/**
 * Service registry / locator. One place owns all domain services so strategies
 * and widgets resolve dependencies without knowing the wiring (Service
 * Locator). PURE: holds typed references only — no DOM/HTTP imports.
 *
 * Keys are strings for now; later changes will introduce a typed service map.
 */
export class ServiceManager {
  private readonly services = new Map<string, unknown>();

  /** Register (or replace) a service under a key. */
  public register<T>(key: string, service: T): void {
    this.services.set(key, service);
  }

  /** Returns true if a service is registered under the key. */
  public has(key: string): boolean {
    return this.services.has(key);
  }

  /**
   * Resolve a service by key. Throws if the service is not registered so
   * wiring bugs surface eagerly during development.
   */
  public get<T>(key: string): T {
    const service = this.services.get(key);
    if (service === undefined) {
      throw new Error(`Service "${key}" is not registered.`);
    }
    return service as T;
  }
}
