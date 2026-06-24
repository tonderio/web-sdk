import type {
  CardFieldErrorMessages,
  CardFieldsCustomization,
} from './customization';

/**
 * Secure card fields the SDK can mount into your checkout form.
 *
 * Values are stable public identifiers used in component options,
 * customization, and field event callbacks.
 */
export type CardField =
  | 'cvv'
  | 'card_number'
  | 'expiration_month'
  | 'expiration_year'
  | 'cardholder_name';

/**
 * Card fields that can be revealed via secure reveal elements.
 *
 * `cvv` is intentionally excluded: PCI DSS Requirement 3.2.1 prohibits storing or
 * displaying the card verification value after authorisation.
 */
export type RevealableCardField = Exclude<CardField, 'cvv'>;

/**
 * Normalized state of a secure card field, delivered to merchant event callbacks.
 *
 * The SDK never exposes raw secure-field internals to application code. This is
 * the stable event payload delivered to card-field callbacks. The `error` value
 * is `null` when the field is valid.
 */
export interface CardFieldState {
  /** Which card field emitted the event. */
  readonly element_type: CardField;
  /** Whether the field is currently empty. */
  readonly is_empty: boolean;
  /** Whether the field currently has focus. */
  readonly is_focused: boolean;
  /** Whether the field currently passes validation. */
  readonly is_valid: boolean;
  /** Masked value string when available; never the raw PAN or CVV. */
  readonly value: string;
  /** SDK-owned validation message, or `null` when the field is valid. */
  readonly error: string | null;
}

/**
 * Per-field lifecycle callbacks accepted by `create('card_fields', { events })`.
 * All are optional; each receives the normalized {@link CardFieldState}.
 */
export interface CardFieldEvents {
  on_change?(state: CardFieldState): void;
  on_blur?(state: CardFieldState): void;
  on_focus?(state: CardFieldState): void;
  on_ready?(state: CardFieldState): void;
}

/**
 * Override map for the SDK's default (English) field error copy. Use `required`
 * for empty-field messages, `invalid` as the generic fallback, or a specific
 * {@link CardField} key to override a single field. This is a copy override map,
 * NOT a full i18n system. Configure it at `customization.card_fields.error_messages`.
 */
export type FieldErrorMessages = CardFieldErrorMessages;

/**
 * One entry in {@link CardFieldsOptions.fields}. Either the bare field name
 * (uses the default container id) or an object overriding the container id.
 *
 * Default container ids (kebab-case HTML id attributes):
 * - `card_number`      → `#collect-card-number`
 * - `cvv`            → `#collect-cvv`  (saved card: `#collect-cvv-<card_id>`)
 * - `expiration_month` → `#collect-expiration-month`
 * - `expiration_year`  → `#collect-expiration-year`
 * - `cardholder_name`  → `#collect-cardholder-name`
 */
export type CardFieldEntry =
  | CardField
  | { field: CardField; container_id?: string };

/**
 * Construction options for a `'card_fields'` component
 * (`tonder.create('card_fields', options)`).
 *
 * Two scenarios:
 * - **New card form** (no `card_id`): mounts the fields used by
 *   `pay({ payment_method: { type: 'card' }, ... })` and `enrollCard()`.
 *   Default container ids are kebab-case (e.g. `#collect-card-number`).
 * - **Saved-card CVV** (with `card_id`): mounts the CVV field for that saved
 *   card. Default container id is `#collect-cvv-<card_id>`.
 */
