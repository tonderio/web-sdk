/**
 * Browser presentation contract for hosted authentication/payment pages.
 *
 * Two presentation styles:
 * - `redirect` — navigate the top window to the hosted page.
 * - `embedded` — present the hosted page in an SDK-owned full-screen modal
 *   appended to `document.body` (no merchant container).
 *
 * The modal's closability is caller-driven via {@link ThreeDsHostOptions}:
 * card 3DS is non-closable, while an APM/SPEI hosted page is closable by the
 * shopper and invokes `onUserClose`.
 */
export interface ThreeDsHostOptions {
  /** Whether the shopper may dismiss the modal. */
  closable: boolean;
  /** Invoked once the modal host node is mounted. */
  onOpen?(): void;
  /** Invoked when the shopper closes a closable modal. */
  onUserClose?(): void;
}

export interface ThreeDsHostPort {
  /** Navigate the browser to the hosted page. */
  redirect(url: string): void;
  /** Present the hosted page in an SDK-owned full-screen modal. */
  open(url: string, options: ThreeDsHostOptions): void;
  /** Close and remove the SDK-owned modal. */
  close(): void;
}
