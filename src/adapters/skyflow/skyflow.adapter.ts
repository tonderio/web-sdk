import type { VaultService } from '../../core/services/vault.service';
import type { TokenizerPort } from '../../ports/tokenizer.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { TonderMode } from '../../shared/config/env';
import type {
  CardField,
  CardFieldEvents,
  CardFieldState,
  FieldErrorMessages,
  CardFieldsOptions,
  RevealCardField,
  RevealCardFieldsInput,
  CardFieldEntry,
  RevealableCardField,
} from '../../types/card';
import type {
  CardFieldsCustomization,
  ErrorTextStyles,
  FieldStyles,
  LabelStyles,
} from '../../types/customization';
import type {
  SkyflowCollectContainer,
  SkyflowElement,
  SkyflowElementState,
  SkyflowInstance,
  SkyflowRevealContainer,
  SkyflowSdkLoader,
  SkyflowStatic,
} from './skyflow-loader';

/** Vault config the adapter needs from core state (set by `init()`). */
export interface VaultConfig {
  vault_id: string;
  vault_url: string;
}

/** Dependencies injected into the adapter (the testability seam). */
export interface SkyflowAdapterDeps {
  loader: SkyflowSdkLoader;
  vaultService: VaultService;
  /** Reads `vault_id`/`vault_url` from core state. Null until `init()` ran. */
  getVaultConfig: () => VaultConfig | null;
  mode: TonderMode;
  customization?: CardFieldsCustomization;
  /** Merchant overrides for the SDK's default field error copy. */
  error_messages?: FieldErrorMessages;
}

/** Default error copy shown inside secure fields on blur. */
const DEFAULT_REQUIRED_MESSAGE = 'El campo es requerido';
const DEFAULT_INVALID_MESSAGE = 'Campo no válido';

/** Reverse of {@link CARD_FIELD_META}: internal vault column → public snake_case field. */
const FIELD_BY_COLUMN: Record<string, CardField> = {
  card_number: 'card_number',
  cvv: 'cvv',
  expiration_month: 'expiration_month',
  expiration_year: 'expiration_year',
  cardholder_name: 'cardholder_name',
};

/** Elements + their Skyflow Collect container, keyed per mount context. */
interface MountedContext {
  elements: SkyflowElement[];
  container: SkyflowCollectContainer;
}

const CONTEXT_CREATE = 'create';
const CARD_NUMBER_PADDING_LEFT = '15px';
const MOUNT_RETRIES = 2;
const MOUNT_RETRY_DELAY_MS = 30;

/**
 * Maps each public CardField to:
 * - `column`: the internal Skyflow snake_case column name (backend vault schema).
 * - `defaultContainerId`: the kebab-case HTML id used when no explicit container is given.
 *
 * The saved-card CVV default id (`#collect-cvv-<card_id>`) is built dynamically in
 * `collectContainerId()` and is NOT in this map.
 */
const CARD_FIELD_META: Record<
  CardField,
  { column: string; defaultContainerId: string }
> = {
  card_number: {
    column: 'card_number',
    defaultContainerId: '#collect-card-number',
  },
  cvv: { column: 'cvv', defaultContainerId: '#collect-cvv' },
  expiration_month: {
    column: 'expiration_month',
    defaultContainerId: '#collect-expiration-month',
  },
  expiration_year: {
    column: 'expiration_year',
    defaultContainerId: '#collect-expiration-year',
  },
  cardholder_name: {
    column: 'cardholder_name',
    defaultContainerId: '#collect-cardholder-name',
  },
};

/**
 * Default reveal container ids (kebab-case). CVV is excluded (PCI DSS req. 3.2.1).
 */
const REVEAL_DEFAULT_CONTAINER_ID: Record<RevealableCardField, string> = {
  card_number: '#reveal-card-number',
  expiration_month: '#reveal-expiration-month',
  expiration_year: '#reveal-expiration-year',
  cardholder_name: '#reveal-cardholder-name',
};

const DEFAULT_FONT_FAMILY = '"Inter", sans-serif';