export interface CardFieldsOptions {
  /**
   * Fields to mount. Omit to mount the full new-card form using default
   * containers: cardholder name, card number, expiration month, expiration year,
   * and CVV.
   */
  fields?: CardFieldEntry[];
  /** Identifier of a saved card. When present, mounts the saved-card CVV field. */
  card_id?: string;
  /**
   * Which previously-mounted context(s) to unmount before mounting. Defaults to
   * `'all'`. Use `'none'` to keep existing contexts, `'current'` to replace only
   * the context being mounted, or a specific context key.
   */
  unmount_context?: 'all' | 'none' | 'current' | 'create' | string;
  /**
   * Optional per-field lifecycle callbacks. Keyed by public {@link CardField}
   * name; each field may supply any subset of {@link CardFieldEvents}. Events
   * are per-component (context-aware), so a saved-card CVV component and a
   * new-card component carry independent event maps.
   */
  events?: Partial<Record<CardField, CardFieldEvents>>;
}

/**
 * Per-field reveal configuration. The string shorthand form applies all defaults.
 *
 * Redaction levels are fixed by the SDK per PCI DSS and cannot be overridden:
 * - `card_number`      → `MASKED` (first-6 / last-4 only)
 * - `cardholder_name`  → `PLAIN_TEXT`
 * - `expiration_month` → `PLAIN_TEXT`
 * - `expiration_year`  → `PLAIN_TEXT`
 *
 * Default reveal container ids (kebab-case):
 * - `card_number`      → `#reveal-card-number`
 * - `cardholder_name`  → `#reveal-cardholder-name`
 * - `expiration_month` → `#reveal-expiration-month`
 * - `expiration_year`  → `#reveal-expiration-year`
 */
export interface RevealCardField {
  /** The card field to reveal. CVV is not allowed per PCI DSS req. 3.2.1. */
  field: RevealableCardField;
  /** Container id for the reveal element. Defaults to `#reveal-<kebab-field>`. */
  container_id?: string;
  /** Placeholder shown inside the iframe before `reveal()` resolves. */
  alt_text?: string;
  /** Label rendered above the element. */
  label?: string;
  /** Per-field reveal styles. Overrides {@link RevealCardFieldsInput.styles}. */
  styles?: CardFieldsCustomization['styles'];
}

/**
 * Input accepted by a `'card_fields'` component's `reveal()` method. Reveals the
 * tokens captured by the last `collect()` into merchant-provided containers.
 * Redaction is fixed.
 */
export interface RevealCardFieldsInput {
  /**
   * Fields to reveal. Each entry is a bare {@link RevealableCardField} (defaults)
   * or a {@link RevealCardField} object. CVV is not a valid option.
   */
  fields: (RevealableCardField | RevealCardField)[];
  /** Global reveal styles. Per-field `styles` take priority. */
  styles?: CardFieldsCustomization['styles'];
}

/**
 * The set of UI component types the SDK can construct via
 * `tonder.create(type, options)`. Declared as a union with a single member for
 * now (`'card_fields'`); future roadmap components (`'saved_cards'`, `'checkout'`,
 * `'apmSelector'`) extend it additively with zero breaking change.
 */
export type TonderComponentType = 'card_fields';

/**
 * Handle returned by `tonder.create('card_fields', options)`.
 *
 * Use it to mount, unmount, and reveal secure card fields for the configured
 * component instance.
 */
export interface CardFieldsComponent {
  /**
   * Mount the secure card fields into their per-field containers (from
   * `options.fields`). Requires `init()` to have completed.
   */
  mount(): Promise<void>;
  /** Unmount this component's fields. */
  unmount(): void;
  /**
   * Reveal the last-collected tokens into merchant reveal containers. Replaces
   * the removed top-level `revealCardFields`. Scoped to this component's collect.
   */
  reveal(request: RevealCardFieldsInput): Promise<void>;
}

/**
 * Union of all component handles `tonder.create()` can return. Today just
 * {@link CardFieldsComponent}; grows with the component roadmap.
 */
export type TonderComponent = CardFieldsComponent;

/**
 * Maps each {@link TonderComponentType} to its construction options. Lets
 * `create<T>(type, options)` type-check `options` against the chosen `type`.
 */
export type ComponentOptionsByType = Record<
  TonderComponentType,
  CardFieldsOptions | undefined
>;
