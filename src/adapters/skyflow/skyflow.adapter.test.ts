import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkyflowAdapter } from './skyflow.adapter';
import type { SkyflowAdapterDeps } from './skyflow.adapter';
import type {
  SkyflowStatic,
  SkyflowInstance,
  SkyflowCollectContainer,
  SkyflowRevealContainer,
  SkyflowElement,
  SkyflowElementState,
} from './skyflow-loader';
import type { CardField } from '../../types/card';
import type { VaultService } from '../../core/services/vault.service';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * Verbatim copy of the vendor bundle's `ELEMENTS_NOT_MOUNTED` description
 * (`https://js.skyflow.com/v1/index.js`), carried by the error its `collect()`
 * rejects with, under code 400.
 */
const SKYFLOW_ELEMENTS_NOT_MOUNTED_MESSAGE =
  "Collect failed. Make sure all elements are mounted before calling 'collect' on the container.";

/** Stand-in for the vendor's `SkyflowError` shape: message plus numeric code. */
class SkyflowElementsNotMountedError extends Error {
  public readonly code = 400;
  constructor() {
    super(SKYFLOW_ELEMENTS_NOT_MOUNTED_MESSAGE);
    this.name = 'SkyflowError';
  }
}

/**
 * Verbatim copy of the vendor bundle's `ELEMENTS_NOT_MOUNTED_REVEAL` description
 * (`https://js.skyflow.com/v1/index.js`). Its `reveal()` rejects with this only
 * after a timer, never immediately.
 */
const SKYFLOW_ELEMENTS_NOT_MOUNTED_REVEAL_MESSAGE =
  "Reveal failed. Make sure to mount all elements before invoking 'reveal' function.";

/**
 * Stand-in for the vendor's own mount gate on `reveal()`: it arms a timer at
 * call time and only settles early once every created element reports ready.
 * The real timer is 30 seconds; this suite shortens it because the assertion is
 * about whether the adapter is GATED, not about how long the gate runs.
 */
const REVEAL_MOUNT_GATE_MS = 300;

class SkyflowElementsNotMountedRevealError extends Error {
  constructor() {
    super(SKYFLOW_ELEMENTS_NOT_MOUNTED_REVEAL_MESSAGE);
    this.name = 'SkyflowError';
  }
}

type CreatedElement = SkyflowElement & {
  mount: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
  /** Mirrors Skyflow's internal mount flag, read by `collect()` before validating. */
  isMounted: () => boolean;
  isValidElement: ReturnType<typeof vi.fn<() => boolean>>;
  on: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  setErrorOverride: ReturnType<typeof vi.fn>;
  resetError: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  __input: Record<string, unknown>;
  /** Registered Skyflow event handlers, keyed by event name. */
  __handlers: Record<string, (state: SkyflowElementState) => void>;
  /** Shared, ordered call log ('setError' | 'setErrorOverride' | 'update' | 'resetError') for order assertions. */
  __calls: string[];
  /** Fire a registered handler with a state payload, as Skyflow would. */
  __emit(event: string, state: Partial<SkyflowElementState>): void;
};

type FakeCollectContainer = SkyflowCollectContainer & {
  create: ReturnType<typeof vi.fn>;
  collect: ReturnType<typeof vi.fn>;
  __elements: CreatedElement[];
};

type FakeRevealContainer = SkyflowRevealContainer & {
  create: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
  __elements: CreatedElement[];
};

/**
 * Collect container stand-in modelling the vendor contract: elements register
 * unmounted at `create()`, and `collect()` gates on every one of them.
 *
 * Known divergence: `makeFakeSkyflow` hands the SAME container back for every
 * `instance.container(COLLECT)` call, while real Skyflow returns a fresh one per
 * call. So elements from different mount contexts share one registry here. That
 * only ever makes the gate stricter than production — a test that mounts a
 * context, re-mounts it, and then collects would see a rejection reality would
 * not produce. Give such a test its own adapter instead of weakening the gate.
 */
function makeCollectContainer(
  collectImpl?: () => Promise<{
    records: { fields: Record<string, string> }[];
  }>,
): FakeCollectContainer {
  const elements: CreatedElement[] = [];
  const container = {
    __elements: elements,
    create: vi.fn((input: Record<string, unknown>) => {
      // Mirror real Skyflow: every validation rule MUST carry a `params` object,
      // otherwise Skyflow rejects the element at mount time.
      const validations =
        (input.validations as Array<{ params?: unknown }> | undefined) ?? [];
      validations.forEach((rule, i) => {
        if (!rule || typeof rule.params !== 'object' || rule.params === null) {
          throw new Error(
            `Validation error. 'params' for validation rule missing in validations array at index ${i}.`,
          );
        }
      });
      const calls: string[] = [];
      const handlers: Record<string, (state: SkyflowElementState) => void> = {};
      let mounted = false;
      const el: CreatedElement = {
        __input: input,
        __handlers: handlers,
        __calls: calls,
        // Skyflow's mount() resolves the selector itself and, when it finds no
        // node, logs INVALID_ELEMENT_SELECTOR and returns WITHOUT attaching —
        // it never throws. The element simply stays unmounted.
        mount: vi.fn<SkyflowElement['mount']>((selector: string) => {
          mounted = document.querySelector(selector) !== null;
        }),
        unmount: vi.fn<NonNullable<SkyflowElement['unmount']>>(() => {
          mounted = false;
        }),
        isMounted: () => mounted,
        isValidElement: vi.fn(() => true),
        on: vi.fn(
          (event: string, handler: (state: SkyflowElementState) => void) => {
            handlers[event] = handler;
          },
        ),
        setError: vi.fn(() => {
          calls.push('setError');
        }),
        setErrorOverride: vi.fn(() => {
          calls.push('setErrorOverride');
        }),
        resetError: vi.fn(() => {
          calls.push('resetError');
        }),
        update: vi.fn(() => {
          calls.push('update');
        }),
        __emit(event, state) {
          handlers[event]?.({
            elementType: 'card_number',
            isEmpty: false,
            isFocused: false,
            isValid: true,
            value: '',
            ...state,
          });
        },
      };
      elements.push(el);
      return el;
    }),
    collect: vi.fn(() => {
      // Skyflow gates the WHOLE container before it collects anything: it walks
      // every element it created and throws ELEMENTS_NOT_MOUNTED on the first
      // unmounted one, so a single unmounted field fails the entire collect.
      // The isMounted() check short-circuits isValidElement(), which is why an
      // unmounted element is never validated.
      for (const element of elements) {
        if (!element.isMounted()) {
          return Promise.reject(new SkyflowElementsNotMountedError());
        }
        element.isValidElement();
      }
      return (
        collectImpl?.() ??
        Promise.resolve({
          // collect() returns internal Skyflow snake_case field names — this is INTERNAL only
          records: [{ fields: { card_number: 'tok_pan', cvv: 'tok_cvv' } }],
        })
      );
    }),
  } as unknown as FakeCollectContainer;
  return container;
}

