/**
 * Apple Pay checkout orchestration: session lifecycle, the merchant-validation
 * round trip, and the `/process` response mapping.
 *
 * PURE. Everything arrives through injected deps, so it holds no DOM reference,
 * reads no global, and issues no `fetch` of its own.
 *
 * ONE INSTANCE PER BUTTON COMPONENT, never one per `Tonder`: the class holds
 * exactly one mutable field, the live session, and a shared instance would let
 * a second button's `unmount()` abort the first button's live sheet.
 */
import type { DirectApiService } from './direct-api.service';
import { ApplePayService } from './apple-pay.service';
import {
  buildApplePayPaymentMethod,
  buildApplePayPaymentRequest,
} from '../strategies/apple-pay.strategy';
import {
  buildProcessBody,
  resolveRequestId,
  DEFAULT_CURRENCY,
} from '../strategies/process-body.strategy';
import {
  isSuccessfulStatus,
  toRawTransaction,
} from '../../models/transaction.model';
import type { ApplePayConfig } from '../../models/business.model';
import type { TelemetryPort } from '../../ports/telemetry.port';
import { elapsedSince, failureFields } from '../telemetry/flow';
import type {
  ApplePayPaymentToken,
  ApplePayPort,
  ApplePaySessionHandle,
} from '../../ports/apple-pay.port';
import type { ApplePayPaymentInput } from '../../types/apple-pay';
import type { Customer, PaymentEventSink } from '../../shared/types';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import { snapshotPaymentInput } from '../../shared/payment-input-snapshot';

/** Values read LIVE, at click or authorization time. Never snapshotted. */
export interface ApplePayCheckoutContext {
  /** The business config's `apple_pay` block, read live from state. */
  applePay: ApplePayConfig | undefined;
  customer: Customer | undefined;
  presentationMode: 'redirect' | 'embedded';
  businessPk: number | undefined;
}

export interface ApplePayCheckoutDeps {
  applePay: ApplePayPort;
  validation: ApplePayService;
  /**
   * Charges the payment on whichever system the business is on. The engine is
   * chosen by the owner of this dep at call time, never captured here.
   */
  payments: Pick<DirectApiService, 'processPayment'>;
  /** Reports the steps of the payment: start, charge and result. */
  telemetry: TelemetryPort;
  /** Live reads at click/fire time. Never snapshotted. */
  getContext(): ApplePayCheckoutContext;
  /**
   * The ONE emit surface. Reads `config.events.payment` at fire time, isolates
   * the merchant's callback, and cannot throw back into this service. Owned by
   * the facade because `core/` may not touch `console`.
   */
  emit: PaymentEventSink;
}

export interface ApplePayCheckoutStartInput {
  /** Object, or the merchant's SYNCHRONOUS function. */
  payment: ApplePayPaymentInput | (() => ApplePayPaymentInput);
  /** Narrowed by the `mount()` gate — hence an argument, not a deps read. */
  countryCode: string;
  /** Narrowed by the `mount()` gate. */
  merchantName: string;
}

/** Where one Apple Pay payment is, for the telemetry of its steps. */
interface ApplePayFlow {
  step: string;
  stepStartedAt: number;
  requestId?: string;
}

const APPLE_PAY_TYPE = 'APPLE_PAY';

export class ApplePayCheckoutService {
  private readonly deps: ApplePayCheckoutDeps;
  private session: ApplePaySessionHandle | null = null;

  constructor(deps: ApplePayCheckoutDeps) {
    this.deps = deps;
  }

  /**
   * Begin a checkout from the button's click.
   *
   * DELIBERATELY NOT `async`. Apple's `ApplePaySession` constructor throws
   * outside a user-gesture handler, and one `await` before it breaks the chain
   * in a way that is invisible outside real Safari. Without the `async` keyword
   * an `await` added here is a compile error (TS2705), and there is nothing to
   * await anyway. Do NOT add `async` to make something convenient.
   *
   * Never throws: there is no promise a merchant is holding at click time, so
   * the only report channel is `events.payment.on_error`.
   */
  public start(input: ApplePayCheckoutStartInput): void {
    const flow: ApplePayFlow = { step: 'start', stepStartedAt: Date.now() };
    try {
      const ctx = this.deps.getContext();
      // Copied, not aliased: this is read again at `onPaymentAuthorized`, and
      // a cart that changes while the sheet is open would charge a price the
      // shopper never saw.
      const payment = snapshotPaymentInput(
        typeof input.payment === 'function' ? input.payment() : input.payment,
      );
      const currency = payment.currency ?? DEFAULT_CURRENCY;

      const request = buildApplePayPaymentRequest({
        amount: payment.amount,
        currencyCode: currency,
        countryCode: input.countryCode,
        merchantName: input.merchantName,
        applePay: ctx.applePay,
      });

      this.session = this.deps.applePay.createSession(request, {
        onValidateMerchant: () => this.onValidateMerchant(flow),
        onPaymentAuthorized: (token) =>
          this.onPaymentAuthorized(token, payment, currency, flow),
        onCancel: () => this.onCancel(),
      });
      this.session.begin();
    } catch (error) {
      this.deps.telemetry.flowFailed('start', {
        ...failureFields(error),
        duration_ms: elapsedSince(flow.stepStartedAt),
        payment_method_type: APPLE_PAY_TYPE,
      });
      this.emitError(error);
    }
  }

