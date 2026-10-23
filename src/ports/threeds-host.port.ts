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
  /**
   * Whether the hosted page is allowed to write to the system clipboard.
   *
   * Cross-origin iframes get no `clipboard-write` Permissions-Policy grant by
   * default, so the APM/SPEI hosted page's "Copy" buttons (CVU, alias, CLABE)
   * fail with a policy violation until the embedder delegates it. Scoped per
   * call rather than always-on: card 3DS embeds a third-party BANK ACS page
   * that has no need for the clipboard, and least privilege keeps us from
   * handing that page a capability it never uses.
   */
  allowClipboard?: boolean;
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
