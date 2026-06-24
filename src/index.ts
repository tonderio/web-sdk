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
export type { TonderMode, TonderBaseUrls } from './shared/config/env';
export type {
  TonderConfig,
  TonderSession,
  TonderEvents,
  PresentationEvents,
  PaymentMethod,
  PayInput,
  RawTransaction,
  Card,
  Customer,
  EnrollResult,
  PaymentMethodInfo,
  PaymentMethodBank,
  PaymentMethodBanks,
} from './shared/types';

export type {
  CardField,
  RevealableCardField,
  CardFieldEntry,
  CardFieldsOptions,
  RevealCardField,
  RevealCardFieldsInput,
  TonderComponentType,
  TonderComponent,
  CardFieldsComponent,
} from './types/card';
export type {
  TonderCustomization,
  CardFieldsCustomization,
  CardFieldErrorMessages,
  CardStyles,
  CardLabels,
  CardPlaceholders,
  FieldStyles,
} from './types/customization';
