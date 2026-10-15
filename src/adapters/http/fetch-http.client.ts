import type { HttpPort, HttpRequestOptions } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** Construction options for {@link FetchHttpClient}. */
export interface FetchHttpClientOptions {
  /**
   * Send `X-App-Origin: sdk/web` on every request. Defaults to `true`. Disable
   * it for hosts whose CORS policy does not allow the header: a custom header
   * outside `Access-Control-Allow-Headers` fails the preflight.
   */
  appOrigin?: boolean;
}

/**
 * `fetch`-based implementation of {@link HttpPort}. The ONLY place in the SDK
 * that touches the global `fetch`. Generic transport — it carries no domain
 * knowledge of any specific endpoint.
 *
 * Per-request headers override the defaults. Responses parse as JSON with a
 * text fallback. Non-2xx and network errors become `AppError(REQUEST_FAILED)`;
 * an `AbortError` becomes `AppError(REQUEST_ABORTED)`.
 */
export class FetchHttpClient implements HttpPort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appOrigin: boolean;

  constructor(
    baseUrl: string,
    apiKey: string,
    options: FetchHttpClientOptions = {},
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.appOrigin = options.appOrigin ?? true;
  }

  public async request<T>(options: HttpRequestOptions): Promise<T> {
    const url = `${this.baseUrl}${options.path}`;
    const headers: Record<string, string> = {
      Authorization: `Token ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...(this.appOrigin ? { 'X-App-Origin': 'sdk/web' } : {}),
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
      // The parsed error body is deliberately NOT carried onto the error: it is
      // backend-shaped — stack traces, internal service names, database
      // constraints — and this error is merchant-facing. `status_code` is the
      // one piece of the response that crosses.
      throw new AppError({
        errorCode: ErrorKeyEnum.REQUEST_FAILED,
        status_code: response.status,
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
