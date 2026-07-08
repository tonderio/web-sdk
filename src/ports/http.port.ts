/** HTTP method verbs supported by the SDK transport. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Options for a single HTTP request. */
export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Abstraction over the SDK HTTP transport. */
export interface HttpPort {
  request<T>(options: HttpRequestOptions): Promise<T>;
}
