import type { AppError } from '../shared/errors/AppError';

/**
 * Run something expected to reject and return the {@link AppError} it threw.
 *
 * Replaces `.catch((e) => e)`, which types as `unknown` the moment the awaited
 * call is declared `Promise<unknown>` — and, worse, quietly hands back the
 * RESOLVED value when the call does not reject at all, turning a missing throw
 * into a confusing assertion failure somewhere further down.
 */
export async function rejectionOf(
  run: () => Promise<unknown>,
): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Expected the call to reject, but it resolved.');
}
