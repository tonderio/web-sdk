import { describe, it, expect } from 'vitest';
import { mapToCard, type BackendCard } from './card.model';

function backendCard(
  overrides: Partial<BackendCard['fields']> = {},
): BackendCard {
  return {
    fields: {
      card_number: 'XXXX-XXXX-XXXX-1234',
      expiration_month: '12',
      expiration_year: '2030',
      skyflow_id: 'sky_abc',
      subscription_id: 'sub_1',
      card_scheme: 'visa',
      ...overrides,
    },
  };
}

describe('mapToCard', () => {
  it('maps every snake_case backend field to the public camelCase shape', () => {
    const result = mapToCard(backendCard());

    expect(result).toEqual({
      card_id: 'sky_abc',
      card_number: 'XXXX-XXXX-XXXX-1234',
      expiration_month: '12',
      expiration_year: '2030',
      card_scheme: 'visa',
      subscription_id: 'sub_1',
    });
  });

  it('passes through a null subscription_id as subscription_id: null', () => {
    const result = mapToCard(backendCard({ subscription_id: null }));

    expect(result.subscription_id).toBeNull();
  });

  it('passes card_scheme through unchanged', () => {
    const result = mapToCard(backendCard({ card_scheme: 'mastercard' }));

    expect(result.card_scheme).toBe('mastercard');
  });
});
