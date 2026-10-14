import assert from "node:assert/strict";
import { test } from "node:test";
import { b64ToBytes, bytesToB64 } from "../app/js/bytes.js";
import {
  AES,
  KDF,
  createVaultSecrets,
  decryptJson,
  encryptBytes,
  encryptJson,
  generateDek,
  unlockForRewrap,
  unlockWithPassphrase,
  unlockWithPin,
  wrapDekWithPin,
} from "../app/js/crypto.js";

const weak = { iterations: 1_000, allowWeak: true };

test("AES-GCM round trip", async () => {
  const key = await generateDek();
  const payload = { text: "texto" };
  const packed = await encryptJson(key, payload, "registro-1");
  assert.deepEqual(await decryptJson(key, packed, "registro-1"), payload);
  assert.equal(b64ToBytes(packed.iv).length, AES.ivBytes);
});

test("wrong key and tampered ciphertext fail", async () => {
  const key = await generateDek();
  const other = await generateDek();
  const packed = await encryptJson(key, { secret: "secreto" }, "registro-2");
  await assert.rejects(() => decryptJson(other, packed, "registro-2"));
  await assert.rejects(() => decryptJson(key, packed, "otro-aad"));
  const bytes = b64ToBytes(packed.ciphertext);
  bytes[0] ^= 0xff;
  await assert.rejects(() => decryptJson(key, { ...packed, ciphertext: bytesToB64(bytes) }, "registro-2"));
});

test("nonces are unique", async () => {
  const key = await generateDek();
  const ivs = new Set();
  const ciphers = new Set();
  for (let index = 0; index < 100; index += 1) {
    const packed = await encryptBytes(key, new TextEncoder().encode("mismo texto"), "audio");
    ivs.add(packed.iv);
    ciphers.add(packed.ciphertext);
    assert.equal(b64ToBytes(packed.iv).length, 12);
  }
  assert.equal(ivs.size, 100);
  assert.equal(ciphers.size, 100);
});

test("passphrase unwraps and a wrong passphrase does not", async () => {
  const secrets = await createVaultSecrets("frase-prueba-01", "123456", weak);
  const dek = await unlockWithPassphrase(secrets, "frase-prueba-01", { allowWeak: true });
  const packed = await encryptJson(dek, { ok: true }, "caja");
  assert.deepEqual(await decryptJson(dek, packed, "caja"), { ok: true });
  await assert.rejects(() => unlockWithPassphrase(secrets, "frase-prueba-02", { allowWeak: true }));
  await assert.rejects(() => unlockWithPin(secrets, "000000", { allowWeak: true }));
  const pinKey = await unlockWithPin(secrets, "123456", { allowWeak: true });
  assert.deepEqual(await decryptJson(pinKey, packed, "caja"), { ok: true });
});

test("a rewrap copy can receive a new PIN", async () => {
  const secrets = await createVaultSecrets("frase-prueba-01", "123456", weak);
  const opened = await unlockForRewrap(secrets, "frase-prueba-01", { allowWeak: true });
  const pin = await wrapDekWithPin(opened.extractable, "654321", weak);
  const material = { ...secrets, pin };
  const dek = await unlockWithPin(material, "654321", { allowWeak: true });
  const packed = await encryptJson(dek, { ok: 1 }, "caja");
  assert.deepEqual(await decryptJson(opened.dek, packed, "caja"), { ok: 1 });
});

test("production KDF stays at the high iteration floor", async () => {
  assert.ok(KDF.iterations >= 600_000);
  assert.equal(KDF.hash, "SHA-256");
  const secrets = await createVaultSecrets("frase-prueba-03", "654321");
  await unlockWithPassphrase(secrets, "frase-prueba-03");
  await assert.rejects(() => unlockWithPassphrase(secrets, "frase-prueba-04"));
});
