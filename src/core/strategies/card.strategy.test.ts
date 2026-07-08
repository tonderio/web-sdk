import { describe, it, expect } from 'vitest';
import {
  buildCardPaymentMethod,
  buildSavedCardPaymentMethod,
} from './card.strategy';

describe('buildCardPaymentMethod', () => {
  it('maps the snake_case Skyflow collect tokens to the CARD payment_method body', () => {
    const tokens = {
      card_number: 'tok_card_number',
      cvv: 'tok_cvv',
      expiration_month: 'tok_exp_month',
      expiration_year: 'tok_exp_year',
      cardholder_name: 'tok_name',
      skyflow_id: 'sky_123',
    };

    const pm = buildCardPaymentMethod(tokens);

    expect(pm).toEqual({
      type: 'CARD',
      card_number: 'tok_card_number',
      cvv: 'tok_cvv',
      expiration_month: 'tok_exp_month',
      expiration_year: 'tok_exp_year',
      cardholder_name: 'tok_name',
    });
  });

  it('does not leak skyflow_id or any extra collect key into the payment method', () => {
    const tokens = {
      card_number: 'a',
      cvv: 'b',
      expiration_month: 'c',
      expiration_year: 'd',
      cardholder_name: 'e',
      skyflow_id: 'sky_999',
    };

    const pm = buildCardPaymentMethod(tokens);

    expect('skyflow_id' in pm).toBe(false);
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