const DEFAULT_INPUT_STYLES = {
  base: {
    border: '1px solid #e0e0e0',
    padding: '10px 7px',
    borderRadius: '5px',
    color: '#1d1d1d',
    marginTop: '2px',
    backgroundColor: 'white',
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: '16px',
    '&::placeholder': {
      color: '#ccc',
    },
  },
  cardIcon: {
    position: 'absolute',
    left: '6px',
    bottom: 'calc(50% - 12px)',
  },
  complete: {
    color: '#4caf50',
  },
  invalid: {
    border: '1px solid #f44336',
  },
  empty: {},
  focus: {},
  global: {
    '@import':
      'url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700&display=swap")',
  },
};
const DEFAULT_LABEL_STYLES: LabelStyles = {
  base: {
    fontSize: '12px',
    fontWeight: '500',
    fontFamily: DEFAULT_FONT_FAMILY,
  },
};
const DEFAULT_ERROR_STYLES: ErrorTextStyles = {
  base: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#f44336',
    fontFamily: DEFAULT_FONT_FAMILY,
  },
};

const DEFAULT_LABELS: Record<CardField, string> = {
  cardholder_name: 'Titular de la tarjeta',
  card_number: 'Número de tarjeta',
  cvv: 'CVC/CVV',
  expiration_month: 'Mes',
  expiration_year: 'Año',
};
const DEFAULT_PLACEHOLDERS: Record<CardField, string> = {
  cardholder_name: 'Nombre como aparece en la tarjeta',
  card_number: '1234 1234 1234 1234',
  cvv: '3-4 dígitos',
  expiration_month: 'MM',
  expiration_year: 'AA',
};

const STYLE_KEY_BY_FIELD: Record<
  CardField,
  keyof Omit<
    NonNullable<CardFieldsCustomization['styles']>,
    'card_form' | 'enable_card_icon'
  >
> = {
  cardholder_name: 'cardholder_name',
  card_number: 'card_number',
  cvv: 'cvv',
  expiration_month: 'expiration_month',
  expiration_year: 'expiration_year',
};

/**
 * Skyflow Collect/Reveal adapter. Implements {@link TokenizerPort} and is the
 * ONLY place that touches the DOM and the external Skyflow SDK. Initialization
 * is lazy: the SDK loads and `Skyflow.init` runs on the first `mount`/`reveal`.
 *
 * The SDK loader and {@link VaultService} are injected so unit tests run with a
 * fake Skyflow and a mock vault — no script injection, network, or real browser.
 *
 * Public API uses camelCase field names. The mapping to internal Skyflow
 * snake_case column names lives entirely in {@link CARD_FIELD_META}.
 */
export class SkyflowAdapter implements TokenizerPort {
  private readonly deps: SkyflowAdapterDeps;
  private skyflow: SkyflowStatic | null = null;
  private instance: SkyflowInstance | null = null;
  private readonly contexts = new Map<string, MountedContext>();
  private lastCollectedTokens: Record<string, string> | null = null;

  constructor(deps: SkyflowAdapterDeps) {
    this.deps = deps;
  }

