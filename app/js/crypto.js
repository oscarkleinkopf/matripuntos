import { MpError } from "./errors.js";
import { VERIFIER_AAD } from "./constants.js";
import { b64ToBytes, bytesToB64, randomBytes, randomId, zeroize } from "./bytes.js";
import { hashArgon2id } from "./argon2.js";

// Versioned key-wrapping header:
//   v:1  PBKDF2-SHA256. The password bytes are the raw NFKC secret. Existing
//        spaces stay on this header and keep opening.
//   v:2  Argon2id (version 0x13). The password bytes are
//        UTF-8("mp-phrase\\0" + secret) or UTF-8("mp-pin\\0" + pin).
// New spaces use v:2. A copied database can still be attacked offline; Argon2id
// makes that attack cost memory. Parameters are chosen for a phone: 19 MiB,
// 2 passes, 1 lane. The vendored module also reserves about 65 MiB of WASM
// memory because that is the initial size of the binary we ship.
export const KDF = Object.freeze({
  name: "PBKDF2",
  hash: "SHA-256",
  iterations: 600_000,
  saltBytes: 16,
});

export const ARGON2 = Object.freeze({
  name: "Argon2id",
  version: 0x13,
  memoryKiB: 19 * 1024,
  iterations: 2,
  parallelism: 1,
  hashLen: 32,
  saltBytes: 16,
});

export const AES = Object.freeze({
  name: "AES-GCM",
  length: 256,
  ivBytes: 12,
});

export const MIN_PASSPHRASE = 12;

const COMMON_PASSPHRASES = new Set([
  "password",
  "password1",
  "password123",
  "password1234",
  "123456789012",
  "1234567890123",
  "qwertyuiop",
  "qwertyuiopas",
  "contrasena",
  "contrasena123",
  "clave123456",
  "matripuntos",
  "iloveyou123",
  "letmein1234",
  "welcome1234",
  "admin123456",
  "frase secreta",
  "cambiame1234",
]);

const SEQUENCES = Object.freeze([
  "0123", "1234", "2345", "3456", "4567", "5678", "6789",
  "abcd", "qwerty", "asdf", "zxcv",
]);

