import type {
  ThreeDsHostOptions,
  ThreeDsHostPort,
} from '../../ports/threeds-host.port';

/** Highest 32-bit signed z-index — keeps the modal above merchant UI. */
const MAX_Z_INDEX = '2147483647';

/** CSS selector matching focusable elements inside the shadow dialog. */
const FOCUSABLE_SELECTOR =
  'button, [href], iframe, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Browser implementation of {@link ThreeDsHostPort}. This is the ONLY place in
 * the SDK that touches `window`/`document` for the presentation flow — the core
 * and the facade stay DOM-free and tests inject a fake host.
 *
 * - `redirect` navigates the top window to the hosted page.
 * - `open` builds an SDK-owned full-screen modal appended to `document.body`,
 *   isolated from merchant CSS by an OPEN shadow root. Card 3DS is non-closable
 *   (no X, Escape ignored); an APM/SPEI hosted page is closable (renders an "X"
 *   and responds to Escape, invoking `onUserClose`).
 * - `close` removes the modal and its listeners. Idempotent.
 */
export class Browser3dsHost implements ThreeDsHostPort {
  private hostNode: HTMLElement | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private onUserClose?: () => void;

  public redirect(url: string): void {
    window.location.href = url;
  }

  public open(url: string, options: ThreeDsHostOptions): void {
    // Replace any currently-open modal so we never stack hosts.
    this.close();
    this.onUserClose = options.onUserClose;

    const host = document.createElement('div');
    host.setAttribute('data-tonder-modal', '');
    // The host element cannot be styled from inside its own shadow root, so its
    // positioning/stacking must be set inline here.
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = MAX_Z_INDEX;

    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(this.buildStyle());

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Payment authentication');

    if (options.closable) {
      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('type', 'button');
      closeBtn.setAttribute('data-tonder-close', '');
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.className = 'close';
      closeBtn.textContent = '×'; // ×
      closeBtn.addEventListener('click', () => this.userClose());
      dialog.appendChild(closeBtn);
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', url);
    iframe.setAttribute('title', 'Payment authentication');
    iframe.className = 'frame';
    dialog.appendChild(iframe);

    backdrop.appendChild(dialog);
    root.appendChild(backdrop);

    document.body.appendChild(host);
    this.hostNode = host;

    this.installKeydownHandler(options.closable, dialog);

    // Move focus into the dialog so keyboard users start inside the trap.
    const focusables = this.focusablesIn(dialog);
    (focusables[0] ?? dialog).focus?.();

    options.onOpen?.();
  }

  public close(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.hostNode?.remove();
    this.hostNode = null;
    this.onUserClose = undefined;
  }

  /** Shopper-driven close: tear down AND invoke the merchant callback. */
  private userClose(): void {
    const cb = this.onUserClose;
    this.close();
    cb?.();
  }

  /**
   * Install a single capturing keydown handler that (a) closes on Escape when
   * the modal is closable and (b) enforces the Tab focus trap inside the dialog.
   */
  private installKeydownHandler(closable: boolean, dialog: HTMLElement): void {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (closable) {
          event.preventDefault();
          this.userClose();
        }
        // Non-closable 3DS: Escape is ignored.
        return;
      }
      if (event.key === 'Tab') {
        this.trapFocus(event, dialog);
      }
    };
    this.keydownHandler = handler;
    document.addEventListener('keydown', handler, true);
  }

  /** Keep Tab / Shift+Tab cycling within the dialog's focusable set. */
  private trapFocus(event: KeyboardEvent, dialog: HTMLElement): void {
    const focusables = this.focusablesIn(dialog);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = (dialog.getRootNode() as ShadowRoot).activeElement;

    if (event.shiftKey) {
      if (active === first || !active) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !active) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusablesIn(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  private buildStyle(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dialog {
        position: relative;
        width: min(520px, calc(100vw - 32px));
        height: min(700px, calc(100vh - 32px));
        background: #fff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
      }
      .frame {
        width: 100%;
        height: 100%;
        border: 0;
      }
      .close {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
      }
    `;
    return style;
  }
}