/**
 * Reveal container stand-in modelling the vendor contract: elements register
 * unmounted at `create()`, and `reveal()` arms a mount gate it can only escape
 * early when every registered element is mounted. One element the container was
 * told about but that never mounts holds the whole call until the gate expires,
 * which is why a field with no container must never reach `create()`.
 */
function makeRevealContainer(): FakeRevealContainer {
  const elements: CreatedElement[] = [];
  const container = {
    __elements: elements,
    create: vi.fn((input: Record<string, unknown>) => {
      let mounted = false;
      const el = {
        __input: input,
        // Skyflow's mount() resolves the selector itself and, when it finds no
        // node, logs INVALID_ELEMENT_SELECTOR and returns WITHOUT attaching.
        mount: vi.fn<SkyflowElement['mount']>((selector: string) => {
          mounted = document.querySelector(selector) !== null;
        }),
        unmount: vi.fn<NonNullable<SkyflowElement['unmount']>>(() => {
          mounted = false;
        }),
        isMounted: () => mounted,
      } as unknown as CreatedElement;
      elements.push(el);
      return el;
    }),
    reveal: vi.fn(() => {
      if (elements.every((element) => element.isMounted())) {
        return Promise.resolve();
      }
      return new Promise((_resolve, reject) => {
        setTimeout(
          () => reject(new SkyflowElementsNotMountedRevealError()),
          REVEAL_MOUNT_GATE_MS,
        );
      });
    }),
  } as unknown as FakeRevealContainer;
  return container;
}

interface FakeSkyflow {
  loader: () => Promise<SkyflowStatic>;
  loaderSpy: ReturnType<typeof vi.fn>;
  initSpy: ReturnType<typeof vi.fn>;
  collectContainer: FakeCollectContainer;
  revealContainer: FakeRevealContainer;
}

function makeFakeSkyflow(
  collectImpl?: () => Promise<{
    records: { fields: Record<string, string> }[];
  }>,
): FakeSkyflow {
  const collectContainer = makeCollectContainer(collectImpl);
  const revealContainer = makeRevealContainer();
  const initSpy = vi.fn(
    (): SkyflowInstance => ({
      container: (type: string) =>
        type === 'COLLECT' ? collectContainer : revealContainer,
    }),
  );
  const skyflow = {
    init: initSpy,
    ContainerType: { COLLECT: 'COLLECT', REVEAL: 'REVEAL' },
    ElementType: {
      CVV: 'CVV',
      CARD_NUMBER: 'CARD_NUMBER',
      EXPIRATION_MONTH: 'EXPIRATION_MONTH',
      EXPIRATION_YEAR: 'EXPIRATION_YEAR',
      CARDHOLDER_NAME: 'CARDHOLDER_NAME',
      INPUT_FIELD: 'INPUT_FIELD',
    },
    LogLevel: { ERROR: 'ERROR' },
    Env: { DEV: 'DEV', PROD: 'PROD' },
    RedactionType: { MASKED: 'MASKED', PLAIN_TEXT: 'PLAIN_TEXT' },
    ValidationRuleType: {
      LENGTH_MATCH_RULE: 'LENGTH_MATCH_RULE',
      REGEX_MATCH_RULE: 'REGEX_MATCH_RULE',
    },
    EventName: {
      CHANGE: 'CHANGE',
      BLUR: 'BLUR',
      FOCUS: 'FOCUS',
      READY: 'READY',
    },
  } as unknown as SkyflowStatic;
  const loaderSpy = vi.fn(() => Promise.resolve(skyflow));
  return {
    loader: loaderSpy,
    loaderSpy,
    initSpy,
    collectContainer,
    revealContainer,
  };
}

function mockVaultService(token = 'vt_token'): VaultService {
  return {
    fetchVaultToken: vi.fn(() => Promise.resolve(token)),
  } as unknown as VaultService;
}

interface BuildOpts {
  vaultConfig?: { vault_id: string; vault_url: string } | null;
  mode?: 'production' | 'sandbox' | 'stage';
  customization?: SkyflowAdapterDeps['customization'];
  error_messages?: SkyflowAdapterDeps['error_messages'];
  fake?: FakeSkyflow;
  vault?: VaultService;
}

function buildAdapter(opts: BuildOpts = {}): {
  adapter: SkyflowAdapter;
  fake: FakeSkyflow;
  vault: VaultService;
} {
  const fake = opts.fake ?? makeFakeSkyflow();
  const vault = opts.vault ?? mockVaultService();
  const vaultConfig =
    opts.vaultConfig === undefined
      ? { vault_id: 'vault-1', vault_url: 'https://vault.test' }
      : opts.vaultConfig;
  const adapter = new SkyflowAdapter({
    loader: fake.loader,
    vaultService: vault,
    getVaultConfig: () => vaultConfig,
    mode: opts.mode ?? 'sandbox',
    customization: opts.customization,
    error_messages: opts.error_messages,
  });
  return { adapter, fake, vault };
}

