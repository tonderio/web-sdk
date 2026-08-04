import { vi } from 'vitest';
import type { HttpPort, HttpRequestOptions } from '../ports/http.port';

/**
 * Non-generic stand-in for `HttpPort['request']`, the shape a test can actually
 * write.
 *
 * `HttpPort.request` is generic — `<T>(options) => Promise<T>` — and a test
 * implementation cannot produce the caller's `T`, nor is a Vitest `Mock<F>`
 * assignable to a generic signature. Typing an implementation against the port
 * directly therefore fails to compile no matter what the test returns.
 */
export type RequestImpl = (options: HttpRequestOptions) => Promise<unknown>;

/**
 * Present a request implementation as an {@link HttpPort}.
 *
 * The unavoidable cast for the generic mismatch above lives here, once, instead
 * of in every suite that stubs the transport.
 *
 * `request` is always wrapped in a spy, so a suite can reach through the port
 * — `http.request as ReturnType<typeof vi.fn>` — to assert on calls or swap the
 * implementation mid-test.
 */
export function asHttpPort(request: RequestImpl): HttpPort {
  return { request: vi.fn(request) } as unknown as HttpPort;
}

/** {@link asHttpPort} plus the spy, for suites that assert on the calls. */
export function mockHttpPort(impl: RequestImpl): {
  http: HttpPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const http = asHttpPort(impl);
  return { http, spy: http.request as unknown as ReturnType<typeof vi.fn> };
}
