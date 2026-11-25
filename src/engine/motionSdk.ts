import type { CustomDesignDirection, DesignFontFamily, SceneRole, WordTimestamp } from "../types/scene";

const FONT_STACKS: Record<DesignFontFamily, string> = {
  sans: '"Plus Jakarta Sans", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", Cambria, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  display: '"Inter", "Plus Jakarta Sans", "IBM Plex Sans", -apple-system, sans-serif',
};

export interface BeatRenderState {
  frame: number;
  fps: number;
  totalFrames: number;
  timeMs: number;
  durationMs: number;
  progress: number;
  width: number;
  height: number;
  u: number;
  text: string;
  title: string;
  role: SceneRole;
  words: WordTimestamp[];
  activeWordIndex: number;
  hasBrandLogo: boolean;
  brandLogoUrl?: string | null;
  design: CustomDesignDirection;
}

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  delay?: number;
  from?: number;
  to?: number;
}

export interface InterpolateOptions {
  easing?: (t: number) => number;
  extrapolateLeft?: "clamp" | "extend";
  extrapolateRight?: "clamp" | "extend";
}

const brandImageCache = new Map<string, HTMLImageElement>();

export function preloadBrandLogoImage(dataUrl?: string | null): HTMLImageElement | null {
  if (!dataUrl || typeof Image === "undefined") return null;
  const cached = brandImageCache.get(dataUrl);
  if (cached) return cached;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = dataUrl;
  brandImageCache.set(dataUrl, img);
  return img;
}

export async function ensureBrandLogoDecoded(dataUrl?: string | null): Promise<void> {
  const img = preloadBrandLogoImage(dataUrl);
  if (!img || img.complete) return;
  try {
    if (typeof img.decode === "function") {
      await img.decode();
    } else {
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }
  } catch {
    // ignore invalid image data URL
  }
}