function addContainer(id: string): HTMLDivElement {
  const div = document.createElement('div');
  div.id = id;
  document.body.appendChild(div);
  return div;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SkyflowAdapter — initialization', () => {
  it('throws NOT_INITIALIZED when vault config is not loaded', async () => {
    const { adapter } = buildAdapter({ vaultConfig: null });

    // camelCase public field value
    const err = await adapter
      .mount({ fields: ['card_number'] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
  });

  it('loads the SDK once across two mounts (single-load)', async () => {
    // kebab-case default container id
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['card_number'] });
    await adapter.mount({ fields: ['card_number'] });

    expect(fake.loaderSpy).toHaveBeenCalledTimes(1);
    expect(fake.initSpy).toHaveBeenCalledTimes(1);
  });

  it('calls Skyflow.init with vaultID, vaultURL and a getBearerToken delegating to VaultService', async () => {
    addContainer('collect-card-number');
    const vault = mockVaultService('vt_from_service');
    const { adapter, fake } = buildAdapter({ vault });

    await adapter.mount({ fields: ['card_number'] });

    const initArg = fake.initSpy.mock.calls[0][0];
    expect(initArg.vaultID).toBe('vault-1');
    expect(initArg.vaultURL).toBe('https://vault.test');
    const token = await initArg.getBearerToken();
    expect(token).toBe('vt_from_service');
    expect(vault.fetchVaultToken).toHaveBeenCalledTimes(1);
  });

  it('uses Env.PROD in production mode and Env.DEV otherwise', async () => {
    addContainer('collect-cvv');
    const prod = buildAdapter({ mode: 'production' });
    await prod.adapter.mount({ fields: ['cvv'] });
    expect(prod.fake.initSpy.mock.calls[0][0].options.env).toBe('PROD');

    const sandbox = buildAdapter({ mode: 'sandbox' });
    addContainer('collect-cvv');
    await sandbox.adapter.mount({ fields: ['cvv'] });
    expect(sandbox.fake.initSpy.mock.calls[0][0].options.env).toBe('DEV');
  });
});

describe('SkyflowAdapter — mount', () => {
  it('creates one Collect element per field with the cards table and snake_case column', async () => {
    // Public fields are camelCase; Skyflow column (internal) is snake_case
    addContainer('collect-card-number');
    addContainer('collect-cvv');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['card_number', 'cvv'] });

    expect(fake.collectContainer.create).toHaveBeenCalledTimes(2);
    const inputs = fake.collectContainer.__elements.map((e) => e.__input);
    // column is the INTERNAL Skyflow snake name; camelCase field maps to it via CARD_FIELD_META
    expect(inputs[0]).toMatchObject({
      table: 'cards',
      column: 'card_number',
      type: 'CARD_NUMBER',
    });
    expect(inputs[1]).toMatchObject({
      table: 'cards',
      column: 'cvv',
      type: 'CVV',
    });
  });

  it('passes well-formed validation rules — every rule carries a params object', async () => {
    addContainer('collect-cardholder-name');
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['cardholder_name', 'card_number'] });

    const rulesFor = (i: number) =>
      (
        fake.collectContainer.__elements[i].__input as {
          validations: Array<{ type: string; params: Record<string, unknown> }>;
        }
      ).validations;
    // cardholder_name → length + regex, both with params
    const holder = rulesFor(0);
    expect(holder).toHaveLength(2);
    holder.forEach((rule) => expect(typeof rule.params).toBe('object'));
    expect(holder[0]).toMatchObject({
      type: 'LENGTH_MATCH_RULE',
      params: { max: 70 },
    });
    expect(holder[1].type).toBe('REGEX_MATCH_RULE');
    expect(holder[1].params).toHaveProperty('regex');
    // other fields → a single regex rule, with params
    const number = rulesFor(1);
    expect(number).toHaveLength(1);
    expect(number[0].params).toHaveProperty('regex');
  });

  it('mounts each element into the default kebab-case #collect-<field> container when present', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['card_number'] });

    const el = fake.collectContainer.__elements[0];
    expect(el.mount).toHaveBeenCalledWith('#collect-card-number');
  });

  it('passes a label and placeholder, preferring caller customization', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter({
      customization: {
        labels: { card_number: 'PAN' },
        placeholders: { card_number: '0000 0000' },
      },
    });

    await adapter.mount({ fields: ['card_number'] });

    expect(fake.collectContainer.__elements[0].__input).toMatchObject({
      label: 'PAN',
      placeholder: '0000 0000',
    });
  });

  it('uses Spanish legacy-compatible default labels and placeholders', async () => {
    addContainer('collect-cardholder-name');
    addContainer('collect-card-number');
    addContainer('collect-cvv');
    addContainer('collect-expiration-month');
    addContainer('collect-expiration-year');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({
      fields: [
        'cardholder_name',
        'card_number',
        'cvv',
        'expiration_month',
        'expiration_year',
      ],
    });

    const inputs = fake.collectContainer.__elements.map((el) => el.__input);
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: 'cardholder_name',
          label: 'Titular de la tarjeta',
          placeholder: 'Nombre como aparece en la tarjeta',
        }),
        expect.objectContaining({
          column: 'card_number',
          label: 'Número de tarjeta',
          placeholder: '1234 1234 1234 1234',
        }),
        expect.objectContaining({
          column: 'cvv',
          label: 'CVC/CVV',
          placeholder: '3-4 dígitos',
        }),
        expect.objectContaining({
          column: 'expiration_month',
          label: 'Mes',
          placeholder: 'MM',
        }),
        expect.objectContaining({
          column: 'expiration_year',
          label: 'Año',
          placeholder: 'AA',
        }),
      ]),
    );
  });

  it('maps legacy Skyflow default style variants into Collect element options', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['card_number'] });

    const input = fake.collectContainer.__elements[0].__input;
    expect(input.inputStyles).toMatchObject({
      base: expect.objectContaining({
        border: '1px solid #e0e0e0',
        padding: '10px 7px',
        borderRadius: '5px',
        fontFamily: '"Inter", sans-serif',
        '&::placeholder': { color: '#ccc' },
      }),
      complete: { color: '#4caf50' },
      invalid: { border: '1px solid #f44336' },
      empty: {},
      focus: {},
      global: expect.objectContaining({
        '@import': expect.stringContaining('Inter'),
      }),
    });
    expect(input.labelStyles).toMatchObject({
      base: expect.objectContaining({ fontFamily: '"Inter", sans-serif' }),
    });
    expect(input.errorStyles).toMatchObject({
      base: expect.objectContaining({ fontFamily: '"Inter", sans-serif' }),
    });
  });

  it('honors a custom container_id in the object field form', async () => {
    addContainer('my_pan_box');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({
      fields: [{ field: 'card_number', container_id: '#my_pan_box' }],
    });

    expect(fake.collectContainer.__elements[0].mount).toHaveBeenCalledWith(
      '#my_pan_box',
    );
  });

  it('rejects with MOUNT_COLLECT_ERROR when the container node is missing', async () => {
    const { adapter, fake } = buildAdapter();

    const err = await adapter
      .mount({ fields: ['card_number'] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
    expect(fake.collectContainer.__elements[0].mount).not.toHaveBeenCalled();
  });

  it('names the missing container in originalError', async () => {
    const { adapter } = buildAdapter();

    const err = await adapter
      .mount({ fields: [{ field: 'card_number', container_id: '#pan_box' }] })
      .catch((e) => e);

    // The shared MOUNT_COLLECT_ERROR copy cannot say which container is missing,
    // so originalError is the only channel carrying the selector.
    expect(err.originalError).toBeInstanceOf(Error);
    expect((err.originalError as Error).message).toContain('#pan_box');
  });

  it('still mounts when the container appears within the retry budget', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, fake } = buildAdapter();

      const mounting = adapter.mount({ fields: ['card_number'] });
      // First attempt runs with the node absent.
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.collectContainer.__elements[0].mount).not.toHaveBeenCalled();

      addContainer('collect-card-number');
      await vi.advanceTimersByTimeAsync(30);

      await expect(mounting).resolves.toBeUndefined();
      expect(fake.collectContainer.__elements[0].mount).toHaveBeenCalledWith(
        '#collect-card-number',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('tears down already-mounted fields when a later container is missing', async () => {
    addContainer('collect-cardholder-name');
    // #collect-card-number is deliberately absent.
    addContainer('collect-cvv');
    const { adapter, fake } = buildAdapter();

    const err = await adapter
      .mount({ fields: ['cardholder_name', 'card_number', 'cvv'] })
      .catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
    const first = fake.collectContainer.__elements[0];
    expect(first.mount).toHaveBeenCalledWith('#collect-cardholder-name');
    expect(first.unmount).toHaveBeenCalledTimes(1);
    // The loop aborted at field 2, so cvv was never created.
    expect(fake.collectContainer.__elements).toHaveLength(2);

    const collectErr = await adapter.collect().catch((e) => e);
    expect(collectErr).toBeInstanceOf(AppError);
    expect(collectErr.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
  });

  it('uses the kebab default container and passes skyflowID when card_id is set', async () => {
    // saved-card cvv default: #collect-cvv-<card_id>
    addContainer('collect-cvv-card_99');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['cvv'], card_id: 'card_99' });

    const el = fake.collectContainer.__elements[0];
    expect(el.mount).toHaveBeenCalledWith('#collect-cvv-card_99');
    expect(el.__input).toMatchObject({ skyflowID: 'card_99' });
  });
});

