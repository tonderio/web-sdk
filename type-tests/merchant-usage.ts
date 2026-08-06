/**
 * Merchant-shaped usage of the published type surface.
 *
 * This file is a TEST, and compiling it is the assertion. It imports from
 * `@tonder.io/web-sdk` — resolved to `dist/index.d.ts` by this directory's
 * `tsconfig.json` — so it can only compile while every type it names is
 * actually EXPORTED from the package entry point.
 *
 * A type declared in `dist/index.d.ts` but not exported from it still appears
 * in tooltips and still types the signature it sits on, so nothing inside this
 * repository notices it is unreachable. A merchant notices immediately:
 *
 *   error TS2459: Module '@tonder.io/web-sdk' declares 'BillingAddress'
 *   locally, but it is not exported.
 *
 * Each block below writes the code a merchant would actually write. Annotating
 * every variable is deliberate — inference would hide the defect, because an
 * inferred type needs no name and therefore no export.
 */
import { createTonder } from '@tonder.io/web-sdk';
import type {
  ApplePayAvailability,
  BackendNextAction,
  BillingAddress,
  CardField,
  CardFieldEvents,
  CardFieldState,
  CardFieldsOptions,
  CollectInputStyles,
  ComponentByType,
  ComponentOptionsByType,
  ErrorTextStyles,
  FieldStyles,
  LabelStyles,
  PayInput,
  RawTransaction,
  StyleBlock,
  TonderComponentType,
  TonderCustomization,
} from '@tonder.io/web-sdk';

/** A merchant collects the shopper's address in its own form state. */
export const billingAddress: BillingAddress = {
  street: 'Av. Paseo de la Reforma 222',
  street2: 'Piso 12',
  state: 'CDMX',
  country: 'MX',
  zip_code: '06600',
};

/** ...and passes it through to `pay()`. */
export const payInput: PayInput = {
  amount: 149.5,
  currency: 'MXN',
  return_url: 'https://shop.example/checkout/return',
  payment_method: { type: 'card' },
  client_reference: 'order-1042',
  billing_address: billingAddress,
};

/**
 * A standalone field handler, extracted from the options object so it can be
 * unit-tested. Extracting it is what forces `CardFieldState` to have a name.
 */
export function onCardFieldChange(state: CardFieldState): void {
  const field: CardField = state.element_type;
  if (!state.is_valid && !state.is_empty) {
    console.warn(`[checkout] ${field}: ${state.error ?? 'invalid'}`);
  }
}

/** The per-field callback map, built as a reusable variable. */
export const cardFieldEvents: CardFieldEvents = {
  on_change: onCardFieldChange,
  on_blur: onCardFieldChange,
  on_focus: onCardFieldChange,
  on_ready: onCardFieldChange,
};

/** A style block shared across fields, built once and reused. */
export const inputBase: StyleBlock = {
  fontSize: '16px',
  color: '#1a1a1a',
  fontFamily: 'Inter, sans-serif',
};

export const inputStyles: CollectInputStyles = {
  base: inputBase,
  focus: { borderColor: '#0055ff' },
  invalid: { color: '#c00000' },
};

export const labelStyles: LabelStyles = {
  base: { fontWeight: 600 },
  requiredAsterisk: { color: '#c00000' },
};

export const errorStyles: ErrorTextStyles = {
  base: { fontSize: '12px', color: '#c00000' },
};

export const fieldStyles: FieldStyles = {
  input_styles: inputStyles,
  label_styles: labelStyles,
  error_styles: errorStyles,
};

/** The full customization object, assembled from the pieces above. */
export const customization: TonderCustomization = {
  card_fields: {
    styles: { card_form: fieldStyles, cvv: { input_styles: inputStyles } },
    labels: { card_number: 'Card number' },
  },
};

export const cardFieldsOptions: CardFieldsOptions = {
  fields: ['card_number', { field: 'cvv', container_id: '#my-cvv' }],
  events: { card_number: cardFieldEvents, cvv: cardFieldEvents },
};

/**
 * A generic wrapper over `create()` — the only usage that needs the component
 * maps, since a helper generic over `TonderComponentType` has no other way to
 * spell its parameter and return types.
 */
export function makeComponent<T extends TonderComponentType>(
  tonder: ReturnType<typeof createTonder>,
  type: T,
  options: ComponentOptionsByType[T],
): ComponentByType[T] {
  return tonder.create(type, options);
}

/**
 * A merchant reads `next_action` off the transaction `pay()` returned and
 * hands it to its own redirect helper.
 */
export function resolveRedirectUrl(
  nextAction: BackendNextAction | undefined,
): string | null {
  return nextAction?.redirect_to_url?.url ?? null;
}

export function afterPay(transaction: RawTransaction): string | null {
  return transaction.status === 'Pending'
    ? resolveRedirectUrl(transaction.next_action)
    : null;
}

/**
 * A merchant decides whether to render the Apple Pay button, and logs the
 * reason when it will not render.
 *
 * The annotated parameter is what forces `ApplePayAvailability` to be nameable:
 * a merchant who wants this decision in a testable function of its own cannot
 * write it while the type is unreachable. Reading `code` and `message` only
 * after checking `available` is the narrowing assertion — outside the `if`,
 * neither field exists on the union.
 */
export function shouldRenderApplePayButton(
  availability: ApplePayAvailability,
): boolean {
  if (!availability.available) {
    console.info(
      `[checkout] Apple Pay hidden: ${availability.code} — ${availability.message}`,
    );
    return false;
  }
  return true;
}

/** The same decision taken straight off the instance, as a merchant would. */
export function renderApplePay(
  tonder: ReturnType<typeof createTonder>,
): boolean {
  return shouldRenderApplePayButton(tonder.isApplePayAvailable());
}
