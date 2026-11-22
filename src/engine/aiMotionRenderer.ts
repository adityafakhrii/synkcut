import type {
  AiMotionSpec,
  AiMotionTheme,
  FlowDiagramConfig,
  MotionChartConfig,
  StickFigureConfig,
  TechCardsConfig,
} from "../types/scene";
import { renderBreakdown3DScene } from "./breakdown3dRenderer";

const SANS = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

interface MotionPalette {
  bgTop: string;
  bgBottom: string;
  cardBg: string;
  cardBorder: string;
  ink: string;
  muted: string;
  soft: string;
  faint: string;
  accent: string;
  accentAlt: string;
  accentInk: string;
  grid: string;
  isLight: boolean;
}

const PALETTES: Record<AiMotionTheme, MotionPalette> = {
  carbon: {
    bgTop: "#0a0c11",
    bgBottom: "#12161f",
    cardBg: "rgba(24, 28, 38, 0.86)",
    cardBorder: "rgba(255, 255, 255, 0.14)",
    ink: "#f4f5f7",
    muted: "#9aa3b5",
    soft: "rgba(255, 255, 255, 0.24)",
    faint: "rgba(255, 255, 255, 0.10)",
    accent: "#10b981",
    accentAlt: "#f59e0b",
    accentInk: "#07140e",
    grid: "rgba(255, 255, 255, 0.045)",
    isLight: false,
  },
  paper: {
    bgTop: "#f7f3ea",
    bgBottom: "#ede6d8",
    cardBg: "rgba(255, 255, 255, 0.88)",
    cardBorder: "rgba(21, 21, 24, 0.14)",
    ink: "#15161a",
    muted: "#575c68",
    soft: "rgba(21, 22, 26, 0.22)",
    faint: "rgba(21, 22, 26, 0.10)",
    accent: "#ea580c",
    accentAlt: "#0f766e",
    accentInk: "#ffffff",
    grid: "rgba(21, 22, 26, 0.055)",
    isLight: true,
  },
  coral: {
    bgTop: "#b84e2e",
    bgBottom: "#8e3522",
    cardBg: "rgba(24, 15, 24, 0.34)",
    cardBorder: "rgba(255, 255, 255, 0.22)",
    ink: "#ffffff",
    muted: "rgba(255, 243, 232, 0.80)",
    soft: "rgba(255, 255, 255, 0.30)",
    faint: "rgba(255, 255, 255, 0.15)",
    accent: "#ffe2b8",
    accentAlt: "#2a1b4a",
    accentInk: "#1d1226",
    grid: "rgba(255, 255, 255, 0.055)",
    isLight: false,
  },
  mint: {
    bgTop: "#c8edd9",
    bgBottom: "#a8dfc2",
    cardBg: "rgba(255, 255, 255, 0.78)",
    cardBorder: "rgba(13, 42, 31, 0.16)",
    ink: "#0c281e",
    muted: "#2f5747",
    soft: "rgba(12, 40, 30, 0.24)",
    faint: "rgba(12, 40, 30, 0.11)",
    accent: "#ea580c",
    accentAlt: "#097954",
    accentInk: "#ffffff",
    grid: "rgba(12, 40, 30, 0.055)",
    isLight: true,
  },
  blue: {
    bgTop: "#081226",
    bgBottom: "#10244a",
    cardBg: "rgba(16, 36, 74, 0.78)",
    cardBorder: "rgba(125, 211, 252, 0.22)",
    ink: "#f4f8ff",
    muted: "#9bb7dc",
    soft: "rgba(255, 255, 255, 0.26)",
    faint: "rgba(255, 255, 255, 0.12)",
    accent: "#38bdf8",
    accentAlt: "#fbbf24",
    accentInk: "#071422",
    grid: "rgba(125, 211, 252, 0.06)",
    isLight: false,
  },
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, q: number) => a + (b - a) * q;
const prog = (t: number, t0: number, t1: number) => clamp((t - t0) / Math.max(1e-5, t1 - t0));

