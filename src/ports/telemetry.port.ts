/**
 * What the SDK reports about its own use: which public method was called and
 * how the key steps of a payment went. Closed fields only: never card, buyer,
 * 3DS or free-text data. An implementation never throws into the page.
 */
export interface TelemetryFields {
  outcome?: 'ok' | 'error' | 'timeout' | 'cancelled';
  error_code?: string;
  http_status?: number;
  duration_ms?: number;
  payment_method_type?: string;
  operation_id?: string;
  request_id?: string;
}

export interface TelemetryPort {
  methodCalled(method: string, options?: { deprecated?: boolean }): void;
  flowStep(step: string, fields?: TelemetryFields): void;
  flowFailed(step: string, fields?: TelemetryFields): void;
  /** Send what is queued now, for a page that is about to leave. Never awaited. */
  flush(): void;
}
