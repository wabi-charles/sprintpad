/**
 * Writes the PWA icons. Hand-rolled rather than rasterised from SVG because no
 * converter is available on this machine -- and the mark is only rectangles,
 * so a raw encoder is both sufficient and reproducible.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [28, 26, 23]; // --sp-fg, the ink of the light theme
const MARK = [240, 160, 75]; // --sp-accent in dark, legible on that ground

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * An open checkbox: the app's one recurring shape. Small sizes take a bolder
 * weight -- a hairline outline disappears in a 16px tab strip.
 */
function pixels(size, bold = false) {
  const px = (n) => Math.round(size * n);
  const inset = px(bold ? 0.19 : 0.24);
  const right = size - inset;
  const stroke = Math.max(2, px(bold ? 0.1 : 0.055));
  const radius = px(bold ? 0.06 : 0.045);

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const inBox = x >= inset && x < right && y >= inset && y < right;
      const inHole =
        x >= inset + stroke && x < right - stroke && y >= inset + stroke && y < right - stroke;

      // Knock the sharp corners off the square so it reads as drawn, not printed.
      const cx = Math.min(x - inset, right - 1 - x);
      const cy = Math.min(y - inset, right - 1 - y);
      const corner = cx < radius && cy < radius && (radius - cx) ** 2 + (radius - cy) ** 2 > radius ** 2;

      const [r, g, b] = inBox && !inHole && !corner ? MARK : BG;
      row.writeUInt8(r, 1 + x * 3);
      row.writeUInt8(g, 2 + x * 3);
      row.writeUInt8(b, 3 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function png(size, bold = false) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels(size, bold), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 180, name: "apple-touch-icon.png" },
  // Fallback for browsers that will not take an SVG favicon.
  { size: 32, name: "favicon-32.png", bold: true },
];

for (const { size, name, bold } of targets) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, bold));
  console.log(`public/${name}  ${size}x${size}${bold ? "  (bold)" : ""}`);
}
