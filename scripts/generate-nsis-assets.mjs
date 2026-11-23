import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Generates bespoke 24-bit Windows BMP artwork for the Synkcut NSIS installer:
 * - src-tauri/nsis/sidebar.bmp (164x314) — Welcome & Finish left banner
 * - src-tauri/nsis/header.bmp  (150x57)  — Interior pages header banner
 * Also exports PNG previews to optional --preview-dir for visual inspection.
 */

function encodeBmp24(width, height, rgb) {
  const rowBytes = width * 3;
  const paddedRow = (rowBytes + 3) & ~3;
  const pixelArraySize = paddedRow * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);

  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // bottom-up standard BMP for NSIS compatibility
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const dstRow = 54 + y * paddedRow;
    for (let x = 0; x < width; x++) {
      const si = (srcY * width + x) * 3;
      const di = dstRow + x * 3;
      buf[di] = rgb[si + 2]; // B
      buf[di + 1] = rgb[si + 1]; // G
      buf[di + 2] = rgb[si]; // R
    }
  }
  return buf;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
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

function encodePngRgb(width, height, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function insideRoundedRect(x, y, rx, ry, rw, rh, rad) {
  const r = Math.min(rad, rw / 2, rh / 2);
  const cx = Math.max(rx + r, Math.min(x, rx + rw - r));
  const cy = Math.max(ry + r, Math.min(y, ry + rh - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function blend(bg, fg, alpha) {
  const a = clamp(alpha);
  return [
    bg[0] * (1 - a) + fg[0] * a,
    bg[1] * (1 - a) + fg[1] * a,
    bg[2] * (1 - a) + fg[2] * a,
  ];
}

function sampleSynkcutMark(x, y, mx, my, size, baseRgb) {
  if (!insideRoundedRect(x, y, mx, my, size, size, size * 0.23)) return baseRgb;

  const lx = ((x - mx) / size) * 28;
  const ly = ((y - my) / size) * 28;
  const t = clamp(ly / 28);
  let col = [lerp(18, 8, t), lerp(192, 138, t), lerp(134, 96, t)];

  // Top studio catchlight rim
  if (!insideRoundedRect(lx, ly, 1.0, 1.0, 26.0, 26.0, 5.6)) {
    const rim = clamp(1 - ly / 12) * 0.28;
    col = blend(col, [255, 255, 255], rim);
  }

  // 3 rhythm bars
  const inLeft = insideRoundedRect(lx, ly, 6.2, 7.2, 3.8, 13.6, 1.2);
  const inMid = insideRoundedRect(lx, ly, 12.1, 5.2, 3.8, 17.6, 1.2);
  const inRight = insideRoundedRect(lx, ly, 18.0, 9.2, 3.8, 9.6, 1.2);

  if (inLeft || inRight) return [255, 255, 255];
  if (inMid) return blend(col, [255, 255, 255], 0.72);
  return col;
}

/**
 * 164 x 314 Machined Carbon + Signature Emerald vertical brand sidebar
 */
function renderSidebar(width = 164, height = 314) {
  const rgb = Buffer.alloc(width * height * 3);
  const samples = 3;

  // Deterministic waveform heights for the mini timeline graphic
  const waveHeights = Array.from({ length: 24 }, (_, i) =>
    Math.max(4, Math.round(Math.abs(Math.sin(i * 0.62) * 11 + Math.cos(i * 1.45) * 6)))
  );

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;

          // 1. Machined Carbon studio vertical gradient (#0a0d11 -> #0d1614 -> #080a0d)
          const gy = y / height;
          let col = [
            lerp(11, 8, gy),
            lerp(14, 12, gy),
            lerp(19, 15, gy),
          ];

          // 2. Soft Signature Emerald studio radial glow behind top logo & 9:16 stage
          const dx1 = (x - width * 0.5) / 92;
          const dy1 = (y - 76) / 96;
          const glow1 = Math.exp(-(dx1 * dx1 + dy1 * dy1) * 1.35) * 0.34;
          col = blend(col, [16, 185, 129], glow1);

          const dx2 = (x - width * 0.52) / 86;
          const dy2 = (y - 210) / 115;
          const glow2 = Math.exp(-(dx2 * dx2 + dy2 * dy2) * 1.6) * 0.16;
          col = blend(col, [56, 189, 248], glow2);

          // 3. Subtle studio dot-grid
          const gxMod = Math.abs(((x + 8) % 16) - 8);
          const gyMod = Math.abs(((y + 8) % 16) - 8);
          if (gxMod * gxMod + gyMod * gyMod < 0.72) {
            col = blend(col, [255, 255, 255], 0.08);
          }

          // 4. Centerpiece Synkcut Emerald Mark (56x56 centered at y=44)
          col = sampleSynkcutMark(x, y, (width - 56) / 2, 42, 56, col);

          // 5. Stylized 9:16 Video Preview Card (motion bars + play button)
          const cardX = 24;
          const cardY = 122;
          const cardW = 116;
          const cardH = 112;
          if (insideRoundedRect(x, y, cardX, cardY, cardW, cardH, 11)) {
            col = blend(col, [18, 22, 28], 0.92);
            // Subtle border
            if (!insideRoundedRect(x, y, cardX + 1.2, cardY + 1.2, cardW - 2.4, cardH - 2.4, 9.8)) {
              col = blend(col, [56, 229, 157], 0.35);
            }

            // Mini top progress pill neatly inset inside the stage card
            if (insideRoundedRect(x, y, cardX + 14, cardY + 8, 54, 3.2, 1.6)) {
              col = [56, 229, 157];
            }
            if (insideRoundedRect(x, y, cardX + 71, cardY + 8, 31, 3.2, 1.6)) {
              col = blend(col, [255, 255, 255], 0.14);
            }

            // 3 stacked mini Motion Diagram / 3D layers inside card
            const layers = [
              { lx: cardX + 14, ly: cardY + 18, lw: 88, lh: 14, accent: [56, 229, 157] },
              { lx: cardX + 14, ly: cardY + 38, lw: 72, lh: 14, accent: [56, 189, 248] },
              { lx: cardX + 14, ly: cardY + 58, lw: 82, lh: 14, accent: [245, 158, 11] },
            ];
            for (const L of layers) {
              if (insideRoundedRect(x, y, L.lx, L.ly, L.lw, L.lh, 4)) {
                col = blend(col, [30, 36, 46], 0.96);
                // Colored leading dot
                const ddx = x - (L.lx + 7);
                const ddy = y - (L.ly + L.lh / 2);
                if (ddx * ddx + ddy * ddy <= 7.5) {
                  col = L.accent;
                }
                // Mini bar representation of text
                if (insideRoundedRect(x, y, L.lx + 16, L.ly + 5, L.lw - 24, 4, 2)) {
                  col = blend(col, [235, 242, 248], 0.55);
                }
              }
            }

            // Kinetic Caption highlight bar near bottom of card
            if (insideRoundedRect(x, y, cardX + 20, cardY + 84, 34, 8, 3)) {
              col = [56, 229, 157];
            }
            if (insideRoundedRect(x, y, cardX + 58, cardY + 84, 38, 8, 3)) {
              col = [242, 245, 248];
            }
          }

          // 6. Mini Audio-Synced Waveform + Scene Blocks strip at bottom (y=248..292)
          const stripX = 18;
          const stripY = 250;
          const stripW = width - 36;
          if (insideRoundedRect(x, y, stripX, stripY, stripW, 38, 8)) {
            col = blend(col, [18, 22, 28], 0.9);
            if (!insideRoundedRect(x, y, stripX + 1, stripY + 1, stripW - 2, 36, 7)) {
              col = blend(col, [255, 255, 255], 0.14);
            }
            // Scene segments row
            const segs = [
              { sx: stripX + 6, sw: 36, c: [245, 158, 11] },
              { sx: stripX + 46, sw: 42, c: [56, 189, 248] },
              { sx: stripX + 92, sw: 30, c: [16, 185, 129] },
            ];
            for (const s of segs) {
              if (insideRoundedRect(x, y, s.sx, stripY + 6, s.sw, 8, 2.5)) {
                col = blend(col, s.c, 0.72);
              }
            }
            // Mini synced waveform bars
            for (let i = 0; i < waveHeights.length; i++) {
              const bx = stripX + 8 + i * 4.8;
              const bh = waveHeights[i];
              const by = stripY + 26 - bh / 2;
              if (x >= bx && x <= bx + 2.2 && y >= by && y <= by + bh) {
                col = blend(col, [56, 229, 157], i < 11 ? 0.92 : 0.35);
              }
            }
            // Crisp vertical playhead line
            if (x >= stripX + 58 && x <= stripX + 59.5 && y >= stripY + 2 && y <= stripY + 36) {
              col = [255, 255, 255];
            }
          }

          // 7. Crisp right-edge Signature Emerald hairline separating sidebar from wizard white pane
          if (x >= width - 2.2) {
            col = blend(col, [16, 185, 129], 0.78);
          }

          rSum += col[0];
          gSum += col[1];
          bSum += col[2];
        }
      }

      const cnt = samples * samples;
      const idx = (py * width + px) * 3;
      rgb[idx] = Math.round(rSum / cnt);
      rgb[idx + 1] = Math.round(gSum / cnt);
      rgb[idx + 2] = Math.round(bSum / cnt);
    }
  }
  return rgb;
}

