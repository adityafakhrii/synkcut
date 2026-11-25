import type {
  CustomDesignDirection,
  SceneItem,
  WordTimestamp,
} from "../types/scene";
import {
  createMotionSdk,
  ease,
  spring,
  type BeatRenderState,
} from "./motionSdk";

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\b(window|document|globalThis|self|top|parent|frames|location|navigator|localStorage|sessionStorage|indexedDB|cookie|ownerDocument|defaultView)\b/,
    reason: "Akses DOM/browser global tidak diizinkan di sandbox motion.",
  },
  {
    re: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts)\b|\bimport\s*\(/,
    reason: "Akses jaringan/modul eksternal tidak diizinkan di sandbox motion.",
  },
  {
    re: /\b(eval|Function|Reflect|Proxy|__TAURI__|__TAURI_INTERNALS__|process|require)\b/,
    reason: "Eksekusi dinamis / API sistem tidak diizinkan di sandbox motion.",
  },
  {
    re: /\b(__proto__|prototype|setPrototypeOf|defineProperty|setTimeout|setInterval|requestAnimationFrame)\b|\.\s*constructor\b|\[\s*['"`]constructor['"`]\s*\]|\bconstructor\s*\(/,
    reason: "Timer/prototype tampering tidak diizinkan di renderer frame deterministik.",
  },
];

export interface BeatValidationResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

type CompiledRenderFn = (
  ctx: CanvasRenderingContext2D,
  state: BeatRenderState,
  M: ReturnType<typeof createMotionSdk>,
  __guard: () => void
) => void;

const compiledCache = new Map<string, { fn: CompiledRenderFn | null; error?: string }>();

export function defaultDesignFromTheme(
  theme: string | undefined,
  accentColor: string
): CustomDesignDirection {
  const isLight = theme === "paper" || theme === "mint";
  return {
    name: "Synkcut Custom Motion",
    summary: "Desain prosedural kontras tinggi.",
    artDirectionNotes: "Jaga keterbacaan tipografi dan ritme gerak mulus.",
    isLight,
    palette: {
      bgTop: isLight ? "#F7F3EA" : "#0A0E16",
      bgBottom: isLight ? "#ECE4D3" : "#141D2E",
      surfaceBg: isLight ? "rgba(255,255,255,0.90)" : "rgba(22,29,44,0.88)",
      surfaceBorder: isLight ? "rgba(18,22,28,0.16)" : "rgba(255,255,255,0.16)",
      textPrimary: isLight ? "#12151C" : "#F5F7FA",
      textSecondary: isLight ? "#4B5563" : "#9BA6BA",
      accentPrimary: accentColor || "#38E59D",
      accentSecondary: "#F59E0B",
      accentInk: isLight ? "#FFFFFF" : "#07140E",
    },
    typography: {
      headingFont: "sans",
      bodyFont: "sans",
      captionFont: "sans",
      captionUppercase: true,
    },
    visualStyle: {
      backgroundPattern: isLight ? "paper_grain" : "aurora",
      cardStyle: "glass",
      cornerStyle: "rounded",
      captionLook: isLight ? "custom_pill" : "bold_outline",
    },
    pacing: "snappy",
    preferredMotion: "static_clean",
    preferredTransition: "pop_zoom",
    preferredEngines: ["custom_code"],
  };
}

export function validateBeatCodeSafety(code: string): BeatValidationResult {
  const trimmed = String(code || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Kode animasi beat kosong." };
  }
  if (trimmed.length > 24000) {
    return { ok: false, error: "Kode animasi terlalu panjang (>24KB)." };
  }
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.re.test(trimmed)) {
      return { ok: false, error: rule.reason };
    }
  }
  return { ok: true };
}

/**
 * Balanced-parenthesis & string-aware loop guard instrumenter:
 * Safely injects `__guard();` into `for (...)`, `while (...)`, and `do { ... }` loops
 * even when headers contain nested function calls like `for (let i = 0; i < Math.min(a, b); i++)`,
 * while skipping string/template literals and comments!
 */