export function normalizeSecret(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function foldSecret(secret) {
  return secret.toLocaleLowerCase("es").normalize("NFD").replace(/\p{M}/gu, "");
}

export function ratePassphrase(value) {
  const secret = normalizeSecret(value);
  const reasons = [];
  if (secret.length < MIN_PASSPHRASE) reasons.push("corta");
  if (secret.length > 256) reasons.push("larga");
  if (secret.length > 0 && /^(.)\1+$/u.test(secret)) reasons.push("repetida");
  const folded = foldSecret(secret);
  if (COMMON_PASSPHRASES.has(folded) || COMMON_PASSPHRASES.has(secret.toLocaleLowerCase("es"))) {
    reasons.push("comun");
  }
  if (SEQUENCES.some((item) => folded.includes(item))) reasons.push("secuencia");

  let score = 0;
  if (secret.length >= 12) score += 1;
  if (secret.length >= 20) score += 1;
  if (secret.length >= 28) score += 1;
  const words = secret.split(/\s+/).filter((word) => [...word].length >= 3);
  if (words.length >= 4) score += 2;
  else if (/[\s.-]/u.test(secret)) score += 1;
  const classes = [/\p{L}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((pattern) => pattern.test(secret)).length;
  if (classes >= 2) score += 1;
  if (reasons.length) score = Math.min(score, 1);

  const level = score >= 4 ? "fuerte" : score >= 3 ? "justa" : "debil";
  const labels = { fuerte: "Fuerte", justa: "Justa", debil: "Débil" };
  return {
    score,
    level,
    label: labels[level],
    accept: reasons.length === 0 && secret.length >= MIN_PASSPHRASE && secret.length <= 256 && score >= 3,
    reasons,
  };
}

export function assertPassphrase(value) {
  const secret = normalizeSecret(value);
  const rated = ratePassphrase(secret);
  if (secret.length < MIN_PASSPHRASE) {
    throw new MpError("passphrase-short", "La frase secreta necesita al menos 12 caracteres.");
  }
  if (secret.length > 256) {
    throw new MpError("passphrase-long", "La frase secreta es demasiado larga.");
  }
  if (!rated.accept) {
    throw new MpError("passphrase-weak", "La frase es débil. Usa varias palabras o la sugerida.");
  }
  return secret;
}

export function assertPin(value) {
  const pin = String(value ?? "").trim();
  if (!/^\d{6}$/.test(pin)) throw new MpError("pin", "El PIN son 6 dígitos.");
  return pin;
}

function assertInteger(value, code = "kdf") {
  if (!Number.isInteger(value)) throw new MpError(code, "Parámetros de cifrado inválidos.");
  return value;
}

export function assertKdfIterations(iterations, { allowWeak = false } = {}) {
  assertInteger(iterations);
  if (!allowWeak && iterations < KDF.iterations) {
    throw new MpError("kdf", "La invitación o el respaldo usa un cifrado más débil que el mínimo de Matripuntos.");
  }
  if (allowWeak && iterations < 1) throw new MpError("kdf", "Parámetros de cifrado inválidos.");
  if (iterations > 2_000_000) throw new MpError("kdf", "Esos parámetros de cifrado no se aceptan.");
  return iterations;
}

function normalizePbkdf2(kdf, options) {
  return {
    v: 1,
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: assertKdfIterations(kdf.iterations, options),
    salt: expectSalt(kdf.salt),
  };
}

function normalizeArgon2(kdf, options) {
  const allowWeak = options.allowWeak === true;
  const memory = assertInteger(kdf.memory);
  const iterations = assertInteger(kdf.iterations);
  const parallelism = assertInteger(kdf.parallelism);
  const version = kdf.version == null ? ARGON2.version : assertInteger(kdf.version);
  if (version !== ARGON2.version) throw new MpError("kdf", "Esa versión de Argon2id no está soportada.");
  if (parallelism !== 1) throw new MpError("kdf", "Esos parámetros de cifrado no se aceptan.");
  const minMemory = allowWeak ? 8 : ARGON2.memoryKiB;
  const minIterations = allowWeak ? 1 : ARGON2.iterations;
  if (memory < minMemory || iterations < minIterations) {
    throw new MpError("kdf", "La invitación o el respaldo usa un cifrado más débil que el mínimo de Matripuntos.");
  }
  if (memory > 65_536 || iterations > 8) throw new MpError("kdf", "Esos parámetros de cifrado no se aceptan.");
  return {
    v: 2,
    name: "Argon2id",
    version,
    memory,
    iterations,
    parallelism,
    salt: expectSalt(kdf.salt),
  };
}

function expectSalt(salt) {
  if (typeof salt !== "string" || !salt) throw new MpError("kdf", "Parámetros de cifrado inválidos.");
  return salt;
}

export function normalizeKdf(kdf, options = {}) {
  if (!kdf || typeof kdf !== "object") throw new MpError("kdf", "Parámetros de cifrado inválidos.");
  const name = kdf.name || (kdf.v === 2 ? "Argon2id" : "PBKDF2");
  if (name === "Argon2id") return normalizeArgon2(kdf, options);
  if (name === "PBKDF2") {
    if (kdf.hash && kdf.hash !== "SHA-256") throw new MpError("kdf", "Ese cifrado no está soportado.");
    return normalizePbkdf2(kdf, options);
  }
  throw new MpError("kdf", "Ese cifrado no está soportado.");
}

export function needsKdfMigration(material) {
  const name = material?.kdf?.name;
  return !name || name === "PBKDF2";
}

function selectParams(options = {}) {
  if (String(options.kdf || "").toLowerCase() === "pbkdf2") {
    return {
      v: 1,
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: options.iterations ?? (options.allowWeak ? 1_000 : KDF.iterations),
    };
  }
  const weak = options.allowWeak === true;
  return {
    v: 2,
    name: "Argon2id",
    version: ARGON2.version,
    memory: options.memory ?? (weak ? 32 : ARGON2.memoryKiB),
    iterations: weak ? 1 : (options.iterations ?? ARGON2.iterations),
    parallelism: 1,
  };
}

async function derivePbkdf2(secret, salt, iterations) {
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

function secretBytes(secret, purpose) {
  const prefix = purpose === "pin" ? "mp-pin\0" : "mp-phrase\0";
  return new TextEncoder().encode(prefix + secret);
}

async function deriveArgon2(secret, params, purpose) {
  const password = secretBytes(secret, purpose);
  const salt = b64ToBytes(params.salt);
  if (salt.length < 8) throw new MpError("kdf", "Parámetros de cifrado inválidos.");
  try {
    const tag = await hashArgon2id({
      password,
      salt,
      parallelism: params.parallelism,
      passes: params.iterations,
      memorySize: params.memory,
      tagLength: ARGON2.hashLen,
    });
    try {
      return await crypto.subtle.importKey(
        "raw",
        tag,
        { name: "AES-GCM", length: AES.length },
        false,
        ["wrapKey", "unwrapKey"],
      );
    } finally {
      zeroize(tag);
    }
  } finally {
    zeroize(password);
  }
}

async function deriveFromKdf(secret, kdf, options = {}) {
  const params = normalizeKdf(kdf, options);
  if (params.name === "PBKDF2") {
    const salt = b64ToBytes(params.salt);
    if (salt.length < 16) throw new MpError("kdf", "Parámetros de cifrado inválidos.");
    return derivePbkdf2(secret, salt, params.iterations);
  }
  return deriveArgon2(secret, params, options.purpose === "pin" ? "pin" : "phrase");
}

function freshKdf(options) {
  const salt = bytesToB64(randomBytes(KDF.saltBytes));
  return normalizeKdf({ ...selectParams(options), salt }, options);
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

async function wrapSecret(dek, secret, options) {
  const kdf = freshKdf(options);
  const kek = await deriveFromKdf(secret, kdf, options);
  return { kdf, wrappedDek: await wrapDek(dek, kek) };
}

function argonOptions(options = {}) {
  return {
    allowWeak: options.allowWeak === true,
    memory: options.memory,
    purpose: options.purpose,
    kdf: "argon2id",
  };
}

export async function createVaultSecrets(passphrase, pin, options = {}) {
  const secret = assertPassphrase(passphrase);
  const pinCode = assertPin(pin);
  const fresh = await generateDek();
  const phraseWrap = await wrapSecret(fresh, secret, { ...options, purpose: "phrase" });
  const pinState = await wrapDekWithPin(fresh, pinCode, options);
  const kek = await deriveFromKdf(secret, phraseWrap.kdf, { ...options, purpose: "phrase" });
  const dek = await unwrapDek(phraseWrap.wrappedDek, kek, { extractable: false });
  const verifier = await encryptJson(dek, { ok: true, v: 1 }, VERIFIER_AAD);
  return {
    dek,
    spaceId: randomId(),
    epoch: 0,
    kdf: phraseWrap.kdf,
    wrappedDek: phraseWrap.wrappedDek,
    pin: pinState,
    verifier,
  };
}

export async function wrapDekWithPin(dek, pin, options = {}) {
  const pinCode = assertPin(pin);
  const wrapped = await wrapSecret(dek, pinCode, { ...options, purpose: "pin" });
  return {
    kdf: wrapped.kdf,
    wrappedDek: wrapped.wrappedDek,
    failures: 0,
    lockoutLevel: 0,
    lockedUntil: 0,
  };
}

async function openWithKekMaterial(material, secret, kdf, wrapped, options) {
  const kek = await deriveFromKdf(secret, kdf, options);
  const dek = await unwrapDek(wrapped, kek, { extractable: false });
  const verifier = await decryptJson(dek, material.verifier, VERIFIER_AAD);
  if (!verifier || verifier.ok !== true) {
    throw new MpError("decrypt", "El espacio no pasó la verificación.");
  }
  return dek;
}

export async function unlockWithPassphrase(material, passphrase, options = {}) {
  const secret = assertPassphrase(passphrase);
  normalizeKdf(material?.kdf, options);
  return openWithKekMaterial(material, secret, material.kdf, material.wrappedDek, { ...options, purpose: "phrase" });
}

// Chrome refuses wrapKey on a non-extractable key. Callers that must wrap the
// data key again (a new PIN, a migration, a new passphrase) get a temporary
// extractable copy and should drop that reference immediately after wrapping.
// The session key stays non-extractable.
export async function unlockForRewrap(material, passphrase, options = {}) {
  const secret = assertPassphrase(passphrase);
  normalizeKdf(material?.kdf, options);
  const kek = await deriveFromKdf(secret, material.kdf, { ...options, purpose: "phrase" });
  const extractable = await unwrapDek(material.wrappedDek, kek, { extractable: true });
  const dek = await unwrapDek(material.wrappedDek, kek, { extractable: false });
  const verifier = await decryptJson(dek, material.verifier, VERIFIER_AAD);
  if (!verifier || verifier.ok !== true) {
    throw new MpError("decrypt", "El espacio no pasó la verificación.");
  }
  return { dek, extractable };
}

export async function unlockWithPin(material, pin, options = {}) {
  const pinCode = assertPin(pin);
  if (!material?.pin?.wrappedDek || !material?.pin?.kdf) {
    throw new MpError("pin-absent", "Este teléfono no tiene PIN. Entra con la frase secreta.");
  }
  normalizeKdf(material.pin.kdf, options);
  try {
    return await openWithKekMaterial(
      material,
      pinCode,
      material.pin.kdf,
      material.pin.wrappedDek,
      { ...options, purpose: "pin" },
    );
  } catch (error) {
    if (error instanceof MpError && error.code === "decrypt") {
      throw new MpError("pin-mismatch", "PIN incorrecto.");
    }
    throw error;
  }
}

export async function rewrapWithPassphrase(material, currentPassphrase, nextPassphrase, pin, options = {}) {
  const current = assertPassphrase(currentPassphrase);
  const next = assertPassphrase(nextPassphrase);
  if (current === next) throw new MpError("passphrase-same", "La frase nueva tiene que ser distinta.");
  const opened = await unlockForRewrap(material, current, options);
  const phraseWrap = await wrapSecret(opened.extractable, next, argonOptions({ ...options, purpose: "phrase" }));
  const pinState = await wrapDekWithPin(opened.extractable, pin, argonOptions({ ...options, purpose: "pin" }));
  return {
    dek: opened.dek,
    kdf: phraseWrap.kdf,
    wrappedDek: phraseWrap.wrappedDek,
    pin: pinState,
    epoch: (Number.isInteger(material.epoch) ? material.epoch : 0) + 1,
    verifier: material.verifier,
  };
}

export async function migrateKdf(material, passphrase, pin, options = {}) {
  if (!needsKdfMigration(material)) throw new MpError("kdf", "Este espacio ya usa Argon2id.");
  const opened = await unlockForRewrap(material, passphrase, options);
  const phraseWrap = await wrapSecret(opened.extractable, assertPassphrase(passphrase), argonOptions({ ...options, purpose: "phrase" }));
  const pinState = await wrapDekWithPin(opened.extractable, pin, argonOptions({ ...options, purpose: "pin" }));
  return {
    dek: opened.dek,
    kdf: phraseWrap.kdf,
    wrappedDek: phraseWrap.wrappedDek,
    pin: pinState,
    epoch: Number.isInteger(material.epoch) ? material.epoch : 0,
    verifier: material.verifier,
  };
}

export function buildMeta({ secrets, profile, createdAt }) {
  return {
    v: 1,
    spaceId: secrets.spaceId,
    createdAt,
    epoch: Number.isInteger(secrets.epoch) ? secrets.epoch : 0,
    kdf: secrets.kdf,
    wrappedDek: secrets.wrappedDek,
    pin: secrets.pin,
    verifier: secrets.verifier,
    profile,
  };
}
