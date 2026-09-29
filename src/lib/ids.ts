/**
 * Identifier helpers.
 *
 * `crypto.randomUUID` exists in every browser we support and in Node 19+, but we
 * still fall back so the pure logic stays testable in any environment.
 */
export function newId(prefix = ""): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  const raw =
    cryptoObj && typeof cryptoObj.randomUUID === "function"
      ? cryptoObj.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}
