import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** Shape of the `GET /api/v1/vault-token/` response body. */
interface VaultTokenResponse {
  token?: unknown;
}

/**
 * Domain service that mints the short-lived bearer token Skyflow uses to talk to
 * the vault. PURE: depends only on the injected {@link HttpPort} — never on
 * `fetch`/DOM. Failure mapping:
 *   - empty/malformed body → `AppError(INVALID_VAULT_TOKEN)`
 *   - transport failure    → `AppError(VAULT_TOKEN_ERROR)`
 *   - an existing `AppError` is re-thrown unchanged (no double-wrap).
 */
export class VaultService {
  private readonly http: HttpPort;

  constructor(http: HttpPort) {
    this.http = http;
  }

  public async fetchVaultToken(): Promise<string> {
    let response: VaultTokenResponse;
    try {
      response = await this.http.request<VaultTokenResponse>({
        method: 'GET',
        path: '/api/v1/vault-token/',
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.VAULT_TOKEN_ERROR,
        originalError: error,
      });
    }

    const token = response?.token;
    if (typeof token !== 'string' || token.trim() === '') {
      throw new AppError({ errorCode: ErrorKeyEnum.INVALID_VAULT_TOKEN });
    }
    return token;
  }
}
