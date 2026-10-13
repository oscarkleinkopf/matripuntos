import { MpError } from "./errors.js";

export const CATEGORIES = Object.freeze([
  { id: "platos", label: "Platos" },
  { id: "puntualidad", label: "Puntualidad" },
  { id: "celular", label: "Celular" },
  { id: "casa", label: "Casa" },
  { id: "carino", label: "Cariño" },
  { id: "plata", label: "Plata" },
  { id: "otro", label: "Otra" },
]);

export const MIN_POINTS = 1;
export const MAX_POINTS = 5;
export const DAILY_COMPLAINT_CAP = 3;
export const DAILY_DEDUCTION_CAP = 10;
export const DAILY_GESTURE_COUNT_CAP = 8;
export const DAILY_GESTURE_POINTS_CAP = 15;
export const MAX_TEXT = 500;
export const DEFAULT_TIME_ZONE = "America/Santiago";

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function categoryLabel(id) {
  return CATEGORIES.find((category) => category.id === id)?.label || "Otra";
}

export function otherPartner(id) {
  return id === "a" ? "b" : "a";
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

export function timeZoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

export function startOfZonedDay(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let offset = timeZoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - offset;
  offset = timeZoneOffsetMs(new Date(utc), timeZone);
  utc = guess - offset;
  return utc;
}

export function periodBounds(now, period, timeZone = DEFAULT_TIME_ZONE) {
  const parts = zonedParts(new Date(now), timeZone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (period === "month") {
    const start = startOfZonedDay(year, month, 1, timeZone);
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    return { start, end: startOfZonedDay(next.year, next.month, 1, timeZone), period };
  }
  if (period !== "week") throw new MpError("period", "Período desconocido.");
  const index = WEEKDAYS[parts.weekday];
  if (index == null) throw new MpError("period", "No se pudo calcular la semana.");
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() - index);
  const start = startOfZonedDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), timeZone);
  cursor.setUTCDate(cursor.getUTCDate() + 7);
  const end = startOfZonedDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), timeZone);
  return { start, end, period };
}

export function localDayBounds(now, timeZone = DEFAULT_TIME_ZONE) {
  const parts = zonedParts(new Date(now), timeZone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const start = startOfZonedDay(year, month, day, timeZone);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  const end = startOfZonedDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), timeZone);
  return { start, end };
}

export function formatPeriodLabel(bounds, timeZone = DEFAULT_TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone });
  return `${fmt.format(new Date(bounds.start))} – ${fmt.format(new Date(bounds.end - 1))}`;
}

export function assertPoints(points) {
  if (!Number.isInteger(points) || points < MIN_POINTS || points > MAX_POINTS) {
    throw new MpError("points", "Los puntos tienen que ser un entero entre 1 y 5.");
  }
}

export function assertPartner(id) {
  if (id !== "a" && id !== "b") throw new MpError("partner", "Persona desconocida.");
}

export function normalizeText(value) {
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (!text) throw new MpError("empty", "Escribe algo, aunque sea corto.");
  if ([...text].length > MAX_TEXT) throw new MpError("too-long", "Máximo 500 caracteres.");
  return text;
}

function inRange(iso, start, end) {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= start && time < end;
}

export function canFileComplaint(records, { authorId, points, now, timeZone = DEFAULT_TIME_ZONE }) {
  assertPartner(authorId);
  assertPoints(points);
  const day = localDayBounds(now, timeZone);
  const todays = records.filter(
    (record) => record.kind === "complaint" && record.authorId === authorId && inRange(record.createdAt, day.start, day.end),
  );
  if (todays.length >= DAILY_COMPLAINT_CAP) {
    return {
      ok: false,
      reason: "cap_count",
      message: "Ya van 3 quejas hoy de esta persona. Dejen que se enfríe y salden las que están abiertas.",
    };
  }
  const deducted = todays.reduce((sum, record) => sum + record.points, 0);
  if (deducted + points > DAILY_DEDUCTION_CAP) {
    return {
      ok: false,
      reason: "cap_points",
      message: "Esas quejas pasarían el tope de 10 puntos en el día. Bajen la intensidad o déjenlo para mañana.",
    };
  }
  return { ok: true };
}

