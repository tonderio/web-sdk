/** HTTP method verbs supported by the Direct API client. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Options for a single HTTP request. */
export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Driven port: abstracts the HTTP transport so the domain never depends on a
 * concrete `fetch`/client. Implemented by `adapters/http/direct-api.client`.
 */
export interface HttpPort {
  request<T>(options: HttpRequestOptions): Promise<T>;
}