/**
 * 150 x 57 crisp interior header banner (left-aligned Synkcut mark + flowing waveform
 * fading seamlessly into pure white before the NSIS page title on the right)
 */
function renderHeader(width = 150, height = 57) {
  const rgb = Buffer.alloc(width * height * 3);
  const samples = 3;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;

          // Clean pure white background blending seamlessly with native NSIS white header
          let col = [255, 255, 255];

          // Soft sage-emerald studio aura behind the left-aligned Synkcut icon
          const dx = (x - 38) / 48;
          const dy = (y - 28.5) / 34;
          const wash = Math.exp(-(dx * dx + dy * dy) * 1.45) * 0.13;
          col = blend(col, [16, 185, 129], wash);

          // Crisp 36x36 Synkcut Mark aligned neatly on the left
          col = sampleSynkcutMark(x, y, 18, 10.5, 36, col);

          // Synced audio/motion pulse bars flowing right from the mark, tapering softly into white
          const bars = [
            { bx: 64, bh: 16, a: 0.62, c: [12, 166, 114] },
            { bx: 71, bh: 26, a: 0.72, c: [16, 185, 129] },
            { bx: 78, bh: 12, a: 0.48, c: [12, 166, 114] },
            { bx: 85, bh: 22, a: 0.42, c: [56, 189, 248] },
            { bx: 92, bh: 14, a: 0.30, c: [16, 185, 129] },
            { bx: 99, bh: 19, a: 0.22, c: [16, 185, 129] },
            { bx: 106, bh: 10, a: 0.14, c: [16, 185, 129] },
            { bx: 113, bh: 7, a: 0.08, c: [16, 185, 129] },
          ];
          for (const b of bars) {
            if (insideRoundedRect(x, y, b.bx, 28.5 - b.bh / 2, 3.2, b.bh, 1.5)) {
              col = blend(col, b.c, b.a);
            }
          }

          rSum += col[0];
          gSum += col[1];
          bSum += col[2];
        }
      }

      const cnt = samples * samples;
      const idx = (py * width + px) * 3;
      rgb[idx] = Math.round(rSum / cnt);
      rgb[idx + 1] = Math.round(gSum / cnt);
      rgb[idx + 2] = Math.round(bSum / cnt);
    }
  }
  return rgb;
}

const root = path.resolve(process.cwd());
const outDir = path.join(root, "src-tauri", "nsis");
fs.mkdirSync(outDir, { recursive: true });

const sidebarRgb = renderSidebar(164, 314);
const headerRgb = renderHeader(150, 57);

fs.writeFileSync(path.join(outDir, "sidebar.bmp"), encodeBmp24(164, 314, sidebarRgb));
fs.writeFileSync(path.join(outDir, "header.bmp"), encodeBmp24(150, 57, headerRgb));
console.log("Generated src-tauri/nsis/sidebar.bmp (164x314) & header.bmp (150x57)");

const previewArgIdx = process.argv.indexOf("--preview-dir");
if (previewArgIdx !== -1 && process.argv[previewArgIdx + 1]) {
  const previewDir = process.argv[previewArgIdx + 1];
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(path.join(previewDir, "nsis_sidebar.png"), encodePngRgb(164, 314, sidebarRgb));
  fs.writeFileSync(path.join(previewDir, "nsis_header.png"), encodePngRgb(150, 57, headerRgb));
  console.log("Saved PNG previews to", previewDir);
}
