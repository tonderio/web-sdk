import { describe, it, expect } from 'vitest';
import {
  buildCardPaymentMethod,
  buildSavedCardPaymentMethod,
} from './card.strategy';

describe('buildCardPaymentMethod', () => {
  const tokens = {
    card_number: 'tok_card_number',
    cvv: 'tok_cvv',
    expiration_month: 'tok_exp_month',
    expiration_year: 'tok_exp_year',
    cardholder_name: 'tok_name',
  };

  it('maps the snake_case Skyflow collect tokens and the card vault id to the CARD payment_method body', () => {
    const pm = buildCardPaymentMethod({
      ...tokens,
      skyflow_id: '3f8c1a2e-9b7d-4c55-8a10-2d6e5f4b7c90',
    });

    expect(pm).toEqual({
      type: 'CARD',
      ...tokens,
      skyflow_id: '3f8c1a2e-9b7d-4c55-8a10-2d6e5f4b7c90',
    });
  });

  it('omits skyflow_id when the collected tokens do not carry one', () => {
    const pm = buildCardPaymentMethod(tokens);

    expect('skyflow_id' in pm).toBe(false);
    expect(pm).toEqual({ type: 'CARD', ...tokens });
  });

  it('never sends an empty skyflow_id', () => {
    const pm = buildCardPaymentMethod({ ...tokens, skyflow_id: '' });

    expect('skyflow_id' in pm).toBe(false);
  });

  it('does not leak any other extra collect key into the payment method', () => {
    const pm = buildCardPaymentMethod({ ...tokens, brand: 'visa', extra: 'x' });

    expect(Object.keys(pm).sort()).toEqual(
      [
        'card_number',
        'cardholder_name',
        'cvv',
        'expiration_month',
        'expiration_year',
        'type',
      ].sort(),
    );
  });
});

describe('buildSavedCardPaymentMethod', () => {
  it('maps the cardId to a CARD payment_method that carries it as the token', () => {
    const pm = buildSavedCardPaymentMethod('card_abc123');

    expect(pm).toEqual({ type: 'CARD', token: 'card_abc123' });
  });

  it('only emits the type and token keys (no card fields, no vendor id)', () => {
    const pm = buildSavedCardPaymentMethod('card_xyz');

    expect(Object.keys(pm).sort()).toEqual(['token', 'type']);
  });
});
