import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  CardField,
  CardFieldState,
  CardFieldEvents,
  FieldErrorMessages,
  CardFieldsOptions,
  CardFieldEntry,
  RevealCardFieldsInput,
  TonderComponentType,
  TonderComponent,
  CardFieldsComponent,
} from './card';
import type { TonderConfig } from '../shared/types';
import type {
  TonderCustomization,
  CardFieldsCustomization,
} from './customization';

describe('card field event types', () => {
  it('CardFieldState has exactly the documented keys', () => {
    // A concrete value that satisfies the type — the object literal doubles as a
    // compile-time exactness check (excess properties would fail).
    const state: CardFieldState = {
      element_type: 'card_number',
      is_empty: false,
      is_focused: true,
      is_valid: false,
      value: '4111',
      error: 'This field is invalid.',
    };
    expect(Object.keys(state).sort()).toEqual(
      [
        'element_type',
        'error',
        'is_empty',
        'is_focused',
        'is_valid',
        'value',
      ].sort(),
    );

    // error is nullable
    const valid: CardFieldState = {
      element_type: 'cvv',
      is_empty: false,
      is_focused: false,
      is_valid: true,
      value: '123',
      error: null,
    };
    expect(valid.error).toBeNull();

    expectTypeOf<CardFieldState['element_type']>().toEqualTypeOf<CardField>();
    expectTypeOf<CardFieldState['error']>().toEqualTypeOf<string | null>();
  });

  it('CardFieldEvents exposes optional lifecycle callbacks receiving CardFieldState', () => {
    const events: CardFieldEvents = {
      on_change: (s) => expectTypeOf(s).toEqualTypeOf<CardFieldState>(),
      on_blur: (s) => expectTypeOf(s).toEqualTypeOf<CardFieldState>(),
      on_focus: (s) => expectTypeOf(s).toEqualTypeOf<CardFieldState>(),
      on_ready: (s) => expectTypeOf(s).toEqualTypeOf<CardFieldState>(),
    };
    expect(typeof events.on_change).toBe('function');

    // all callbacks optional
    const empty: CardFieldEvents = {};
    expect(empty.on_change).toBeUndefined();
  });

  it('CardFieldsOptions may omit fields to use the default full-card form', () => {
    const options: CardFieldsOptions = {};
    expect(options.fields).toBeUndefined();
    expectTypeOf<CardFieldsOptions['fields']>().toEqualTypeOf<
      CardFieldEntry[] | undefined
    >();
  });

  it('CardFieldsOptions accepts a partial per-field events map', () => {
    const options: CardFieldsOptions = {
      fields: ['card_number', 'cvv'],
      events: {
        card_number: { on_change: () => undefined },
      },
    };
    expectTypeOf<CardFieldsOptions['events']>().toEqualTypeOf<
      Partial<Record<CardField, CardFieldEvents>> | undefined
    >();
    expect(options.events?.card_number).toBeDefined();
  });

  it('CardFieldEntry is a bare field or a container override object', () => {
    const bare: CardFieldEntry = 'card_number';
    const override: CardFieldEntry = {
      field: 'cvv',
      container_id: '#my-cvv',
    };
    expect(bare).toBe('card_number');
    expect((override as { container_id?: string }).container_id).toBe(
      '#my-cvv',
    );
  });

  it('RevealCardFieldsInput carries fields plus optional styles', () => {
    const input: RevealCardFieldsInput = {
      fields: ['card_number', 'cardholder_name'],
    };
    expect(input.fields).toHaveLength(2);
    expectTypeOf<RevealCardFieldsInput['fields']>().toBeArray();
  });

  it('TonderComponentType is the "card_fields" union', () => {
    const type: TonderComponentType = 'card_fields';
    expect(type).toBe('card_fields');
    expectTypeOf<TonderComponentType>().toEqualTypeOf<'card_fields'>();
  });

  it('CardFieldsComponent exposes mount/unmount/reveal; TonderComponent unions it', () => {
    expectTypeOf<CardFieldsComponent['mount']>().toBeFunction();
    expectTypeOf<CardFieldsComponent['unmount']>().toBeFunction();
    expectTypeOf<CardFieldsComponent['reveal']>().toBeFunction();
    expectTypeOf<TonderComponent>().toEqualTypeOf<CardFieldsComponent>();
  });

  it('TonderConfig namespaces card-field customization under customization.card_fields', () => {
    const config: TonderConfig = {
      api_key: 'pk_test',
      environment: 'sandbox',
      customization: {
        card_fields: {
          labels: { card_number: 'Tarjeta' },
          placeholders: { cvv: 'CVV' },
          error_messages: {
            required: 'Completa este campo.',
            card_number: 'Número de tarjeta inválido.',
          },
        },
      },
    };

    expect(config.customization?.card_fields?.error_messages?.required).toBe(
      'Completa este campo.',
    );
    expectTypeOf<TonderConfig['customization']>().toEqualTypeOf<
      TonderCustomization | undefined
    >();
    expectTypeOf<TonderCustomization['card_fields']>().toEqualTypeOf<
      CardFieldsCustomization | undefined
    >();
  });

  it('TonderConfig namespaces session-scoped customer and secureToken', () => {
    const config: TonderConfig = {
      api_key: 'pk_test',
      environment: 'sandbox',
      session: {
        customer: { email: 'ada@example.com', first_name: 'Ada' },
        secure_token: 'secure_abc',
      },
    };

    expect(config.session?.customer?.email).toBe('ada@example.com');
    expect(config.session?.secure_token).toBe('secure_abc');

    const rootCustomerConfig: TonderConfig = {
      api_key: 'pk_test',
      environment: 'sandbox',
      // @ts-expect-error — customer belongs under session.customer.
      customer: { email: 'ada@example.com' },
    };
    void rootCustomerConfig;

    const rootSecureTokenConfig: TonderConfig = {
      api_key: 'pk_test',
      environment: 'sandbox',
      // @ts-expect-error — secure_token belongs under session.secure_token.
      secure_token: 'secure_abc',
    };
    void rootSecureTokenConfig;
  });

  it('FieldErrorMessages allows per-field plus required/invalid overrides', () => {
    const messages: FieldErrorMessages = {
      required: 'Required',
      invalid: 'Invalid',
      card_number: 'Bad card number',
    };
    expect(messages.card_number).toBe('Bad card number');
    expectTypeOf<FieldErrorMessages>().toEqualTypeOf<
      Partial<Record<CardField | 'required' | 'invalid', string>>
    >();
  });
});
