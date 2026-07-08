import type { HttpPort, HttpRequestOptions } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * `fetch`-based implementation of {@link HttpPort}. The ONLY place in the SDK
 * that touches the global `fetch`. Generic transport — it carries no domain
 * knowledge of any specific endpoint.
 *
 * Behavior:
 *   - URL = `${baseUrl}${path}`.
 *   - Default headers: `Authorization: Token <apiKey>` + `Content-Type:
 *     application/json`. Per-request headers override defaults.
 *   - JSON body is serialized; the response is parsed as JSON with a text
 *     fallback for empty/non-JSON payloads.
 *   - Non-2xx → `AppError(REQUEST_FAILED)` with the response `statusCode` and
 *     the parsed body in `details`.
 *   - `AbortError` → `AppError(REQUEST_ABORTED)`.
 *   - Any other (network) error → `AppError(REQUEST_FAILED)`.
 */
export class FetchHttpClient implements HttpPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  public async request<T>(options: HttpRequestOptions): Promise<T> {
    const url = `${this.baseUrl}${options.path}`;
    const headers: Record<string, string> = {
      Authorization: `Token ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-App-Origin': 'sdk/web',
      ...(options.headers ?? {}),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (error) {
      if (FetchHttpClient.isAbortError(error)) {
        throw new AppError({
          errorCode: ErrorKeyEnum.REQUEST_ABORTED,
          originalError: error,
        });
      }
      throw new AppError({
        errorCode: ErrorKeyEnum.REQUEST_FAILED,
        originalError: error,
      });
    }

    const parsedBody = await FetchHttpClient.parseBody(response);

    if (!response.ok) {
      throw new AppError({
        errorCode: ErrorKeyEnum.REQUEST_FAILED,
        status_code: response.status,
        details: { body: parsedBody },
      });
    }

    return parsedBody as T;
  }

  private static isAbortError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError'
    );
  }

  private static async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