const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeOutExpo = (x: number) => {
  const c = clamp(x);
  return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
};
const easeInOut = (x: number) => {
  const c = clamp(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
const easeBack = (x: number) => {
  const c = clamp(x);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
};

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withAlpha(hexOrRgba: string, a: number): string {
  const safe = clamp(a);
  if (hexOrRgba.startsWith("#")) {
    const clean = hexOrRgba.slice(1);
    const full =
      clean.length === 3
        ? clean
            .split("")
            .map((c) => c + c)
            .join("")
        : clean;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${safe.toFixed(3)})`;
  }
  return hexOrRgba.replace(
    /rgba?\(([^,]+),([^,]+),([^,)]+)(,[^)]+)?\)/,
    `rgba($1,$2,$3,${safe.toFixed(3)})`
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number]
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = typeof r === "number" ? Math.min(r, w / 2, h / 2) : r[0];
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  startSize: number,
  minSize: number,
  maxLines: number,
  weight = 800,
  family = SANS
): { lines: string[]; size: number } {
  for (let s = startSize; s >= minSize; s -= Math.max(1, startSize * 0.04)) {
    ctx.font = `${weight} ${Math.round(s)}px ${family}`;
    const lines = wrapText(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) {
      return { lines, size: Math.round(s) };
    }
  }
  ctx.font = `${weight} ${Math.round(minSize)}px ${family}`;
  return { lines: wrapText(ctx, text, maxW).slice(0, maxLines), size: Math.round(minSize) };
}

function drawLayeredBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pal: MotionPalette,
  progress: number
) {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, pal.bgTop);
  grad.addColorStop(1, pal.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle architectural dot/line grid
  ctx.save();
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = Math.max(1, width / 540);
  const step = Math.round(width / 9);
  const drift = (progress * step * 0.5) % step;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = -step; y <= height + step; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + drift);
    ctx.lineTo(width, y + drift);
    ctx.stroke();
  }

  // Soft radial focal aura centered on the 10%-59% Motion Stage
  const orbX = width * (0.5 + 0.08 * Math.sin(progress * Math.PI * 2));
  const orbY = height * 0.36;
  const rad = ctx.createRadialGradient(orbX, orbY, width * 0.04, orbX, orbY, width * 0.62);
  rad.addColorStop(0, withAlpha(pal.accent, pal.isLight ? 0.11 : 0.16));
  rad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, width, height);

  // Subtle bottom scrim in caption area for clean separation
  if (!pal.isLight) {
    const scrim = ctx.createLinearGradient(0, height * 0.58, 0, height);
    scrim.addColorStop(0, "rgba(0,0,0,0)");
    scrim.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, height * 0.58, width, height * 0.42);
  }
  ctx.restore();
}

function drawStageHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spec: AiMotionSpec,
  pal: MotionPalette,
  p: number
): number {
  const u = width / 1080;
  const enter = easeOutExpo(prog(p, 0, 0.16));
  const topY = height * 0.112;

  ctx.save();
  ctx.globalAlpha = enter;
  ctx.translate(0, (1 - enter) * 24 * u);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const titleFit = fitText(ctx, spec.title || "AI Motion", width * 0.84, 62 * u, 36 * u, 2, 800, SANS);
  ctx.font = `800 ${titleFit.size}px ${SANS}`;
  ctx.fillStyle = pal.ink;
  const lh = titleFit.size * 1.15;
  titleFit.lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, topY + titleFit.size + idx * lh);
  });

  let bottomY = topY + titleFit.size + (titleFit.lines.length - 1) * lh;
  if (spec.subtitle && spec.subtitle.trim()) {
    const subSize = Math.round(30 * u);
    ctx.font = `500 ${subSize}px ${SANS}`;
    ctx.fillStyle = pal.muted;
    bottomY += 44 * u;
    ctx.fillText(spec.subtitle.trim().slice(0, 52), width / 2, bottomY);
  }
  ctx.restore();
  return bottomY + 26 * u;
}

function drawStageTakeaway(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  takeaway: string | undefined,
  pal: MotionPalette,
  p: number
) {
  if (!takeaway || !takeaway.trim()) return;
  const u = width / 1080;
  const q = easeOutExpo(prog(p, 0.68, 0.86));
  if (q <= 0.01) return;

  const y = height * 0.568;
  ctx.save();
  ctx.globalAlpha = q;
  ctx.translate(0, (1 - q) * 18 * u);
  const fontSize = Math.round(27 * u);
  ctx.font = `600 ${fontSize}px ${SANS}`;
  const label = takeaway.trim().slice(0, 56);
  const tw = ctx.measureText(label).width;
  const pillW = Math.min(width * 0.86, tw + 54 * u);
  const pillH = 58 * u;

  ctx.fillStyle = pal.cardBg;
  ctx.strokeStyle = withAlpha(pal.accent, 0.55);
  ctx.lineWidth = 2 * u;
  roundRect(ctx, (width - pillW) / 2, y - pillH / 2, pillW, pillH, 999);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = pal.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, y + 1 * u);
  ctx.restore();
}

function drawRipple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  q: number,
  color: string,
  u: number
) {
  if (q <= 0 || q >= 1) return;
  ctx.beginPath();
  ctx.arc(x, y, r0 * (1 + 1.85 * easeOut(q)), 0, Math.PI * 2);
  ctx.strokeStyle = withAlpha(color, 0.5 * (1 - q));
  ctx.lineWidth = 2.5 * u;
  ctx.stroke();
}

function drawTrailDot(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  s: number,
  e: number,
  rad: number,
  col: string
) {
  for (let k = 0; k < 5; k++) {
    const q = easeInOut(prog(t - k * 0.018, s, e));
    if (q <= 0 || (k === 0 && q >= 1)) continue;
    ctx.beginPath();
    ctx.arc(lerp(x0, x1, q), lerp(y0, y1, q), rad * (1 - k * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = k ? withAlpha(col, 0.45 - k * 0.08) : col;
    ctx.fill();
  }
}

function drawGeoShape(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  r: number,
  fill: string
) {
  ctx.beginPath();
  if (kind === "square") {
    roundRect(ctx, x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76, r * 0.28);
  } else if (kind === "diamond") {
    ctx.moveTo(x, y - r * 1.1);
    ctx.lineTo(x + r * 1.1, y);
    ctx.lineTo(x, y + r * 1.1);
    ctx.lineTo(x - r * 1.1, y);
    ctx.closePath();
  } else if (kind === "hexagon") {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      if (k === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

/* ==================== ENGINE 1: FLOW & DIAGRAM ==================== */
function renderFlowDiagram(
  ctx: CanvasRenderingContext2D,
  width: number,
  stageTop: number,
  stageBottom: number,
  cfg: FlowDiagramConfig,
  pal: MotionPalette,
  p: number
) {
  const u = width / 1080;
  const cx = width / 2;
  const stageH = Math.max(260 * u, stageBottom - stageTop);
  const cy = stageTop + stageH * 0.5;
  const R = Math.min(width * 0.36, stageH * 0.43);

  if (cfg.pattern === "flow") {
    const steps = (cfg.steps && cfg.steps.length ? cfg.steps : ["Input", "Proses", "Output"]).slice(0, 6);
    const n = steps.length;
    const shapes = ["circle", "square", "diamond", "hexagon", "circle", "square"];
    const nr = (n > 4 ? 38 : 44) * u;
    const leftX = width * 0.20;
    const topY = stageTop + 56 * u;
    const botY = stageBottom - 56 * u;
    const ys = steps.map((_, i) => (n === 1 ? cy : lerp(topY, botY, i / (n - 1))));
    const hop = n > 1 ? 0.68 / (n - 1) : 0.4;
    const arriveAt = steps.map((_, i) => 0.08 + i * hop);
    const endP = arriveAt[n - 1] + 0.08;

    // Connectors + travelling dot
    for (let i = 0; i < n - 1; i++) {
      const y0 = ys[i] + nr * 1.18;
      const y1 = ys[i + 1] - nr * 1.18;
      const s = arriveAt[i] + 0.02;
      const e = arriveAt[i + 1] - 0.01;
      const q = easeInOut(prog(p, s, e));
      if (q <= 0) continue;

      ctx.strokeStyle = withAlpha(pal.ink, 0.45);
      ctx.lineWidth = 4 * u;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(leftX, y0);
      ctx.lineTo(leftX, lerp(y0, y1, q));
      ctx.stroke();

      drawTrailDot(ctx, leftX, y0, leftX, y1, p, s, e, 10 * u, pal.accent);
    }

    // Continuous stream after all nodes arrive
    if (p > endP && n > 1) {
      const fade = easeOut(prog(p, endP, endP + 0.12));
      for (let i = 0; i < n - 1; i++) {
        const y0 = ys[i] + nr * 1.18;
        const y1 = ys[i + 1] - nr * 1.18;
        for (let k = 0; k < 2; k++) {
          const uDot = (((p - endP) * 3.5 + k * 0.5) % 1 + 1) % 1;
          ctx.save();
          ctx.globalAlpha = fade * Math.sin(Math.PI * uDot);
          ctx.beginPath();
          ctx.arc(leftX, lerp(y0, y1, uDot), 7.5 * u, 0, Math.PI * 2);
          ctx.fillStyle = pal.accent;
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Nodes + step labels
    steps.forEach((label, i) => {
      const y = ys[i];
      const q = prog(p, arriveAt[i] - 0.03, arriveAt[i] + 0.1);
      if (q <= 0) return;
      const sc = easeBack(q);
      ctx.save();
      ctx.translate(leftX, y);
      ctx.scale(sc, sc);
      drawGeoShape(ctx, shapes[i % shapes.length], 0, 0, nr, pal.ink);
      ctx.fillStyle = pal.bgTop;
      ctx.font = `800 ${Math.round(nr * 0.8)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), 0, 2 * u);
      ctx.restore();

      drawRipple(ctx, leftX, y, nr, prog(p, arriveAt[i], arriveAt[i] + 0.18), pal.accent, u);

      const lq = easeOutExpo(prog(p, arriveAt[i], arriveAt[i] + 0.14));
      if (lq > 0) {
        const cardX = leftX + nr + 30 * u;
        const cardW = width - cardX - 152 * u;
        const cardH = Math.min(92 * u, (stageH / Math.max(2, n)) * 0.72);
        ctx.save();
        ctx.globalAlpha = lq;
        ctx.translate((1 - lq) * 28 * u, 0);
        ctx.fillStyle = pal.cardBg;
        ctx.strokeStyle = i === n - 1 ? withAlpha(pal.accent, 0.75) : pal.cardBorder;
        ctx.lineWidth = 2 * u;
        roundRect(ctx, cardX, y - cardH / 2, cardW, cardH, 20 * u);
        ctx.fill();
        ctx.stroke();

        const fitted = fitText(ctx, label, cardW - 44 * u, 38 * u, 24 * u, 2, 700, SANS);
        ctx.font = `700 ${fitted.size}px ${SANS}`;
        ctx.fillStyle = pal.ink;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const flh = fitted.size * 1.12;
        fitted.lines.forEach((ln, k) => {
          ctx.fillText(ln, cardX + 24 * u, y + (k - (fitted.lines.length - 1) / 2) * flh);
        });
        ctx.restore();
      }
    });
    return;
  }

  if (cfg.pattern === "spread") {
    const b = clamp(Math.round(cfg.branches || 3), 2, 4);
    let d = clamp(Math.round(cfg.depth || 3), 2, 4);
    while (Math.pow(b, d) > 120) d--;

    const radii = [0];
    for (let k = 1; k <= d; k++) radii.push(R * Math.pow(k / d, 0.8));
    const nr = (k: number) => [22, 15, 11, 8, 6][k] * u * (d <= 3 ? 1.15 : 1);

    const nodes: Array<Array<{ x: number; y: number; pIdx: number }>> = [[{ x: cx, y: cy, pIdx: -1 }]];
    let off = 0;
    for (let k = 1; k <= d; k++) {
      off -= (Math.PI * (b - 1)) / Math.pow(b, k);
      const count = Math.pow(b, k);
      const ring = [];
      for (let j = 0; j < count; j++) {
        const a = -Math.PI / 2 + (2 * Math.PI * j) / count + off;
        ring.push({
          x: cx + radii[k] * Math.cos(a),
          y: cy + radii[k] * Math.sin(a),
          pIdx: Math.floor(j / b),
        });
      }
      nodes.push(ring);
    }

    const waveStep = 0.65 / d;
    const seq = (
      cfg.sequence && cfg.sequence.length
        ? cfg.sequence
        : Array.from({ length: d + 1 }, (_, k) => String(Math.pow(b, k)))
    ).slice(0, d + 1);

    // Subtle concentric guide rings
    for (let k = 1; k <= d; k++) {
      const q = easeOut(prog(p, (k - 1) * waveStep, k * waveStep));
      if (q <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, radii[k], -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q);
      ctx.strokeStyle = pal.faint;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
    }

    // Branches & travelling dots
    for (let k = 1; k <= d; k++) {
      const ws = 0.06 + (k - 1) * waveStep;
      const we = ws + waveStep * 0.72;
      nodes[k].forEach((node) => {
        const par = nodes[k - 1][node.pIdx];
        const q = easeInOut(prog(p, ws, we));
        if (q <= 0) return;
        ctx.beginPath();
        ctx.moveTo(par.x, par.y);
        ctx.lineTo(lerp(par.x, node.x, q), lerp(par.y, node.y, q));
        ctx.strokeStyle = withAlpha(pal.ink, 0.72 - 0.1 * k);
        ctx.lineWidth = Math.max(1.4, 3.2 - 0.45 * k) * u;
        ctx.stroke();
        drawTrailDot(ctx, par.x, par.y, node.x, node.y, p, ws, we, Math.max(3.5, 7.5 - k) * u, pal.accent);
      });
    }

    // Nodes
    for (let k = 0; k <= d; k++) {
      const arrive = k === 0 ? 0 : 0.06 + (k - 1) * waveStep + waveStep * 0.72;
      nodes[k].forEach((node) => {
        const lit = p >= arrive;
        const app = k === 0 ? 1 : easeOut(prog(p, arrive - waveStep * 0.8, arrive));
        if (app <= 0) return;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nr(k) * app, 0, Math.PI * 2);
        ctx.fillStyle = lit ? (k === 0 ? pal.accent : pal.ink) : pal.soft;
        ctx.fill();
        if (lit && k > 0) drawRipple(ctx, node.x, node.y, nr(k), prog(p, arrive, arrive + 0.16), pal.accent, u);
      });
    }

    // Sequence bar at top of stage
    const activeRing = Math.min(d, Math.floor(Math.max(0, p - 0.06) / waveStep) + 1);
    const seqText = seq.slice(0, activeRing + 1).join("  →  ");
    ctx.font = `700 ${Math.round(30 * u)}px ${MONO}`;
    ctx.fillStyle = pal.accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(seqText, cx, stageTop + 26 * u);
    return;
  }

  if (cfg.pattern === "cycle") {
    const steps = (cfg.steps && cfg.steps.length ? cfg.steps : ["Trigger", "Aksi", "Reward", "Ulangi"]).slice(0, 6);
    const n = steps.length;
    const rc = R * 0.72;
    const nr = 30 * u;
    const angles = steps.map((_, i) => -Math.PI / 2 + (2 * Math.PI * i) / n);
    const gapA = (nr + 18 * u) / rc;

    // Arcs + arrowheads
    steps.forEach((_, i) => {
      const a0 = angles[i] + gapA;
      const a1 = angles[i] + (2 * Math.PI) / n - gapA;
      const q = easeInOut(prog(p, 0.04 + i * 0.08, 0.24 + i * 0.08));
      if (q <= 0) return;
      const ae = lerp(a0, a1, q);
      ctx.strokeStyle = withAlpha(pal.ink, 0.5);
      ctx.lineWidth = 4 * u;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, rc, a0, ae);
      ctx.stroke();

      if (q > 0.85) {
        const hx = cx + rc * Math.cos(ae);
        const hy = cy + rc * Math.sin(ae);
        const dir = ae + Math.PI / 2;
        const s = 15 * u;
        ctx.fillStyle = withAlpha(pal.ink, 0.65);
        ctx.beginPath();
        ctx.moveTo(hx + s * Math.cos(dir), hy + s * Math.sin(dir));
        ctx.lineTo(hx + s * Math.cos(dir + 2.5), hy + s * Math.sin(dir + 2.5));
        ctx.lineTo(hx + s * Math.cos(dir - 2.5), hy + s * Math.sin(dir - 2.5));
        ctx.closePath();
        ctx.fill();
      }
    });

    // Center word
    if (cfg.center) {
      const f = fitText(ctx, cfg.center, rc * 1.25, 42 * u, 24 * u, 2, 800, SANS);
      ctx.font = `800 ${f.size}px ${SANS}`;
      ctx.fillStyle = pal.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      f.lines.forEach((l, k) => {
        ctx.fillText(l, cx, cy + (k - (f.lines.length - 1) / 2) * f.size * 1.12);
      });
    }

    // Orbiting comet
    const orbitStart = 0.2;
    const orbitProgress = Math.max(0, (p - orbitStart) / 0.65);
    if (p >= orbitStart) {
      for (let k = 0; k < 6; k++) {
        const th = -Math.PI / 2 + 2 * Math.PI * (orbitProgress - k * 0.02);
        ctx.beginPath();
        ctx.arc(cx + rc * Math.cos(th), cy + rc * Math.sin(th), (13 - k * 1.6) * u, 0, Math.PI * 2);
        ctx.fillStyle = k === 0 ? pal.accent : withAlpha(pal.accent, 0.45 - k * 0.07);
        ctx.fill();
      }
    }

    // Nodes + labels
    steps.forEach((label, i) => {
      const x = cx + rc * Math.cos(angles[i]);
      const y = cy + rc * Math.sin(angles[i]);
      const lit = p >= orbitStart + (i / n) * 0.65;
      const app = easeBack(prog(p, 0.04 + i * 0.06, 0.18 + i * 0.06));
      if (app <= 0) return;

      ctx.beginPath();
      ctx.arc(x, y, nr * app, 0, Math.PI * 2);
      ctx.fillStyle = lit ? pal.accent : pal.soft;
      ctx.fill();

      const labelOffset = nr + 34 * u;
      const lx = clamp(cx + (rc + labelOffset * 1.1) * Math.cos(angles[i]), 130 * u, width - 130 * u);
      const ly = cy + (rc + labelOffset * 0.85) * Math.sin(angles[i]);
      ctx.font = `700 ${Math.round(30 * u)}px ${SANS}`;
      const tw = ctx.measureText(label).width;
      const pw = Math.min(280 * u, tw + 28 * u);
      const ph = 46 * u;
      ctx.fillStyle = pal.cardBg;
      ctx.strokeStyle = lit ? withAlpha(pal.accent, 0.65) : pal.cardBorder;
      ctx.lineWidth = 1.5 * u;
      roundRect(ctx, lx - pw / 2, ly - ph / 2, pw, ph, 14 * u);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pal.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label.slice(0, 18), lx, ly + 1 * u);
    });
    return;
  }

  if (cfg.pattern === "converge") {
    const out = cfg.direction === "out";
    const srcs = (cfg.sources && cfg.sources.length ? cfg.sources : ["Hook", "Visual", "Suara", "Motion"]).slice(0, 6);
    const rng = seededRng(42);
    const ring = R * 0.88;
    const angles = srcs.map((_, i) => -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / srcs.length);

    const count = 32;
    let arrived = 0;
    for (let k = 0; k < count; k++) {
      const si = k % srcs.length;
      const a = angles[si] + (rng() - 0.5) * 0.18;
      const x0 = cx + ring * Math.cos(a);
      const y0 = cy + ring * Math.sin(a);
      const s = 0.08 + (k / count) * 0.45;
      const dur = 0.28;
      const bend = (k % 2 === 0 ? 1 : -1) * (0.16 + rng() * 0.16);
      if (p >= s + dur) {
        arrived++;
        continue;
      }
      if (p < s) continue;

      const xa = out ? cx : x0;
      const ya = out ? cy : y0;
      const xb = out ? x0 : cx;
      const yb = out ? y0 : cy;
      const mx = (xa + xb) / 2 - (yb - ya) * bend;
      const my = (ya + yb) / 2 + (xb - xa) * bend;

      for (let tr = 0; tr < 4; tr++) {
        const q = easeInOut(prog(p - tr * 0.015, s, s + dur));
        if (q <= 0) continue;
        const inv = 1 - q;
        const px = inv * inv * xa + 2 * inv * q * mx + q * q * xb;
        const py = inv * inv * ya + 2 * inv * q * my + q * q * yb;
        ctx.beginPath();
        ctx.arc(px, py, (7.5 - tr * 1.3) * u, 0, Math.PI * 2);
        ctx.fillStyle = tr === 0 ? pal.accent : withAlpha(pal.accent, 0.4 - tr * 0.09);
        ctx.fill();
      }
    }

    // Perimeter nodes
    srcs.forEach((label, i) => {
      const x = cx + ring * Math.cos(angles[i]);
      const y = cy + ring * Math.sin(angles[i]);
      const q = easeOut(prog(p, 0.02 + i * 0.04, 0.16 + i * 0.04));
      ctx.save();
      ctx.globalAlpha = q;
      ctx.beginPath();
      ctx.arc(x, y, 20 * u, 0, Math.PI * 2);
      ctx.fillStyle = pal.ink;
      ctx.fill();

      ctx.font = `700 ${Math.round(28 * u)}px ${SANS}`;
      ctx.fillStyle = pal.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ly = y + (Math.sin(angles[i]) >= 0 ? 44 * u : -44 * u);
      ctx.fillText(label.slice(0, 14), clamp(x, 110 * u, width - 110 * u), ly);
      ctx.restore();
    });

    // Central growing/shrinking node
    const frac = arrived / count;
    const cr = (out ? lerp(96, 62, frac) : lerp(48, 102, Math.sqrt(frac))) * u;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = pal.ink;
    ctx.fill();

    if (cfg.center) {
      const f = fitText(ctx, cfg.center, cr * 1.55, 36 * u, 20 * u, 2, 800, SANS);
      ctx.font = `800 ${f.size}px ${SANS}`;
      ctx.fillStyle = pal.bgTop;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      f.lines.forEach((l, k) => {
        ctx.fillText(l, cx, cy + (k - (f.lines.length - 1) / 2) * f.size * 1.1);
      });
    }
    return;
  }

  // compare: 2-3 groups side-by-side proportional circles with animated count-up
  const groups = (
    cfg.groups && cfg.groups.length
      ? cfg.groups
      : [
          { label: "Opsi A", value: 40, unit: "dtk" },
          { label: "Opsi B", value: 8, unit: "dtk" },
        ]
  ).slice(0, 3);
  const n = groups.length;
  const vmax = Math.max(1, ...groups.map((g) => g.value));
  const cw = (width - 120 * u) / n;
  const maxR = Math.min(cw * 0.4, stageH * 0.28);
  const hl = typeof cfg.highlightIndex === "number" ? cfg.highlightIndex : n - 1;

  groups.forEach((gr, i) => {
    const gx = 60 * u + cw * (i + 0.5);
    const q = easeOut(prog(p, 0.1 + i * 0.14, 0.58 + i * 0.14));
    const r = Math.max(24 * u, maxR * Math.sqrt(Math.max(0.05, gr.value) / vmax));
    const isHi = i === hl;
    const sc = easeBack(clamp(q * 1.15));

    ctx.save();
    ctx.translate(gx, cy - 12 * u);
    ctx.scale(sc, sc);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = isHi ? pal.accent : pal.cardBg;
    ctx.strokeStyle = isHi ? pal.accent : pal.cardBorder;
    ctx.lineWidth = 3 * u;
    ctx.fill();
    ctx.stroke();

    const curVal = Math.round(gr.value * q);
    ctx.fillStyle = isHi ? pal.accentInk : pal.ink;
    ctx.font = `800 ${Math.round(Math.min(62, Math.max(34, r * 0.56)))}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(curVal), 0, gr.unit ? -10 * u : 0);
    if (gr.unit) {
      ctx.font = `600 ${Math.round(24 * u)}px ${SANS}`;
      ctx.fillText(gr.unit, 0, 26 * u);
    }
    ctx.restore();

    const lbl = fitText(ctx, gr.label, cw * 0.88, 34 * u, 22 * u, 2, 700, SANS);
    ctx.font = `700 ${lbl.size}px ${SANS}`;
    ctx.fillStyle = pal.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lbl.lines.forEach((ln, k) => {
      ctx.fillText(ln, gx, cy + maxR + 20 * u + k * lbl.size * 1.15);
    });
  });
}

/* ==================== ENGINE 2: MOTION CHART ==================== */
function formatCompact(val: number, prefix = "", suffix = ""): string {
  const neg = val < 0;
  const abs = Math.abs(val);
  let out: string;
  if (abs >= 1_000_000) out = `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  else if (abs >= 10_000) out = `${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  else out = Math.round(abs).toLocaleString("id-ID");
  return `${neg ? "-" : ""}${prefix}${out}${suffix}`;
}

function renderMotionChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  stageTop: number,
  stageBottom: number,
  cfg: MotionChartConfig,
  pal: MotionPalette,
  p: number
) {
  const u = width / 1080;
  const data = (cfg.data && cfg.data.length ? cfg.data : [{ label: "A", value: 100 }, { label: "B", value: 320 }]).slice(0, 8);
  const n = data.length;
  const vals = data.map((d) => Number(d.value) || 0);
  const vmax = Math.max(1, ...vals);
  const pre = cfg.prefix || "";
  const suf = cfg.suffix || "";

  // Auto growth callout
  let calloutText = cfg.callout;
  if (calloutText === undefined || calloutText === "auto") {
    const first = vals[0];
    const last = vals[n - 1];
    if (n >= 2 && first > 0 && last > 0 && Math.abs(last - first) > 0.001) {
      const ratio = last / first;
      if (ratio >= 2) calloutText = `↑ ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x`;
      else if (ratio > 1) calloutText = `↑ ${Math.round((ratio - 1) * 100)}%`;
      else calloutText = `↓ ${Math.round((1 - ratio) * 100)}%`;
    } else {
      calloutText = "";
    }
  }
  const isUp = !calloutText.startsWith("↓") && !calloutText.startsWith("-");
  const isGood = cfg.goodDirection === "down" ? !isUp : isUp;

  if (cfg.chartType === "stat_counter") {
    const cards = data.slice(0, 3);
    const gap = 24 * u;
    const cardW = width * 0.84;
    const cardH = Math.min(165 * u, (stageBottom - stageTop - gap * (cards.length - 1) - 40 * u) / cards.length);
    const startY = stageTop + ((stageBottom - stageTop) - (cards.length * cardH + (cards.length - 1) * gap)) / 2;

    cards.forEach((item, i) => {
      const q = easeOutExpo(prog(p, 0.06 + i * 0.14, 0.56 + i * 0.14));
      const y = startY + i * (cardH + gap);
      const isHi = (cfg.highlightIndex ?? cards.length - 1) === i;
      ctx.save();
      ctx.globalAlpha = clamp(q * 2);
      ctx.translate(0, (1 - q) * 28 * u);
      ctx.fillStyle = pal.cardBg;
      ctx.strokeStyle = isHi ? pal.accent : pal.cardBorder;
      ctx.lineWidth = (isHi ? 3 : 2) * u;
      roundRect(ctx, (width - cardW) / 2, y, cardW, cardH, 24 * u);
      ctx.fill();
      ctx.stroke();

      // Label left
      ctx.fillStyle = pal.muted;
      ctx.font = `600 ${Math.round(30 * u)}px ${SANS}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(item.label, (width - cardW) / 2 + 34 * u, y + cardH * 0.36);

      // Progress track bar inside card
      const trackX = (width - cardW) / 2 + 34 * u;
      const trackW = cardW - 68 * u;
      const trackY = y + cardH * 0.72;
      ctx.fillStyle = pal.faint;
      roundRect(ctx, trackX, trackY, trackW, 12 * u, 999);
      ctx.fill();
      ctx.fillStyle = isHi ? pal.accent : withAlpha(pal.ink, 0.6);
      roundRect(ctx, trackX, trackY, Math.max(12 * u, trackW * (item.value / vmax) * q), 12 * u, 999);
      ctx.fill();

      // Big counter right
      ctx.fillStyle = isHi ? pal.accent : pal.ink;
      ctx.font = `800 ${Math.round(52 * u)}px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(formatCompact(item.value * q, pre, suf), (width + cardW) / 2 - 34 * u, y + cardH * 0.38);
      ctx.restore();
    });
    return;
  }

  // Plot region strictly inside Safe Stage
  const px0 = width * 0.14;
  const px1 = width * 0.90;
  const pyTop = stageTop + 72 * u;
  const pyBot = stageBottom - 96 * u;
  const plotW = px1 - px0;
  const plotH = Math.max(180 * u, pyBot - pyTop);
  const yOf = (v: number) => pyBot - (clamp(v / (vmax * 1.12), 0, 1)) * plotH;

  // Horizontal gridlines
  for (let tIdx = 0; tIdx <= 3; tIdx++) {
    const ratio = tIdx / 3;
    const y = lerp(pyBot, pyTop, ratio);
    const q = easeOut(prog(p, tIdx * 0.04, 0.24 + tIdx * 0.04));
    ctx.strokeStyle = tIdx === 0 ? pal.soft : pal.faint;
    ctx.lineWidth = (tIdx === 0 ? 3 : 2) * u;
    ctx.beginPath();
    ctx.moveTo(px0, y);
    ctx.lineTo(px0 + plotW * q, y);
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = q;
    ctx.fillStyle = pal.muted;
    ctx.font = `600 ${Math.round(24 * u)}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(tIdx === 0 ? "0" : formatCompact(vmax * 1.12 * ratio, pre, ""), px0 - 16 * u, y);
    ctx.restore();
  }

  const hiIdx = typeof cfg.highlightIndex === "number" ? cfg.highlightIndex : n - 1;

  if (cfg.chartType === "bar") {
    const gapR = 0.34;
    const bw = Math.min(180 * u, plotW / (n + (n + 1) * gapR));
    const gapW = (plotW - n * bw) / (n + 1);
    const stag = n > 1 ? 0.42 / (n - 1) : 0;

    data.forEach((d, i) => {
      const q = easeOutExpo(prog(p, 0.08 + i * stag, 0.44 + i * stag));
      const x = px0 + gapW + i * (bw + gapW);
      const isHi = i === hiIdx;

      // Category label
      ctx.save();
      ctx.globalAlpha = clamp(q * 2.5);
      ctx.fillStyle = isHi ? pal.ink : pal.muted;
      ctx.font = `700 ${Math.round((n > 5 ? 24 : 30) * u)}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(d.label.slice(0, 12), x + bw / 2, pyBot + 20 * u);
      ctx.restore();

      if (q <= 0) return;
      const curV = d.value * q;
      const yt = yOf(curV);
      const barH = Math.max(4 * u, pyBot - yt);
      const r = Math.min(20 * u, bw * 0.35);

      const barGrad = ctx.createLinearGradient(0, yt, 0, pyBot);
      if (isHi) {
        barGrad.addColorStop(0, pal.accent);
        barGrad.addColorStop(1, withAlpha(pal.accent, 0.55));
      } else {
        barGrad.addColorStop(0, withAlpha(pal.ink, 0.78));
        barGrad.addColorStop(1, withAlpha(pal.ink, 0.32));
      }
      ctx.fillStyle = barGrad;
      roundRect(ctx, x, yt, bw, barH, [r, r, 0, 0]);
      ctx.fill();

      // Count-up numeral above bar
      ctx.fillStyle = isHi ? pal.accent : pal.ink;
      ctx.font = `800 ${Math.round((n > 5 ? 28 : 36) * u)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(formatCompact(curV, pre, suf), x + bw / 2, yt - 14 * u);
    });
  } else {
    // Line chart
    const lx = (i: number) => px0 + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const drawP = easeInOut(prog(p, 0.1, 0.68)) * (n - 1);
    const kMax = Math.floor(drawP);
    const frac = drawP - kMax;

    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= Math.min(kMax, n - 1); i++) {
      pts.push([lx(i), yOf(vals[i])]);
    }
    let headV = vals[Math.min(kMax, n - 1)];
    if (kMax < n - 1 && p >= 0.1) {
      headV = lerp(vals[kMax], vals[kMax + 1], frac);
      pts.push([lerp(lx(kMax), lx(kMax + 1), frac), yOf(headV)]);
    }

    // X-axis labels
    data.forEach((d, i) => {
      const a = clamp((drawP - i + 0.5) / 0.5);
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = pal.muted;
      ctx.font = `600 ${Math.round(25 * u)}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(d.label.slice(0, 10), lx(i), pyBot + 20 * u);
      ctx.restore();
    });

    if (pts.length > 1) {
      const areaGrad = ctx.createLinearGradient(0, pyTop, 0, pyBot);
      areaGrad.addColorStop(0, withAlpha(pal.accent, 0.35));
      areaGrad.addColorStop(1, withAlpha(pal.accent, 0.0));
      ctx.fillStyle = areaGrad;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pyBot);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(pts[pts.length - 1][0], pyBot);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 7 * u;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }

    if (pts.length > 0) {
      const [hx, hy] = pts[pts.length - 1];
      ctx.fillStyle = withAlpha(pal.accent, 0.32);
      ctx.beginPath();
      ctx.arc(hx, hy, 24 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.ink;
      ctx.beginPath();
      ctx.arc(hx, hy, 11 * u, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = pal.ink;
      ctx.font = `800 ${Math.round(38 * u)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(formatCompact(headV, pre, suf), clamp(hx, px0 + 60 * u, px1 - 60 * u), hy - 28 * u);
    }
  }

  // Growth callout badge (top-right of chart stage)
  if (calloutText) {
    const cq = prog(p, 0.62, 0.78);
    if (cq > 0) {
      const sc = 0.6 + 0.4 * easeBack(cq);
      const pillBg = isGood ? "#10b981" : "#f43f5e";
      const pillFg = isGood ? "#052014" : "#ffffff";
      ctx.save();
      ctx.translate(px1 - 92 * u, pyTop + 16 * u);
      ctx.scale(sc, sc);
      ctx.globalAlpha = clamp(cq * 2);
      ctx.font = `800 ${Math.round(34 * u)}px ${MONO}`;
      const tw = ctx.measureText(calloutText).width;
      const pw = tw + 44 * u;
      const ph = 64 * u;
      ctx.fillStyle = pillBg;
      roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 999);
      ctx.fill();
      ctx.fillStyle = pillFg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(calloutText, 0, 2 * u);
      ctx.restore();
    }
  }

  if (cfg.sourceNote) {
    ctx.fillStyle = pal.muted;
    ctx.font = `500 ${Math.round(22 * u)}px ${SANS}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`Sumber: ${cfg.sourceNote}`, px1, pyBot + 62 * u);
  }
}

/* ==================== ENGINE 3: TECH & UI CARDS ==================== */
function renderTechCards(
  ctx: CanvasRenderingContext2D,
  width: number,
  stageTop: number,
  stageBottom: number,
  cfg: TechCardsConfig,
  pal: MotionPalette,
  p: number
) {
  const u = width / 1080;
  const stageH = Math.max(260 * u, stageBottom - stageTop);

  if (cfg.layout === "terminal_code") {
    const lines = (cfg.codeLines && cfg.codeLines.length ? cfg.codeLines : ["// Ready"]).slice(0, 7);
    const boxW = width * 0.84;
    const headerH = 64 * u;
    const lineH = 68 * u;
    const boxH = Math.min(stageH * 0.90, headerH + lines.length * lineH + 48 * u);
    const x = (width - boxW) / 2;
    const y = stageTop + (stageH - boxH) / 2;
    const enter = easeOutExpo(prog(p, 0.04, 0.24));

    ctx.save();
    ctx.globalAlpha = enter;
    ctx.translate(0, (1 - enter) * 32 * u);

    // Terminal chrome
    ctx.fillStyle = pal.isLight ? "#141821" : "rgba(11, 14, 21, 0.95)";
    ctx.strokeStyle = withAlpha(pal.accent, 0.45);
    ctx.lineWidth = 2.5 * u;
    roundRect(ctx, x, y, boxW, boxH, 24 * u);
    ctx.fill();
    ctx.stroke();

    // Header bar
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, x, y, boxW, headerH, [24 * u, 24 * u, 0, 0]);
    ctx.fill();

    // Window dots
    const dotColors = ["#f43f5e", "#f59e0b", "#10b981"];
    dotColors.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x + 34 * u + i * 24 * u, y + headerH / 2, 7.5 * u, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `600 ${Math.round(25 * u)}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.codeTitle || "terminal.ts", width / 2, y + headerH / 2);

    // Staggered code lines
    const hl = typeof cfg.highlightLine === "number" ? cfg.highlightLine : -1;
    lines.forEach((code, idx) => {
      const lq = easeOut(prog(p, 0.16 + idx * 0.11, 0.34 + idx * 0.11));
      if (lq <= 0) return;
      const ly = y + headerH + 40 * u + idx * lineH;
      const isHl = idx === hl;

      ctx.save();
      ctx.globalAlpha = lq;
      if (isHl) {
        ctx.fillStyle = withAlpha(pal.accent, 0.2);
        ctx.fillRect(x + 12 * u, ly - lineH * 0.44, boxW - 24 * u, lineH * 0.88);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(x + 12 * u, ly - lineH * 0.44, 6 * u, lineH * 0.88);
      }

      ctx.font = `600 ${Math.round(27 * u)}px ${MONO}`;
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), x + 58 * u, ly);

      const visibleChars = Math.max(1, Math.ceil(code.length * clamp(lq * 1.25)));
      ctx.fillStyle = isHl ? pal.accent : "#f1f5f9";
      ctx.textAlign = "left";
      ctx.fillText(code.slice(0, visibleChars).slice(0, 42), x + 80 * u, ly);
      ctx.restore();
    });

    ctx.restore();
    return;
  }

  if (cfg.layout === "comparison_split") {
    const leftItems = (cfg.leftItems && cfg.leftItems.length ? cfg.leftItems : ["Manual & lama"]).slice(0, 4);
    const rightItems = (cfg.rightItems && cfg.rightItems.length ? cfg.rightItems : ["Otomatis & cepat"]).slice(0, 4);
    const gap = 24 * u;
    const colW = (width * 0.88 - gap) / 2;
    const colH = Math.min(stageH * 0.84, 520 * u);
    const y = stageTop + (stageH - colH) / 2;
    const leftX = (width - (colW * 2 + gap)) / 2;
    const rightX = leftX + colW + gap;

    const drawCol = (
      x: number,
      title: string,
      items: string[],
      positive: boolean,
      delay: number
    ) => {
      const cq = easeOutExpo(prog(p, delay, delay + 0.22));
      ctx.save();
      ctx.globalAlpha = cq;
      ctx.translate(0, (1 - cq) * 28 * u);

      ctx.fillStyle = pal.cardBg;
      ctx.strokeStyle = positive ? pal.accent : pal.cardBorder;
      ctx.lineWidth = (positive ? 3 : 2) * u;
      roundRect(ctx, x, y, colW, colH, 24 * u);
      ctx.fill();
      ctx.stroke();

      // Header pill
      ctx.fillStyle = positive ? pal.accent : "rgba(244, 63, 94, 0.2)";
      roundRect(ctx, x + 22 * u, y + 24 * u, colW - 44 * u, 56 * u, 14 * u);
      ctx.fill();

      ctx.fillStyle = positive ? pal.accentInk : "#f43f5e";
      ctx.font = `800 ${Math.round(28 * u)}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(title.slice(0, 18), x + colW / 2, y + 52 * u);

      items.forEach((txt, idx) => {
        const iq = easeOut(prog(p, delay + 0.14 + idx * 0.11, delay + 0.3 + idx * 0.11));
        if (iq <= 0) return;
        const iy = y + 124 * u + idx * 96 * u;
        ctx.save();
        ctx.globalAlpha = iq;
        ctx.fillStyle = positive ? pal.accent : "#f43f5e";
        ctx.font = `800 ${Math.round(30 * u)}px ${SANS}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(positive ? "✓" : "✕", x + 28 * u, iy);

        const fit = fitText(ctx, txt, colW - 92 * u, 28 * u, 20 * u, 2, 600, SANS);
        ctx.font = `600 ${fit.size}px ${SANS}`;
        ctx.fillStyle = pal.ink;
        fit.lines.forEach((ln, k) => {
          ctx.fillText(ln, x + 68 * u, iy + (k - (fit.lines.length - 1) / 2) * fit.size * 1.15);
        });
        ctx.restore();
      });

      ctx.restore();
    };

    drawCol(leftX, cfg.leftTitle || "Sebelum", leftItems, false, 0.04);
    drawCol(rightX, cfg.rightTitle || "Sesudah", rightItems, true, 0.18);
    return;
  }

  // staggered_steps (default)
  const cards = (
    cfg.cards && cfg.cards.length
      ? cfg.cards
      : [
          { badge: "01", title: "Langkah Pertama", detail: "Mulai dari satu ide inti." },
          { badge: "02", title: "Langkah Kedua", detail: "Sinkronkan suara & visual." },
        ]
  ).slice(0, 4);
  const gap = 22 * u;
  const cardW = width * 0.86;
  const cardH = Math.min(168 * u, (stageH - gap * (cards.length - 1) - 36 * u) / cards.length);
  const startY = stageTop + (stageH - (cards.length * cardH + (cards.length - 1) * gap)) / 2;

  cards.forEach((card, i) => {
    const q = easeOutExpo(prog(p, 0.06 + i * 0.14, 0.34 + i * 0.14));
    if (q <= 0) return;
    const x = (width - cardW) / 2;
    const y = startY + i * (cardH + gap);
    const sc = 0.94 + 0.06 * q;

    ctx.save();
    ctx.globalAlpha = q;
    ctx.translate(width / 2, y + cardH / 2 + (1 - q) * 28 * u);
    ctx.scale(sc, sc);
    ctx.translate(-width / 2, -(y + cardH / 2));

    ctx.fillStyle = pal.cardBg;
    ctx.strokeStyle = i === cards.length - 1 ? withAlpha(pal.accent, 0.72) : pal.cardBorder;
    ctx.lineWidth = 2.2 * u;
    roundRect(ctx, x, y, cardW, cardH, 22 * u);
    ctx.fill();
    ctx.stroke();

    // Left badge pill
    const badgeW = 74 * u;
    const badgeH = 74 * u;
    ctx.fillStyle = pal.accent;
    roundRect(ctx, x + 26 * u, y + (cardH - badgeH) / 2, badgeW, badgeH, 18 * u);
    ctx.fill();

    ctx.fillStyle = pal.accentInk;
    ctx.font = `800 ${Math.round(30 * u)}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(card.badge || `0${i + 1}`, x + 26 * u + badgeW / 2, y + cardH / 2 + 1 * u);

    // Title & detail
    const textX = x + 124 * u;
    const textMaxW = cardW - 152 * u;
    const titleF = fitText(ctx, card.title, textMaxW, 34 * u, 24 * u, 1, 800, SANS);
    ctx.font = `800 ${titleF.size}px ${SANS}`;
    ctx.fillStyle = pal.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(titleF.lines[0] || "", textX, y + (card.detail ? cardH * 0.36 : cardH * 0.5));

    if (card.detail) {
      const detF = fitText(ctx, card.detail, textMaxW, 25 * u, 19 * u, 2, 500, SANS);
      ctx.font = `500 ${detF.size}px ${SANS}`;
      ctx.fillStyle = pal.muted;
      detF.lines.forEach((ln, k) => {
        ctx.fillText(ln, textX, y + cardH * 0.66 + k * detF.size * 1.12);
      });
    }
    ctx.restore();
  });
}

/* ==================== ENGINE 4: STICK-FIGURE STORY ==================== */
function renderStickFigure(
  ctx: CanvasRenderingContext2D,
  width: number,
  stageTop: number,
  stageBottom: number,
  cfg: StickFigureConfig,
  pal: MotionPalette,
  p: number,
  sceneDurationSec: number
) {
  const u = width / 1080;
  const stageW = width * 0.88;
  const stageX = (width - stageW) / 2;
  const stageH = Math.max(320 * u, stageBottom - stageTop - 16 * u);
  const stageY = stageTop + 8 * u;
  const groundY = stageY + stageH * 0.84;
  const t = p * Math.max(3, sceneDurationSec);

  ctx.save();
  // Illustrated stage card frame
  roundRect(ctx, stageX, stageY, stageW, stageH, 28 * u);
  ctx.save();
  ctx.clip();

  // Setting backdrop
  const setting = cfg.setting || "office";
  const skyGrad = ctx.createLinearGradient(0, stageY, 0, groundY);
  if (setting === "street") {
    skyGrad.addColorStop(0, "#cfe9ff");
    skyGrad.addColorStop(1, "#f2f8ff");
  } else if (setting === "office") {
    skyGrad.addColorStop(0, "#eceef4");
    skyGrad.addColorStop(1, "#e2e6ef");
  } else if (setting === "classroom") {
    skyGrad.addColorStop(0, "#f5f1e6");
    skyGrad.addColorStop(1, "#ebe4d2");
  } else {
    skyGrad.addColorStop(0, "#f7f4ec");
    skyGrad.addColorStop(1, "#efeade");
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(stageX, stageY, stageW, stageH);

  // Subtle environment details
  if (setting === "office") {
    ctx.fillStyle = "#d3e4f5";
    ctx.strokeStyle = "#9aa7b8";
    ctx.lineWidth = 4 * u;
    roundRect(ctx, stageX + stageW * 0.34, stageY + stageH * 0.14, stageW * 0.32, stageH * 0.32, 10 * u);
    ctx.fill();
    ctx.stroke();
  } else if (setting === "classroom") {
    ctx.fillStyle = "#22463a";
    ctx.strokeStyle = "#8c6239";
    ctx.lineWidth = 8 * u;
    roundRect(ctx, stageX + stageW * 0.18, stageY + stageH * 0.12, stageW * 0.64, stageH * 0.3, 8 * u);
    ctx.fill();
    ctx.stroke();
  } else if (setting === "street") {
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.arc(stageX + stageW * 0.84, stageY + stageH * 0.16, 36 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // Floor
  ctx.fillStyle = setting === "street" ? "#cbd5e1" : "#ded7c8";
  ctx.fillRect(stageX, groundY, stageW, stageY + stageH - groundY);
  ctx.strokeStyle = "#1b1b1f";
  ctx.lineWidth = 4 * u;
  ctx.beginPath();
  ctx.moveTo(stageX, groundY);
  ctx.lineTo(stageX + stageW, groundY);
  ctx.stroke();

  // Props
  const ink = "#1b1b1f";
  for (const prop of cfg.props || []) {
    const px = stageX + clamp(prop.x, 0.08, 0.92) * stageW;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5 * u;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (prop.type === "desk" || prop.type === "table") {
      const tw = 150 * u;
      const th = 105 * u;
      ctx.fillStyle = "#c89b6e";
      roundRect(ctx, px - tw / 2, groundY - th, tw, 18 * u, 6 * u);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - tw * 0.4, groundY - th + 18 * u);
      ctx.lineTo(px - tw * 0.4, groundY);
      ctx.moveTo(px + tw * 0.4, groundY - th + 18 * u);
      ctx.lineTo(px + tw * 0.4, groundY);
      ctx.stroke();
      if (prop.type === "desk") {
        // Mini laptop on desk
        ctx.fillStyle = "#475569";
        ctx.beginPath();
        ctx.moveTo(px - 28 * u, groundY - th);
        ctx.lineTo(px + 26 * u, groundY - th);
        ctx.lineTo(px + 38 * u, groundY - th - 36 * u);
        ctx.lineTo(px - 16 * u, groundY - th - 36 * u);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (prop.type === "plant") {
      ctx.fillStyle = "#c26d4a";
      roundRect(ctx, px - 22 * u, groundY - 46 * u, 44 * u, 46 * u, 8 * u);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#22a06b";
      for (const ang of [-0.6, 0, 0.6]) {
        ctx.save();
        ctx.translate(px, groundY - 46 * u);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, -28 * u, 13 * u, 30 * u, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // Characters
  const figs = (cfg.figures && cfg.figures.length
    ? cfg.figures
    : [{ id: "a", kind: "person" as const, x: 0.3, label: "Kamu" }]
  ).slice(0, 3);
  const headPositions: Record<string, { x: number; y: number }> = {};
  const figScale = 0.66 * u;

  figs.forEach((fig, idx) => {
    // Active beat for figure
    const myBeats = (cfg.beats || []).filter((b) => b.who === fig.id).sort((a, b) => a.atSec - b.atSec);
    let curX = clamp(fig.x, 0.14, 0.86);
    let activeBeat = myBeats.find((b) => t >= b.atSec && t <= b.atSec + Math.max(0.4, b.durationSec));
    if (!activeBeat && myBeats.length > 0 && t > myBeats[myBeats.length - 1].atSec) {
      // Hold final payoff beat cleanly
      activeBeat = myBeats[myBeats.length - 1];
    }

    // Track walk transitions
    for (const b of myBeats) {
      if (b.action === "walk" && typeof b.toX === "number") {
        if (t >= b.atSec + b.durationSec) curX = clamp(b.toX, 0.14, 0.86);
        else if (t > b.atSec) curX = lerp(curX, clamp(b.toX, 0.14, 0.86), easeInOut(prog(t, b.atSec, b.atSec + b.durationSec)));
      }
    }

    const fx = stageX + curX * stageW;
    const facing = fig.facing === "left" ? -1 : fig.facing === "right" ? 1 : curX <= 0.5 ? 1 : -1;
    const act = activeBeat?.action || "talk";
    const beatU = activeBeat ? Math.max(0, t - activeBeat.atSec) : t;
    const breath = Math.sin(t * 3.8 + idx) * 3;

    ctx.save();
    ctx.translate(fx, groundY);
    ctx.scale(figScale * facing, figScale);

    // Shadow
    ctx.fillStyle = "rgba(25, 30, 40, 0.14)";
    ctx.beginPath();
    ctx.ellipse(0, 6, 72, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 13;

    if (fig.kind === "person") {
      const jump = act === "cheer" || act === "laugh" ? Math.abs(Math.sin(beatU * 7)) * 22 : 0;
      ctx.translate(0, -jump);

      const walkSwing = act === "walk" ? Math.sin(beatU * 10) * 32 : 0;
      // Legs
      ctx.beginPath();
      ctx.moveTo(0, -190);
      ctx.lineTo(-34 + walkSwing, 0);
      ctx.moveTo(0, -190);
      ctx.lineTo(34 - walkSwing, 0);
      ctx.stroke();

      // Torso
      ctx.beginPath();
      ctx.moveTo(0, -190);
      ctx.lineTo(0, -355 + breath);
      ctx.stroke();

      // Accent tie/scarf dot for character color identity
      if (fig.color) {
        ctx.fillStyle = fig.color;
        ctx.beginPath();
        ctx.arc(0, -328 + breath, 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Arms based on action
      const shY = -335 + breath;
      let lHand: [number, number] = [-54, -228];
      let rHand: [number, number] = [54, -228];
      if (act === "talk") {
        rHand = [82, -290 + Math.sin(beatU * 9) * 20];
      } else if (act === "point") {
        rHand = [125, -340];
      } else if (act === "think") {
        rHand = [26, -372];
      } else if (act === "idea") {
        rHand = [64, -445];
      } else if (act === "cheer" || act === "surprised") {
        lHand = [-86, -430];
        rHand = [86, -430];
      } else if (act === "wave") {
        rHand = [85 + Math.sin(beatU * 12) * 24, -425];
      } else if (act === "shrug") {
        lHand = [-84, -305];
        rHand = [84, -305];
      }

      ctx.beginPath();
      ctx.moveTo(0, shY);
      ctx.lineTo(lHand[0], lHand[1]);
      ctx.moveTo(0, shY);
      ctx.lineTo(rHand[0], rHand[1]);
      ctx.stroke();

      // Head
      const headY = -410 + breath;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, headY, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 11;
      ctx.stroke();

      // Eyes
      ctx.fillStyle = ink;
      ctx.lineWidth = 6;
      for (const ex of [-14, 18]) {
        if (act === "cheer" || act === "laugh") {
          ctx.beginPath();
          ctx.arc(ex + 6, headY - 4, 9, 1.15 * Math.PI, 1.85 * Math.PI);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(ex + 6, headY - 8, act === "surprised" ? 9 : 6.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Mouth
      if (act === "talk") {
        const mh = 6 + Math.abs(Math.sin(beatU * 14)) * 12;
        ctx.fillStyle = "#3a1a1e";
        ctx.beginPath();
        ctx.ellipse(8, headY + 20, 12, mh, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (act === "surprised") {
        ctx.beginPath();
        ctx.arc(8, headY + 22, 11, 0, Math.PI * 2);
        ctx.stroke();
      } else if (act === "sad") {
        ctx.beginPath();
        ctx.arc(8, headY + 30, 12, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(8, headY + 12, 14, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }

      // Idea bulb emote
      if (act === "idea" && !activeBeat?.say) {
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.arc(0, headY - 94, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      headPositions[fig.id] = { x: fx, y: groundY + (headY - 56 - jump) * figScale };
    } else {
      // Cute side-profile pet (cat/dog)
      const isCat = fig.kind === "cat";
      ctx.beginPath();
      ctx.moveTo(-48, -68);
      ctx.lineTo(-56, 0);
      ctx.moveTo(-36, -68);
      ctx.lineTo(-28, 0);
      ctx.moveTo(42, -68);
      ctx.lineTo(36, 0);
      ctx.moveTo(52, -68);
      ctx.lineTo(60, 0);
      ctx.moveTo(-50, -68);
      ctx.quadraticCurveTo(0, -82 + breath, 50, -68);
      ctx.stroke();

      // Tail
      ctx.beginPath();
      ctx.moveTo(-50, -68);
      ctx.quadraticCurveTo(-86, -102 + Math.sin(t * 8) * 14, -68, -138);
      ctx.stroke();

      // Head
      ctx.fillStyle = fig.color || (isCat ? "#f4a261" : "#d9a066");
      ctx.beginPath();
      ctx.arc(72, -96, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      headPositions[fig.id] = { x: fx + 50 * figScale * facing, y: groundY - 140 * figScale };
    }
    ctx.restore();

    // Foot label
    if (fig.label) {
      ctx.fillStyle = ink;
      ctx.font = `700 ${Math.round(25 * u)}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fig.label, fx, groundY + 14 * u);
    }

    // Speech / thought bubble
    if (activeBeat?.say && activeBeat.say.trim()) {
      const hp = headPositions[fig.id];
      const bq = easeBack(prog(t, activeBeat.atSec, activeBeat.atSec + 0.25));
      ctx.save();
      ctx.font = `700 ${Math.round(25 * u)}px ${SANS}`;
      const txt = activeBeat.say.trim().slice(0, 26);
      const tw = ctx.measureText(txt).width;
      const bw = Math.min(stageW * 0.44, tw + 40 * u);
      const bh = 58 * u;
      const bx = clamp(hp.x, stageX + bw / 2 + 16 * u, stageX + stageW - bw / 2 - 16 * u);
      const by = Math.max(stageY + 56 * u, hp.y - 46 * u);

      ctx.translate(bx, by);
      ctx.scale(bq, bq);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3.5 * u;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 22 * u);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, 0, 1 * u);
      ctx.restore();
    }
  });

  // Dotted arrow between figures
  if (cfg.arrow && headPositions[cfg.arrow.fromId] && headPositions[cfg.arrow.toId]) {
    const aq = easeOut(prog(t, cfg.arrow.atSec, cfg.arrow.atSec + 0.45));
    if (aq > 0) {
      const a = headPositions[cfg.arrow.fromId];
      const b = headPositions[cfg.arrow.toId];
      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - 72 * u;
      const arrowCol = pal.accent === "#ffe2b8" ? "#c95f3c" : pal.accent;
      ctx.save();
      ctx.strokeStyle = arrowCol;
      ctx.lineWidth = 4.5 * u;
      ctx.setLineDash([12 * u, 10 * u]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 10 * u);
      ctx.quadraticCurveTo(mx, my, lerp(a.x, b.x, aq), lerp(a.y - 10 * u, b.y - 10 * u, aq));
      ctx.stroke();
      ctx.setLineDash([]);

      if (cfg.arrow.label && aq > 0.6) {
        const apexY = 0.25 * (a.y - 10 * u) + 0.5 * my + 0.25 * (b.y - 10 * u);
        const badgeY = apexY - 28 * u;
        ctx.font = `700 ${Math.round(22 * u)}px ${MONO}`;
        const tw = ctx.measureText(cfg.arrow.label).width;
        const pw = tw + 26 * u;
        const ph = 36 * u;
        ctx.fillStyle = "rgba(255,255,255,0.96)";
        ctx.strokeStyle = arrowCol;
        ctx.lineWidth = 2.5 * u;
        roundRect(ctx, mx - pw / 2, badgeY - ph / 2, pw, ph, 999);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cfg.arrow.label, mx, badgeY + 1 * u);
      }
      ctx.restore();
    }
  }

  ctx.restore(); // end clip
  // Crisp outer stage border
  ctx.strokeStyle = pal.cardBorder;
  ctx.lineWidth = 3 * u;
  roundRect(ctx, stageX, stageY, stageW, stageH, 28 * u);
  ctx.stroke();
  ctx.restore();
}

