import { AppError } from '../../shared/errors/AppError';
import type { TelemetryFields } from '../../ports/telemetry.port';

/** The fields of a failed step: the stable code and the HTTP status, never a message. */
export function failureFields(error: unknown): TelemetryFields {
  if (error instanceof AppError) {
    return {
      outcome: 'error',
      error_code: error.code,
      http_status: error.status_code,
    };
  }
  return { outcome: 'error' };
}

/** `card` -> `CARD`, the shape the telemetry contract expects. */
export function paymentMethodTypeOf(type: unknown): string | undefined {
  return typeof type === 'string' && type ? type.toUpperCase() : undefined;
}

/** Wall-clock milliseconds since `startedAt`. */
export function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.round(Date.now() - startedAt));
}
