import { describe, it, expect } from 'vitest';
import { VaultService } from './vault.service';
import { mockHttpPort } from '../../test-support/http.mock';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

describe('VaultService.fetchVaultToken', () => {
  it('GETs /api/v1/vault-token/ and returns the token string', async () => {
    const { http, spy } = mockHttpPort(() =>
      Promise.resolve({ token: 'vt_abc' }),
    );
    const service = new VaultService(http);

    const token = await service.fetchVaultToken();

    expect(token).toBe('vt_abc');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/v1/vault-token/' }),
    );
  });

  it('throws AppError(INVALID_VAULT_TOKEN) when the body has no token', async () => {
    const { http } = mockHttpPort(() => Promise.resolve({}));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_VAULT_TOKEN);
  });

  it('throws AppError(INVALID_VAULT_TOKEN) when the token is an empty string', async () => {
    const { http } = mockHttpPort(() => Promise.resolve({ token: '   ' }));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_VAULT_TOKEN);
  });

  it('wraps a transport rejection as AppError(VAULT_TOKEN_ERROR)', async () => {
    const { http } = mockHttpPort(() =>
      Promise.reject(new Error('network down')),
    );
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.VAULT_TOKEN_ERROR);
  });

  it('re-throws an existing AppError unchanged (no double-wrap)', async () => {
    const inner = new AppError({ errorCode: ErrorKeyEnum.INVALID_VAULT_TOKEN });
    const { http } = mockHttpPort(() => Promise.reject(inner));
    const service = new VaultService(http);

    const err = await service.fetchVaultToken().catch((e) => e);
    expect(err).toBe(inner);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_VAULT_TOKEN);
  });
});
