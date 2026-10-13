import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyComplaint,
  applyGesture,
  applySettlement,
  periodBounds,
  scoreboard,
  zonedParts,
} from "../app/js/scoring.js";

const TZ = "America/Santiago";
const NOW = Date.parse("2026-10-13T15:00:00Z");

function complaint(partial) {
  return {
    id: partial.id,
    kind: "complaint",
    createdAt: partial.createdAt,
    authorId: partial.authorId,
    aboutId: partial.aboutId,
    category: "platos",
    points: partial.points,
    text: partial.text || "texto",
    audioId: null,
    settledBy: partial.settledBy || null,
  };
}

test("week starts Monday in Santiago and the score resets", () => {
  const week = periodBounds(NOW, "week", TZ);
  const parts = zonedParts(new Date(week.start), TZ);
  assert.equal(parts.weekday, "Mon");
  assert.equal(parts.day, "12");
  assert.equal(parts.month, "10");
  assert.equal(parts.hour, "00");
  assert.equal(parts.minute, "00");

  const records = [
    complaint({
      id: "old",
      createdAt: new Date(week.start - 60_000).toISOString(),
      authorId: "a",
      aboutId: "b",
      points: 5,
    }),
    complaint({
      id: "now",
      createdAt: new Date(week.start + 60_000).toISOString(),
      authorId: "a",
      aboutId: "b",
      points: 2,
    }),
  ];
  const board = scoreboard(records, NOW, TZ);
  assert.equal(board.week.scores.b, -2);
  assert.equal(board.week.scores.a, 0);
  assert.equal(board.week.pending, 1);
});

test("month score ignores the previous month", () => {
  const month = periodBounds(NOW, "month", TZ);
  const records = [
    complaint({
      id: "sept",
      createdAt: new Date(month.start - 60_000).toISOString(),
      authorId: "b",
      aboutId: "a",
      points: 4,
    }),
  ];
  const board = scoreboard(records, NOW, TZ);
  assert.equal(board.month.scores.a, 0);
  assert.equal(board.month.pending, 0);
});

test("settling zeroes the complaint and does not add points on top", () => {
  const week = periodBounds(NOW, "week", TZ);
  const open = [
    complaint({
      id: "c1",
      createdAt: new Date(week.start + 3_600_000).toISOString(),
      authorId: "a",
      aboutId: "b",
      points: 4,
    }),
  ];
  assert.equal(scoreboard(open, NOW, TZ).week.scores.b, -4);
  const settled = applySettlement(open, {
    id: "s1",
    authorId: "b",
    complaintId: "c1",
    mode: "disculpa",
    text: "cierre",
  }, week.start + 7_200_000);
  const board = scoreboard(settled, NOW, TZ);
  assert.equal(board.week.scores.b, 0);
  assert.equal(board.week.scores.a, 0);
  assert.equal(board.week.pending, 0);
  assert.throws(() => applySettlement(settled, {
    id: "s2",
    authorId: "b",
    complaintId: "c1",
    mode: "gesto",
    text: "cierre-2",
  }, NOW), (error) => error.code === "settled");
});

test("settling an old complaint does not change the new period", () => {
  const week = periodBounds(NOW, "week", TZ);
  const records = applySettlement([
    complaint({
      id: "old",
      createdAt: new Date(week.start - 86_400_000).toISOString(),
      authorId: "a",
      aboutId: "b",
      points: 5,
    }),
  ], {
    id: "s",
    authorId: "b",
    complaintId: "old",
    mode: "gesto",
    text: "cierre",
  }, NOW);
  const board = scoreboard(records, NOW, TZ);
  assert.equal(board.week.scores.a, 0);
  assert.equal(board.week.scores.b, 0);
});

test("gestures add points only to the author", () => {
  const records = applyGesture([], {
    id: "g1",
    authorId: "b",
    points: 3,
    text: "gesto",
  }, NOW, TZ);
  const board = scoreboard(records, NOW, TZ);
  assert.equal(board.week.scores.b, 3);
  assert.equal(board.month.scores.b, 3);
  assert.equal(board.week.scores.a, 0);
});

test("daily complaint caps and point range", () => {
  let records = [];
  for (let index = 0; index < 3; index += 1) {
    records = applyComplaint(records, {
      id: `c${index}`,
      authorId: "a",
      aboutId: "b",
      category: "celular",
      points: 1,
      text: `queja ${index}`,
    }, NOW, TZ);
  }
  assert.throws(() => applyComplaint(records, {
    id: "c4",
    authorId: "a",
    aboutId: "b",
    category: "celular",
    points: 1,
    text: "texto",
  }, NOW, TZ), (error) => error.code === "cap_count");

  records = applyComplaint([], {
    id: "heavy",
    authorId: "b",
    aboutId: "a",
    category: "platos",
    points: 5,
    text: "texto-1",
  }, NOW, TZ);
  records = applyComplaint(records, {
    id: "heavy2",
    authorId: "b",
    aboutId: "a",
    category: "platos",
    points: 5,
    text: "texto-2",
  }, NOW, TZ);
  assert.throws(() => applyComplaint(records, {
    id: "heavy3",
    authorId: "b",
    aboutId: "a",
    category: "platos",
    points: 1,
    text: "texto-3",
  }, NOW, TZ), (error) => error.code === "cap_points");

  assert.throws(() => applyComplaint([], {
    id: "self",
    authorId: "a",
    aboutId: "a",
    category: "casa",
    points: 1,
    text: "texto",
  }, NOW, TZ), (error) => error.code === "self");

  for (const points of [0, 6, 1.5]) {
    assert.throws(() => applyComplaint([], {
      id: "bad",
      authorId: "a",
      aboutId: "b",
      category: "otro",
      points,
      text: "texto",
    }, NOW, TZ), (error) => error.code === "points");
  }
});

test("gesture daily ceiling", () => {
  let records = [];
  for (let index = 0; index < 3; index += 1) {
    records = applyGesture(records, {
      id: `g${index}`,
      authorId: "a",
      points: 5,
      text: `gesto ${index}`,
    }, NOW, TZ);
  }
  assert.throws(() => applyGesture(records, {
    id: "g-extra",
    authorId: "a",
    points: 1,
    text: "gesto-extra",
  }, NOW, TZ), (error) => error.code === "cap_gesture");
});
