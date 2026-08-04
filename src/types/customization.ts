/**
 * Styling and customization types for SDK-rendered UI surfaces.
 *
 * `TonderCustomization` is namespaced by surface. Today the SDK supports
 * `card_fields`; future checkout surfaces can add sibling keys without changing
 * the card-fields contract.
 *
 * Style records are intentionally open (`Record<string, unknown>`) so you can
 * pass CSS-in-JS declarations supported by the secure card-field renderer.
 */

/** A single CSS-in-JS style block (the `base` variant and friends). */
export type StyleBlock = Record<string, unknown>;

/** Input-element style variants accepted by a secure field element. */
export interface CollectInputStyles {
  base?: StyleBlock;
  focus?: StyleBlock;
  complete?: StyleBlock;
  invalid?: StyleBlock;
  empty?: StyleBlock;
  global?: StyleBlock;
  /** Position/style overrides for the card network icon when supported. */
  cardIcon?: StyleBlock;
}

/** Label-element style variants. */
export interface LabelStyles {
  base?: StyleBlock;
  global?: StyleBlock;
  requiredAsterisk?: StyleBlock;
}

/** Error-text style variants. */
export interface ErrorTextStyles {
  base?: StyleBlock;
  global?: StyleBlock;
}

/**
 * Styles for a single field (or the global `card_form`). Per-field entries
 * override the `card_form` defaults for that field only.
 */
export interface FieldStyles {
  input_styles?: CollectInputStyles;
  label_styles?: LabelStyles;
  error_styles?: ErrorTextStyles;
}

/** Style overrides, global plus per-field. */
export interface CardStyles {
  /** Default styles applied to every field. */
  card_form?: FieldStyles;
  /** Overrides for the cardholder-name field. */
  cardholder_name?: FieldStyles;
  /** Overrides for the card-number field. */
  card_number?: FieldStyles;
  /** Overrides for the CVV field. */
  cvv?: FieldStyles;
  /** Overrides for the expiration-month field. */
  expiration_month?: FieldStyles;
  /** Overrides for the expiration-year field. */
  expiration_year?: FieldStyles;
  /**
   * Show the card-network icon inside the card-number element. When enabled
   * (the default) the SDK injects a left padding so the text clears the icon.
   * @default true
   */
  enable_card_icon?: boolean;
}

/** Label overrides shown above each field. */
export interface CardLabels {
  cardholder_name?: string;
  card_number?: string;
  cvv?: string;
  expiry_date?: string;
  expiration_month?: string;
  expiration_year?: string;
}

/** Placeholder overrides shown inside each field. */
export interface CardPlaceholders {
  cardholder_name?: string;
  card_number?: string;
  cvv?: string;
  expiration_month?: string;
  expiration_year?: string;
}

/**
 * Override map for the SDK's default (English) field error copy. Use `required`
 * for empty-field messages, `invalid` as the generic fallback, or a specific
 * card field key to override a single field. This is a copy override map, not a
 * full i18n system.
 */
export type CardFieldErrorMessages = Partial<
  Record<
    | 'cvv'
    | 'card_number'
    | 'expiration_month'
    | 'expiration_year'
    | 'cardholder_name'
    | 'required'
    | 'invalid',
    string
  >
>;

/** Customization for the secure card-fields surface. */
export interface CardFieldsCustomization {
  styles?: CardStyles;
  labels?: CardLabels;
  placeholders?: CardPlaceholders;
  error_messages?: CardFieldErrorMessages;
}

/**
 * Customization for the Apple Pay button surface.
 *
 * Set it at `customization.apple_pay_button`; `mount()` forwards it to the
 * renderer unchanged, and the adapter emits the documented defaults for every
 * field left absent.
 *
 * There is deliberately no image, icon, or logo option: Apple's HIG forbids
 * custom Apple Pay artwork, which is why the button is rendered via
 * `-webkit-appearance: -apple-pay-button` rather than an `<img>`. Every field
 * maps to a WebKit CSS property Apple actually exposes; Apple's own tokens keep
 * Apple's casing (`check-out`, `white-outline`) — that is Apple's contract.
 */
export interface ApplePayButtonCustomization {
  /** Maps to -apple-pay-button-type. Defaults to 'buy'. */
  type?:
    | 'buy'
    | 'plain'
    | 'donate'
    | 'book'
    | 'subscribe'
    | 'check-out'
    | 'set-up'
    | 'continue'
    | 'order';
  /** Maps to -apple-pay-button-style. Defaults to 'black'. */
  style?: 'black' | 'white' | 'white-outline';
  /** Maps to -apple-pay-button-locale, e.g. 'es-MX'. */
  locale?: string;
  height?: string;
  border_radius?: string;
}

/** Root customization object accepted by `createTonder`. */
export interface TonderCustomization {
  card_fields?: CardFieldsCustomization;
  /** Styles for the SDK-rendered Apple Pay button. */
  apple_pay_button?: ApplePayButtonCustomization;
}