describe('SkyflowAdapter — saved-card CVV mount', () => {
  const ALL_FIELDS: CardField[] = [
    'cardholder_name',
    'card_number',
    'expiration_month',
    'expiration_year',
    'cvv',
  ];

  it('resolves with ONLY the CVV container present — the documented saved-card flow', async () => {
    // The saved-card page renders one input, not five. The required-container
    // rejection added to mount() must not reach this shape.
    addContainer('collect-cvv-card_7');
    const { adapter, fake } = buildAdapter();

    await expect(
      adapter.mount({ fields: ['cvv'], card_id: 'card_7' }),
    ).resolves.toBeUndefined();

    expect(fake.collectContainer.__elements).toHaveLength(1);
    await expect(adapter.collect('update:card_7')).resolves.toMatchObject({
      cvv: 'tok_cvv',
    });
  });

  it('keeps a create context alive alongside it under unmount_context "none"', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cvv-card_7');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'], unmount_context: 'none' });

    await adapter.mount({
      fields: ['cvv'],
      card_id: 'card_7',
      unmount_context: 'none',
    });

    // Two independent Skyflow containers in production; both contexts collect.
    await expect(adapter.collect()).resolves.toMatchObject({
      card_number: 'tok_pan',
    });
    await expect(adapter.collect('update:card_7')).resolves.toMatchObject({
      cvv: 'tok_cvv',
    });
    expect(fake.collectContainer.__elements[0].isMounted()).toBe(true);
  });

  it('tears down the create context by default, because unmount_context defaults to "all"', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cvv-card_7');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const pan = fake.collectContainer.__elements[0];

    // No unmount_context given — the default is 'all', not 'current'.
    await adapter.mount({ fields: ['cvv'], card_id: 'card_7' });

    expect(pan.unmount).toHaveBeenCalledTimes(1);
    const err = await adapter.collect().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
  });

  it('rejects when all five fields are requested but only the CVV container exists', async () => {
    // The shape produced by `create("card_fields", { card_id })` with no
    // `fields`: tonder.ts defaults to all five regardless of card_id.
    addContainer('collect-cvv-card_7');
    const { adapter } = buildAdapter();

    const err = await adapter
      .mount({ fields: ALL_FIELDS, card_id: 'card_7' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
    expect((err.originalError as Error).message).toContain(
      '#collect-cardholder-name',
    );
  });

  it('is the same shape Skyflow itself rejects at collect() time', async () => {
    // Before mount() rejected on a missing container, this integration reached
    // payment and died there instead: Skyflow gates the whole container, so the
    // four unmounted fields fail the collect even though the CVV mounted fine.
    addContainer('collect-cvv-card_7');
    const container = makeCollectContainer();
    for (const field of ALL_FIELDS) {
      const element = container.create({ table: 'cards', column: field });
      element.mount(
        field === 'cvv' ? '#collect-cvv-card_7' : `#collect-${field}`,
      );
    }

    await expect(container.collect()).rejects.toThrow(
      SKYFLOW_ELEMENTS_NOT_MOUNTED_MESSAGE,
    );
  });
});

