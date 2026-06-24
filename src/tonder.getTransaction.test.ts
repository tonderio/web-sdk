import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
};

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    reveal: vi.fn(),
    collect: vi.fn(),
  } as unknown as TokenizerPort;
}

function backendTx(
  overrides: Partial<BackendTransactionResponse> = {},
): BackendTransactionResponse {
  return {
    id: 'tx_1',
    operation_type: 'payment',
    status: 'success',
    amount: '150.00',
    currency: 'MXN',
    ...overrides,
  };
}

function makeSdk(http: HttpPort) {
  return _createTonderWithDeps({
    config: CONFIG,
    http,
    tokenizer: noopTokenizer(),
  });
}

describe('Tonder.getTransaction', () => {
  it('works without session.customer for return_url reconciliation and never throws MISSING_CUSTOMER', async () => {
    const http: HttpPort = {
      request: vi.fn().mockResolvedValue(backendTx({ id: 'tx_return' })),
    };
    const sdk = _createTonderWithDeps({
      config: { ...CONFIG, session: undefined },
      http,
      tokenizer: noopTokenizer(),
    });

    const tx = await sdk.getTransaction('tx_return');

    expect(tx).toMatchObject({ id: 'tx_return', status: 'success' });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/transactions/tx_return/',
      }),
    );
  });

  it('delegates to the service and returns the bare RawTransaction (snake_case, amount coerced, psp_response stripped)', async () => {
    const raw = backendTx({
      client_reference: 'ref-9',
      status_code: 200,
      psp_response: { authorization: '00' },
    } as Partial<BackendTransactionResponse>);
    const http: HttpPort = { request: vi.fn().mockResolvedValue(raw) };
    const sdk = makeSdk(http);

    const tx = await sdk.getTransaction('tx_1');

    expect(tx).toEqual({
      id: 'tx_1',
      operation_type: 'payment',
      status: 'success',
      amount: 150,
      currency: 'MXN',
      client_reference: 'ref-9',
      status_code: 200,
    });
    expect(typeof tx.amount).toBe('number');
    expect('psp_response' in tx).toBe(false);
    expect('outcome' in tx).toBe(false);
  });

  it('works WITHOUT init() — no ready guard (only needs apiKey)', async () => {
    const http: HttpPort = {
      request: vi.fn().mockResolvedValue(backendTx()),
    };
    const sdk = makeSdk(http);

    // No init() call.
    await expect(sdk.getTransaction('tx_1')).resolves.toMatchObject({
      id: 'tx_1',
    });
  });

  it('propagates an AppError(FETCH_TRANSACTION_ERROR) from the service', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
      status_code: 404,
    });
    const http: HttpPort = { request: vi.fn().mockRejectedValue(inner) };
    const sdk = makeSdk(http);

    const err = await sdk.getTransaction('tx_404').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
    expect(err.status_code).toBe(404);
  });

  it('wraps an unknown (non-AppError) failure as FETCH_TRANSACTION_ERROR', async () => {
    // A raw body whose `status` getter throws makes toRawTransaction blow up
    // (the spread copy reads every own enumerable prop) with a plain Error AFTER
    // the service returned — it reaches the facade catch and must be normalized
    // to FETCH_TRANSACTION_ERROR.
    const hostile = backendTx();
    Object.defineProperty(hostile, 'status', {
      get() {
        throw new Error('boom');
      },
    });
    const http: HttpPort = { request: vi.fn().mockResolvedValue(hostile) };
    const sdk = makeSdk(http);

    await expect(sdk.getTransaction('tx_1')).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
    });
  });
});