/* ==================== ENGINE 5 STUB: 3D BREAKDOWN (M7) ==================== */
function renderBreakdownPreviewStub(
  ctx: CanvasRenderingContext2D,
  width: number,
  stageTop: number,
  stageBottom: number,
  spec: AiMotionSpec,
  pal: MotionPalette,
  p: number
) {
  const u = width / 1080;
  const cx = width / 2;
  const cy = (stageTop + stageBottom) / 2;
  const parts = spec.breakdown3d?.parts || [];
  const spread = easeOutExpo(prog(p, 0.15, 0.72));

  // Isometric stacked layers preview (upgraded to full offline Three.js WebGL in Milestone 7!)
  const count = Math.max(3, Math.min(6, parts.length || 5));
  for (let i = count - 1; i >= 0; i--) {
    const part = parts[i];
    const yOff = (i - (count - 1) / 2) * lerp(20 * u, 76 * u, spread);
    const w = 310 * u;
    const h = 110 * u;
    const y = cy + yOff;

    ctx.save();
    ctx.translate(cx, y);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, 0);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? withAlpha(pal.accent, 0.35) : pal.cardBg;
    ctx.strokeStyle = i === 0 ? pal.accent : pal.cardBorder;
    ctx.lineWidth = 2.5 * u;
    ctx.fill();
    ctx.stroke();

    if (part && spread > 0.35) {
      ctx.globalAlpha = clamp((spread - 0.35) / 0.4);
      ctx.fillStyle = pal.ink;
      ctx.font = `600 ${Math.round(24 * u)}px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`• ${part.name}`, w / 2 + 24 * u, 0);
    }
    ctx.restore();
  }
}

/* ==================== MAIN PUBLIC RENDERER ==================== */
export function renderAiMotionScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spec: AiMotionSpec,
  sceneProgress: number,
  sceneDurationSec: number,
  accentOverride?: string,
  settledPreview = false
) {
  const basePal = PALETTES[spec.theme] || PALETTES.carbon;
  const pal: MotionPalette =
    spec.theme === "carbon" && accentOverride
      ? { ...basePal, accent: accentOverride }
      : basePal;

  const p = settledPreview ? 0.85 : clamp(sceneProgress);

  // 1. Full-frame layered backdrop
  drawLayeredBackdrop(ctx, width, height, pal, p);

  // 2. Stage header inside safe zone (10%-19%)
  const stageTop = drawStageHeader(ctx, width, height, spec, pal, p);
  const stageBottom = spec.takeaway ? height * 0.535 : height * 0.578;

  // 3. Dispatch engine strictly inside Safe-Stage (stageTop -> stageBottom)
  switch (spec.engine) {
    case "flow_diagram":
      renderFlowDiagram(
        ctx,
        width,
        stageTop,
        stageBottom,
        spec.flow || { pattern: "flow", steps: ["Step 1", "Step 2", "Step 3"] },
        pal,
        p
      );
      break;
    case "motion_chart":
      renderMotionChart(
        ctx,
        width,
        stageTop,
        stageBottom,
        spec.chart || {
          chartType: "bar",
          data: [
            { label: "A", value: 120 },
            { label: "B", value: 380 },
          ],
        },
        pal,
        p
      );
      break;
    case "tech_cards":
      renderTechCards(
        ctx,
        width,
        stageTop,
        stageBottom,
        spec.techCards || { layout: "staggered_steps", cards: [{ badge: "01", title: "Poin Utama" }] },
        pal,
        p
      );
      break;
    case "stick_figure":
      renderStickFigure(
        ctx,
        width,
        stageTop,
        stageBottom,
        spec.stickFigure || {
          setting: "office",
          figures: [{ id: "a", kind: "person", x: 0.5, label: "Kamu" }],
          beats: [{ who: "a", action: "wave", atSec: 0, durationSec: 2, say: "Halo!" }],
        },
        pal,
        p,
        sceneDurationSec
      );
      break;
    case "breakdown_3d":
    default: {
      const rendered3d = renderBreakdown3DScene(
        ctx,
        width,
        height,
        stageTop,
        stageBottom,
        spec,
        pal,
        p,
        sceneDurationSec
      );
      if (!rendered3d) {
        renderBreakdownPreviewStub(ctx, width, stageTop, stageBottom, spec, pal, p);
      }
      break;
    }
  }

  // 4. Optional Takeaway pill (54.5%-58%, cleanly above 63%-74% Kinetic Captions)
  drawStageTakeaway(ctx, width, height, spec.takeaway, pal, p);
}