  /**
   * Dismiss a live sheet and release ownership. Idempotent.
   *
   * Nulling the session is what makes a late `onPaymentAuthorized` drop the
   * charge — the `if (!session) return` guards below are that behavior, not
   * defensive padding.
   */
  public abort(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.abort();
  }

  private async onValidateMerchant(flow: ApplePayFlow): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      session.completeMerchantValidation(
        await this.deps.validation.validateMerchant(),
      );
      this.advance(flow, 'charge');
    } catch (error) {
      this.deps.telemetry.flowFailed('start', {
        ...failureFields(error),
        duration_ms: elapsedSince(flow.stepStartedAt),
        payment_method_type: APPLE_PAY_TYPE,
      });
      session.abort();
      this.session = null;
      // Re-emitted AS-IS: `ApplePayService` already wraps transport failures as
      // APPLE_PAY_VALIDATION_ERROR, and re-wrapping here would surface
      // PAYMENT_PROCESS_ERROR instead, costing the merchant the actionable code.
      this.emitError(error);
    }
  }

  private async onPaymentAuthorized(
    token: ApplePayPaymentToken,
    payment: ApplePayPaymentInput,
    currency: string,
    flow: ApplePayFlow,
  ): Promise<void> {
    // Captured into a local BEFORE ownership is released, so the sheet can
    // still be settled on every path — including the throw path below.
    const session = this.session;
    if (!session) return;
    this.session = null;

    try {
      const ctx = this.deps.getContext();
      const requestId = resolveRequestId(
        payment.idempotency_key,
        ctx.businessPk,
      );
      flow.requestId = requestId;
      const raw = await this.deps.payments.processPayment(
        buildProcessBody({
          payment,
          // The token travels BY REFERENCE, whole and unread. The SDK is a
          // courier; it does not decide which parts the backend needs.
          paymentMethod: buildApplePayPaymentMethod(token),
          customer: ctx.customer,
          currency,
          presentationMode: ctx.presentationMode,
        }),
        requestId,
      );
      this.advance(flow, 'result');

      const tx = toRawTransaction(raw);
      // ONE rule decides the channel: a transaction goes to `on_completed`, and
      // only an operational failure — where there is no transaction — goes to
      // `on_error`. A DECLINE therefore arrives here, and so does a response
      // carrying `next_action`: `on_error` takes no transaction, so routing
      // either there would cost the merchant the id they need to reconcile.
      //
      // Apple is told `failure` for both, because the charge was not approved.
      session.completePayment({
        status: isSuccessfulStatus(tx.status) ? 'success' : 'failure',
      });
      this.deps.emit.onCompleted(tx);
      this.deps.telemetry.flowStep('result', {
        ...this.fields(flow),
        outcome: isSuccessfulStatus(tx.status) ? 'ok' : 'error',
      });
    } catch (error) {
      // ALWAYS first: the merchant's callback commonly navigates.
      session.completePayment({ status: 'failure' });
      this.deps.telemetry.flowFailed(flow.step, {
        ...this.fields(flow),
        ...failureFields(error),
      });
      this.emitError(error);
    }
  }

  /** Close the current step as done and open `next`. */
  private advance(flow: ApplePayFlow, next: string): void {
    this.deps.telemetry.flowStep(flow.step, {
      ...this.fields(flow),
      outcome: 'ok',
    });
    flow.step = next;
    flow.stepStartedAt = Date.now();
  }

  private fields(flow: ApplePayFlow) {
    return {
      duration_ms: elapsedSince(flow.stepStartedAt),
      payment_method_type: APPLE_PAY_TYPE,
      ...(flow.requestId ? { request_id: flow.requestId } : {}),
    };
  }

  private onCancel(): void {
    // The sheet is already dismissed; completing it would be a second settle.
    this.session = null;
    this.deps.emit.onCancel();
  }

  /**
   * The ONE `on_error` site in this service. Cannot throw: a merchant callback
   * that throws must not disturb an already-settled sheet.
   */
  private emitError(error: unknown): void {
    this.deps.emit.onError(
      error instanceof AppError
        ? error
        : new AppError({
            errorCode: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
            originalError: error,
          }),
    );
  }
}