describe('SkyflowAdapter — partial mount teardown', () => {
  /**
   * Makes `container.create` throw on the Nth call, keeping the real fake for the
   * rest. `breakUnmount` additionally makes every surviving element's `unmount`
   * throw, to prove teardown cannot mask the original failure.
   */
  function throwOnCreateCall(
    fake: FakeSkyflow,
    nth: number,
    breakUnmount = false,
  ): void {
    const create = fake.collectContainer.create;
    const realCreate = create.getMockImplementation() as (
      input: Record<string, unknown>,
    ) => CreatedElement;
    let calls = 0;
    create.mockImplementation((input: Record<string, unknown>) => {
      calls += 1;
      if (calls === nth) throw new Error('Skyflow rejected the element');
      const element = realCreate(input);
      if (breakUnmount) {
        element.unmount.mockImplementation(() => {
          throw new Error('unmount blew up');
        });
      }
      return element;
    });
  }

  it('unmounts the fields already mounted in this call before rethrowing', async () => {
    addContainer('collect-cardholder-name');
    addContainer('collect-card-number');
    addContainer('collect-cvv');
    const { adapter, fake } = buildAdapter();
    throwOnCreateCall(fake, 2);

    const err = await adapter
      .mount({ fields: ['cardholder_name', 'card_number', 'cvv'] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
    // Field 1 was mounted before the failure. Without teardown it survives as an
    // orphaned secure iframe with no handle to unmount it, because `contexts` is
    // only written after the try/catch and the catch rethrows.
    const first = fake.collectContainer.__elements[0];
    expect(first.mount).toHaveBeenCalledWith('#collect-cardholder-name');
    expect(first.unmount).toHaveBeenCalledTimes(1);
  });

  it('registers no context for a failed mount, so collect() rejects', async () => {
    addContainer('collect-cardholder-name');
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    throwOnCreateCall(fake, 2);

    await adapter
      .mount({ fields: ['cardholder_name', 'card_number'] })
      .catch(() => undefined);

    const err = await adapter.collect().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
  });

  it('reports the original mount failure even when teardown unmount throws', async () => {
    addContainer('collect-cardholder-name');
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    throwOnCreateCall(fake, 2, true);

    const err = await adapter
      .mount({ fields: ['cardholder_name', 'card_number'] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
    // The teardown failure must not replace the cause the merchant needs to see.
    expect((err.originalError as Error).message).toBe(
      'Skyflow rejected the element',
    );
    expect(fake.collectContainer.__elements[0].unmount).toHaveBeenCalledTimes(
      1,
    );
  });
});

describe('SkyflowAdapter — context isolation and unmount', () => {
  it('keeps create and update:<card_id> as separate contexts', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cvv-card_7');
    const { adapter } = buildAdapter();

    await adapter.mount({ fields: ['card_number'], unmount_context: 'none' });
    await adapter.mount({
      fields: ['cvv'],
      card_id: 'card_7',
      unmount_context: 'none',
    });

    // collect() defaults to the 'create' context — proves it was not overwritten.
    const fields = await adapter.collect();
    expect(fields).toMatchObject({ card_number: 'tok_pan' });
  });

  it('unmount(context) unmounts the elements of that context', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    adapter.unmount('create');

    expect(el.unmount).toHaveBeenCalledTimes(1);
  });

  it('unmount() with no argument unmounts every context', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cvv-card_3');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'], unmount_context: 'none' });
    await adapter.mount({
      fields: ['cvv'],
      card_id: 'card_3',
      unmount_context: 'none',
    });

    adapter.unmount();

    for (const el of fake.collectContainer.__elements) {
      expect(el.unmount).toHaveBeenCalled();
    }
  });

  it('re-mounting the create context unmounts the previous create elements by default', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const firstEl = fake.collectContainer.__elements[0];

    await adapter.mount({ fields: ['card_number'] });

    expect(firstEl.unmount).toHaveBeenCalled();
  });
});

describe('SkyflowAdapter — collect', () => {
  it('returns records[0].fields from the create container (internal snake_case tokens)', async () => {
    addContainer('collect-card-number');
    const { adapter } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });

    const fields = await adapter.collect();

    // collect() returns Skyflow's internal snake_case token map — INTERNAL, not public API
    expect(fields).toEqual({ card_number: 'tok_pan', cvv: 'tok_cvv' });
  });

  it('collects from an update:<card_id> context for saved-card CVV', async () => {
    addContainer('collect-cvv-card_7');
    const { adapter } = buildAdapter();
    await adapter.mount({ fields: ['cvv'], card_id: 'card_7' });

    const fields = await adapter.collect('update:card_7');

    expect(fields).toEqual({ card_number: 'tok_pan', cvv: 'tok_cvv' });
  });

  it('throws MOUNT_COLLECT_ERROR when no create context is mounted', async () => {
    const { adapter } = buildAdapter();

    const err = await adapter.collect().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
  });

  it('throws MOUNT_COLLECT_ERROR when the container rejects', async () => {
    addContainer('collect-card-number');
    const fake = makeFakeSkyflow(() =>
      Promise.reject(new Error('invalid card')),
    );
    const { adapter } = buildAdapter({ fake });
    await adapter.mount({ fields: ['card_number'] });

    const err = await adapter.collect().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.MOUNT_COLLECT_ERROR);
  });
});