export function instrumentLoopGuards(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;
  const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

  while (i < n) {
    const ch = code[i];

    // Skip single-line comments
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i + 2);
      if (nl === -1) {
        out += code.slice(i);
        break;
      }
      out += code.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }
    // Skip block comments
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) {
        out += code.slice(i);
        break;
      }
      out += code.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    // Skip string & template literals
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const sc = code[i];
        out += sc;
        i++;
        if (sc === "\\" && i < n) {
          out += code[i];
          i++;
          continue;
        }
        if (sc === quote) break;
      }
      continue;
    }

    // Check keyword boundary for `for`, `while`, or `do`
    const prev = i > 0 ? code[i - 1] : "";
    if (!isIdentChar(prev) && prev !== ".") {
      const kw = code.startsWith("while", i)
        ? "while"
        : code.startsWith("for", i)
          ? "for"
          : code.startsWith("do", i)
            ? "do"
            : null;
      if (kw && !isIdentChar(code[i + kw.length] || "")) {
        if (kw === "do") {
          let j = i + 2;
          while (j < n && /\s/.test(code[j])) j++;
          if (code[j] === "{") {
            out += code.slice(i, j + 1) + " __guard();";
            i = j + 1;
            continue;
          }
        } else {
          let j = i + kw.length;
          while (j < n && /\s/.test(code[j])) j++;
          if (code[j] === "(") {
            let depth = 0;
            let k = j;
            while (k < n) {
              const kc = code[k];
              if (kc === "'" || kc === '"' || kc === "`") {
                const q = kc;
                k++;
                while (k < n) {
                  if (code[k] === "\\") {
                    k += 2;
                    continue;
                  }
                  if (code[k] === q) {
                    k++;
                    break;
                  }
                  k++;
                }
                continue;
              }
              if (kc === "(") depth++;
              else if (kc === ")") {
                depth--;
                if (depth === 0) {
                  k++;
                  break;
                }
              }
              k++;
            }
            if (depth === 0) {
              let m = k;
              while (m < n && /\s/.test(code[m])) m++;
              if (code[m] === "{") {
                out += code.slice(i, m + 1) + " __guard();";
                i = m + 1;
                continue;
              }
            }
          }
        }
      }
    }

    out += ch;
    i++;
  }
  return out;
}

function createSafeCanvasContextProxy(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): CanvasRenderingContext2D {
  const safeCanvasDim = Object.freeze({ width, height });
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === "canvas") return safeCanvasDim;
      if (prop === "constructor" || prop === "__proto__") return undefined;
      const val = Reflect.get(target, prop, target);
      return typeof val === "function" ? val.bind(target) : val;
    },
    set(target, prop, value) {
      if (prop === "canvas" || prop === "__proto__" || prop === "constructor") return false;
      return Reflect.set(target, prop, value, target);
    },
  });
}

