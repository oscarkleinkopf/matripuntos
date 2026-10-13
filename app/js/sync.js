// Sync stays off. A later server may store only ciphertext envelopes.
// It must never receive the passphrase, the PIN, the data key, or plaintext.
export const SYNC = Object.freeze({
  enabled: false,
  endpoint: null,
  storesPlaintext: false,
  storesKeys: false,
});

export function ciphertextEnvelope(row) {
  if (typeof row?.id !== "string" || typeof row?.iv !== "string" || typeof row?.ciphertext !== "string") {
    throw new Error("Registro cifrado incompleto.");
  }
  return { id: row.id, iv: row.iv, ciphertext: row.ciphertext };
}

export function pushCiphertext() {
  throw new Error("La sincronización está apagada. Matripuntos no envía datos a ningún servidor.");
}
