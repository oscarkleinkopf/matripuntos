export const PIN_LENGTH = 6;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_BACKOFF_BASE_MS = 30_000;
export const PIN_BACKOFF_CAP_MS = 24 * 60 * 60 * 1000;
export const PIN_WIPE_AFTER_LEVEL = 3;

export function pinBackoffMs(level) {
  const exponent = Math.max(0, Math.min(level, 16));
  const wait = PIN_BACKOFF_BASE_MS * (2 ** exponent);
  return Math.min(wait, PIN_BACKOFF_CAP_MS);
}

export function pinGate(pin, now) {
  if (!pin?.wrappedDek) return { allow: false, reason: "absent" };
  if (pin.lockedUntil && now < pin.lockedUntil) {
    return { allow: false, reason: "locked", lockedUntil: pin.lockedUntil, waitMs: pin.lockedUntil - now };
  }
  return { allow: true, failures: pin.failures || 0, remaining: PIN_MAX_ATTEMPTS - (pin.failures || 0) };
}

export function registerPinFailure(pin, now) {
  const failures = (pin.failures || 0) + 1;
  if (failures < PIN_MAX_ATTEMPTS) {
    return {
      ...pin,
      failures,
      lockedUntil: 0,
      wiped: false,
      reason: "mismatch",
      remaining: PIN_MAX_ATTEMPTS - failures,
    };
  }
  const level = pin.lockoutLevel || 0;
  const nextLevel = level + 1;
  if (nextLevel >= PIN_WIPE_AFTER_LEVEL) {
    return {
      failures: 0,
      lockoutLevel: 0,
      lockedUntil: 0,
      wrappedDek: null,
      kdf: null,
      wiped: true,
      reason: "wiped",
      remaining: 0,
    };
  }
  const wait = pinBackoffMs(level);
  return {
    ...pin,
    failures: 0,
    lockoutLevel: nextLevel,
    lockedUntil: now + wait,
    wiped: false,
    reason: "lockout",
    remaining: 0,
    waitMs: wait,
  };
}

export function registerPinSuccess(pin) {
  return {
    ...pin,
    failures: 0,
    lockoutLevel: 0,
    lockedUntil: 0,
  };
}
