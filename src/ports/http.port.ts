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

/**
 * The transactions API as an alternative target of a service whose routes
 * exist on both engines. `enabled` is read on every call, so the answer of the
 * business configuration applies from the moment it is known.
 */
export interface CoreTarget {
  http: HttpPort;
  enabled: () => boolean;
}