  public async mount(request: CardFieldsOptions): Promise<void> {
    const { skyflow, instance } = await this.ensureInitialized();
    const context = request.card_id
      ? `update:${request.card_id}`
      : CONTEXT_CREATE;

    this.handleUnmountContext(request.unmount_context, context);

    const container = instance.container(
      skyflow.ContainerType.COLLECT,
    ) as SkyflowCollectContainer;

    const elements: SkyflowElement[] = [];
    try {
      for (const entry of request.fields ?? []) {
        const field = SkyflowAdapter.fieldOf(entry);
        const meta = CARD_FIELD_META[field];
        const container_id = SkyflowAdapter.collectContainerId(
          entry,
          field,
          request.card_id,
        );
        const element = container.create({
          table: 'cards',
          column: meta.column,
          type: this.typeByField(skyflow, field),
          validations: this.validationsByField(skyflow, field),
          ...this.resolveFieldStyles(field),
          label: this.labelFor(field),
          placeholder: this.placeholderFor(field),
          ...(request.card_id ? { skyflowID: request.card_id } : {}),
        });
        this.wireFieldEvents(skyflow, element, field, request.events?.[field]);
        await this.tryMountElement(element, container_id);
        elements.push(element);
      }
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.MOUNT_COLLECT_ERROR,
        originalError: error,
      });
    }

    this.contexts.set(context, { elements, container });
  }

  public unmount(context?: string): void {
    if (context === undefined) {
      for (const key of [...this.contexts.keys()]) {
        this.unmountContext(key);
      }
      this.contexts.clear();
      return;
    }
    this.unmountContext(context);
    this.contexts.delete(context);
  }

  /**
   * Collect mounted fields into per-field Skyflow tokens.
   * Returns the raw Skyflow snake_case token map — INTERNAL only.
   * Callers (core/services) must not expose this map directly as public API.
   */
  public async collect(
    contextKey: string = CONTEXT_CREATE,
  ): Promise<Record<string, string>> {
    const context = this.contexts.get(contextKey);
    if (!context) {
      throw new AppError({ errorCode: ErrorKeyEnum.MOUNT_COLLECT_ERROR });
    }
    try {
      const response = await context.container.collect();
      const fields = response?.records?.[0]?.fields ?? {};
      this.lastCollectedTokens = fields;
      return fields;
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.MOUNT_COLLECT_ERROR,
        originalError: error,
      });
    }
  }

  public async reveal(request: RevealCardFieldsInput): Promise<void> {
    const { skyflow, instance } = await this.ensureInitialized();
    if (!this.lastCollectedTokens) {
      throw new AppError({ errorCode: ErrorKeyEnum.NOT_INITIALIZED });
    }
    const tokens = this.lastCollectedTokens;
    const container = instance.container(
      skyflow.ContainerType.REVEAL,
    ) as SkyflowRevealContainer;

    const redactionByField: Record<RevealableCardField, string> = {
      card_number: skyflow.RedactionType.MASKED,
      cardholder_name: skyflow.RedactionType.PLAIN_TEXT,
      expiration_month: skyflow.RedactionType.PLAIN_TEXT,
      expiration_year: skyflow.RedactionType.PLAIN_TEXT,
    };

    for (const entry of request.fields) {
      const isString = typeof entry === 'string';
      const field = (isString ? entry : entry.field) as CardField;

      // CVV must never be revealed — PCI DSS req. 3.2.1.
      if (field === 'cvv') {
        console.warn(
          '[revealCardFields] CVV cannot be revealed (PCI DSS req. 3.2.1). Skipping.',
        );
        continue;
      }

      // Tokens are keyed by Skyflow snake column (internal). Look up via CARD_FIELD_META.
      const column = CARD_FIELD_META[field].column;
      const token = tokens[column];
      if (!token) {
        console.warn(
          `[revealCardFields] No token for field "${field}", skipping.`,
        );
        continue;
      }

      const cfg: Partial<RevealCardField> = isString ? {} : entry;
      const container_id =
        cfg.container_id ??
        REVEAL_DEFAULT_CONTAINER_ID[field as RevealableCardField];
      const element = container.create({
        token,
        redaction: redactionByField[field as RevealableCardField],
        ...(cfg.alt_text !== undefined ? { altText: cfg.alt_text } : {}),
        ...(cfg.label !== undefined ? { label: cfg.label } : {}),
        ...this.resolveRevealStyles(cfg.styles, request.styles),
      });
      await this.tryMountElement(element, container_id);
    }

    try {
      await container.reveal();
    } catch (error) {
      // reveal() returns partial success/error — warn, do not throw.
      console.warn('[revealCardFields] reveal completed with errors:', error);
    }
  }

  /** Lazily loads the SDK and runs `Skyflow.init` once. */
  private async ensureInitialized(): Promise<{
    skyflow: SkyflowStatic;
    instance: SkyflowInstance;
  }> {
    if (this.skyflow && this.instance) {
      return { skyflow: this.skyflow, instance: this.instance };
    }
    const vaultConfig = this.deps.getVaultConfig();
    if (!vaultConfig) {
      throw new AppError({ errorCode: ErrorKeyEnum.NOT_INITIALIZED });
    }

    const skyflow = await this.deps.loader();
    const instance = skyflow.init({
      vaultID: vaultConfig.vault_id,
      vaultURL: vaultConfig.vault_url,
      getBearerToken: () => this.deps.vaultService.fetchVaultToken(),
      options: {
        logLevel: skyflow.LogLevel.ERROR,
        env:
          this.deps.mode === 'production' ? skyflow.Env.PROD : skyflow.Env.DEV,
      },
    });
    this.skyflow = skyflow;
    this.instance = instance;
    return { skyflow, instance };
  }

  private handleUnmountContext(
    unmount_context: string | undefined,
    currentContext: string,
  ): void {
    const value = unmount_context ?? 'all';
    if (value === 'none') return;
    if (value === 'current') {
      this.unmount(currentContext);
      return;
    }
    if (value === 'all') {
      this.unmount();
      return;
    }
    this.unmount(value);
  }

  private unmountContext(context: string): void {
    const data = this.contexts.get(context);
    if (!data) return;
    for (const element of data.elements) {
      try {
        element.unmount?.();
      } catch (error) {
        console.warn(`Error unmounting secure field from '${context}':`, error);
      }
    }
  }

  private labelFor(field: CardField): string {
    const labels = this.deps.customization?.labels;
    const custom = labels?.[field as keyof typeof labels];
    return custom ?? DEFAULT_LABELS[field];
  }

  private placeholderFor(field: CardField): string {
    const placeholders = this.deps.customization?.placeholders;
    const custom = placeholders?.[field as keyof typeof placeholders];
    return custom ?? DEFAULT_PLACEHOLDERS[field];
  }

  private typeByField(skyflow: SkyflowStatic, field: CardField): string {
    const map: Record<CardField, string> = {
      cvv: skyflow.ElementType.CVV,
      card_number: skyflow.ElementType.CARD_NUMBER,
      expiration_month: skyflow.ElementType.EXPIRATION_MONTH,
      expiration_year: skyflow.ElementType.EXPIRATION_YEAR,
      cardholder_name: skyflow.ElementType.CARDHOLDER_NAME,
    };
    return map[field];
  }

  private validationsByField(
    skyflow: SkyflowStatic,
    field: CardField,
  ): { type: string; params: Record<string, unknown> }[] {
    // Skyflow REQUIRES a `params` object on every validation rule, or it rejects
    // the element at mount time. These enforce a non-empty value (and a sane max
    // length on the cardholder name), mirroring the legacy SDK so integrator
    // behavior is unchanged.
    const nonEmpty = /^(?!\s*$).+/;
    const regexRule = {
      type: skyflow.ValidationRuleType.REGEX_MATCH_RULE,
      params: { regex: nonEmpty, error: DEFAULT_REQUIRED_MESSAGE },
    };
    const lengthRule = {
      type: skyflow.ValidationRuleType.LENGTH_MATCH_RULE,
      params: { max: 70 },
    };
    if (field === 'cardholder_name') return [lengthRule, regexRule];
    return [regexRule];
  }

  /**
   * Wires Skyflow element events to merchant callbacks and restores the SDK-owned
   * error label on blur.
   *
   * On blur+invalid the order is LOAD-BEARING and test-covered:
   * the SDK applies the error message before it reapplies `errorTextStyles`.
   * When available, it uses Skyflow's `setErrorOverride`, matching Hosted
   * Checkout behavior for browser/password-manager autofill edge cases.
   *
   * Merchant callbacks always receive the normalized {@link CardFieldState} — the
   * raw Skyflow element state is never passed through.
   */
  private wireFieldEvents(
    skyflow: SkyflowStatic,
    element: SkyflowElement,
    field: CardField,
    events: CardFieldEvents | undefined,
  ): void {
    if (typeof element.on !== 'function') return;

    const emit = (
      state: SkyflowElementState,
      handler: ((state: CardFieldState) => void) | undefined,
    ): void => {
      const normalized = this.toCardFieldState(state, field);
      handler?.(normalized);
    };

    element.on(skyflow.EventName.CHANGE, (state) => {
      emit(state, events?.on_change);
      this.updateErrorLabel(element, field, 'transparent');
    });

    element.on(skyflow.EventName.BLUR, (state) => {
      emit(state, events?.on_blur);
      if (!state.isValid) {
        const message = this.resolveErrorMessage(field, state);
        // Prefer Hosted Checkout's runtime API; fall back for older SDK surfaces.
        if (typeof element.setErrorOverride === 'function') {
          element.setErrorOverride(message);
        } else {
          element.setError?.(message);
        }
      } else {
        element.resetError?.();
      }
      this.updateErrorLabel(element, field);
    });

    element.on(skyflow.EventName.FOCUS, (state) => {
      emit(state, events?.on_focus);
      this.updateErrorLabel(element, field, 'transparent');
      element.resetError?.();
    });

    element.on(skyflow.EventName.READY, (state) => {
      emit(state, events?.on_ready);
    });
  }

  /**
   * Normalizes a raw Skyflow element state into the public {@link CardFieldState}.
   * `element_type` is remapped from the internal snake_case column to the public
   * snake_case field; `error` carries the SDK-owned message (null when valid).
   */
  private toCardFieldState(
    state: SkyflowElementState,
    field: CardField,
  ): CardFieldState {
    return {
      element_type: FIELD_BY_COLUMN[state.elementType] ?? field,
      is_empty: !!state.isEmpty,
      is_focused: !!state.isFocused,
      is_valid: !!state.isValid,
      value: state.value ?? '',
      error: state.isValid ? null : this.resolveErrorMessage(field, state),
    };
  }

  private updateErrorLabel(
    element: SkyflowElement,
    field: CardField,
    color?: string,
  ): void {
    const styles = this.resolveFieldStyles(field) as unknown as {
      errorStyles: ErrorTextStyles;
    };
    const errorStyles = styles.errorStyles;
    element.update?.({
      errorTextStyles: {
        ...errorStyles,
        base: {
          ...(errorStyles.base ?? {}),
          ...(color ? { color } : {}),
        },
      },
    });
  }

  /**
   * Resolves the error copy for an invalid field: empty → `required` override or
   * the English default; non-empty invalid → per-field override, then `invalid`
   * override, then the English default.
   */
  private resolveErrorMessage(
    field: CardField,
    state: SkyflowElementState,
  ): string {
    const overrides = this.deps.error_messages;
    if (state.isEmpty) {
      return overrides?.required ?? DEFAULT_REQUIRED_MESSAGE;
    }
    return overrides?.[field] ?? overrides?.invalid ?? DEFAULT_INVALID_MESSAGE;
  }

  /** Per-field over `card_form` over default; card_number gets icon padding. */
  private resolveFieldStyles(field: CardField): FieldStyles {
    const styles = this.deps.customization?.styles;
    const perField = styles?.[STYLE_KEY_BY_FIELD[field]];
    const form = styles?.card_form;

    const resolvedInput =
      perField?.input_styles ?? form?.input_styles ?? DEFAULT_INPUT_STYLES;

    const iconVisible =
      field === 'card_number' && styles?.enable_card_icon !== false;
    const input_styles = iconVisible
      ? {
          ...resolvedInput,
          base: {
            paddingLeft: CARD_NUMBER_PADDING_LEFT,
            ...(resolvedInput as { base?: Record<string, unknown> }).base,
          },
        }
      : resolvedInput;

    return {
      inputStyles: input_styles,
      labelStyles:
        perField?.label_styles ?? form?.label_styles ?? DEFAULT_LABEL_STYLES,
      errorStyles:
        perField?.error_styles ?? form?.error_styles ?? DEFAULT_ERROR_STYLES,
    } as unknown as FieldStyles;
  }

  private resolveRevealStyles(
    fieldStyles: CardFieldsCustomization['styles'] | undefined,
    globalStyles: CardFieldsCustomization['styles'] | undefined,
  ): Record<string, unknown> {
    const field =
      fieldStyles?.card_form ?? (fieldStyles as FieldStyles | undefined);
    const global =
      globalStyles?.card_form ?? (globalStyles as FieldStyles | undefined);
    const out: Record<string, unknown> = {};
    const input_styles = field?.input_styles ?? global?.input_styles;
    const label_styles = field?.label_styles ?? global?.label_styles;
    const error_styles = field?.error_styles ?? global?.error_styles;
    if (input_styles) out.inputStyles = input_styles;
    if (label_styles) out.labelStyles = label_styles;
    if (error_styles) out.errorTextStyles = error_styles;
    return out;
  }

  /** Mounts after the node appears. Warn-only on miss — never throws. */
  private async tryMountElement(
    element: SkyflowElement,
    container_id: string,
  ): Promise<void> {
    for (let attempt = 0; attempt <= MOUNT_RETRIES; attempt++) {
      if (document.querySelector(container_id)) {
        element.mount(container_id);
        return;
      }
      if (attempt < MOUNT_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, MOUNT_RETRY_DELAY_MS),
        );
      }
    }
    console.warn(
      `[card_fields] Container ${container_id} not found after ${MOUNT_RETRIES + 1} attempts`,
    );
  }

  private static fieldOf(entry: CardFieldEntry): CardField {
    return typeof entry === 'string' ? entry : entry.field;
  }

  private static collectContainerId(
    entry: CardFieldEntry,
    field: CardField,
    card_id?: string,
  ): string {
    if (typeof entry !== 'string' && entry.container_id) {
      return entry.container_id;
    }
    if (field === 'cvv' && card_id) {
      return `#collect-cvv-${card_id}`;
    }
    return CARD_FIELD_META[field].defaultContainerId;
  }
}