describe('Skyflow Collect container fake — vendor contract fidelity', () => {
  function createCvv(container: FakeCollectContainer): CreatedElement {
    return container.create({
      table: 'cards',
      column: 'cvv',
    }) as CreatedElement;
  }

  it('starts every created element unmounted', () => {
    const container = makeCollectContainer();

    expect(createCvv(container).isMounted()).toBe(false);
  });

  it('rejects collect() when a created element was never mounted', async () => {
    const container = makeCollectContainer();
    createCvv(container);

    const err = await container.collect().catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(SKYFLOW_ELEMENTS_NOT_MOUNTED_MESSAGE);
    expect((err as { code?: number }).code).toBe(400);
  });

  it('gates the whole container — one unmounted element rejects the collect', async () => {
    addContainer('collect-card-number');
    const container = makeCollectContainer();
    const pan = container.create({ table: 'cards', column: 'card_number' });
    createCvv(container);
    pan.mount('#collect-card-number');

    await expect(container.collect()).rejects.toThrow(
      SKYFLOW_ELEMENTS_NOT_MOUNTED_MESSAGE,
    );
  });

  it('short-circuits before validation — an unmounted element is never validated', async () => {
    const container = makeCollectContainer();
    const cvv = createCvv(container);

    await container.collect().catch(() => undefined);

    expect(cvv.isValidElement).not.toHaveBeenCalled();
  });

  it('resolves collect() once every element is mounted, validating each one', async () => {
    addContainer('collect-cvv');
    const container = makeCollectContainer();
    const cvv = createCvv(container);
    cvv.mount('#collect-cvv');

    await expect(container.collect()).resolves.toMatchObject({
      records: [{ fields: { cvv: 'tok_cvv' } }],
    });
    expect(cvv.isValidElement).toHaveBeenCalledTimes(1);
  });

  it('marks the element unmounted again after unmount()', async () => {
    addContainer('collect-cvv');
    const container = makeCollectContainer();
    const cvv = createCvv(container);
    cvv.mount('#collect-cvv');

    cvv.unmount();

    expect(cvv.isMounted()).toBe(false);
    await expect(container.collect()).rejects.toThrow(
      SKYFLOW_ELEMENTS_NOT_MOUNTED_MESSAGE,
    );
  });

  it('leaves the element unmounted when the mount selector does not resolve', () => {
    const container = makeCollectContainer();
    const cvv = createCvv(container);

    // Skyflow's own mount() logs INVALID_ELEMENT_SELECTOR and returns without
    // attaching — it does NOT throw. The failure only surfaces at collect().
    expect(() => cvv.mount('#absent')).not.toThrow();
    expect(cvv.isMounted()).toBe(false);
  });
});

describe('Skyflow Reveal container fake — vendor contract fidelity', () => {
  it('starts every created element unmounted', () => {
    const container = makeRevealContainer();

    const el = container.create({ token: 'tok_pan' }) as CreatedElement;

    expect(el.isMounted()).toBe(false);
  });

  it('resolves reveal() immediately once every element is mounted', async () => {
    addContainer('reveal-card-number');
    const container = makeRevealContainer();
    const el = container.create({ token: 'tok_pan' });
    el.mount('#reveal-card-number');

    await expect(container.reveal()).resolves.toBeUndefined();
  });

  it('holds reveal() on the mount gate when an element never mounts', async () => {
    const container = makeRevealContainer();
    container.create({ token: 'tok_pan' });

    const outcome = await Promise.race([
      container.reveal().then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise<'still-pending'>((resolve) => {
        setTimeout(() => resolve('still-pending'), REVEAL_MOUNT_GATE_MS / 2);
      }),
    ]);

    expect(outcome).toBe('still-pending');
    await expect(container.reveal()).rejects.toThrow(
      SKYFLOW_ELEMENTS_NOT_MOUNTED_REVEAL_MESSAGE,
    );
  });
});

describe('SkyflowAdapter — reveal', () => {
  it('throws NOT_INITIALIZED when called before any collect', async () => {
    addContainer('collect-card-number');
    const { adapter } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });

    const err = await adapter
      .reveal({ fields: ['card_number'] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
  });

  it('reveals non-CVV fields using the collected tokens and calls reveal()', async () => {
    addContainer('collect-card-number');
    addContainer('reveal-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    await adapter.collect();

    await adapter.reveal({ fields: ['card_number'] });

    expect(fake.revealContainer.create).toHaveBeenCalledTimes(1);
    expect(fake.revealContainer.__elements[0].__input).toMatchObject({
      token: 'tok_pan',
    });
    expect(fake.revealContainer.__elements[0].mount).toHaveBeenCalledWith(
      '#reveal-card-number',
    );
    expect(fake.revealContainer.reveal).toHaveBeenCalledTimes(1);
  });

  it('does NOT reject when a reveal container is missing', async () => {
    addContainer('collect-card-number');
    // #reveal-card-number is deliberately absent.
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    await adapter.collect();

    // reveal() is partial-success by contract — unlike mount(), a missing
    // container warns and the call still resolves.
    await expect(
      adapter.reveal({ fields: ['card_number'] }),
    ).resolves.toBeUndefined();
    // The field is dropped before create(), so the container is never told
    // about an element it would then wait on.
    expect(fake.revealContainer.create).not.toHaveBeenCalled();
    expect(fake.revealContainer.reveal).toHaveBeenCalledTimes(1);
  });

  it('returns without waiting on the mount gate when a container is missing', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cardholder-name');
    addContainer('reveal-card-number');
    // #reveal-cardholder-name is deliberately absent.
    const fake = makeFakeSkyflow(() =>
      Promise.resolve({
        records: [
          { fields: { card_number: 'tok_pan', cardholder_name: 'tok_name' } },
        ],
      }),
    );
    const { adapter } = buildAdapter({ fake });
    await adapter.mount({ fields: ['card_number', 'cardholder_name'] });
    await adapter.collect();

    const outcome = await Promise.race([
      adapter
        .reveal({ fields: ['card_number', 'cardholder_name'] })
        .then(() => 'reveal-returned' as const),
      new Promise<'gate-elapsed'>((resolve) => {
        setTimeout(() => resolve('gate-elapsed'), REVEAL_MOUNT_GATE_MS);
      }),
    ]);

    expect(outcome).toBe('reveal-returned');
    expect(fake.revealContainer.reveal).toHaveBeenCalledTimes(1);
  });

  it('still reveals the fields whose containers exist when one is missing', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cardholder-name');
    addContainer('reveal-card-number');
    // #reveal-cardholder-name is deliberately absent.
    const fake = makeFakeSkyflow(() =>
      Promise.resolve({
        records: [
          { fields: { card_number: 'tok_pan', cardholder_name: 'tok_name' } },
        ],
      }),
    );
    const { adapter } = buildAdapter({ fake });
    await adapter.mount({ fields: ['card_number', 'cardholder_name'] });
    await adapter.collect();

    await adapter.reveal({ fields: ['card_number', 'cardholder_name'] });

    expect(fake.revealContainer.__elements.map((e) => e.__input.token)).toEqual(
      ['tok_pan'],
    );
    expect(fake.revealContainer.__elements[0].isMounted()).toBe(true);
  });

  it('reveals a field whose container only appears within the retry window', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    await adapter.collect();

    // Lands after the first two attempts (t=0, t=30) and before the third.
    setTimeout(() => addContainer('reveal-card-number'), 35);

    await adapter.reveal({ fields: ['card_number'] });

    expect(fake.revealContainer.__elements[0].mount).toHaveBeenCalledWith(
      '#reveal-card-number',
    );
    expect(fake.revealContainer.__elements[0].isMounted()).toBe(true);
  });

  it('skips CVV on reveal (PCI DSS) even if requested', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cvv');
    addContainer('reveal-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number', 'cvv'] });
    await adapter.collect();

    await adapter.reveal({
      fields: ['card_number', 'cvv' as unknown as 'card_number'],
    });

    const revealedColumns = fake.revealContainer.__elements.map(
      (e) => e.__input.token,
    );
    expect(revealedColumns).toEqual(['tok_pan']);
  });
});