export function applyComplaint(records, input, now, timeZone = DEFAULT_TIME_ZONE) {
  assertPartner(input.aboutId);
  if (input.authorId === input.aboutId) throw new MpError("self", "La queja es sobre la otra persona.");
  if (!CATEGORIES.some((category) => category.id === input.category)) {
    throw new MpError("category", "Elige una categoría.");
  }
  const check = canFileComplaint(records, {
    authorId: input.authorId,
    points: input.points,
    now,
    timeZone,
  });
  if (!check.ok) throw new MpError(check.reason, check.message);
  return records.concat({
    id: input.id,
    kind: "complaint",
    createdAt: new Date(now).toISOString(),
    authorId: input.authorId,
    aboutId: input.aboutId,
    category: input.category,
    points: input.points,
    text: normalizeText(input.text),
    audioId: input.audioId || null,
    settledBy: null,
  });
}

export function canFileGesture(records, { authorId, points, now, timeZone = DEFAULT_TIME_ZONE }) {
  assertPartner(authorId);
  assertPoints(points);
  const day = localDayBounds(now, timeZone);
  const todays = records.filter(
    (record) => record.kind === "gesture" && record.authorId === authorId && inRange(record.createdAt, day.start, day.end),
  );
  const added = todays.reduce((sum, record) => sum + record.points, 0);
  if (todays.length >= DAILY_GESTURE_COUNT_CAP || added + points > DAILY_GESTURE_POINTS_CAP) {
    return {
      ok: false,
      reason: "cap_gesture",
      message: "Ya hubo hartos gestos hoy. El marcador también necesita un techo.",
    };
  }
  return { ok: true };
}

export function applyGesture(records, input, now, timeZone = DEFAULT_TIME_ZONE) {
  const check = canFileGesture(records, {
    authorId: input.authorId,
    points: input.points,
    now,
    timeZone,
  });
  if (!check.ok) throw new MpError(check.reason, check.message);
  return records.concat({
    id: input.id,
    kind: "gesture",
    createdAt: new Date(now).toISOString(),
    authorId: input.authorId,
    points: input.points,
    text: normalizeText(input.text),
    audioId: input.audioId || null,
  });
}

export function applySettlement(records, input, now) {
  assertPartner(input.authorId);
  const complaint = records.find((record) => record.id === input.complaintId && record.kind === "complaint");
  if (!complaint) throw new MpError("missing", "No está esa queja.");
  if (complaint.settledBy) throw new MpError("settled", "Esa queja ya está saldada.");
  if (input.mode !== "disculpa" && input.mode !== "gesto") throw new MpError("mode", "Elige disculpa o gesto.");
  const settlement = {
    id: input.id,
    kind: "settlement",
    createdAt: new Date(now).toISOString(),
    authorId: input.authorId,
    complaintId: complaint.id,
    mode: input.mode,
    text: normalizeText(input.text),
    audioId: input.audioId || null,
    points: complaint.points,
  };
  const next = records.map((record) => (record.id === complaint.id ? { ...record, settledBy: settlement.id } : record));
  return next.concat(settlement);
}

export function scorePeriod(records, bounds) {
  const scores = { a: 0, b: 0 };
  let pending = 0;
  for (const record of records) {
    if (!inRange(record.createdAt, bounds.start, bounds.end)) continue;
    if (record.kind === "complaint" && !record.settledBy) {
      scores[record.aboutId] -= record.points;
      pending += 1;
    } else if (record.kind === "gesture") {
      scores[record.authorId] += record.points;
    }
  }
  return { scores, pending };
}

export function scoreboard(records, now, timeZone = DEFAULT_TIME_ZONE) {
  const week = periodBounds(now, "week", timeZone);
  const month = periodBounds(now, "month", timeZone);
  return {
    week: { ...scorePeriod(records, week), ...week },
    month: { ...scorePeriod(records, month), ...month },
  };
}