export function clamp(v: number, min = 0, max = 1): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function seededRng(seed: number): () => number {
  let s = (Math.floor(seed) || 1) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withAlpha(hexOrRgba: string, alpha: number): string {
  const a = clamp(alpha);
  if (typeof hexOrRgba !== "string" || !hexOrRgba.trim()) {
    return `rgba(56,229,157,${a.toFixed(3)})`;
  }
  const trimmed = hexOrRgba.trim();
  if (trimmed.startsWith("#")) {
    const clean = trimmed.slice(1);
    const full =
      clean.length === 3
        ? clean
            .split("")
            .map((c) => c + c)
            .join("")
        : clean.slice(0, 6);
    const n = parseInt(full, 16);
    if (!Number.isFinite(n)) return `rgba(56,229,157,${a.toFixed(3)})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
  }
  if (/^rgba?\(/i.test(trimmed)) {
    return trimmed.replace(
      /rgba?\(([^,]+),([^,]+),([^,)]+)(,[^)]+)?\)/i,
      `rgba($1,$2,$3,${a.toFixed(3)})`
    );
  }
  return trimmed;
}

function cubicBezierSolver(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const derivX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  return (t: number) => {
    const target = clamp(t);
    if (target <= 0) return 0;
    if (target >= 1) return 1;
    let u = target;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(u) - target;
      const d = derivX(u);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      u = clamp(u - err / d);
    }
    return sampleY(u);
  };
}

export const ease = {
  linear: (t: number) => clamp(t),
  outCubic: (t: number) => 1 - Math.pow(1 - clamp(t), 3),
  inCubic: (t: number) => Math.pow(clamp(t), 3),
  inOutCubic: (t: number) => {
    const c = clamp(t);
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
  },
  outExpo: (t: number) => {
    const c = clamp(t);
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  },
  inExpo: (t: number) => {
    const c = clamp(t);
    return c === 0 ? 0 : Math.pow(2, 10 * c - 10);
  },
  inOutQuart: (t: number) => {
    const c = clamp(t);
    return c < 0.5 ? 8 * c * c * c * c : 1 - Math.pow(-2 * c + 2, 4) / 2;
  },
  backOut: (t: number, overshoot = 1.70158) => {
    const c = clamp(t);
    const c3 = overshoot + 1;
    return 1 + c3 * Math.pow(c - 1, 3) + overshoot * Math.pow(c - 1, 2);
  },
  anticipation: (t: number, pull = 0.16) => {
    const c = clamp(t);
    if (c < 0.22) {
      const k = c / 0.22;
      return -pull * Math.sin(k * Math.PI);
    }
    const k = (c - 0.22) / 0.78;
    return 1 - Math.pow(1 - k, 3) * (1 + pull * 0.4);
  },
  bezier: cubicBezierSolver,
};

/**
 * Analytical damped harmonic oscillator spring — identical physics model to Remotion's `spring()`.
 * Purely deterministic for any fractional frame!
 */
export function spring(frame: number, fps = 30, cfg: SpringConfig = {}): number {
  const stiffness = Math.max(10, cfg.stiffness ?? 180);
  const damping = Math.max(1, cfg.damping ?? 18);
  const mass = Math.max(0.1, cfg.mass ?? 1);
  const delay = cfg.delay ?? 0;
  const from = cfg.from ?? 0;
  const to = cfg.to ?? 1;

  const localFrame = frame - delay;
  if (localFrame <= 0) return from;

  const t = localFrame / Math.max(1, fps);
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  let normalized = 1;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * omega0 * t);
    normalized =
      1 - env * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  } else if (Math.abs(zeta - 1) < 1e-4) {
    const env = Math.exp(-omega0 * t);
    normalized = 1 - env * (1 + omega0 * t);
  } else {
    const r1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
    const c1 = r2 / (r2 - r1);
    const c2 = -r1 / (r2 - r1);
    normalized = 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
  }

  return from + (to - from) * normalized;
}

/**
 * Remotion-compatible value remapping with optional easing and clamp/extend extrapolation.
 */
export function interpolate(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number],
  options: InterpolateOptions = {}
): number {
  const [in0, in1] = inputRange;
  const [out0, out1] = outputRange;
  const span = in1 - in0;
  if (Math.abs(span) < 1e-8) return out1;

  let t = (value - in0) / span;
  const exLeft = options.extrapolateLeft ?? "clamp";
  const exRight = options.extrapolateRight ?? "clamp";
  if (t < 0 && exLeft === "clamp") t = 0;
  if (t > 1 && exRight === "clamp") t = 1;

  const eased = options.easing ? options.easing(clamp(t)) : t;
  return out0 + (out1 - out0) * (options.easing ? eased : t);
}

export function stagger(
  index: number,
  delayFrames: number,
  frame: number,
  fps = 30,
  cfg: SpringConfig = {}
): number {
  return spring(frame, fps, {
    ...cfg,
    delay: (cfg.delay ?? 0) + Math.max(0, index) * Math.max(0, delayFrames),
  });
}

/** Area-conserving Disney squash & stretch pulse centered around impactProgress 0..1 */
export function squash(impactProgress: number, strength = 0.18): { sx: number; sy: number } {
  const p = clamp(impactProgress);
  const pulse = Math.sin(p * Math.PI) * Math.exp(-p * 2.2) * strength;
  const sx = 1 + pulse;
  const sy = 1 / Math.max(0.5, sx);
  return { sx, sy };
}

export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
  } else {
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
}

export function resolveDesignFont(
  design: CustomDesignDirection,
  kind: "heading" | "body" | "mono" | "display" | "serif" = "heading"
): string {
  if (kind === "mono") return FONT_STACKS.mono;
  if (kind === "display") return FONT_STACKS.display;
  if (kind === "serif") return FONT_STACKS.serif;
  if (kind === "body") return FONT_STACKS[design.typography.bodyFont] ?? FONT_STACKS.sans;
  return FONT_STACKS[design.typography.headingFont] ?? FONT_STACKS.sans;
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  minPx = 22,
  fontStack = FONT_STACKS.sans,
  weight = 800
): number {
  let size = startPx;
  while (size > minPx) {
    ctx.font = `${weight} ${Math.round(size)}px ${fontStack}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minPx;
}

export function wordHit(state: BeatRenderState, keyword: string): number {
  const target = String(keyword || "").toLowerCase().trim();
  if (!target) return clamp(state.progress * 2);
  const found = state.words.find((w) => w.word.toLowerCase().includes(target));
  if (!found) {
    return clamp((state.progress - 0.18) / 0.25);
  }
  if (state.timeMs < found.startMs) return 0;
  const span = Math.max(240, found.endMs - found.startMs);
  return clamp((state.timeMs - found.startMs) / span);
}

/**
 * Create the bound Motion SDK `M` object passed into every freeform `renderBeat(ctx, state, M)`.
 */
export function createMotionSdk(state: BeatRenderState) {
  const design = state.design;
  const P = design.palette;
  const u = state.u;

  const font = (
    kind: "heading" | "body" | "mono" | "display" | "serif" = "heading",
    weight = 700,
    sizePx = 36
  ) => `${weight} ${Math.max(10, Math.round(sizePx))}px ${resolveDesignFont(design, kind)}`;

  const cornerRadius = (base: number) => {
    if (design.visualStyle.cornerStyle === "sharp") return Math.min(6 * u, base * 0.25);
    if (design.visualStyle.cornerStyle === "pill") return base * 1.45;
    return base;
  };

  return {
    spring,
    interpolate,
    stagger,
    clamp,
    lerp,
    rng: seededRng,
    withAlpha,
    ease,
    squash,
    wordHit,
    font,
    drawRoundRect,
    wrapText,
    fitText: (
      ctx: CanvasRenderingContext2D,
      text: string,
      maxWidth: number,
      startPx: number,
      minPx = 22,
      kind: "heading" | "body" | "mono" | "display" | "serif" = "heading",
      weight = 800
    ) => fitText(ctx, text, maxWidth, startPx, minPx, resolveDesignFont(design, kind), weight),

    withCamera(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      opts: { zoom?: number; panX?: number; panY?: number; rotateDeg?: number; shake?: number } = {},
      drawFn: () => void
    ) {
      const zoom = Number.isFinite(opts.zoom) ? Math.max(0.5, Math.min(2.4, opts.zoom!)) : 1;
      const panX = Number.isFinite(opts.panX) ? opts.panX! : 0;
      const panY = Number.isFinite(opts.panY) ? opts.panY! : 0;
      const rot = Number.isFinite(opts.rotateDeg) ? (opts.rotateDeg! * Math.PI) / 180 : 0;
      const shakeAmp = Number.isFinite(opts.shake) ? Math.min(30 * st.u, Math.max(0, opts.shake!)) : 0;
      const sx = shakeAmp > 0 ? Math.sin(st.frame * 2.9) * shakeAmp : 0;
      const sy = shakeAmp > 0 ? Math.cos(st.frame * 3.7) * shakeAmp * 0.7 : 0;

      ctx.save();
      ctx.translate(st.width / 2 + panX + sx, st.height / 2 + panY + sy);
      if (rot !== 0) ctx.rotate(rot);
      if (zoom !== 1) ctx.scale(zoom, zoom);
      ctx.translate(-st.width / 2, -st.height / 2);
      try {
        drawFn();
      } finally {
        ctx.restore();
      }
    },

    drawBackdrop(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      opts: {
        pattern?: string;
        glowX?: number;
        glowY?: number;
        glowColor?: string;
        glowAlpha?: number;
        vignette?: boolean;
      } = {}
    ) {
      const { width, height, progress } = st;
      const grad = ctx.createLinearGradient(0, 0, width * 0.4, height);
      grad.addColorStop(0, P.bgTop);
      grad.addColorStop(1, P.bgBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      const pattern = opts.pattern || design.visualStyle.backgroundPattern || "grid";
      const lineColor = design.isLight ? "rgba(18,22,28,0.065)" : "rgba(255,255,255,0.05)";
      ctx.save();
      if (pattern === "grid") {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, 1.5 * st.u);
        const step = 92 * st.u;
        const shift = (progress * 32 * st.u) % step;
        for (let x = 0; x <= width; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = -step; y <= height + step; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y + shift);
          ctx.lineTo(width, y + shift);
          ctx.stroke();
        }
      } else if (pattern === "dots") {
        ctx.fillStyle = lineColor;
        const step = 62 * st.u;
        const shift = (progress * 26 * st.u) % step;
        for (let x = step * 0.5; x < width; x += step) {
          for (let y = -step; y < height + step; y += step) {
            ctx.beginPath();
            ctx.arc(x, y + shift, 2.8 * st.u, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (pattern === "diagonal") {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2 * st.u;
        const step = 88 * st.u;
        const shift = (progress * 44 * st.u) % step;
        for (let x = -height; x <= width + height; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + shift, 0);
          ctx.lineTo(x - height * 0.45 + shift, height);
          ctx.stroke();
        }
      } else if (pattern === "aurora") {
        const g1 = ctx.createRadialGradient(
          width * (0.25 + 0.25 * Math.sin(progress * Math.PI)),
          height * 0.25,
          20 * st.u,
          width * 0.3,
          height * 0.28,
          width * 0.72
        );
        g1.addColorStop(0, withAlpha(P.accentPrimary, design.isLight ? 0.18 : 0.24));
        g1.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, width, height);

        const g2 = ctx.createRadialGradient(
          width * (0.75 - 0.2 * Math.cos(progress * Math.PI)),
          height * 0.62,
          20 * st.u,
          width * 0.72,
          height * 0.62,
          width * 0.68
        );
        g2.addColorStop(0, withAlpha(P.accentSecondary, design.isLight ? 0.14 : 0.20));
        g2.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, width, height);
      } else if (pattern === "paper_grain") {
        ctx.fillStyle = design.isLight ? "rgba(92,74,48,0.045)" : "rgba(255,255,255,0.035)";
        const r = seededRng(77);
        for (let i = 0; i < 160; i++) {
          ctx.fillRect(r() * width, r() * height, 3 * st.u, 3 * st.u);
        }
      }

      // Soft ambient spotlight
      const gx = opts.glowX ?? width * (0.5 + 0.14 * Math.sin(progress * Math.PI * 1.4));
      const gy = opts.glowY ?? height * 0.36;
      const gColor = opts.glowColor || P.accentPrimary;
      const gAlpha = opts.glowAlpha ?? (design.isLight ? 0.14 : 0.20);
      const orb = ctx.createRadialGradient(gx, gy, 10 * st.u, gx, gy, width * 0.64);
      orb.addColorStop(0, withAlpha(gColor, gAlpha));
      orb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = orb;
      ctx.fillRect(0, 0, width, height);

      if (opts.vignette) {
        const vig = ctx.createRadialGradient(
          width / 2,
          height / 2,
          width * 0.35,
          width / 2,
          height / 2,
          height * 0.72
        );
        vig.addColorStop(0, "rgba(0,0,0,0)");
        vig.addColorStop(1, design.isLight ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.38)");
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    },

    drawBrandLogo(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      cx: number,
      cy: number,
      maxW: number,
      maxH: number,
      alpha = 1
    ): boolean {
      const img = preloadBrandLogoImage(st.brandLogoUrl);
      if (!img || !img.complete || img.naturalWidth <= 0) return false;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.save();
      ctx.globalAlpha *= clamp(alpha);
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
      return true;
    },

    drawCard(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      x: number,
      y: number,
      w: number,
      h: number,
      opts: { radius?: number; highlighted?: boolean; fill?: string; border?: string } = {}
    ) {
      const rad = cornerRadius(opts.radius ?? 26 * st.u);
      const style = design.visualStyle.cardStyle || "glass";

      ctx.save();
      if (style === "brutalist") {
        ctx.fillStyle = opts.highlighted ? P.accentPrimary : withAlpha(P.textPrimary, design.isLight ? 0.86 : 0.36);
        drawRoundRect(ctx, x + 9 * st.u, y + 9 * st.u, w, h, rad);
        ctx.fill();
      } else if (style === "neon" && opts.highlighted) {
        ctx.shadowColor = P.accentPrimary;
        ctx.shadowBlur = 24 * st.u;
      } else {
        ctx.shadowColor = design.isLight ? "rgba(15,23,42,0.10)" : "rgba(0,0,0,0.38)";
        ctx.shadowBlur = 24 * st.u;
        ctx.shadowOffsetY = 10 * st.u;
      }

      ctx.fillStyle = opts.fill || P.surfaceBg;
      drawRoundRect(ctx, x, y, w, h, rad);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle =
        opts.border ||
        (style === "brutalist"
          ? P.textPrimary
          : opts.highlighted
            ? P.accentPrimary
            : P.surfaceBorder);
      ctx.lineWidth = (style === "brutalist" ? 3.5 : style === "hairline" ? 1.5 : opts.highlighted ? 2.8 : 2) * st.u;
      ctx.stroke();
      ctx.restore();
    },

    drawPill(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      text: string,
      cx: number,
      cy: number,
      opts: {
        fill?: string;
        textColor?: string;
        fontSize?: number;
        padX?: number;
        padY?: number;
        kind?: "heading" | "body" | "mono" | "display" | "serif";
      } = {}
    ) {
      const fs = opts.fontSize ?? 26 * st.u;
      const padX = opts.padX ?? 26 * st.u;
      const padY = opts.padY ?? 13 * st.u;
      ctx.save();
      ctx.font = font(opts.kind ?? "mono", 700, fs);
      const tw = ctx.measureText(text).width;
      const bw = Math.min(st.width * 0.84, tw + padX * 2);
      const bh = fs + padY * 2;
      const rx = cx - bw / 2;
      const ry = cy - bh / 2;
      const r = design.visualStyle.cornerStyle === "sharp" ? 6 * st.u : bh / 2;

      if (design.visualStyle.cardStyle === "brutalist") {
        ctx.fillStyle = P.textPrimary;
        drawRoundRect(ctx, rx + 5 * st.u, ry + 5 * st.u, bw, bh, r);
        ctx.fill();
      }
      ctx.fillStyle = opts.fill || P.accentPrimary;
      drawRoundRect(ctx, rx, ry, bw, bh, r);
      ctx.fill();
      if (design.visualStyle.cardStyle === "brutalist") {
        ctx.strokeStyle = P.textPrimary;
        ctx.lineWidth = 2.5 * st.u;
        ctx.stroke();
      }
      ctx.fillStyle = opts.textColor || P.accentInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy + 1 * st.u, bw - padX);
      ctx.restore();
    },

    drawMaskedText(
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      progress: number,
      opts: {
        font?: string;
        color?: string;
        align?: CanvasTextAlign;
        direction?: "up" | "down" | "left";
        maxWidth?: number;
        lineHeight?: number;
      } = {}
    ) {
      const p = clamp(progress);
      const e = ease.outExpo(p);
      const f = opts.font || font("heading", 800, 62 * u);
      const maxW = opts.maxWidth ?? state.width * 0.84;
      ctx.save();
      ctx.font = f;
      const sizeMatch = /(\d+)px/.exec(f);
      const fs = sizeMatch ? Number(sizeMatch[1]) : 56 * u;
      const lh = opts.lineHeight ?? fs * 1.18;
      const lines = wrapText(ctx, text, maxW);
      const totalH = lines.length * lh;
      const align = opts.align ?? "center";
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = opts.color || P.textPrimary;

      lines.forEach((line, idx) => {
        const ly = y - totalH / 2 + (idx + 0.5) * lh;
        const lineP = clamp((p * (1 + lines.length * 0.14)) - idx * 0.14);
        const le = ease.outExpo(lineP);
        ctx.save();
        ctx.beginPath();
        const clipX = align === "center" ? x - maxW * 0.55 : align === "right" ? x - maxW : x - 8 * u;
        ctx.rect(clipX, ly - lh * 0.58, maxW * 1.12, lh * 1.16);
        ctx.clip();
        const dx = opts.direction === "left" ? (1 - le) * 80 * u : 0;
        const dy = opts.direction === "down" ? -(1 - le) * lh : opts.direction === "left" ? 0 : (1 - le) * lh;
        ctx.globalAlpha *= clamp(lineP * 1.8);
        ctx.fillText(line, x + dx, ly + dy, maxW);
        ctx.restore();
      });
      void e;
      ctx.restore();
    },

    drawKineticHeadline(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      text: string,
      cx: number,
      cy: number,
      opts: {
        maxWidth?: number;
        fontSize?: number;
        color?: string;
        accentColor?: string;
        highlightWord?: string;
        delayFrames?: number;
      } = {}
    ) {
      const maxW = opts.maxWidth ?? st.width * 0.82;
      const baseFs = opts.fontSize ?? 78 * st.u;
      const stack = resolveDesignFont(design, "heading");
      ctx.save();
      ctx.font = `900 ${Math.round(baseFs)}px ${stack}`;
      const lines = wrapText(ctx, text, maxW);
      const fs = lines.length > 3 ? Math.max(42 * st.u, baseFs * 0.78) : baseFs;
      ctx.font = `900 ${Math.round(fs)}px ${stack}`;
      const wrapped = wrapText(ctx, text, maxW).slice(0, 4);
      const lh = fs * 1.16;
      const totalH = wrapped.length * lh;
      const hlNeedle = (opts.highlightWord || "").toLowerCase().trim();
      const stepDelay = opts.delayFrames ?? 3;

      let wordCursor = 0;
      wrapped.forEach((line, li) => {
        const ly = cy - totalH / 2 + (li + 0.5) * lh;
        const lineWords = line.split(/\s+/);
        const spaceW = ctx.measureText(" ").width;
        const widths = lineWords.map((w) => ctx.measureText(w).width);
        const lineW = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, lineWords.length - 1);
        let curX = cx - lineW / 2;

        lineWords.forEach((w, wi) => {
          const wWidth = widths[wi];
          const wCx = curX + wWidth / 2;
          const sp = spring(st.frame, st.fps, {
            stiffness: 240,
            damping: 19,
            delay: wordCursor * stepDelay,
          });
          const isHl =
            (hlNeedle && w.toLowerCase().includes(hlNeedle)) ||
            (!hlNeedle && li === wrapped.length - 1 && wi === lineWords.length - 1);

          ctx.save();
          ctx.translate(wCx, ly + (1 - sp) * 34 * st.u);
          const sc = 0.84 + sp * 0.16;
          ctx.scale(sc, sc);
          ctx.globalAlpha *= clamp(sp * 1.4);

          if (isHl) {
            const sweep = ease.outExpo(clamp((st.frame - wordCursor * stepDelay - 2) / 10));
            ctx.fillStyle = withAlpha(opts.accentColor || P.accentPrimary, 0.92);
            drawRoundRect(
              ctx,
              -wWidth / 2 - 12 * st.u,
              -fs * 0.54,
              (wWidth + 24 * st.u) * sweep,
              fs * 1.08,
              cornerRadius(14 * st.u)
            );
            ctx.fill();
          }

          ctx.fillStyle = isHl ? P.accentInk : opts.color || P.textPrimary;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(w, 0, 0);
          ctx.restore();

          curX += wWidth + spaceW;
          wordCursor++;
        });
      });
      ctx.restore();
    },

    drawSvgPath(
      ctx: CanvasRenderingContext2D,
      pathData: string,
      opts: {
        x?: number;
        y?: number;
        scale?: number;
        stroke?: string;
        fill?: string;
        lineWidth?: number;
        strokeProgress?: number;
        glowColor?: string;
        glowBlur?: number;
      } = {}
    ) {
      if (typeof Path2D === "undefined" || !pathData) return;
      try {
        const path = new Path2D(pathData);
        const sc = opts.scale ?? 1;
        ctx.save();
        ctx.translate(opts.x ?? 0, opts.y ?? 0);
        if (sc !== 1) ctx.scale(sc, sc);
        if (opts.glowColor && (opts.glowBlur ?? 0) > 0) {
          ctx.shadowColor = opts.glowColor;
          ctx.shadowBlur = opts.glowBlur!;
        }
        if (opts.fill) {
          ctx.fillStyle = opts.fill;
          ctx.fill(path);
        }
        if (opts.stroke) {
          ctx.strokeStyle = opts.stroke;
          ctx.lineWidth = (opts.lineWidth ?? 4 * u) / Math.max(0.1, sc);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          const sp = opts.strokeProgress !== undefined ? clamp(opts.strokeProgress) : 1;
          if (sp < 0.999) {
            const approxLen = 1400;
            ctx.setLineDash([approxLen * sp, approxLen]);
          }
          ctx.stroke(path);
        }
        ctx.restore();
      } catch {
        // Ignore invalid SVG path data gracefully
      }
    },

    drawLiquidWave(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      fillRatio: number,
      colorTop: string,
      colorBottom: string,
      phase = 0,
      amplitude = 10 * u
    ) {
      const ratio = clamp(fillRatio);
      if (ratio <= 0.002) return;
      const surfaceY = y + h * (1 - ratio);
      const amp = Math.min(amplitude, h * ratio * 0.45, h * (1 - ratio) * 0.6 + 4 * u);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, surfaceY);
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const px = x + (w * i) / steps;
        const wave =
          Math.sin((i / steps) * Math.PI * 2.4 + phase) * amp +
          Math.cos((i / steps) * Math.PI * 4.2 - phase * 1.3) * (amp * 0.32);
        ctx.lineTo(px, surfaceY + wave);
      }
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(x, surfaceY - amp, x, y + h);
      grad.addColorStop(0, colorTop);
      grad.addColorStop(1, colorBottom);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    },

    drawBrowserWindow(
      ctx: CanvasRenderingContext2D,
      st: BeatRenderState,
      x: number,
      y: number,
      w: number,
      h: number,
      opts: { url: string; typedProgress?: number; contentFn?: (cx: number, cy: number, cw: number, ch: number) => void }
    ) {
      const barH = 68 * st.u;
      const rad = cornerRadius(24 * st.u);
      ctx.save();
      // Outer shell
      this.drawCard(ctx, st, x, y, w, h, { radius: rad, highlighted: true });

      // Top bar
      ctx.save();
      drawRoundRect(ctx, x, y, w, h, rad);
      ctx.clip();
      ctx.fillStyle = design.isLight ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(x, y, w, barH);
      ctx.strokeStyle = P.surfaceBorder;
      ctx.lineWidth = 1.5 * st.u;
      ctx.beginPath();
      ctx.moveTo(x, y + barH);
      ctx.lineTo(x + w, y + barH);
      ctx.stroke();

      // Traffic lights
      const dotY = y + barH / 2;
      const dotColors = ["#FF5F57", "#FEBC2E", "#28C840"];
      dotColors.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x + 28 * st.u + i * 24 * st.u, dotY, 7 * st.u, 0, Math.PI * 2);
        ctx.fill();
      });

      // URL bar
      const urlX = x + 106 * st.u;
      const urlW = w - 130 * st.u;
      const urlH = 38 * st.u;
      ctx.fillStyle = design.isLight ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.34)";
      drawRoundRect(ctx, urlX, dotY - urlH / 2, urlW, urlH, 10 * st.u);
      ctx.fill();

      const fullUrl = String(opts.url || "");
      const tp = clamp(opts.typedProgress ?? 1);
      const shown = fullUrl.slice(0, Math.max(1, Math.round(fullUrl.length * tp)));
      const blink = tp < 0.99 || Math.floor(st.frame / 12) % 2 === 0;
      ctx.fillStyle = P.textPrimary;
      ctx.font = font("mono", 600, 22 * st.u);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(shown + (blink && tp < 0.99 ? "|" : ""), urlX + 16 * st.u, dotY + 1 * st.u, urlW - 30 * st.u);

      if (typeof opts.contentFn === "function") {
        opts.contentFn(x, y + barH, w, h - barH);
      }
      ctx.restore();
      ctx.restore();
    },

    drawCursor(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      opts: { clickProgress?: number; scale?: number; color?: string; rippleColor?: string } = {}
    ) {
      const cp = clamp(opts.clickProgress ?? 0);
      const sc = (opts.scale ?? 1) * (1 - Math.sin(cp * Math.PI) * 0.18);
      ctx.save();
      if (cp > 0.01 && cp < 0.99) {
        ctx.strokeStyle = withAlpha(opts.rippleColor || P.accentPrimary, 1 - cp);
        ctx.lineWidth = (4 - cp * 2.5) * u;
        ctx.beginPath();
        ctx.arc(x, y, (14 + cp * 62) * u, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.translate(x, y);
      ctx.scale(sc * u, sc * u);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 42);
      ctx.lineTo(12, 31);
      ctx.lineTo(22, 48);
      ctx.lineTo(30, 44);
      ctx.lineTo(20, 27);
      ctx.lineTo(34, 27);
      ctx.closePath();
      ctx.fillStyle = opts.color || "#FFFFFF";
      ctx.strokeStyle = "#0A0D12";
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },

    drawCounter(
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      opts: {
        from?: number;
        to: number;
        progress: number;
        prefix?: string;
        suffix?: string;
        decimals?: number;
        fontSize?: number;
        color?: string;
        kind?: "heading" | "body" | "mono" | "display" | "serif";
      }
    ) {
      const from = opts.from ?? 0;
      const p = ease.outExpo(clamp(opts.progress));
      const val = lerp(from, opts.to, p);
      const dec = opts.decimals ?? 0;
      const formatted =
        dec > 0
          ? val.toFixed(dec).replace(".", ",")
          : Math.round(val).toLocaleString("id-ID");
      const text = `${opts.prefix ?? ""}${formatted}${opts.suffix ?? ""}`;
      ctx.save();
      ctx.font = font(opts.kind ?? "display", 900, opts.fontSize ?? 112 * u);
      ctx.fillStyle = opts.color || P.accentPrimary;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy, state.width * 0.86);
      ctx.restore();
    },

    drawProgressRing(
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      radius: number,
      progress: number,
      opts: { color?: string; trackColor?: string; lineWidth?: number; label?: string; labelColor?: string } = {}
    ) {
      const lw = opts.lineWidth ?? 18 * u;
      const p = clamp(progress);
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = opts.trackColor || P.surfaceBorder;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = opts.color || P.accentPrimary;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();

      if (opts.label) {
        ctx.fillStyle = opts.labelColor || P.textPrimary;
        ctx.font = font("display", 900, radius * 0.44);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(opts.label, cx, cy, radius * 1.6);
      }
      ctx.restore();
    },

    drawParticles(
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      count: number,
      progress: number,
      opts: {
        seed?: number;
        color?: string;
        color2?: string;
        spread?: number;
        size?: number;
        shape?: "circle" | "star" | "rect";
      } = {}
    ) {
      const p = clamp(progress);
      if (p <= 0.01 || p >= 0.99) return;
      const safeCount = Math.min(48, Math.max(1, Math.round(count)));
      const rand = seededRng(opts.seed ?? 42);
      const spread = opts.spread ?? 240 * u;
      const baseSize = opts.size ?? 10 * u;
      const alpha = Math.sin(p * Math.PI);

      ctx.save();
      for (let i = 0; i < safeCount; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = (0.35 + rand() * 0.65) * spread * ease.outExpo(p);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist + p * p * 45 * u;
        const sz = baseSize * (0.55 + rand() * 0.8) * (1 - p * 0.35);
        ctx.fillStyle = withAlpha(
          i % 2 === 0 ? opts.color || P.accentPrimary : opts.color2 || P.accentSecondary,
          alpha * 0.9
        );
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle + p * 4);
        if (opts.shape === "rect") {
          ctx.fillRect(-sz / 2, -sz * 0.35, sz, sz * 0.7);
        } else if (opts.shape === "star") {
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const r = k % 2 === 0 ? sz : sz * 0.42;
            const a = (k * Math.PI) / 4;
            if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, sz * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    },

    drawSpotlight(
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      radius: number,
      color?: string,
      alpha = 0.28
    ) {
      ctx.save();
      const grad = ctx.createRadialGradient(cx, cy, 4 * u, cx, cy, Math.max(10, radius));
      grad.addColorStop(0, withAlpha(color || P.accentPrimary, alpha));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(10, radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };
}
