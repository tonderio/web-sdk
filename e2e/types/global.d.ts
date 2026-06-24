// Ambient declarations for the in-page globals the fixture exposes. Tests
// reference these inside `page.evaluate` callbacks (which run in the browser),
// so they must be typed for the E2E tsconfig to pass.
//
// We intentionally type the SDK surface STRUCTURALLY (not by importing src/)
// because page.evaluate runs against the built IIFE, not the TS source, and we
// must not couple the E2E project to internal module paths. Keep this minimal:
// only the public methods the suite calls.

export {};

interface TonderE2EComponent {
  mount(): Promise<void>;
  unmount(): void;
  reveal(request: unknown): Promise<void>;
}

interface TonderE2EInstance {
  init(): Promise<void>;
  create(type: string, options: unknown): TonderE2EComponent;
  pay(input: unknown): Promise<Record<string, unknown>>;
  getTransaction(id: string): Promise<Record<string, unknown>>;
  enrollCard(): Promise<Record<string, unknown>>;
  getCustomerCards(): Promise<Array<Record<string, unknown>>>;
  removeCustomerCard(card_id: string): Promise<void>;
  getPaymentMethods(): Promise<Array<Record<string, unknown>>>;
  getPaymentMethodBanks(): Promise<{ cash: unknown[]; transfer: unknown[] }>;
}

interface TonderGlobal {
  createTonder(config: unknown): TonderE2EInstance;
}

interface TonderBridge {
  instance: TonderE2EInstance | null;
  lastResult: unknown;
  lastError: unknown;
}

declare global {
  interface Window {
    Tonder: TonderGlobal;
    __tonderBridge: TonderBridge;
  }
}
