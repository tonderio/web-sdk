import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Browser3dsHost } from './browser-3ds-host.adapter';

const URL_3DS = 'https://3ds.example/go';

/** Query the open shadow root of the single mounted host node. */
function hostNode(): HTMLElement | null {
  return document.querySelector('[data-tonder-modal]');
}

function shadow(): ShadowRoot {
  const host = hostNode();
  if (!host || !host.shadowRoot) {
    throw new Error('host node with open shadow root not found');
  }
  return host.shadowRoot;
}

describe('Browser3dsHost.redirect', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // jsdom blocks real navigation; stub a writable href so we can assert it.
    Reflect.deleteProperty(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'https://merchant.example/checkout' } as Location,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('navigates the window to the url', () => {
    const host = new Browser3dsHost();

    host.redirect(URL_3DS);

    expect(window.location.href).toBe(URL_3DS);
  });
});

describe('Browser3dsHost.open / close — SDK-owned modal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('appends a host node to document.body with an OPEN shadow root', () => {
    const host = new Browser3dsHost();

    host.open(URL_3DS, { closable: false });

    const node = hostNode();
    expect(node).toBeTruthy();
    expect(node?.parentElement).toBe(document.body);
    expect(node?.shadowRoot).toBeTruthy();
    expect(node?.shadowRoot?.mode).toBe('open');
  });

  it('host node has inline position:fixed and a max z-index', () => {
    const host = new Browser3dsHost();

    host.open(URL_3DS, { closable: false });

    const node = hostNode() as HTMLElement;
    expect(node.style.position).toBe('fixed');
    expect(node.style.zIndex).toBe('2147483647');
  });

  it('renders a dialog with role="dialog", aria-modal and an aria-label', () => {
    const host = new Browser3dsHost();

    host.open(URL_3DS, { closable: false });

    const dialog = shadow().querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders an iframe pointed at the url inside the shadow root', () => {
    const host = new Browser3dsHost();

    host.open(URL_3DS, { closable: false });

    const iframe = shadow().querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toBe(URL_3DS);
  });

  it('never throws for a "missing container" (there is no container anymore)', () => {
    const host = new Browser3dsHost();
    expect(() => host.open(URL_3DS, { closable: false })).not.toThrow();
  });

  it('calls onOpen once the host node is mounted', () => {
    const host = new Browser3dsHost();
    const onOpen = vi.fn();

    host.open(URL_3DS, { closable: false, onOpen });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('close() removes the host node from document.body', () => {
    const host = new Browser3dsHost();
    host.open(URL_3DS, { closable: false });

    host.close();

    expect(hostNode()).toBeNull();
  });

  it('close() is idempotent (calling twice does not throw)', () => {
    const host = new Browser3dsHost();
    host.open(URL_3DS, { closable: false });

    host.close();
    expect(() => host.close()).not.toThrow();
  });

  it('open() replaces a previously-open modal (single host node)', () => {
    const host = new Browser3dsHost();
    host.open(URL_3DS, { closable: false });
    host.open(URL_3DS, { closable: false });

    expect(document.querySelectorAll('[data-tonder-modal]')).toHaveLength(1);
  });
});

describe('Browser3dsHost — 3DS (non-closable) modal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders NO close control', () => {
    const host = new Browser3dsHost();

    host.open(URL_3DS, { closable: false });

    expect(shadow().querySelector('[data-tonder-close]')).toBeNull();
  });

  it('ignores Escape (does not close, does not call onUserClose)', () => {
    const host = new Browser3dsHost();
    const onUserClose = vi.fn();
    host.open(URL_3DS, { closable: false, onUserClose });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(hostNode()).toBeTruthy();
    expect(onUserClose).not.toHaveBeenCalled();
  });
});

describe('Browser3dsHost — APM (closable) modal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a close control; clicking it closes and calls onUserClose', () => {
    const host = new Browser3dsHost();
    const onUserClose = vi.fn();
    host.open(URL_3DS, { closable: true, onUserClose });

    const closeBtn = shadow().querySelector(
      '[data-tonder-close]',
    ) as HTMLElement;
    expect(closeBtn).toBeTruthy();

    closeBtn.click();

    expect(hostNode()).toBeNull();
    expect(onUserClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes and calls onUserClose', () => {
    const host = new Browser3dsHost();
    const onUserClose = vi.fn();
    host.open(URL_3DS, { closable: true, onUserClose });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(hostNode()).toBeNull();
    expect(onUserClose).toHaveBeenCalledTimes(1);
  });

  it('programmatic close() does NOT call onUserClose', () => {
    const host = new Browser3dsHost();
    const onUserClose = vi.fn();
    host.open(URL_3DS, { closable: true, onUserClose });

    host.close();

    expect(hostNode()).toBeNull();
    expect(onUserClose).not.toHaveBeenCalled();
  });
});

describe('Browser3dsHost — focus trap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Tab from the last focusable wraps to the first inside the shadow root', () => {
    const host = new Browser3dsHost();
    host.open(URL_3DS, { closable: true });

    const focusables = Array.from(
      shadow().querySelectorAll<HTMLElement>(
        'button, [href], iframe, [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(0);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    // Real keyboard events from a focused shadow node are composed and reach the
    // document-level capturing trap handler.
    const evt = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    document.dispatchEvent(evt);
    // The trap prevents default and cycles focus back to the first focusable.
    expect(evt.defaultPrevented).toBe(true);
    expect(shadow().activeElement).toBe(first);
  });
});
