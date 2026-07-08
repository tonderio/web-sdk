import { ErrorKeyEnum } from './ErrorKeyEnum';
import { MESSAGES_EN } from './messages';

const DEFAULT_SYSTEM_ERROR = 'APP_INTERNAL_001';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface AppErrorInput {
  errorCode: string;
  message?: string;
  status_code?: number;
  details?: Record<string, unknown>;
  originalError?: unknown;
}

/**
 * Standardized SDK error thrown by public methods.
 *
 * Use `code` for programmatic branching, `message` for user-facing fallback
 * copy, and `details.system_error` when reporting diagnostics to support.
 */
export class AppError extends Error {
  public readonly status = 'error' as const;
  public readonly code: string;
  public readonly status_code: number;
  public readonly originalError?: unknown;
  public details: Record<string, unknown>;

  constructor(error: AppErrorInput) {
    const resolved_status_code = AppError.resolveStatusCode(
      error.status_code,
      error.originalError,
    );
    const resolvedMessage = AppError.resolveMessage(
      error.errorCode,
      error.message,
    );
    const resolved_system_error = AppError.resolveSystemError(
      error.details?.system_error,
      error.originalError,
    );

    super(resolvedMessage);

    Object.setPrototypeOf(this, new.target.prototype);

    this.name = 'TonderError';
    this.code = error.errorCode;
    this.status_code = resolved_status_code;
    this.originalError = error.originalError;
    this.details = {
      code: error.errorCode,
      status_code: resolved_status_code,
      system_error: resolved_system_error,
    };

    const captureStackTrace = (
      Error as unknown as {
        captureStackTrace?: (target: object, ctor: unknown) => void;
      }
    ).captureStackTrace;
    captureStackTrace?.(this, AppError);
  }

  public static resolveStatusCode(
    explicit_status_code: unknown,
    originalError?: unknown,
  ): number {
    const candidates: unknown[] = [explicit_status_code];

    if (isRecord(originalError)) {
      candidates.push(originalError.status_code, originalError.status);

      const body = isRecord(originalError.body) ? originalError.body : null;
      if (body) {
        candidates.push(body.status_code, body.status);
      }
    }

    for (const candidate of candidates) {
      if (AppError.isHttpStatusCode(candidate)) {
        return Math.trunc(Number(candidate));
      }
    }

    return 500;
  }

  public static resolveMessage(errorCode: string, message?: string): string {
    if (message) return message;
    return (
      MESSAGES_EN[errorCode] ||
      MESSAGES_EN[ErrorKeyEnum.UNKNOWN_ERROR] ||
      'An unexpected error occurred.'
    );
  }

  public static isHttpStatusCode(value: unknown): boolean {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599;
  }

  public static normalizeSystemError(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  public static resolveSystemError(
    explicit_system_error: unknown,
    originalError?: unknown,
  ): string {
    const candidates: unknown[] = [explicit_system_error];

    if (isRecord(originalError)) {
      const details = isRecord(originalError.details)
        ? originalError.details
        : null;
      const body = isRecord(originalError.body) ? originalError.body : null;
      const bodyDetails = body && isRecord(body.details) ? body.details : null;

      candidates.push(
        originalError.system_error,
        originalError.code,
        details?.system_error,
        details?.code,
        body?.system_error,
        body?.code,
        bodyDetails?.system_error,
        bodyDetails?.code,
      );
    }

    for (const candidate of candidates) {
      const resolved = AppError.normalizeSystemError(candidate);
      if (resolved) return resolved;
    }

    return DEFAULT_SYSTEM_ERROR;
  }
}

export interface BuildPublicAppErrorInput {
  errorCode: string;
  message?: string;
  status_code?: number;
  details?: Record<string, unknown>;
}

function isTonderAppErrorLike(error: unknown): error is AppError {
  return (
    isRecord(error) &&
    error.name === 'TonderError' &&
    typeof error.code === 'string'
  );
}

function getOriginalError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error.originalError !== undefined ? error.originalError : error;
  }
  return error;
}

/**
 * Factory that normalizes any thrown value into a standardized {@link AppError}.
 * If the input is already a Tonder `AppError` for the same code and there are no
 * explicit overrides, it is returned as-is to preserve the original context.
 */
export function buildPublicAppError(
  data: BuildPublicAppErrorInput,
  error?: unknown,
): AppError {
  if (!data?.errorCode) {
    throw new Error('buildPublicAppError requires errorCode');
  }

  const explicit_system_error = data.details?.system_error;
  const hasExplicitOverrides =
    !!data.message ||
    data.status_code !== undefined ||
    explicit_system_error !== undefined;

  if (
    isTonderAppErrorLike(error) &&
    !hasExplicitOverrides &&
    data.errorCode === error.code
  ) {
    return error;
  }

  return new AppError({
    errorCode: data.errorCode,
    message: data.message,
    status_code: data.status_code,
    details:
      explicit_system_error !== undefined
        ? { system_error: explicit_system_error }
        : undefined,
    originalError: getOriginalError(error),
  });
}
