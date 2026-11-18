/**
 * A fresh request id for one payment attempt.
 *
 * Uses `crypto.randomUUID` when the runtime has it (secure contexts, Node 19+)
 * and a random hex string otherwise; the id only has to be unique per attempt.
 */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const chunk = () =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  return `${chunk()}-${chunk()}-${chunk()}-${chunk()}`;
}