describe('SkyflowAdapter — styling resolution', () => {
  it('applies a per-field input style over the card_form default', async () => {
    addContainer('collect-card-number');
    addContainer('collect-cvv');
    const { adapter, fake } = buildAdapter({
      customization: {
        styles: {
          card_form: { input_styles: { base: { color: 'green' } } },
          cvv: { input_styles: { base: { color: 'red' } } },
        },
      },
    });

    await adapter.mount({ fields: ['card_number', 'cvv'] });

    // byColumn uses the INTERNAL snake_case column value from container.create({ column })
    const byColumn = Object.fromEntries(
      fake.collectContainer.__elements.map((e) => [
        e.__input.column,
        e.__input,
      ]),
    );
    expect(
      (byColumn.cvv.inputStyles as { base: { color: string } }).base.color,
    ).toBe('red');
    expect(
      (byColumn.card_number.inputStyles as { base: { color: string } }).base
        .color,
    ).toBe('green');
  });

  it('deep merges field style overrides with the SDK defaults', async () => {
    addContainer('collect-cardholder-name');
    const { adapter, fake } = buildAdapter({
      customization: {
        styles: {
          cardholder_name: {
            input_styles: {
              base: { height: '200px' },
            },
          },
        },
      },
    });

    await adapter.mount({ fields: ['cardholder_name'] });

    const input = fake.collectContainer.__elements[0].__input;
    const inputStyles = input.inputStyles as {
      base: Record<string, unknown>;
      invalid: Record<string, unknown>;
      global: Record<string, unknown>;
    };

    expect(inputStyles.base.height).toBe('200px');
    expect(inputStyles.base.border).toBe('1px solid #e0e0e0');
    expect(inputStyles.base.borderRadius).toBe('5px');
    expect(inputStyles.invalid.border).toBe('1px solid #f44336');
    expect(inputStyles.global['@import']).toContain('fonts.googleapis.com');
  });

  it('injects a default paddingLeft for card_number when the card icon is enabled', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['card_number'] });

    const input = fake.collectContainer.__elements[0].__input;
    expect(
      (input.inputStyles as { base: { paddingLeft: string } }).base.paddingLeft,
    ).toBe('15px');
  });

  it('does NOT inject paddingLeft for card_number when enable_card_icon is false', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter({
      customization: { styles: { enable_card_icon: false } },
    });

    await adapter.mount({ fields: ['card_number'] });

    const input = fake.collectContainer.__elements[0].__input;
    const base =
      (input.inputStyles as { base?: { paddingLeft?: string } }).base ?? {};
    expect(base.paddingLeft).toBeUndefined();
  });
});

