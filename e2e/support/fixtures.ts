import { test as base, expect, type Page } from '@playwright/test';
import { env } from './env';

/** Shape of the SDK config a test asks the harness to build in-page. */
export interface TonderE2EConfigOverrides {
  presentation_mode?: 'redirect' | 'embedded';
  /** When true, fetch a secure token before createTonder (needed for COF/card-manage endpoints). */
  withSecureToken?: boolean;
  /**
   * Customer identity set once on config.session. `pay()` and COF ops source
   * the customer exclusively from there (never from the pay input).
   */
  customer?: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  };
}

/** The five Skyflow collect fields, keyed by their default container id. */
export interface CardFieldValues {
  name: string;
  pan: string;
  month: string;
  year: string;
  cvv: string;
}

const COLLECT_CONTAINERS = {
  name: '#collect-cardholder-name',
  pan: '#collect-card-number',
  month: '#collect-expiration-month',
  year: '#collect-expiration-year',
  cvv: '#collect-cvv',
} as const;

/**
 * Custom fixtures exposed to every spec. `tonder` provides high-level helpers
 * that drive `window.Tonder` over `page.evaluate`, hiding the bridge plumbing.
 */
export interface TonderFixtures {
  tonder: TonderHarness;
}

export class TonderHarness {
  constructor(
    private readonly page: Page,
    private readonly baseURL: string,
  ) {}

  /** Navigate to the fixture page (idempotent within a test). */
  async open(): Promise<void> {
    await this.page.goto('/checkout.html');
    await this.page.waitForFunction(() => typeof window.Tonder !== 'undefined');
  }

  /**
   * Create a Tonder instance in the page and stash it on `__tonderBridge`.
   * Credential callbacks cannot cross the evaluate boundary as functions, so
   * they are exposed as page functions and re-wrapped inside the browser context.
   */
  async createInstance(
    overrides: TonderE2EConfigOverrides = {},
  ): Promise<void> {
    void this.baseURL;

    if (overrides.withSecureToken) {
      const endpoint = env.secure_tokenEndpoint();
      await this.page.exposeFunction('__e2eGetSecureToken', async () => {
        const res = await fetch(endpoint, { method: 'POST' });
        if (!res.ok) {
          throw new Error(`secure-token endpoint ${res.status}`);
        }
        const data = (await res.json()) as { token?: string };
        if (!data.token)
          throw new Error('secure-token endpoint returned no token');
        return data.token;
      });
    }

    await this.page.evaluate(
      async ({ api_key, presentation_mode, withSecureToken, customer }) => {
        const config: Record<string, unknown> = {
          api_key,
          environment: 'stage',
        };
        const session: Record<string, unknown> = {};
        if (customer) session.customer = customer;
        if (withSecureToken) {
          session.secure_token = await (
            window as unknown as { __e2eGetSecureToken: () => Promise<string> }
          ).__e2eGetSecureToken();
        }
        if (Object.keys(session).length > 0) config.session = session;
        if (presentation_mode) config.presentation_mode = presentation_mode;
        window.__tonderBridge.instance = window.Tonder.createTonder(config);
      },
      {
        api_key: env.api_key(),
        presentation_mode: overrides.presentation_mode ?? null,
        withSecureToken: overrides.withSecureToken ?? false,
        customer: overrides.customer ?? null,
      },
    );
  }

  /** Convenience: createInstance + init. Resolves when the SDK is ready. */
  async initInstance(overrides: TonderE2EConfigOverrides = {}): Promise<void> {
    await this.createInstance(overrides);
    await this.page.evaluate(async () => {
      const t = window.__tonderBridge.instance;
      if (!t) throw new Error('no instance');
      await t.init();
    });
  }

  /** Mount the five collect fields and wait for the Skyflow iframes to render. */
  async mountAllCardFields(): Promise<void> {
    await this.page.evaluate(async () => {
      const t = window.__tonderBridge.instance;
      if (!t) throw new Error('no instance');
      const component = t.create('card_fields', {
        fields: [
          'cardholder_name',
          'card_number',
          'expiration_month',
          'expiration_year',
          'cvv',
        ],
      });
      // Stash the handle so later helpers (unmount/reveal) can reach it.
      (window as unknown as { __card_fields?: unknown }).__card_fields =
        component;
      await component.mount();
    });
    for (const selector of Object.values(COLLECT_CONTAINERS)) {
      await this.page.waitForSelector(`${selector} iframe`, {
        timeout: 20_000,
      });
    }
  }

  /**
   * Fill the five Skyflow collect fields. Each field is a cross-origin iframe,
   * so we drive it via `frameLocator`. Uses `.fill()` first; on failure falls
   * back to focus + `keyboard.type` (informed by the Slice-1 spike). The exact
   * input role inside a Skyflow field is a single textbox.
   */
  async fillCardFields(values: CardFieldValues): Promise<void> {
    const entries: Array<[keyof CardFieldValues, string]> = [
      ['name', values.name],
      ['pan', values.pan],
      ['month', values.month],
      ['year', values.year],
      ['cvv', values.cvv],
    ];
    for (const [key, value] of entries) {
      const selector = COLLECT_CONTAINERS[key];
      const input = this.page
        .frameLocator(`${selector} iframe`)
        .locator('input')
        .first();
      try {
        await input.fill(value, { timeout: 10_000 });
      } catch {
        await input.click({ timeout: 10_000 });
        await this.page.keyboard.type(value, { delay: 20 });
      }
    }
  }

  /** Direct access to the underlying page for low-level steps. */
  get rawPage(): Page {
    return this.page;
  }

  /**
   * Run a function in the page against the live instance.
   *
   * IMPORTANT: the callback is serialized via `toString()` and reconstructed in
   * the browser, so it CANNOT capture closures. Any external value (customer,
   * ids, PANs) MUST be passed through `args` and read from the callback's second
   * parameter — never referenced from the enclosing test scope.
   */
  async eval<R, A = undefined>(
    fn: (
      instance: NonNullable<Window['__tonderBridge']['instance']>,
      args: A,
    ) => Promise<R> | R,
    args?: A,
  ): Promise<R> {
    return this.page.evaluate(
      async ({ fnStr, args }) => {
        const t = window.__tonderBridge.instance;
        if (!t) throw new Error('no instance');
        const f = new Function(
          'instance',
          'args',
          `return (${fnStr})(instance, args);`,
        ) as (i: typeof t, a: unknown) => Promise<unknown>;
        return f(t, args);
      },
      { fnStr: fn.toString(), args: args ?? null },
    ) as Promise<R>;
  }
}

export const test = base.extend<TonderFixtures>({
  tonder: async ({ page, baseURL }, use) => {
    const harness = new TonderHarness(page, baseURL ?? 'http://localhost:4321');
    await harness.open();
    await use(harness);
  },
});

export { expect };
