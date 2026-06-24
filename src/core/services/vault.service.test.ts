import { describe, it, expect, vi } from 'vitest';
import { VaultService } from './vault.service';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

function mockHttp(impl: HttpPort['request']): {
  http: HttpPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(impl);
  return { http: { request: spy }, spy };
}

describe('VaultService.fetchVaultToken', () => {
  it('GETs /api/v1/vault-token/ and returns the token string', async () => {
    const { http, spy } = mockHttp(() => Promise.resolve({ token: 'vt_abc' }));
    const service = new VaultService(http);

    const token = await service.fetchVaultToken();

    expect(token).toBe('vt_abc');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/v1/vault-token/' }),
    );
  });

  it('throws AppError(INVALID_VAULT_TOKEN) when the body has no token', async () => {
    const { http } = mockHttp(() => Promise.resolve({}));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_VAULT_TOKEN);
  });

  it('throws AppError(INVALID_VAULT_TOKEN) when the token is an empty string', async () => {
    const { http } = mockHttp(() => Promise.resolve({ token: '   ' }));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_VAULT_TOKEN);
  });

  it('wraps a transport rejection as AppError(VAULT_TOKEN_ERROR)', async () => {
    const { http } = mockHttp(() => Promise.reject(new Error('network down')));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.VAULT_TOKEN_ERROR);
  });

  it('re-throws an existing AppError unchanged (no double-wrap)', async () => {
    const inner = new AppError({ errorCode: ErrorKeyEnum.INVALID_VAULT_TOKEN });
    const { http } = mockHttp(() => Promise.reject(inner));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBe(inner);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_VAULT_TOKEN);
  });
});
