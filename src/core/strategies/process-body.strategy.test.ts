import { describe, it, expect } from 'vitest';
import {
  buildProcessBody,
  scopeRequestId,
  DEFAULT_CURRENCY,
  DEFAULT_PRESENTATION_MODE,
} from './process-body.strategy';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { Customer } from '../../shared/types';

const CUSTOMER: Customer = {
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

const CARD_METHOD = { type: 'CARD' as const, card: { token: 'tok_1' } };

function baseInput() {
  return {
    payment: {
      amount: 100,
      return_url: 'https://merchant.example/return',
      client_reference: 'ref-1',
    },
    paymentMethod: CARD_METHOD,
    customer: CUSTOMER,
    currency: 'MXN',
    presentationMode: 'redirect' as const,
  };
}

describe('process-body.strategy — defaults', () => {
  it('exports DEFAULT_CURRENCY as MXN', () => {
    expect(DEFAULT_CURRENCY).toBe('MXN');
  });

  it('exports DEFAULT_PRESENTATION_MODE as redirect', () => {
    expect(DEFAULT_PRESENTATION_MODE).toBe('redirect');
  });
});

describe('buildProcessBody', () => {
  it('builds the full /process body from the resolved inputs', () => {
    const body = buildProcessBody(baseInput());

    // Whole-body deep equality (DD12): objectContaining would pass with a
    // stray extra field, which is exactly how a drifted body would ship.
    expect(body).toEqual({
      operation_type: 'payment',
      amount: 100,
      currency: 'MXN',
      return_url: 'https://merchant.example/return',
      presentation_mode: 'redirect',
      customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
      payment_method: CARD_METHOD,
      client_reference: 'ref-1',
    });
  });

  it('uses the pre-resolved currency and presentation mode verbatim, never defaulting internally', () => {
    const body = buildProcessBody({
      ...baseInput(),
      currency: 'USD',
      presentationMode: 'embedded',
    });

    expect(body.currency).toBe('USD');
    expect(body.presentation_mode).toBe('embedded');
  });

  it('joins only the present customer name parts', () => {
    const body = buildProcessBody({
      ...baseInput(),
      customer: { email: 'solo@example.com', first_name: 'Solo' },
    });

    expect(body.customer).toEqual({
      name: 'Solo',
      email: 'solo@example.com',
    });
  });

  it('omits metadata and billing_address when the caller omits them', () => {
    const body = buildProcessBody(baseInput());

    expect('metadata' in body).toBe(false);
    expect('billing_address' in body).toBe(false);
  });

  it('forwards metadata and billing_address when supplied', () => {
    const input = baseInput();
    const body = buildProcessBody({
      ...input,
      payment: {
        ...input.payment,
        metadata: { order: 7 },
        billing_address: { zip_code: '01000' },
      },
    });

    expect(body.metadata).toEqual({ order: 7 });
    expect(body.billing_address).toEqual({ zip_code: '01000' });
  });

  it('passes the payment_method block through by reference', () => {
    const body = buildProcessBody(baseInput());

    expect(body.payment_method).toBe(CARD_METHOD);
  });

  it('throws MISSING_CUSTOMER when customer is undefined', () => {
    let caught: unknown;
    try {
      buildProcessBody({ ...baseInput(), customer: undefined });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorKeyEnum.MISSING_CUSTOMER);
  });
});

describe('scopeRequestId', () => {
  it('returns undefined when no key is supplied', () => {
    expect(scopeRequestId(undefined, 7)).toBeUndefined();
  });

  it('returns undefined for a blank key', () => {
    expect(scopeRequestId('   ', 7)).toBeUndefined();
  });

  it('prefixes the trimmed key with the business pk', () => {
    expect(scopeRequestId('  key-1  ', 7)).toBe('7_key-1');
  });

  it('returns the trimmed key unscoped when the business pk is unknown', () => {
    expect(scopeRequestId(' key-1 ', undefined)).toBe('key-1');
  });
});
