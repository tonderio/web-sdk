import { describe, it, expect } from 'vitest';
import {
  toRawTransaction,
  type BackendTransactionResponse,
} from './transaction.model';

function makeRaw(
  overrides: Partial<BackendTransactionResponse> = {},
): BackendTransactionResponse {
  return {
    id: 'tx_1',
    operation_type: 'payment',
    status: 'Authorized',
    amount: '150.00',
    currency: 'MXN',
    client_reference: 'ref-1',
    metadata: { order: '42' },
    provider: 'stripe',
    created_at: '2026-06-24T00:00:00Z',
    status_code: 200,
    ...overrides,
  };
}

describe('toRawTransaction', () => {
  it('coerces a string amount to a number', () => {
    const tx = toRawTransaction(makeRaw({ amount: '150' }));

    expect(tx.amount).toBe(150);
    expect(typeof tx.amount).toBe('number');
  });

  it('leaves an already-numeric amount unchanged', () => {
    const tx = toRawTransaction(makeRaw({ amount: 200 as unknown as string }));

    expect(tx.amount).toBe(200);
    expect(typeof tx.amount).toBe('number');
  });

  it('strips psp_response from the returned body when present', () => {
    const tx = toRawTransaction(
      makeRaw({
        psp_response: { authorization: '00', raw: { foo: 'bar' } },
      } as Partial<BackendTransactionResponse>),
    );

    expect('psp_response' in tx).toBe(false);
  });

  it('is a no-op for psp_response when it is absent', () => {
    const tx = toRawTransaction(makeRaw());

    expect('psp_response' in tx).toBe(false);
  });

  it('does not mutate the source body', () => {
    const raw = makeRaw({
      amount: '150',
      psp_response: { authorization: '00' },
    } as Partial<BackendTransactionResponse>);

    toRawTransaction(raw);

    expect(raw.amount).toBe('150');
    expect('psp_response' in raw).toBe(true);
  });

  it('passes unknown/unlisted fields through verbatim under their snake_case keys', () => {
    const raw = makeRaw({
      status: 'Pending',
      next_action: {
        redirect_to_url: { url: 'https://apm.example/go' },
      },
      clabe: '012345678901234567',
      bank_name: 'STP',
      // arbitrary future field the SDK does not know about
      some_future_field: { nested: true },
    } as Partial<BackendTransactionResponse>);

    const tx = toRawTransaction(raw);

    expect(tx.next_action).toEqual({
      redirect_to_url: { url: 'https://apm.example/go' },
    });
    expect(tx.clabe).toBe('012345678901234567');
    expect(tx.bank_name).toBe('STP');
    expect(tx.some_future_field).toEqual({ nested: true });
  });

  it('keeps the known snake_case fields unchanged (only amount coerced, psp_response stripped)', () => {
    const raw = makeRaw({
      decline_code: 'do_not_honor',
      decline_reason: 'Issuer declined',
    });

    const tx = toRawTransaction(raw);

    expect(tx).toEqual({
      id: 'tx_1',
      operation_type: 'payment',
      status: 'Authorized',
      amount: 150,
      currency: 'MXN',
      client_reference: 'ref-1',
      metadata: { order: '42' },
      provider: 'stripe',
      created_at: '2026-06-24T00:00:00Z',
      status_code: 200,
      decline_code: 'do_not_honor',
      decline_reason: 'Issuer declined',
    });
  });
});
