// Public surface of @tonder.io/web-sdk. Named exports only — no heavy barrels —
// to keep the bundle tree-shakeable.

export { createTonder, Tonder } from './tonder';

export { AppError, buildPublicAppError } from './shared/errors/AppError';
export { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';

export type { ThreeDsHostPort } from './ports/threeds-host.port';

export type {
  AppErrorInput,
  BuildPublicAppErrorInput,
} from './shared/errors/AppError';
// `TonderBaseUrls` is deliberately NOT exported: pick the environment with
// `TonderConfig.environment`.
export type { TonderMode } from './shared/config/env';
export type {
  TonderConfig,
  TonderSession,
  TonderEvents,
  PresentationEvents,
  PaymentEvents,
  PaymentMethod,
  PayInput,
  BillingAddress,
  RawTransaction,
  Card,
  Customer,
  EnrollResult,
  PaymentMethodInfo,
  PaymentMethodBank,
  PaymentMethodBanks,
} from './shared/types';

export type { BackendNextAction } from './models/transaction.model';

export type { TonderMountableComponent } from './types/component';
export type {
  CardField,
  RevealableCardField,
  CardFieldState,
  CardFieldEvents,
  CardFieldEntry,
  CardFieldsOptions,
  RevealCardField,
  RevealCardFieldsInput,
  TonderComponentType,
  TonderComponent,
  ComponentOptionsByType,
  ComponentByType,
  CardFieldsComponent,
} from './types/card';
// Apple Pay is reached through `create('apple_pay_button', …)` and
// `isApplePayAvailable()`. The ports, adapter, validation service and checkout
// orchestration stay unexported.
export type {
  ApplePayAvailability,
  ApplePayButtonOptions,
  ApplePayPaymentInput,
  ApplePayButtonComponent,
} from './types/apple-pay';
export type {
  TonderCustomization,
  CardFieldsCustomization,
  ApplePayButtonCustomization,
  CardFieldErrorMessages,
  CardStyles,
  CardLabels,
  CardPlaceholders,
  FieldStyles,
  StyleBlock,
  CollectInputStyles,
  LabelStyles,
  ErrorTextStyles,
} from './types/customization';
