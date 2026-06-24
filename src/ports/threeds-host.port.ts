/**
 * Driven port: presents a `requires_action` (3DS / redirect / APM hosted page)
 * flow in the browser. Implemented by a browser adapter so the core/facade
 * stays free of DOM/`window` access (tests inject a fake host).
 *
 * Two presentation styles:
 * - `redirect` — navigate the top window to the hosted page.
 * - `embedded` — present the hosted page in an SDK-owned full-screen modal
 *   appended to `document.body` (no merchant container). `close()` tears it
 *   down once the flow settles.
 *
 * The modal's closability is caller-driven via {@link ThreeDsHostOptions}:
 * card 3DS is NON-closable (only the SDK's completion/timeout logic closes it),
 * while an APM/SPEI hosted page is closable by the shopper (renders an "X" and
 * responds to Escape), invoking `onUserClose`.
 *
 * The adapter never imports `TonderConfig` — lifecycle callbacks are passed in
 * as plain functions so the presentation layer stays config-agnostic.
 */
export interface ThreeDsHostOptions {
  /**
   * Whether the shopper may dismiss the modal. `false` (card 3DS): no close
   * control, Escape ignored — only programmatic `close()` closes it. `true`
   * (APM/SPEI): renders an "X" and Escape closes it, invoking `onUserClose`.
   */
  closable: boolean;
  /** Invoked once the modal host node is mounted. */
  onOpen?(): void;
  /**
   * Invoked when the SHOPPER closes a closable modal (X or Escape). NOT invoked
   * by a programmatic `close()`.
   */
  onUserClose?(): void;
}

export interface ThreeDsHostPort {
  /** Navigate the browser to the hosted page (`window.location.href = url`). */
  redirect(url: string): void;
  /**
   * Present the hosted page in an SDK-owned full-screen modal appended to
   * `document.body`. Replaces any currently-open modal.
   */
  open(url: string, options: ThreeDsHostOptions): void;
  /**
   * Close and remove the SDK-owned modal. Idempotent — a no-op when nothing is
   * open. Does NOT invoke `onUserClose` (that is shopper-driven only).
   */
  close(): void;
}
