import { createTelemetry } from '@tonder.io/client-telemetry';
import type {
  TelemetryFields,
  TelemetryPort,
} from '../../ports/telemetry.port';
import type { TonderMode } from '../../shared/config/env';
import { SDK_VERSION } from '../../shared/version';

export interface ClientTelemetryOptions {
  env: TonderMode;
  /** Base URL of the telemetry service; the client adds `/v1/events`. */
  endpoint: string;
  /** The API key the SDK already sends to Tonder as `Authorization`. */
  apiKey: string;
}

type Client = ReturnType<typeof createTelemetry>;

/**
 * Sends the SDK's telemetry through the shared client. Every call is isolated:
 * telemetry must never throw into the merchant's page or change a payment.
 */
export class ClientTelemetryAdapter implements TelemetryPort {
  private readonly client: Client | undefined;

  constructor(options: ClientTelemetryOptions) {
    try {
      this.client = createTelemetry({
        sdk: { name: 'web-sdk', version: SDK_VERSION },
        env: options.env,
        endpoint: options.endpoint,
        getAuthorization: () => `Token ${options.apiKey}`,
      });
    } catch {
      this.client = undefined;
    }
  }

  public methodCalled(
    method: string,
    options: { deprecated?: boolean } = {},
  ): void {
    this.safely((client) =>
      client.methodCalled(
        method,
        {},
        options.deprecated ? { deprecated: true } : {},
      ),
    );
  }

  public flowStep(step: string, fields?: TelemetryFields): void {
    this.safely((client) => client.flowStep(step, fields));
  }

  public flowFailed(step: string, fields?: TelemetryFields): void {
    this.safely((client) => client.flowFailed(step, fields));
  }

  private safely(send: (client: Client) => void): void {
    if (!this.client) return;
    try {
      send(this.client);
    } catch {
      // Telemetry is best effort.
    }
  }
}

/** Reports nothing. The default of the test factory, so no test touches the network. */
export class NoopTelemetry implements TelemetryPort {
  public methodCalled(): void {}
  public flowStep(): void {}
  public flowFailed(): void {}
}
