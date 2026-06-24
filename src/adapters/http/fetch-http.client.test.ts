import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FetchHttpClient } from './fetch-http.client';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const BASE = 'https://sandbox.tonder.io';
const API_KEY = 'pk_test_123';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('FetchHttpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('composes the URL as base + path and injects auth + content-type headers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const client = new FetchHttpClient(BASE, API_KEY);

    await client.request({
      method: 'GET',
      path: '/api/v1/payments/business/pk_test_123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/payments/business/pk_test_123`);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Token ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('merges per-request headers over the defaults and forwards the signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const client = new FetchHttpClient(BASE, API_KEY);
    const controller = new AbortController();

    await client.request({
      method: 'POST',
      path: '/x',
      body: { a: 1 },
      headers: { 'X-Custom': 'y' },
      signal: controller.signal,
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('y');
    expect(headers.Authorization).toBe(`Token ${API_KEY}`);
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.signal).toBe(controller.signal);
  });

  it('sends X-App-Origin: sdk/web on a plain GET request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const client = new FetchHttpClient(BASE, API_KEY);

    await client.request({ method: 'GET', path: '/x' });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-App-Origin']).toBe('sdk/web');
  });

  it('X-App-Origin survives when per-request headers are supplied', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const client = new FetchHttpClient(BASE, API_KEY);

    await client.request({
      method: 'POST',
      path: '/x',
      body: { a: 1 },
      headers: { 'X-Custom': 'z' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('z');
    expect(headers['X-App-Origin']).toBe('sdk/web');
  });

  it('X-App-Origin is present even if caller passes an explicit headers object that omits it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const client = new FetchHttpClient(BASE, API_KEY);

    await client.request({
      method: 'GET',
      path: '/x',
      headers: { Authorization: 'Token override' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-App-Origin']).toBe('sdk/web');
  });

  it('returns parsed JSON on a 2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ vault_id: 'v1' }, 200));
    const client = new FetchHttpClient(BASE, API_KEY);

    const result = await client.request<{ vault_id: string }>({
      method: 'GET',
      path: '/x',
    });

    expect(result).toEqual({ vault_id: 'v1' });
  });

  it('maps a 4xx response to AppError(REQUEST_FAILED) with the right status_code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, 404));
    const client = new FetchHttpClient(BASE, API_KEY);

    await expect(
      client.request({ method: 'GET', path: '/x' }),
    ).rejects.toMatchObject({
      code: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 404,
    });
  });

  it('maps a 5xx response to AppError(REQUEST_FAILED) with status_code 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, 500));
    const client = new FetchHttpClient(BASE, API_KEY);

    const err = await client
      .request({ method: 'GET', path: '/x' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.REQUEST_FAILED);
    expect(err.status_code).toBe(500);
  });

  it('maps a network rejection to AppError(REQUEST_FAILED)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const client = new FetchHttpClient(BASE, API_KEY);

    await expect(
      client.request({ method: 'GET', path: '/x' }),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.REQUEST_FAILED });
  });

  it('maps an AbortError to AppError(REQUEST_ABORTED)', async () => {
    const abortError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    fetchMock.mockRejectedValue(abortError);
    const client = new FetchHttpClient(BASE, API_KEY);

    await expect(
      client.request({ method: 'GET', path: '/x' }),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.REQUEST_ABORTED });
  });
});
