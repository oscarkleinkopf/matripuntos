import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "icons");

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function setPixel(buf, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  buf[index] = color[0];
  buf[index + 1] = color[1];
  buf[index + 2] = color[2];
  buf[index + 3] = 255;
}

function fill(buf, size, color) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) setPixel(buf, size, x, y, color);
  }
}

function fillCircle(buf, size, cx, cy, radius, color) {
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(buf, size, x, y, color);
    }
  }
}

function fillRoundRect(buf, size, x, y, width, height, radius, color) {
  for (let yy = Math.floor(y); yy < y + height; yy += 1) {
    for (let xx = Math.floor(x); xx < x + width; xx += 1) {
      const px = xx + 0.5;
      const py = yy + 0.5;
      const left = x + radius;
      const right = x + width - radius;
      const top = y + radius;
      const bottom = y + height - radius;
      const cx = Math.min(Math.max(px, left), right);
      const cy = Math.min(Math.max(py, top), bottom);
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(buf, size, xx, yy, color);
    }
  }
}

const cream = [247, 241, 234];
const clay = [196, 84, 58];

function paint(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  fill(buf, size, maskable ? clay : cream);
  if (!maskable) fillCircle(buf, size, size / 2, size / 2, size * 0.34, clay);
  const unit = size * (maskable ? 0.032 : 0.042);
  const cx = size / 2;
  const cy = size / 2;
  fillRoundRect(buf, size, cx - unit, cy - unit * 4.4, unit * 2, unit * 5.2, unit * 0.7, cream);
  fillRoundRect(buf, size, cx - unit * 2.6, cy - unit * 2.8, unit * 5.2, unit * 2, unit * 0.7, cream);
  fillRoundRect(buf, size, cx - unit * 2.6, cy + unit * 1.8, unit * 5.2, unit * 2, unit * 0.7, cream);
  return encodePng(size, buf);
}

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "icon-192.png"), paint(192, false));
writeFileSync(join(dir, "icon-512.png"), paint(512, false));
writeFileSync(join(dir, "icon-maskable-512.png"), paint(512, true));