function compileBeatCode(code: string): { fn: CompiledRenderFn | null; error?: string } {
  const trimmed = String(code || "").trim();
  if (!trimmed) return { fn: null, error: "Kode kosong." };

  const cached = compiledCache.get(trimmed);
  if (cached) return cached;

  const safety = validateBeatCodeSafety(trimmed);
  if (!safety.ok) {
    const res = { fn: null, error: safety.error };
    compiledCache.set(trimmed, res);
    return res;
  }

  try {
    const guarded = instrumentLoopGuards(trimmed);
    const body = `"use strict";\n${guarded}`;
    // Shadow browser globals inside parameter scope as defense-in-depth
    const rawFn = new Function(
      "ctx",
      "state",
      "M",
      "__guard",
      "window",
      "document",
      "globalThis",
      "fetch",
      "localStorage",
      "Reflect",
      "Proxy",
      "Function",
      body
    ) as (
      ctx: CanvasRenderingContext2D,
      state: BeatRenderState,
      M: ReturnType<typeof createMotionSdk>,
      __guard: () => void,
      ...shadowed: undefined[]
    ) => void;

    const wrapped: CompiledRenderFn = (ctx, state, M, __guard) => {
      const safeCtx = createSafeCanvasContextProxy(ctx, state.width, state.height);
      rawFn(
        safeCtx,
        state,
        M,
        __guard,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    };

    if (compiledCache.size > 120) {
      const firstKey = compiledCache.keys().next().value;
      if (firstKey) compiledCache.delete(firstKey);
    }
    const res = { fn: wrapped };
    compiledCache.set(trimmed, res);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const res = { fn: null, error: `Syntax error: ${msg}` };
    compiledCache.set(trimmed, res);
    return res;
  }
}

export function buildBeatRenderState(params: {
  width: number;
  height: number;
  scene: SceneItem;
  progress: number;
  fps: number;
  allWords: WordTimestamp[];
  accentColor: string;
  customDesign?: CustomDesignDirection | null;
  brandLogoUrl?: string | null;
}): BeatRenderState {
  const { width, height, scene, fps, allWords, accentColor, customDesign, brandLogoUrl } = params;
  const durationMs = Math.max(800, scene.endMs - scene.startMs);
  const clampedP = Math.max(0, Math.min(1, Number.isFinite(params.progress) ? params.progress : 0));
  const timeMs = clampedP * durationMs;
  const totalFrames = Math.max(1, (durationMs / 1000) * fps);
  const frame = clampedP * totalFrames;

  const localWords: WordTimestamp[] = allWords
    .filter((w) => w.endMs > scene.startMs && w.startMs < scene.endMs)
    .map((w) => ({
      word: w.word,
      startMs: Math.max(0, w.startMs - scene.startMs),
      endMs: Math.max(0, w.endMs - scene.startMs),
    }));

  let activeWordIndex = -1;
  for (let i = 0; i < localWords.length; i++) {
    if (timeMs >= localWords[i].startMs && timeMs <= localWords[i].endMs) {
      activeWordIndex = i;
      break;
    }
  }

  const design =
    customDesign ?? defaultDesignFromTheme(scene.aiMotion?.theme, accentColor);

  return {
    frame,
    fps,
    totalFrames,
    timeMs,
    durationMs,
    progress: clampedP,
    width,
    height,
    u: width / 1080,
    text: scene.text || "",
    title: scene.aiMotion?.title || scene.text.split(/\s+/).slice(0, 4).join(" ") || "Motion",
    role: scene.role || "body",
    words: localWords,
    activeWordIndex,
    hasBrandLogo: Boolean(brandLogoUrl),
    brandLogoUrl: brandLogoUrl ?? null,
    design,
  };
}

/**
 * Zero-Dummy Safe Fallback: NEVER renders a smartphone, laptop, or "Masukan/Proses Inti"!
 * Only renders a clean, animated brand-styled kinetic composition of the beat's REAL text.
 */
export function renderPureKineticFallback(
  ctx: CanvasRenderingContext2D,
  state: BeatRenderState
) {
  const M = createMotionSdk(state);
  const { width, height, u, frame, fps, design, title, text, role } = state;
  const P = design.palette;

  M.drawBackdrop(ctx, state, { vignette: true });

  const zoom = 1.0 + 0.03 * ease.outCubic(state.progress);
  M.withCamera(ctx, state, { zoom }, () => {
    const badgeSp = spring(frame, fps, { stiffness: 220, damping: 18 });
    const roleLabel =
      role === "hook" ? "SOROTAN UTAMA" : role === "cta" ? "LANGKAH SELANJUTNYA" : title.toUpperCase().slice(0, 26);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, badgeSp));
    M.drawPill(ctx, state, roleLabel, width / 2, height * 0.21 - (1 - badgeSp) * 28 * u, {
      fill: P.accentPrimary,
      textColor: P.accentInk,
      fontSize: 24 * u,
    });
    ctx.restore();

    // Accent sweeping bar
    const lineW = width * 0.34 * ease.outExpo(Math.min(1, state.progress * 3));
    ctx.fillStyle = P.accentSecondary;
    M.drawRoundRect(ctx, width / 2 - lineW / 2, height * 0.275, lineW, 6 * u, 3 * u);
    ctx.fill();

    // Real beat text rendered with kinetic spring word reveal (zero dummy copy!)
    const displayCopy = text.trim() || title;
    const words = displayCopy.split(/\s+/).filter(Boolean);
    const keyWord =
      words.find((w) => /\d|%|rp|jt|rb|gratis|baru|cepat/i.test(w)) ||
      words[Math.max(0, words.length - 1)] ||
      "";

    M.drawKineticHeadline(ctx, state, displayCopy, width / 2, height * 0.45, {
      maxWidth: width * 0.82,
      fontSize: words.length > 10 ? 58 * u : 72 * u,
      highlightWord: keyWord,
      delayFrames: 2,
    });

    if (state.hasBrandLogo) {
      M.drawBrandLogo(ctx, state, width / 2, height * 0.64, 200 * u, 74 * u, badgeSp);
    }
  });
}

/**
 * Renders a `custom_code` beat deterministically on `ctx` with full sandbox isolation & zero-crash fallback.
 */
