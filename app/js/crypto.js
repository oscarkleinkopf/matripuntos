import { MpError } from "./errors.js";
import { VERIFIER_AAD } from "./constants.js";
import { b64ToBytes, bytesToB64, randomBytes, randomId, zeroize } from "./bytes.js";

// PBKDF2-SHA256 via WebCrypto keeps the app free of extra libraries and of
// WebAssembly, so the page can ship a CSP without unsafe-eval. It is not
// memory-hard. A stolen copy of the database can be attacked offline faster
// than an Argon2id key. The passphrase, not the PIN, is the real secret.
export const KDF = Object.freeze({
  name: "PBKDF2",
  hash: "SHA-256",
  iterations: 600_000,
  saltBytes: 16,
});

export const AES = Object.freeze({
  name: "AES-GCM",
  length: 256,
  ivBytes: 12,
});

export const MIN_PASSPHRASE = 12;

export function normalizeSecret(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function assertPassphrase(value) {
  const secret = normalizeSecret(value);
  if (secret.length < MIN_PASSPHRASE) {
    throw new MpError("passphrase-short", "La frase secreta necesita al menos 12 caracteres.");
  }
  if (secret.length > 256) {
    throw new MpError("passphrase-long", "La frase secreta es demasiado larga.");
  }
  if (/^(.)\1+$/u.test(secret)) {
    throw new MpError("passphrase-weak", "Usa una frase de verdad, no un carácter repetido.");
  }
  return secret;
}

export function assertPin(value) {
  const pin = String(value ?? "").trim();
  if (!/^\d{6}$/.test(pin)) throw new MpError("pin", "El PIN son 6 dígitos.");
  return pin;
}

export function assertKdfIterations(iterations, { allowWeak = false } = {}) {
  if (!Number.isInteger(iterations)) throw new MpError("kdf", "Parámetros de cifrado inválidos.");
  if (!allowWeak && iterations < KDF.iterations) {
    throw new MpError("kdf", "La invitación o el respaldo usa un cifrado más débil que el mínimo de Matripuntos.");
  }
  if (iterations > 2_000_000) throw new MpError("kdf", "Esos parámetros de cifrado no se aceptan.");
  return iterations;
}

export async function deriveKek(secret, salt, iterations = KDF.iterations, { allowWeak = false } = {}) {
  assertKdfIterations(iterations, { allowWeak });
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: AES.length },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export function generateDek() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES.length },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function wrapDek(dek, kek) {
  const iv = randomBytes(AES.ivBytes);
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey("raw", dek, kek, { name: "AES-GCM", iv }),
  );
  return { iv: bytesToB64(iv), wrapped: bytesToB64(wrapped) };
}

export async function unwrapDek(packed, kek, { extractable = false } = {}) {
  const iv = b64ToBytes(packed.iv);
  const wrapped = b64ToBytes(packed.wrapped);
  if (iv.length !== AES.ivBytes) throw new MpError("iv", "Nonce inválido.");
  try {
    return await crypto.subtle.unwrapKey(
      "raw",
      wrapped,
      kek,
      { name: "AES-GCM", iv },
      { name: "AES-GCM", length: AES.length },
      extractable,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new MpError("decrypt", "No se pudo abrir el espacio. Revisa la frase o el PIN.");
  }
}

function aadBytes(aad) {
  if (aad == null) return null;
  return typeof aad === "string" ? new TextEncoder().encode(aad) : aad;
}

export async function encryptBytes(key, data, aad) {
  const iv = randomBytes(AES.ivBytes);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const params = { name: "AES-GCM", iv };
  const extra = aadBytes(aad);
  if (extra) params.additionalData = extra;
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(params, key, bytes));
  return { iv: bytesToB64(iv), ciphertext: bytesToB64(ciphertext) };
}

export async function decryptBytes(key, packed, aad) {
  const iv = b64ToBytes(packed.iv);
  const ciphertext = b64ToBytes(packed.ciphertext);
  if (iv.length !== AES.ivBytes) throw new MpError("iv", "Nonce inválido.");
  const params = { name: "AES-GCM", iv };
  const extra = aadBytes(aad);
  if (extra) params.additionalData = extra;
  try {
    return new Uint8Array(await crypto.subtle.decrypt(params, key, ciphertext));
  } catch {
    throw new MpError("decrypt", "No se pudo descifrar. La llave no coincide o el dato fue alterado.");
  }
}

