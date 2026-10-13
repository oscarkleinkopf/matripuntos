import { MpError } from "./errors.js";
import { MAX_AUDIO_BYTES } from "./audio.js";
import { PROFILE_AAD } from "./constants.js";
import { b64ToBytes, bytesToB64, zeroize } from "./bytes.js";
import { decryptBytes, decryptJson, encryptBytes, encryptJson } from "./crypto.js";
import { commitVault, idbAll, idbGet, putRecordsAndAudio, saveMeta } from "./idb.js";

function toRow(id, packed, extra = {}) {
  return {
    id,
    iv: b64ToBytes(packed.iv),
    ciphertext: b64ToBytes(packed.ciphertext),
    ...extra,
  };
}

function fromRow(row) {
  return { iv: bytesToB64(row.iv), ciphertext: bytesToB64(row.ciphertext) };
}

export async function encryptRecord(dek, record) {
  return toRow(record.id, await encryptJson(dek, record, record.id));
}

export async function openSpace(dek, meta) {
  const profile = await decryptJson(dek, meta.profile, PROFILE_AAD);
  const rows = await idbAll("records");
  const records = [];
  for (const row of rows) {
    const record = await decryptJson(dek, fromRow(row), row.id);
    if (!record || record.id !== row.id) throw new MpError("tamper", "Un registro no coincide con su identificador.");
    records.push(record);
  }
  records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { profile, records };
}

export async function saveEntry(dek, { records, audio }) {
  const recordRows = [];
  for (const record of records) recordRows.push(await encryptRecord(dek, record));
  let audioRow = null;
  if (audio) {
    if (audio.bytes.byteLength > MAX_AUDIO_BYTES) {
      throw new MpError("audio-big", "El audio quedó demasiado pesado.");
    }
    const packed = await encryptBytes(dek, audio.bytes, audio.id);
    audioRow = toRow(audio.id, packed, { mime: audio.mime || "audio/webm" });
  }
  await putRecordsAndAudio(recordRows, audioRow);
}

export async function loadAudio(dek, id) {
  const row = await idbGet("audio", id);
  if (!row) return null;
  const bytes = await decryptBytes(dek, fromRow(row), id);
  return { id, mime: row.mime || "audio/webm", bytes };
}

export async function loadAllAudio(dek) {
  const rows = await idbAll("audio");
  const audios = [];
  for (const row of rows) {
    const bytes = await decryptBytes(dek, fromRow(row), row.id);
    audios.push({ id: row.id, mime: row.mime || "audio/webm", bytes });
  }
  return audios;
}

export async function collectCipherRows() {
  const records = await idbAll("records");
  const audios = await idbAll("audio");
  return {
    records: records.map((row) => ({ id: row.id, ...fromRow(row) })),
    audios: audios.map((row) => ({ id: row.id, mime: row.mime || "audio/webm", ...fromRow(row) })),
  };
}

export async function verifyAndCommitImport(dek, parsed, pinState) {
  const profile = await decryptJson(dek, parsed.profile, PROFILE_AAD);
  for (const row of parsed.records) {
    const record = await decryptJson(dek, row, row.id);
    if (!record || record.id !== row.id) throw new MpError("tamper", "El respaldo no coincide.");
  }
  for (const row of parsed.audios) {
    const bytes = await decryptBytes(dek, row, row.id);
    zeroize(bytes);
  }
  const meta = {
    v: 1,
    spaceId: parsed.spaceId,
    createdAt: parsed.createdAt,
    kdf: parsed.kdf,
    wrappedDek: parsed.wrappedDek,
    verifier: parsed.verifier,
    profile: parsed.profile,
    pin: pinState,
  };
  await commitVault({
    meta,
    recordRows: parsed.records.map((row) => toRow(row.id, row)),
    audioRows: parsed.audios.map((row) => toRow(row.id, row, { mime: row.mime })),
  });
  return { meta, profile };
}

export async function rotateVault({ meta, records, audios, created, profile }) {
  const recordRows = [];
  for (const record of records) recordRows.push(await encryptRecord(created.dek, record));
  const audioRows = [];
  for (const audio of audios) {
    const packed = await encryptBytes(created.dek, audio.bytes, audio.id);
    audioRows.push(toRow(audio.id, packed, { mime: audio.mime }));
    zeroize(audio.bytes);
  }
  const profilePacked = await encryptJson(created.dek, profile, PROFILE_AAD);
  const nextMeta = {
    v: 1,
    spaceId: meta.spaceId,
    createdAt: meta.createdAt,
    kdf: created.kdf,
    wrappedDek: created.wrappedDek,
    pin: created.pin,
    verifier: created.verifier,
    profile: profilePacked,
  };
  await commitVault({ meta: nextMeta, recordRows, audioRows });
  return nextMeta;
}

export async function persistMeta(meta) {
  await saveMeta(meta);
}
