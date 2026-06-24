import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';
import type { CardFieldsOptions } from './types/card';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
};

function makeBusinessConfig(): BusinessConfig {
  return {
    business: {
      pk: 1,
      name: 'Acme',
      categories: [],
      web: 'https://acme.test',
      logo: 'logo.png',
      full_logo_url: 'https://acme.test/logo.png',
      background_color: '#fff',
      primary_color: '#000',
      checkout_environment: true,
      textCheckoutColor: '#111',
      textDetailsColor: '#222',
      checkout_logo: 'checkout.png',
    },
    openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
    fintoc_keys: { public_key: 'pk_fi' },
    mercado_pago: { active: false },
    vault_id: 'vault-1',
    vault_url: 'https://vault.test',
    reference: 'TNDR-abc',
    is_installments_available: true,
    cardonfile_keys: null,
  };
}

function mockHttp(impl: HttpPort['request']): HttpPort {
  return { request: vi.fn(impl) };
}

function mockTokenizer(): TokenizerPort & {
  mount: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
  collect: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
} {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve({})),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

async function readyTonder(tokenizer: TokenizerPort) {
  const http = mockHttp(() => Promise.resolve(makeBusinessConfig()));
  const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });
  await tonder.init();
  return tonder;
}

describe('Tonder.create — component factory', () => {
  it('create("card_fields", options) returns a handle with mount/unmount/reveal', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const component = tonder.create('card_fields', { fields: ['card_number'] });

    expect(typeof component.mount).toBe('function');
    expect(typeof component.unmount).toBe('function');
    expect(typeof component.reveal).toBe('function');
  });

  it('create("card_fields") mounts the full new-card form with default containers', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const component = tonder.create('card_fields');
    await component.mount();

    expect(tokenizer.mount).toHaveBeenCalledWith({
      fields: [
        'cardholder_name',
        'card_number',
        'expiration_month',
        'expiration_year',
        'cvv',
      ],
    });
  });

  it('mount before init (not ready) throws AppError(NOT_INITIALIZED)', async () => {
    const tokenizer = mockTokenizer();
    const http = mockHttp(() => Promise.resolve(makeBusinessConfig()));
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });

    const component = tonder.create('card_fields', { fields: ['card_number'] });
    const err = await component.mount().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
    expect(tokenizer.mount).not.toHaveBeenCalled();
  });

  it('create with an unknown type throws AppError(INVALID_COMPONENT_TYPE)', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    let caught: unknown;
    try {
      // @ts-expect-error — 'saved_cards' is not a valid TonderComponentType yet.
      tonder.create('saved_cards', { fields: ['cvv'] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorKeyEnum.INVALID_COMPONENT_TYPE);
  });

  it('new-card component (no card_id) mounts into the "create" context', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const options: CardFieldsOptions = { fields: ['card_number', 'cvv'] };
    const component = tonder.create('card_fields', options);
    await component.mount();

    // The adapter derives the 'create' context from the absence of card_id.
    expect(tokenizer.mount).toHaveBeenCalledWith(options);
    expect(options.card_id).toBeUndefined();

    component.unmount();
    expect(tokenizer.unmount).toHaveBeenCalledWith('create');
  });

  it('saved-card component (card_id) mounts into the "update:<card_id>" context', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const options: CardFieldsOptions = { fields: ['cvv'], card_id: 'card_42' };
    const component = tonder.create('card_fields', options);
    await component.mount();

    expect(tokenizer.mount).toHaveBeenCalledWith(options);

    component.unmount();
    expect(tokenizer.unmount).toHaveBeenCalledWith('update:card_42');
  });

  it('two components coexist independently without cross-contamination', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const newCard = tonder.create('card_fields', { fields: ['card_number'] });
    const savedCard = tonder.create('card_fields', {
      fields: ['cvv'],
      card_id: 'card_7',
    });

    await newCard.mount();
    await savedCard.mount();

    // Unmounting one scopes to ITS OWN context key only.
    newCard.unmount();
    expect(tokenizer.unmount).toHaveBeenCalledWith('create');
    expect(tokenizer.unmount).not.toHaveBeenCalledWith('update:card_7');

    savedCard.unmount();
    expect(tokenizer.unmount).toHaveBeenCalledWith('update:card_7');
  });

  it('reveal(req) delegates to TokenizerPort.reveal after ready', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const component = tonder.create('card_fields', { fields: ['card_number'] });
    const request = { fields: ['card_number' as const] };
    await component.reveal(request);

    expect(tokenizer.reveal).toHaveBeenCalledWith(request);
  });

  it('reveal before ready throws NOT_INITIALIZED', async () => {
    const tokenizer = mockTokenizer();
    const http = mockHttp(() => Promise.resolve(makeBusinessConfig()));
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });

    const component = tonder.create('card_fields', { fields: ['card_number'] });
    const err = await component
      .reveal({ fields: ['card_number'] })
      .catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
    expect(tokenizer.reveal).not.toHaveBeenCalled();
  });

  it('mount() takes no container argument for card_fields; containers live in create options', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const options: CardFieldsOptions = {
      fields: [{ field: 'card_number', container_id: '#card-number' }],
    };
    const component = tonder.create('card_fields', options);
    await component.mount();

    expect(tokenizer.mount).toHaveBeenCalledWith(options);
    expect(tokenizer.mount).toHaveBeenCalledTimes(1);
  });

  it('old top-level verbs are gone (mountCardFields/unmountCardFields/revealCardFields)', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);
    const bag = tonder as unknown as Record<string, unknown>;

    expect(bag.mountCardFields).toBeUndefined();
    expect(bag.unmountCardFields).toBeUndefined();
    expect(bag.revealCardFields).toBeUndefined();
  });
});

describe('Tonder.create — per-component input-field events', () => {
  it('events live on CardFieldsOptions and reach tokenizer.mount for that component', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const on_ready = vi.fn();
    const options: CardFieldsOptions = {
      fields: ['card_number'],
      events: { card_number: { on_ready } },
    };
    const component = tonder.create('card_fields', options);
    await component.mount();

    // The adapter consumes request.events?.[field]; the facade forwards the
    // whole options object (events included) to tokenizer.mount.
    const passed = tokenizer.mount.mock.calls[0][0] as CardFieldsOptions;
    expect(passed.events?.card_number?.on_ready).toBe(on_ready);
  });

  it('two components carry independent events maps (no cross-fire)', async () => {
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(tokenizer);

    const newCardChange = vi.fn();
    const savedCvvChange = vi.fn();

    const newCard = tonder.create('card_fields', {
      fields: ['card_number'],
      events: { card_number: { on_change: newCardChange } },
    });
    const savedCard = tonder.create('card_fields', {
      fields: ['cvv'],
      card_id: 'card_9',
      events: { cvv: { on_change: savedCvvChange } },
    });

    await newCard.mount();
    await savedCard.mount();

    const firstOptions = tokenizer.mount.mock.calls[0][0] as CardFieldsOptions;
    const secondOptions = tokenizer.mount.mock.calls[1][0] as CardFieldsOptions;

    expect(firstOptions.events?.card_number?.on_change).toBe(newCardChange);
    expect(firstOptions.events?.cvv).toBeUndefined();
    expect(secondOptions.events?.cvv?.on_change).toBe(savedCvvChange);
    expect(secondOptions.events?.card_number).toBeUndefined();
  });
});
