import { MpError } from "./errors.js";
import { MAX_AUDIOS, MAX_RECORDS } from "./constants.js";
import { assertKdfIterations } from "./crypto.js";

export const ENCRYPTED_FORMAT = "matripuntos-backup";
export const PLAIN_FORMAT = "matripuntos-plain";
export const PLAIN_WARNING =
  "Este archivo NO está cifrado. Quien lo abra puede leer las quejas, los gestos y los audios. No lo subas a internet ni lo mandes por chat.";

function copyPacked(row, label) {
  if (!row || typeof row.id !== "string" || typeof row.iv !== "string" || typeof row.ciphertext !== "string") {
    throw new MpError("backup", `Falta un ${label} cifrado.`);
  }
  if ("text" in row || "points" in row || "passphrase" in row || "pin" in row) {
    throw new MpError("backup", "El respaldo cifrado recibió datos en claro.");
  }
  return { id: row.id, iv: row.iv, ciphertext: row.ciphertext };
}

export function buildEncryptedExport({ meta, records, audios, exportedAt }) {
  return {
    format: ENCRYPTED_FORMAT,
    v: 1,
    encrypted: true,
    exportedAt,
    spaceId: meta.spaceId,
    createdAt: meta.createdAt,
    kdf: {
      name: meta.kdf.name,
      hash: meta.kdf.hash,
      iterations: meta.kdf.iterations,
      salt: meta.kdf.salt,
    },
    wrappedDek: { iv: meta.wrappedDek.iv, wrapped: meta.wrappedDek.wrapped },
    verifier: { iv: meta.verifier.iv, ciphertext: meta.verifier.ciphertext },
    profile: { iv: meta.profile.iv, ciphertext: meta.profile.ciphertext },
    records: records.map((row) => copyPacked(row, "registro")),
    audios: audios.map((row) => {
      const packed = copyPacked(row, "audio");
      if (typeof row.mime !== "string") throw new MpError("backup", "Falta el tipo del audio.");
      return { ...packed, mime: row.mime };
    }),
  };
}

export function buildPlainExport({ profile, records, audios, exportedAt }) {
  return {
    format: PLAIN_FORMAT,
    v: 1,
    encrypted: false,
    warning: PLAIN_WARNING,
    exportedAt,
    profile,
    records,
    audios,
  };
}

export function parseEncryptedExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MpError("backup", "Ese archivo no se pudo leer.");
  }
  if (data?.format === PLAIN_FORMAT) {
    throw new MpError("backup-plain", "Ese archivo está en claro. Solo se restaura el respaldo cifrado.");
  }
  if (data?.format !== ENCRYPTED_FORMAT || data.v !== 1 || data.encrypted !== true) {
    throw new MpError("backup", "No reconozco ese respaldo.");
  }
  const records = Array.isArray(data.records) ? data.records : null;
  const audios = Array.isArray(data.audios) ? data.audios : null;
  if (!records || !audios) throw new MpError("backup", "El respaldo está incompleto.");
  if (records.length > MAX_RECORDS || audios.length > MAX_AUDIOS) {
    throw new MpError("backup", "Ese respaldo es demasiado grande para este teléfono.");
  }
  return {
    format: ENCRYPTED_FORMAT,
    v: 1,
    encrypted: true,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date(0).toISOString(),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: assertKdfIterations(data.kdf?.iterations),
      salt: String(data.kdf?.salt ?? ""),
    },
    wrappedDek: { iv: String(data.wrappedDek?.iv ?? ""), wrapped: String(data.wrappedDek?.wrapped ?? "") },
    verifier: { iv: String(data.verifier?.iv ?? ""), ciphertext: String(data.verifier?.ciphertext ?? "") },
    profile: { iv: String(data.profile?.iv ?? ""), ciphertext: String(data.profile?.ciphertext ?? "") },
    records: records.map((row) => copyPacked(row, "registro")),
    audios: audios.map((row) => ({ ...copyPacked(row, "audio"), mime: String(row.mime ?? "audio/webm") })),
  };
}
