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
 * Apple permits four changes — call to action, color, size, corner radius —
 * plus the label's language. There is no logo option because the control is
 * drawn natively, not composed from CSS. Do NOT widen this interface without a
 * page below saying the property is supported: an unsupported declaration is
 * dropped silently rather than rejected.
 *
 * - type:   https://developer.apple.com/documentation/applepayontheweb/displaying-apple-pay-buttons-using-css
 * - rest:   https://developer.apple.com/documentation/applepayontheweb/styling-the-apple-pay-button-using-css
 * - locale: https://developer.apple.com/documentation/applepayontheweb/localizing-apple-pay-buttons-using-css
 */
export interface ApplePayButtonCustomization {
  /**
   * Maps to -apple-pay-button-type. Defaults to 'buy'. Grouped by the Apple Pay
   * on the Web version that introduced each value; an older Safari substitutes
   * the plain button rather than failing.
   */
  type?: // Version 2
    | 'buy'
    | 'donate'
    | 'plain'
    | 'set-up'
    // Version 4
    | 'book'
    | 'check-out'
    | 'subscribe'
    // Version 10
    | 'add-money'
    | 'contribute'
    | 'order'
    | 'reload'
    | 'rent'
    | 'support'
    | 'tip'
    | 'top-up'
    // Version 12
    | 'continue';
  /** Maps to -apple-pay-button-style. Defaults to 'black'. */
  style?: 'black' | 'white' | 'white-outline';
  /**
   * BCP 47 tag for the label, e.g. 'es-MX'. Applied as the button's `lang`
   * attribute: Apple has no `-apple-pay-button-locale` property.
   */
  locale?: string;
  /**
   * Any CSS length. Apple's minimum is 100pt for `plain`, 140pt otherwise —
   * below it, or too narrow for the translated label, Apple substitutes the
   * plain button.
   */
  width?: string;
  /** Any CSS length. Apple's minimum is 30pt. */
  height?: string;
  /**
   * Any CSS length. A SINGLE value: Apple applies the largest to all four
   * corners. Defaults to 4pt.
   */
  border_radius?: string;
}

/** Root customization object accepted by `createTonder`. */
export interface TonderCustomization {
  card_fields?: CardFieldsCustomization;
  /** Styles for the SDK-rendered Apple Pay button. */
  apple_pay_button?: ApplePayButtonCustomization;
}
