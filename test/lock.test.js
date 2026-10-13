import assert from "node:assert/strict";
import { test } from "node:test";
import { PIN_LOCKOUTS_MS, pinGate, registerPinFailure, registerPinSuccess } from "../app/js/lock.js";

test("PIN lockout then wipe after repeated failures", () => {
  let now = 1_000;
  let pin = { failures: 0, lockoutLevel: 0, lockedUntil: 0, wrappedDek: { wrapped: "x" }, kdf: { salt: "y" } };
  for (let round = 0; round < 2; round += 1) {
    for (let attempt = 0; attempt < 4; attempt += 1) pin = registerPinFailure(pin, now);
    assert.equal(pin.remaining, 1);
    pin = registerPinFailure(pin, now);
    assert.equal(pin.reason, "lockout");
    assert.equal(pin.lockedUntil - now, PIN_LOCKOUTS_MS[round]);
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
