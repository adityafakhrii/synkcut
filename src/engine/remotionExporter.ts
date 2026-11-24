import type { SynkcutProject } from "../types/scene";
import { getProjectDurationMs } from "./sampleProject";

export interface RemotionExportFile {
  relativePath: string;
  content: string;
}

/**
 * Generates a self-contained, ready-to-render Remotion (.tsx) project from any Synkcut project
 * so power users can run `npm install && npx remotion render` locally whenever desired.
 */
export function buildRemotionProjectFiles(project: SynkcutProject): RemotionExportFile[] {
  const fps = project.meta.fps || 30;
  const durationMs = Math.max(2000, getProjectDurationMs(project));
  const durationInFrames = Math.max(30, Math.ceil((durationMs / 1000) * fps));
  const safeName = project.meta.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "synkcut-video";

  const hasAudio = Boolean(project.voiceover?.audioPath);
  const audioExt = project.voiceover?.audioPath?.split(".").pop()?.toLowerCase() || "wav";
  const audioFileName = hasAudio ? `voiceover.${audioExt}` : null;

  const packageJson = JSON.stringify(
    {
      name: `synkcut-${safeName}`,
      version: "1.0.0",
      private: true,
      scripts: {
        start: "remotion studio",
        build: "remotion render src/index.ts SynkcutMain out/video.mp4",
      },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        remotion: "^4.0.240",
      },
      devDependencies: {
        "@remotion/cli": "^4.0.240",
        typescript: "^5.7.0",
        "@types/react": "^19.0.0",
      },
    },
    null,
    2
  );

  const tsconfigJson = JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2
  );

  const readmeMd = `# ${project.meta.name} — Synkcut Remotion Export

Proyek Remotion ini diekspor otomatis dari **Synkcut v2.0** (9:16 · 1080×1920 · ${fps}fps · ${project.scenes.length} beat).

## Cara Menjalankan & Render MP4

\`\`\`bash
npm install
npm start       # Buka Remotion Studio preview
npm run build   # Render 1080x1920 MP4 ke out/video.mp4
\`\`\`
`;

  const indexTs = `import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
`;

  const rootTsx = `import React from "react";
import { Composition } from "remotion";
import { SynkcutComposition } from "./SynkcutComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SynkcutMain"
      component={SynkcutComposition}
      durationInFrames={${durationInFrames}}
      fps={${fps}}
      width={1080}
      height={1920}
    />
  );
};
`;

  // Strip local absolute paths for clean portable projectData.ts
  const portableProject = {
    ...project,
    voiceover: {
      ...project.voiceover,
      audioPath: audioFileName,
    },
  };

  const projectDataTs = `export const PROJECT_DATA = ${JSON.stringify(portableProject, null, 2)} as const;\n`;

  const compositionTsx = `import React, { useEffect, useRef } from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PROJECT_DATA } from "./projectData";
import { renderBeatAtFrame } from "./runtimeRenderer";

export const SynkcutComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderBeatAtFrame(ctx, width, height, frame, fps, PROJECT_DATA);
  }, [frame, width, height, fps]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <canvas ref={canvasRef} width={width} height={height} style={{ width: "100%", height: "100%" }} />
      ${audioFileName ? `<Audio src={staticFile("${audioFileName}")} />` : ""}
    </AbsoluteFill>
  );
};
`;

  const runtimeRendererTs = `import { spring as remotionSpring, interpolate as remotionInterpolate } from "remotion";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const ease = {
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
  inExpo: (t: number) => (clamp(t) === 0 ? 0 : Math.pow(2, 10 * clamp(t) - 10)),
  inOutQuart: (t: number) => {
    const c = clamp(t);
    return c < 0.5 ? 8 * c * c * c * c : 1 - Math.pow(-2 * c + 2, 4) / 2;
  },
  backOut: (t: number, s = 1.70158) => {
    const c = clamp(t);
    return 1 + (s + 1) * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2);
  },
  anticipation: (t: number, pull = 0.16) => {
    const c = clamp(t);
    if (c < 0.22) return -pull * Math.sin((c / 0.22) * Math.PI);
    return 1 - Math.pow(1 - (c - 0.22) / 0.78, 3);
  },
  bezier: () => (t: number) => 1 - Math.pow(1 - clamp(t), 3),
};

function withAlpha(hex: string, a: number): string {
  const safe = clamp(a);
  if (!hex || !hex.startsWith("#")) return \`rgba(56,229,157,\${safe})\`;
  const c = hex.slice(1);
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c.slice(0, 6);
  const n = parseInt(full, 16);
  return \`rgba(\${(n >> 16) & 255},\${(n >> 8) & 255},\${n & 255},\${safe})\`;
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
}

function rng(seed: number) {
  let s = (Math.floor(seed) || 1) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderBeatAtFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  globalFrame: number,
  fps: number,
  project: any
) {
  const timeMs = (globalFrame / fps) * 1000;
  const scene =
    project.scenes.find((s: any) => timeMs >= s.startMs && timeMs < s.endMs) ||
    project.scenes[project.scenes.length - 1];
  if (!scene) return;

  const durationMs = Math.max(800, scene.endMs - scene.startMs);
  const localMs = Math.max(0, timeMs - scene.startMs);
  const progress = clamp(localMs / durationMs);
  const localFrame = (localMs / 1000) * fps;
  const u = width / 1080;
  const design = project.globalStyle?.customDesign || {
    name: "Synkcut",
    isLight: false,
    palette: {
      bgTop: "#0B0F17",
      bgBottom: "#151D2B",
      surfaceBg: "rgba(22,29,44,0.88)",
      surfaceBorder: "rgba(255,255,255,0.16)",
      textPrimary: "#F5F7FA",
      textSecondary: "#9BA6BA",
      accentPrimary: project.globalStyle?.accentColor || "#38E59D",
      accentSecondary: "#F59E0B",
      accentInk: "#07140E",
    },
    typography: { headingFont: "sans", bodyFont: "sans", captionFont: "sans", captionUppercase: true },
    visualStyle: { backgroundPattern: "grid", cardStyle: "glass", cornerStyle: "rounded", captionLook: "bold_outline" },
  };
  const P = design.palette;
  const localWords = (project.voiceover?.words || [])
    .filter((w: any) => w.endMs > scene.startMs && w.startMs < scene.endMs)
    .map((w: any) => ({ word: w.word, startMs: w.startMs - scene.startMs, endMs: w.endMs - scene.startMs }));

  const state = {
    frame: localFrame,
    fps,
    totalFrames: (durationMs / 1000) * fps,
    timeMs: localMs,
    durationMs,
    progress,
    width,
    height,
    u,
    text: scene.text || "",
    title: scene.aiMotion?.title || "",
    role: scene.role || "body",
    words: localWords,
    activeWordIndex: localWords.findIndex((w: any) => localMs >= w.startMs && localMs <= w.endMs),
    hasBrandLogo: false,
    design,
  };

  const font = (_kind = "heading", weight = 700, sz = 36) =>
    \`\${weight} \${Math.round(sz)}px "IBM Plex Sans", system-ui, sans-serif\`;

  const M: any = {
    spring: (f: number, _fps = fps, cfg: any = {}) => {
      const sp = remotionSpring({
        frame: Math.max(0, f - (cfg.delay || 0)),
        fps: _fps,
        config: { stiffness: cfg.stiffness ?? 180, damping: cfg.damping ?? 18, mass: cfg.mass ?? 1 },
      });
      return lerp(cfg.from ?? 0, cfg.to ?? 1, sp);
    },
    interpolate: (v: number, inp: [number, number], out: [number, number], opts: any = {}) =>
      remotionInterpolate(v, inp, out, {
        extrapolateLeft: opts.extrapolateLeft || "clamp",
        extrapolateRight: opts.extrapolateRight || "clamp",
        easing: opts.easing,
      }),
    stagger: (idx: number, delayF: number, f: number, _fps = fps, cfg: any = {}) =>
      M.spring(f, _fps, { ...cfg, delay: (cfg.delay || 0) + idx * delayF }),
    clamp,
    lerp,
    rng,
    withAlpha,
    ease,
    squash: (p: number, s = 0.18) => {
      const k = Math.sin(clamp(p) * Math.PI) * Math.exp(-clamp(p) * 2.2) * s;
      return { sx: 1 + k, sy: 1 / (1 + k) };
    },
    wordHit: (st: any, kw: string) => {
      const f = st.words.find((w: any) => w.word.toLowerCase().includes(String(kw || "").toLowerCase()));
      return f ? clamp((st.timeMs - f.startMs) / Math.max(240, f.endMs - f.startMs)) : clamp(st.progress * 2);
    },
    font,
    drawRoundRect,
    wrapText: (c: CanvasRenderingContext2D, txt: string, maxW: number) => {
      const ws = String(txt || "").split(/\\s+/);
      const lines: string[] = [];
      let cur = ws[0] || "";
      for (let i = 1; i < ws.length; i++) {
        if (c.measureText(cur + " " + ws[i]).width <= maxW) cur += " " + ws[i];
        else { lines.push(cur); cur = ws[i]; }
      }
      if (cur) lines.push(cur);
      return lines;
    },
    fitText: (c: CanvasRenderingContext2D, txt: string, maxW: number, startPx: number, minPx = 22) => {
      let sz = startPx;
      while (sz > minPx) {
        c.font = font("heading", 800, sz);
        if (c.measureText(txt).width <= maxW) return sz;
        sz -= 2;
      }
      return minPx;
    },
    withCamera: (c: CanvasRenderingContext2D, st: any, opts: any, fn: () => void) => {
      c.save();
      c.translate(st.width / 2 + (opts?.panX || 0), st.height / 2 + (opts?.panY || 0));
      if (opts?.rotateDeg) c.rotate((opts.rotateDeg * Math.PI) / 180);
      if (opts?.zoom) c.scale(opts.zoom, opts.zoom);
      c.translate(-st.width / 2, -st.height / 2);
      fn();
      c.restore();
    },
    drawBackdrop: (c: CanvasRenderingContext2D, st: any) => {
      const g = c.createLinearGradient(0, 0, st.width * 0.4, st.height);
      g.addColorStop(0, P.bgTop);
      g.addColorStop(1, P.bgBottom);
      c.fillStyle = g;
      c.fillRect(0, 0, st.width, st.height);
    },
    drawBrandLogo: () => false,
    drawCard: (c: CanvasRenderingContext2D, st: any, x: number, y: number, w: number, h: number, opts: any = {}) => {
      c.save();
      c.fillStyle = opts.fill || P.surfaceBg;
      c.strokeStyle = opts.border || P.surfaceBorder;
      c.lineWidth = 2.5 * st.u;
      drawRoundRect(c, x, y, w, h, opts.radius ?? 24 * st.u);
      c.fill();
      c.stroke();
      c.restore();
    },
    drawPill: (c: CanvasRenderingContext2D, st: any, txt: string, cx: number, cy: number, opts: any = {}) => {
      const fs = opts.fontSize ?? 26 * st.u;
      c.save();
      c.font = font("mono", 700, fs);
      const bw = c.measureText(txt).width + 52 * st.u;
      const bh = fs + 26 * st.u;
      c.fillStyle = opts.fill || P.accentPrimary;
      drawRoundRect(c, cx - bw / 2, cy - bh / 2, bw, bh, bh / 2);
      c.fill();
      c.fillStyle = opts.textColor || P.accentInk;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(txt, cx, cy);
      c.restore();
    },
    drawMaskedText: (c: CanvasRenderingContext2D, txt: string, x: number, y: number, p: number, opts: any = {}) => {
      c.save();
      c.globalAlpha *= clamp(p * 1.5);
      c.font = opts.font || font("heading", 800, 62 * u);
      c.fillStyle = opts.color || P.textPrimary;
      c.textAlign = opts.align || "center";
      c.textBaseline = "middle";
      c.fillText(txt, x, y + (1 - ease.outExpo(p)) * 40 * u, opts.maxWidth || width * 0.84);
      c.restore();
    },
    drawKineticHeadline: (c: CanvasRenderingContext2D, st: any, txt: string, cx: number, cy: number, opts: any = {}) => {
      c.save();
      c.font = font("heading", 900, opts.fontSize || 72 * st.u);
      c.fillStyle = opts.color || P.textPrimary;
      c.textAlign = "center";
      c.textBaseline = "middle";
      const lines = M.wrapText(c, txt, opts.maxWidth || st.width * 0.82);
      lines.forEach((l: string, i: number) => c.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * 86 * st.u));
      c.restore();
    },
    drawSvgPath: (c: CanvasRenderingContext2D, d: string, opts: any = {}) => {
      const path = new Path2D(d);
      c.save();
      c.translate(opts.x || 0, opts.y || 0);
      if (opts.scale) c.scale(opts.scale, opts.scale);
      if (opts.fill) { c.fillStyle = opts.fill; c.fill(path); }
      if (opts.stroke) { c.strokeStyle = opts.stroke; c.lineWidth = opts.lineWidth || 4; c.stroke(path); }
      c.restore();
    },
    drawLiquidWave: (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ratio: number, top: string, bot: string, phase = 0, amp = 10) => {
      const sy = y + h * (1 - clamp(ratio));
      c.save();
      c.beginPath();
      c.moveTo(x, y + h);
      for (let i = 0; i <= 24; i++) {
        c.lineTo(x + (w * i) / 24, sy + Math.sin((i / 24) * Math.PI * 2.4 + phase) * amp);
      }
      c.lineTo(x + w, y + h);
      c.closePath();
      const g = c.createLinearGradient(x, sy, x, y + h);
      g.addColorStop(0, top);
      g.addColorStop(1, bot);
      c.fillStyle = g;
      c.fill();
      c.restore();
    },
    drawBrowserWindow: (c: CanvasRenderingContext2D, st: any, x: number, y: number, w: number, h: number, opts: any) => {
      M.drawCard(c, st, x, y, w, h, { highlighted: true });
      if (opts?.contentFn) opts.contentFn(x, y + 68 * st.u, w, h - 68 * st.u);
    },
    drawCursor: (c: CanvasRenderingContext2D, x: number, y: number) => {
      c.save();
      c.fillStyle = "#FFF";
      c.beginPath();
      c.arc(x, y, 12 * u, 0, Math.PI * 2);
      c.fill();
      c.restore();
    },
    drawCounter: (c: CanvasRenderingContext2D, cx: number, cy: number, opts: any) => {
      const v = Math.round(lerp(opts.from ?? 0, opts.to ?? 100, ease.outExpo(opts.progress ?? 1)));
      c.save();
      c.font = font("display", 900, opts.fontSize || 110 * u);
      c.fillStyle = opts.color || P.accentPrimary;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(\`\${opts.prefix || ""}\${v.toLocaleString("id-ID")}\${opts.suffix || ""}\`, cx, cy);
      c.restore();
    },
    drawProgressRing: (c: CanvasRenderingContext2D, cx: number, cy: number, r: number, p: number, opts: any = {}) => {
      c.save();
      c.strokeStyle = opts.color || P.accentPrimary;
      c.lineWidth = opts.lineWidth || 16 * u;
      c.beginPath();
      c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p));
      c.stroke();
      c.restore();
    },
    drawParticles: () => {},
    drawSpotlight: (c: CanvasRenderingContext2D, cx: number, cy: number, r: number, col?: string, a = 0.25) => {
      const g = c.createRadialGradient(cx, cy, 4, cx, cy, r);
      g.addColorStop(0, withAlpha(col || P.accentPrimary, a));
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
    },
  };

  const code = scene.aiMotion?.customCode?.code;
  if (code) {
    try {
      const fn = new Function("ctx", "state", "M", code);
      fn(ctx, state, M);
    } catch {
      M.drawBackdrop(ctx, state);
      M.drawKineticHeadline(ctx, state, scene.text, width / 2, height * 0.45);
    }
  } else {
    M.drawBackdrop(ctx, state);
    M.drawKineticHeadline(ctx, state, scene.text, width / 2, height * 0.45);
  }

  // Synchronized live caption at bottom safe-zone
  const activeW = state.words[state.activeWordIndex]?.word || scene.text.split(" ").slice(0, 4).join(" ");
  ctx.save();
  ctx.font = font("display", 900, 56 * u);
  ctx.fillStyle = P.textPrimary;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(activeW.toUpperCase(), width / 2, height * 0.80, width * 0.86);
  ctx.restore();
}
`;

  return [
    { relativePath: "package.json", content: packageJson },
    { relativePath: "tsconfig.json", content: tsconfigJson },
    { relativePath: "README.md", content: readmeMd },
    { relativePath: "src/index.ts", content: indexTs },
    { relativePath: "src/Root.tsx", content: rootTsx },
    { relativePath: "src/projectData.ts", content: projectDataTs },
    { relativePath: "src/SynkcutComposition.tsx", content: compositionTsx },
    { relativePath: "src/runtimeRenderer.ts", content: runtimeRendererTs },
  ];
}