export async function encryptJson(key, value, aad) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  try {
    return await encryptBytes(key, bytes, aad);
  } finally {
    zeroize(bytes);
  }
}

export async function decryptJson(key, packed, aad) {
  const bytes = await decryptBytes(key, packed, aad);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    zeroize(bytes);
  }
}

export async function createVaultSecrets(passphrase, pin, options = {}) {
  const secret = assertPassphrase(passphrase);
  const pinCode = assertPin(pin);
  const iterations = options.iterations ?? KDF.iterations;
  const allowWeak = options.allowWeak === true;
  const salt = randomBytes(KDF.saltBytes);
  const pinSalt = randomBytes(KDF.saltBytes);
  const kek = await deriveKek(secret, salt, iterations, { allowWeak });
  const pinKek = await deriveKek(pinCode, pinSalt, iterations, { allowWeak });
  const fresh = await generateDek();
  const wrappedDek = await wrapDek(fresh, kek);
  const pinWrapped = await wrapDek(fresh, pinKek);
  const dek = await unwrapDek(wrappedDek, kek, { extractable: false });
  const verifier = await encryptJson(dek, { ok: true, v: 1 }, VERIFIER_AAD);
  return {
    dek,
    spaceId: randomId(),
    kdf: {
      name: KDF.name,
      hash: KDF.hash,
      iterations,
      salt: bytesToB64(salt),
    },
    wrappedDek,
    pin: {
      kdf: {
        name: KDF.name,
        hash: KDF.hash,
        iterations,
        salt: bytesToB64(pinSalt),
      },
      wrappedDek: pinWrapped,
      failures: 0,
      lockoutLevel: 0,
      lockedUntil: 0,
    },
    verifier,
  };
}

export async function wrapDekWithPin(dek, pin, options = {}) {
  const pinCode = assertPin(pin);
  const iterations = options.iterations ?? KDF.iterations;
  const allowWeak = options.allowWeak === true;
  const pinSalt = randomBytes(KDF.saltBytes);
  const pinKek = await deriveKek(pinCode, pinSalt, iterations, { allowWeak });
  return {
    kdf: {
      name: KDF.name,
      hash: KDF.hash,
      iterations,
      salt: bytesToB64(pinSalt),
    },
    wrappedDek: await wrapDek(dek, pinKek),
    failures: 0,
    lockoutLevel: 0,
    lockedUntil: 0,
  };
}

async function openWithKekMaterial(material, secret, kdf, wrapped, options) {
  const kek = await deriveKek(secret, b64ToBytes(kdf.salt), kdf.iterations, options);
  const dek = await unwrapDek(wrapped, kek, { extractable: false });
  const verifier = await decryptJson(dek, material.verifier, VERIFIER_AAD);
  if (!verifier || verifier.ok !== true) {
    throw new MpError("decrypt", "El espacio no pasó la verificación.");
  }
  return dek;
}

export async function unlockWithPassphrase(material, passphrase, options = {}) {
  const secret = assertPassphrase(passphrase);
  assertKdfIterations(material?.kdf?.iterations, options);
  return openWithKekMaterial(material, secret, material.kdf, material.wrappedDek, options);
}

export async function unlockWithPin(material, pin, options = {}) {
  const pinCode = assertPin(pin);
  if (!material?.pin?.wrappedDek || !material?.pin?.kdf) {
    throw new MpError("pin-absent", "Este teléfono no tiene PIN. Entra con la frase secreta.");
  }
  assertKdfIterations(material.pin.kdf.iterations, options);
  try {
    return await openWithKekMaterial(material, pinCode, material.pin.kdf, material.pin.wrappedDek, options);
  } catch (error) {
    if (error instanceof MpError && error.code === "decrypt") {
      throw new MpError("pin-mismatch", "PIN incorrecto.");
    }
    throw error;
  }
}

export function buildMeta({ secrets, profile, createdAt }) {
  return {
    v: 1,
    spaceId: secrets.spaceId,
    createdAt,
    kdf: secrets.kdf,
    wrappedDek: secrets.wrappedDek,
    pin: secrets.pin,
    verifier: secrets.verifier,
    profile,
  };
}