describe('SkyflowAdapter — field events & SDK-owned error labels', () => {
  it('registers CHANGE/BLUR/FOCUS/READY handlers on every mounted element', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();

    await adapter.mount({ fields: ['card_number'] });

    const el = fake.collectContainer.__elements[0];
    const events = el.on.mock.calls.map((c) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining(['CHANGE', 'BLUR', 'FOCUS', 'READY']),
    );
  });

  it('on BLUR with an invalid field calls setError BEFORE update (load-bearing order)', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('BLUR', { isValid: false, isEmpty: false, value: '41' });

    expect(el.setErrorOverride).toHaveBeenCalledTimes(1);
    expect(el.setError).not.toHaveBeenCalled();
    expect(el.update).toHaveBeenCalled();
    // Order matters: Skyflow's update() would otherwise wipe the setError message.
    expect(el.__calls.indexOf('setErrorOverride')).toBeLessThan(
      el.__calls.indexOf('update'),
    );
  });

  it('on BLUR with a valid field does NOT call setError', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('BLUR', {
      isValid: true,
      isEmpty: false,
      value: '4111111111111111',
    });

    expect(el.setErrorOverride).not.toHaveBeenCalled();
    expect(el.setError).not.toHaveBeenCalled();
  });

  it('on FOCUS calls resetError to clear a previously-shown error', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('FOCUS', { isFocused: true });

    expect(el.resetError).toHaveBeenCalledTimes(1);
  });

  it('on CHANGE hides the SDK-owned error label without resetting the field error', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('CHANGE', { isValid: false, isFocused: true, value: '41' });

    expect(el.resetError).not.toHaveBeenCalled();
    expect(el.update).toHaveBeenCalledWith({
      errorTextStyles: expect.objectContaining({
        base: expect.objectContaining({ color: 'transparent' }),
      }),
    });
  });

  it('on FOCUS hides the SDK-owned error label before clearing the field error', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('FOCUS', { isFocused: true });

    expect(el.update).toHaveBeenCalledWith({
      errorTextStyles: expect.objectContaining({
        base: expect.objectContaining({ color: 'transparent' }),
      }),
    });
    expect(el.__calls.indexOf('update')).toBeLessThan(
      el.__calls.indexOf('resetError'),
    );
  });

  it('uses the default Spanish required message when the field is empty', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('BLUR', { isValid: false, isEmpty: true, value: '' });

    expect(el.setErrorOverride).toHaveBeenCalledWith('El campo es requerido');
  });

  it('uses the default Spanish invalid message when the field is non-empty but invalid', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('BLUR', { isValid: false, isEmpty: false, value: '41' });

    expect(el.setErrorOverride).toHaveBeenCalledWith('Campo no válido');
  });

  it('applies merchant error_messages overrides while preserving setError→update order', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter({
      error_messages: {
        card_number: 'Bad card number',
        required: 'Please fill this in',
      },
    });
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    el.__emit('BLUR', { isValid: false, isEmpty: false, value: '41' });
    expect(el.setErrorOverride).toHaveBeenLastCalledWith('Bad card number');
    expect(el.__calls.indexOf('setErrorOverride')).toBeLessThan(
      el.__calls.indexOf('update'),
    );

    el.__emit('BLUR', { isValid: false, isEmpty: true, value: '' });
    expect(el.setErrorOverride).toHaveBeenLastCalledWith('Please fill this in');
  });

  it('falls back to setError when setErrorOverride is unavailable', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];
    el.setErrorOverride =
      undefined as unknown as CreatedElement['setErrorOverride'];

    el.__emit('BLUR', { isValid: false, isEmpty: false, value: '41' });

    expect(el.setError).toHaveBeenCalledWith('Campo no válido');
    expect(el.__calls.indexOf('setError')).toBeLessThan(
      el.__calls.indexOf('update'),
    );
  });

  it('emits on_change with a fully-populated CardFieldState (error present when invalid)', async () => {
    addContainer('collect-card-number');
    const on_change = vi.fn();
    const { adapter, fake } = buildAdapter();
    await adapter.mount({
      fields: ['card_number'],
      events: { card_number: { on_change } },
    });
    const el = fake.collectContainer.__elements[0];

    el.__emit('CHANGE', {
      elementType: 'card_number',
      isEmpty: false,
      isFocused: true,
      isValid: false,
      value: '41',
    });

    expect(on_change).toHaveBeenCalledTimes(1);
    expect(on_change).toHaveBeenCalledWith({
      element_type: 'card_number',
      is_empty: false,
      is_focused: true,
      is_valid: false,
      value: '41',
      error: 'Campo no válido',
    });
  });

  it('emits on_change with error null when the field is valid', async () => {
    addContainer('collect-cvv');
    const on_change = vi.fn();
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['cvv'], events: { cvv: { on_change } } });
    const el = fake.collectContainer.__elements[0];

    el.__emit('CHANGE', {
      elementType: 'cvv',
      isEmpty: false,
      isFocused: true,
      isValid: true,
      value: '123',
    });

    expect(on_change).toHaveBeenCalledWith(
      expect.objectContaining({
        element_type: 'cvv',
        is_valid: true,
        error: null,
      }),
    );
  });

  it('fires on_blur, on_focus and on_ready merchant callbacks with normalized state', async () => {
    addContainer('collect-card-number');
    const on_blur = vi.fn();
    const on_focus = vi.fn();
    const on_ready = vi.fn();
    const { adapter, fake } = buildAdapter();
    await adapter.mount({
      fields: ['card_number'],
      events: { card_number: { on_blur, on_focus, on_ready } },
    });
    const el = fake.collectContainer.__elements[0];

    el.__emit('READY', {
      elementType: 'card_number',
      isEmpty: true,
      isValid: false,
      value: '',
    });
    el.__emit('FOCUS', { elementType: 'card_number', isFocused: true });
    el.__emit('BLUR', {
      elementType: 'card_number',
      isValid: true,
      value: '4111',
    });

    expect(on_ready).toHaveBeenCalledTimes(1);
    expect(on_focus).toHaveBeenCalledWith(
      expect.objectContaining({
        element_type: 'card_number',
        is_focused: true,
      }),
    );
    expect(on_blur).toHaveBeenCalledWith(
      expect.objectContaining({
        element_type: 'card_number',
        is_valid: true,
        error: null,
      }),
    );
  });

  it('does NOT throw when no events are provided (callbacks optional)', async () => {
    addContainer('collect-card-number');
    const { adapter, fake } = buildAdapter();
    await adapter.mount({ fields: ['card_number'] });
    const el = fake.collectContainer.__elements[0];

    expect(() => el.__emit('CHANGE', { isValid: true })).not.toThrow();
  });

  it('isolates a throwing merchant callback and still runs the SDK work queued after it', async () => {
    addContainer('collect-card-number');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boom = (): never => {
      throw new Error('merchant analytics blew up');
    };
    const { adapter, fake } = buildAdapter();
    await adapter.mount({
      fields: ['card_number'],
      events: {
        card_number: {
          on_change: boom,
          on_blur: boom,
          on_focus: boom,
          on_ready: boom,
        },
      },
    });
    const el = fake.collectContainer.__elements[0];

    // The throw must not escape into whoever dispatched the field event...
    expect(() =>
      el.__emit('BLUR', { isValid: false, isEmpty: false, value: '41' }),
    ).not.toThrow();
    expect(() => el.__emit('FOCUS', { isFocused: true })).not.toThrow();
    expect(() => el.__emit('READY', { isEmpty: true })).not.toThrow();
    expect(() => el.__emit('CHANGE', { isValid: true })).not.toThrow();

    // ...and it must not skip the SDK-owned error handling that runs after the
    // callback in each handler.
    expect(el.setErrorOverride).toHaveBeenCalledTimes(1);
    expect(el.resetError).toHaveBeenCalled();
    expect(el.update).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);

    warn.mockRestore();
  });
});
