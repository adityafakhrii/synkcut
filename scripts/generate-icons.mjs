import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, rx, ry, rw, rh, rad) {
  const cx = Math.max(rx + rad, Math.min(x, rx + rw - rad));
  const cy = Math.max(ry + rad, Math.min(y, ry + rh - rad));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

function renderSynkcutIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 28;
  // Supersample 4x4 for crisp anti-aliased edges
  const samples = 4;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        aSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / scale;
          const y = (py + (sy + 0.5) / samples) / scale;

          // Outer emerald rounded squircle (28x28, radius 6.5)
          if (!insideRoundedRect(x, y, 0.5, 0.5, 27, 27, 6.5)) {
            continue;
          }

          // Subtle vertical studio depth gradient on Signature Emerald (#10b981 -> #0a8f63)
          const t = Math.max(0, Math.min(1, y / 28));
          let r = 16 * (1 - t) + 10 * t;
          let g = 185 * (1 - t) + 143 * t;
          let b = 129 * (1 - t) + 99 * t;

          // Smooth subtle top highlight rim
          if (!insideRoundedRect(x, y, 1.3, 1.3, 25.4, 25.4, 5.8)) {
            const rimGlow = Math.max(0, 1 - y / 12) * 26;
            r = Math.min(255, r + rimGlow);
            g = Math.min(255, g + rimGlow);
            b = Math.min(255, b + rimGlow);
          }

          // 3 crisp Synkcut rhythm/cut bars matching SynkcutMark SVG
          const inLeft = insideRoundedRect(x, y, 6.2, 7.2, 3.8, 13.6, 1.2);
          const inMid = insideRoundedRect(x, y, 12.1, 5.2, 3.8, 17.6, 1.2);
          const inRight = insideRoundedRect(x, y, 18.0, 9.2, 3.8, 9.6, 1.2);

          if (inLeft || inRight) {
            r = 255;
            g = 255;
            b = 255;
          } else if (inMid) {
            // 75% white blend over emerald
            r = r * 0.25 + 255 * 0.75;
            g = g * 0.25 + 255 * 0.75;
            b = b * 0.25 + 255 * 0.75;
          }

          rSum += r;
          gSum += g;
          bSum += b;
          aSum += 255;
        }
      }

      const count = samples * samples;
      const idx = (py * size + px) * 4;
      const a = Math.round(aSum / count);
      if (a > 0) {
        rgba[idx] = Math.round(rSum / (aSum / 255));
        rgba[idx + 1] = Math.round(gSum / (aSum / 255));
        rgba[idx + 2] = Math.round(bSum / (aSum / 255));
        rgba[idx + 3] = a;
      }
    }
  }
  return encodePng(size, size, rgba);
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = Buffer.alloc(entries.length * 16);
  entries.forEach((entry, i) => {
    const pos = i * 16;
    dir[pos] = entry.size >= 256 ? 0 : entry.size;
    dir[pos + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[pos + 2] = 0;
    dir[pos + 3] = 0;
    dir.writeUInt16LE(1, pos + 4);
    dir.writeUInt16LE(32, pos + 6);
    dir.writeUInt32LE(entry.png.length, pos + 8);
    dir.writeUInt32LE(offset, pos + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

const outDir = path.resolve("src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });

const png32 = renderSynkcutIcon(32);
const png64 = renderSynkcutIcon(64);
const png128 = renderSynkcutIcon(128);
const png256 = renderSynkcutIcon(256);

fs.writeFileSync(path.join(outDir, "32x32.png"), png32);
fs.writeFileSync(path.join(outDir, "128x128.png"), png128);
fs.writeFileSync(path.join(outDir, "128x128@2x.png"), png256);
fs.writeFileSync(
  path.join(outDir, "icon.ico"),
  buildIco([
    { size: 32, png: png32 },
    { size: 64, png: png64 },
    { size: 128, png: png128 },
    { size: 256, png: png256 },
  ])
);

console.log("Generated crisp Synkcut icons in", outDir);
