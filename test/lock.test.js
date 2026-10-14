import assert from "node:assert/strict";
import { test } from "node:test";
import { PIN_BACKOFF_BASE_MS, pinBackoffMs, pinGate, registerPinFailure, registerPinSuccess } from "../app/js/lock.js";

test("PIN lockout then wipe after repeated failures", () => {
  let now = 1_000;
  let pin = { failures: 0, lockoutLevel: 0, lockedUntil: 0, wrappedDek: { wrapped: "x" }, kdf: { salt: "y" } };
  for (let round = 0; round < 2; round += 1) {
    for (let attempt = 0; attempt < 4; attempt += 1) pin = registerPinFailure(pin, now);
    assert.equal(pin.remaining, 1);
    pin = registerPinFailure(pin, now);
    assert.equal(pin.reason, "lockout");
    assert.equal(pin.lockedUntil - now, pinBackoffMs(round));
    assert.equal(pinGate(pin, now + 1).allow, false);
    now = pin.lockedUntil;
    assert.equal(pinGate(pin, now).allow, true);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) pin = registerPinFailure(pin, now);
  pin = registerPinFailure(pin, now);
  assert.equal(pin.wiped, true);
  assert.equal(pin.wrappedDek, null);
  assert.equal(pinGate(pin, now).reason, "absent");
});

test("backoff doubles and the saved pin keeps the wait", () => {
  assert.equal(pinBackoffMs(0), PIN_BACKOFF_BASE_MS);
  assert.equal(pinBackoffMs(1), PIN_BACKOFF_BASE_MS * 2);
  assert.equal(pinBackoffMs(3), PIN_BACKOFF_BASE_MS * 8);
  assert.ok(pinBackoffMs(40) <= 24 * 60 * 60 * 1000);
  const now = 5_000;
  const pin = registerPinFailure({
    failures: 4,
    lockoutLevel: 0,
    lockedUntil: 0,
    wrappedDek: { wrapped: "x" },
    kdf: { salt: "y" },
  }, now);
  const saved = { ...pin };
  assert.equal(pinGate(saved, now + 1).allow, false);
  assert.equal(saved.lockedUntil - now, PIN_BACKOFF_BASE_MS);
  assert.equal(pinGate(saved, saved.lockedUntil).allow, true);
});

test("a correct PIN clears the failure counters", () => {
  const pin = registerPinSuccess({
    failures: 4,
    lockoutLevel: 2,
    lockedUntil: 99,
    wrappedDek: "keep",
    kdf: { salt: "s" },
  });
  assert.equal(pin.failures, 0);
  assert.equal(pin.lockoutLevel, 0);
  assert.equal(pin.lockedUntil, 0);
  assert.equal(pin.wrappedDek, "keep");
});