export function renderFreeformBeat(
  ctx: CanvasRenderingContext2D,
  state: BeatRenderState,
  code: string
): { ok: boolean; error?: string } {
  const trimmed = String(code || "").trim();
  if (!trimmed) {
    renderPureKineticFallback(ctx, state);
    return { ok: true };
  }

  const compiled = compileBeatCode(trimmed);
  if (!compiled.fn) {
    renderPureKineticFallback(ctx, state);
    return { ok: false, error: compiled.error };
  }

  const M = createMotionSdk(state);
  let loopCounter = 0;
  const __guard = () => {
    loopCounter += 1;
    if (loopCounter > 8000) {
      throw new Error("Loop melebihi batas aman (8000 iterasi per frame).");
    }
  };

  ctx.save();
  try {
    compiled.fn(ctx, state, M, __guard);
    ctx.restore();
    return { ok: true };
  } catch (err) {
    ctx.restore();
    renderPureKineticFallback(ctx, state);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Offscreen 4-Frame Deliver-and-Verify Sandbox Validator!
 * Renders 4 sample timestamps on a lightweight 270x480 canvas to verify:
 * 1) Zero compile/runtime/infinite-loop errors
 * 2) Non-blank hero visual region (real distinct pixels painted)
 * 3) Real animation delta between early and mid-late frames
 */
export function verifyBeatCodeOffscreen(params: {
  code: string;
  scene: SceneItem;
  allWords: WordTimestamp[];
  accentColor: string;
  customDesign?: CustomDesignDirection | null;
  brandLogoUrl?: string | null;
}): BeatValidationResult {
  const { code, scene, allWords, accentColor, customDesign, brandLogoUrl } = params;

  const safety = validateBeatCodeSafety(code);
  if (!safety.ok) return safety;

  const compiled = compileBeatCode(code);
  if (!compiled.fn) {
    return { ok: false, error: compiled.error || "Gagal kompilasi kode beat." };
  }

  if (typeof document === "undefined") {
    return { ok: true };
  }

  const w = 270;
  const h = 480;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: true };

  const samplePoints = [0.08, 0.36, 0.68, 0.92];
  const snapshots: Uint8ClampedArray[] = [];

  for (const p of samplePoints) {
    ctx.clearRect(0, 0, w, h);
    const state = buildBeatRenderState({
      width: w,
      height: h,
      scene,
      progress: p,
      fps: 30,
      allWords,
      accentColor,
      customDesign,
      brandLogoUrl,
    });

    const M = createMotionSdk(state);
    let loopCount = 0;
    const __guard = () => {
      loopCount += 1;
      if (loopCount > 8000) {
        throw new Error("Infinite loop terdeteksi (>8000 iterasi).");
      }
    };

    try {
      ctx.save();
      compiled.fn(ctx, state, M, __guard);
      ctx.restore();
    } catch (err) {
      ctx.restore();
      return {
        ok: false,
        error: `Runtime error pada t=${Math.round(p * 100)}%: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Sample hero region (y: 12%..70%, x: 8%..92%)
    const rx = Math.round(w * 0.08);
    const ry = Math.round(h * 0.12);
    const rw = Math.round(w * 0.84);
    const rh = Math.round(h * 0.58);
    const imgData = ctx.getImageData(rx, ry, rw, rh).data;
    snapshots.push(new Uint8ClampedArray(imgData));
  }

  // Check mid frame (index 2 -> t=0.68) for non-blank visual contrast
  const mid = snapshots[2];
  let minLum = 255;
  let maxLum = 0;
  let opaqueCount = 0;
  for (let i = 0; i < mid.length; i += 16) {
    const a = mid[i + 3];
    if (a > 20) opaqueCount++;
    const lum = 0.299 * mid[i] + 0.587 * mid[i + 1] + 0.114 * mid[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  if (opaqueCount < 20) {
    return { ok: false, error: "Frame kosong/transparan (lupa menggambar backdrop & elemen visual)." };
  }
  if (maxLum - minLum < 16) {
    return { ok: false, error: "Frame terlihat polos 1 warna tanpa elemen ilustrasi/tipografi yang kontras." };
  }

  // Check animation delta between t=0.08 and t=0.68
  const early = snapshots[0];
  let diffPixels = 0;
  let totalSampled = 0;
  for (let i = 0; i < mid.length; i += 24) {
    totalSampled++;
    const d =
      Math.abs(early[i] - mid[i]) +
      Math.abs(early[i + 1] - mid[i + 1]) +
      Math.abs(early[i + 2] - mid[i + 2]);
    if (d > 24) diffPixels++;
  }
  const warning =
    totalSampled > 0 && diffPixels / totalSampled < 0.005
      ? "Gerakan antar frame sangat minim."
      : undefined;

  return { ok: true, warning };
}
