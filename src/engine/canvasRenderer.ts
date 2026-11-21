import type { SceneItem, SceneOverlay, SynkcutProject, WordTimestamp } from "../types/scene";
import { getProjectDurationMs } from "./sampleProject";
import { isLightAiMotionTheme } from "./aiMotionPresets";
import { renderAiMotionScene } from "./aiMotionRenderer";

export interface RenderFrameOptions {
  videoElement?: HTMLVideoElement | null;
  secondaryVideoElement?: HTMLVideoElement | null;
  showSafeZone?: boolean;
  isPosterThumbnail?: boolean;
  isPreviewPaused?: boolean;
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function easeOutExpo(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped === 1 ? 1 : 1 - Math.pow(2, -10 * clamped);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function findActiveScene(project: SynkcutProject, timeMs: number): SceneItem | null {
  for (const scene of project.scenes) {
    if (timeMs >= scene.startMs && timeMs < scene.endMs) {
      return scene;
    }
  }
  return project.scenes[project.scenes.length - 1] ?? null;
}

function drawCoverVideo(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  extraZoom = 1
) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const targetRatio = dw / dh;
  const sourceRatio = vw / vh;

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (sourceRatio > targetRatio) {
    sw = vh * targetRatio;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / targetRatio;
    sy = (vh - sh) / 2;
  }

  if (extraZoom > 1) {
    const zoomedW = sw / extraZoom;
    const zoomedH = sh / extraZoom;
    sx += (sw - zoomedW) / 2;
    sy += (sh - zoomedH) / 2;
    sw = zoomedW;
    sh = zoomedH;
  }

  ctx.drawImage(videoEl, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawProceduralBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: SynkcutProject,
  scene: SceneItem,
  progress: number,
  isPosterThumbnail = false
) {
  const formatPalettes: Record<SynkcutProject["meta"]["format"], [string, string, string]> = {
    ad_promo: ["#0a1410", "#11241c", project.globalStyle.accentColor || "#38e59d"],
    education: ["#09131d", "#0e2233", project.globalStyle.accentColor || "#38bdf8"],
    storytelling: ["#171310", "#241b15", project.globalStyle.accentColor || "#f59e0b"],
    review: ["#091714", "#0f2720", project.globalStyle.accentColor || "#38e59d"],
  };
  const roleFallback: Record<SceneItem["role"], [string, string, string]> = {
    hook: ["#13161f", "#1e1b2e", "#f59e0b"],
    body: ["#0d1520", "#112233", "#38bdf8"],
    cta: ["#0d1915", "#102820", "#34d399"],
  };
  const [c1, c2, accent] = isPosterThumbnail
    ? formatPalettes[project.meta.format]
    : roleFallback[scene.role];

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, c1);
  bgGrad.addColorStop(1, c2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
  ctx.lineWidth = 2;
  const gridStep = 120;
  const shiftY = (progress * 60) % gridStep;
  for (let x = 0; x <= width; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = -gridStep; y <= height + gridStep; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y + shiftY);
    ctx.lineTo(width, y + shiftY);
    ctx.stroke();
  }

  const orbX = width * (0.3 + 0.4 * Math.sin(progress * Math.PI));
  const orbY = height * (0.38 + 0.08 * Math.cos(progress * Math.PI));
  const rad = ctx.createRadialGradient(orbX, orbY, 40, orbX, orbY, width * 0.72);
  rad.addColorStop(0, `${accent}30`);
  rad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, width, height);

  if (!isPosterThumbnail) {
    const cardW = width * 0.78;
    const cardH = height * 0.34;
    const cardX = (width - cardW) / 2;
    const cardY = height * 0.27;
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 32);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.font = '700 26px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`SCENE: ${scene.role.toUpperCase()}`, width / 2, cardY + cardH * 0.42);

    ctx.fillStyle = "rgba(241, 243, 247, 0.78)";
    ctx.font = '500 32px "IBM Plex Sans", sans-serif';
    ctx.fillText("Mode Backdrop Demo (Pilih Footage MP4 Lokal)", width / 2, cardY + cardH * 0.56);
  }
  ctx.restore();
}

function drawFootageWithMotion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: SynkcutProject,
  scene: SceneItem,
  progress: number,
  sceneLocalMs: number,
  videoEl?: HTMLVideoElement | null,
  secondaryVideoEl?: HTMLVideoElement | null,
  isPosterThumbnail = false,
  settledPreview = false
) {
  const isAiMotion = scene.visualSource === "motion" && Boolean(scene.aiMotion);
  const intensity = isAiMotion ? 0 : scene.motion.intensity;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let alpha = 1;

  // Base motion preset (applied to footage scenes; AI Motion has its own native choreography)
  if (!isAiMotion) {
    switch (scene.motion.preset) {
      case "zoom_punch": {
        const punch = easeOutCubic(Math.min(1, progress * 3.2));
        scale = 1 + 0.14 * intensity * (1 - punch) + 0.04 * intensity * progress;
        break;
      }
      case "smooth_ken_burns": {
        scale = 1 + 0.12 * intensity * progress;
        offsetX = (progress - 0.5) * 44 * intensity;
        offsetY = (0.5 - progress) * 28 * intensity;
        break;
      }
      case "shake_impact": {
        const decay = Math.max(0, 1 - progress * 4.5);
        scale = 1 + 0.08 * intensity * decay;
        offsetX = Math.sin(progress * 90) * 24 * intensity * decay;
        offsetY = Math.cos(progress * 75) * 18 * intensity * decay;
        break;
      }
      case "slide_reveal": {
        const slide = easeOutCubic(Math.min(1, progress * 4));
        offsetY = (1 - slide) * 140 * intensity;
        scale = 1.03;
        break;
      }
      case "static_clean":
      default:
        scale = 1;
        break;
    }
  }

  // Deterministic Entry Transitions (`transitionIn`)
  const transDur = scene.transitionIn.durationMs || 0;
  const inTrans = transDur > 0 && sceneLocalMs < transDur && !isPosterThumbnail;
  const trProgress = inTrans ? Math.max(0, Math.min(1, sceneLocalMs / transDur)) : 1;
  const trEase = easeOutExpo(trProgress);

  if (inTrans) {
    switch (scene.transitionIn.preset) {
      case "whip_pan": {
        offsetX += (1 - trEase) * width * 0.72;
        scale *= 1 + (1 - trEase) * 0.08;
        break;
      }
      case "pop_zoom": {
        scale *= 1 + (1 - trEase) * 0.34;
        break;
      }
      case "smooth_crossfade": {
        alpha = trEase;
        break;
      }
      case "glitch_flash": {
        offsetX += Math.sin(trProgress * 48) * 32 * (1 - trProgress);
        break;
      }
      case "hard_cut":
      default:
        break;
    }
  }

  const splitOverlay = scene.overlays.find((o) => o.type === "split_screen");

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-width / 2, -height / 2);

  if (isAiMotion && scene.aiMotion) {
    const durSec = Math.max(0.8, (scene.endMs - scene.startMs) / 1000);
    renderAiMotionScene(
      ctx,
      width,
      height,
      scene.aiMotion,
      progress,
      durSec,
      project.globalStyle.accentColor,
      settledPreview
    );
  } else if (splitOverlay) {
    // True 50/50 Vertical Split-Screen / B-Roll Comparison
    const halfH = Math.round(height / 2);

    // Top half: Primary footage or procedural top
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, halfH);
    ctx.clip();
    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      drawCoverVideo(ctx, videoEl, 0, 0, width, halfH, 1.0);
    } else {
      drawProceduralBackdrop(ctx, width, height, project, scene, progress, isPosterThumbnail);
    }
    ctx.restore();

    // Bottom half: Secondary B-roll video OR crisp zoomed detail cut of primary video
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, halfH, width, height - halfH);
    ctx.clip();
    if (secondaryVideoEl && secondaryVideoEl.readyState >= 2 && secondaryVideoEl.videoWidth > 0) {
      drawCoverVideo(ctx, secondaryVideoEl, 0, halfH, width, height - halfH, 1.04);
    } else if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      drawCoverVideo(ctx, videoEl, 0, halfH, width, height - halfH, 1.45);
    } else {
      const botGrad = ctx.createLinearGradient(0, halfH, width, height);
      botGrad.addColorStop(0, "#121820");
      botGrad.addColorStop(1, "#090d12");
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, halfH, width, height - halfH);
      if (!isPosterThumbnail) {
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.font = '600 28px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(splitOverlay.text || "SPLIT-SCREEN · B-ROLL DETAIL", width / 2, halfH + (height - halfH) * 0.45);
      }
    }
    ctx.restore();

    // Crisp hairline divider & badge at center seam
    ctx.fillStyle = project.globalStyle.accentColor;
    ctx.fillRect(0, halfH - 3, width, 6);

    if (splitOverlay.text) {
      ctx.font = '700 24px "JetBrains Mono", monospace';
      const tw = ctx.measureText(splitOverlay.text.toUpperCase()).width;
      const bw = Math.min(width * 0.72, tw + 44);
      const bh = 50;
      ctx.fillStyle = "rgba(9, 9, 11, 0.92)";
      ctx.strokeStyle = project.globalStyle.accentColor;
      ctx.lineWidth = 2;
      roundRectPath(ctx, (width - bw) / 2, halfH - bh / 2, bw, bh, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(splitOverlay.text.toUpperCase(), width / 2, halfH + 1);
    }
  } else if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    drawCoverVideo(ctx, videoEl, 0, 0, width, height, 1);

    const scrim = ctx.createLinearGradient(0, height * 0.45, 0, height);
    scrim.addColorStop(0, "rgba(0,0,0,0)");
    scrim.addColorStop(0.65, "rgba(0,0,0,0.45)");
    scrim.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  } else {
    drawProceduralBackdrop(ctx, width, height, project, scene, progress, isPosterThumbnail);
  }

  ctx.restore();

  // Transition Post-FX (Whip Pan streak veil, Pop Zoom flash, Glitch RGB bands)
  if (inTrans) {
    ctx.save();
    if (scene.transitionIn.preset === "whip_pan") {
      const blurAlpha = (1 - trEase) * 0.42;
      const streak = ctx.createLinearGradient(0, 0, width, 0);
      streak.addColorStop(0, `rgba(255,255,255,${blurAlpha})`);
      streak.addColorStop(0.5, "rgba(255,255,255,0)");
      streak.addColorStop(1, `rgba(0,0,0,${blurAlpha})`);
      ctx.fillStyle = streak;
      ctx.fillRect(0, 0, width, height);
    } else if (scene.transitionIn.preset === "pop_zoom") {
      const flash = Math.max(0, 1 - trProgress * 2.5) * 0.36;
      ctx.fillStyle = `rgba(255,255,255,${flash})`;
      ctx.fillRect(0, 0, width, height);
    } else if (scene.transitionIn.preset === "glitch_flash") {
      const strength = 1 - trProgress;
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(56, 229, 157, ${0.28 * strength})`;
      ctx.fillRect(0, height * 0.18, width, 54);
      ctx.fillStyle = `rgba(244, 63, 94, ${0.28 * strength})`;
      ctx.fillRect(0, height * 0.44, width, 38);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.24 * strength})`;
      ctx.fillRect(0, height * 0.72, width, 64);
    }
    ctx.restore();
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: SceneOverlay,
  sceneProgress: number,
  accentColor: string,
  settledPreview = false
) {
  if (overlay.type === "split_screen") return; // Handled directly in footage compositor

  const enter = settledPreview ? 1 : easeOutCubic(Math.min(1, sceneProgress * 5));
  const topSafeY = height * 0.115; // Safe below TikTok/Reels 130px top zone

  ctx.save();
  ctx.globalAlpha = enter;

  if (overlay.type === "notification_banner") {
    const boxW = width * 0.84;
    const boxH = 152;
    const x = (width - boxW) / 2;
    const y = topSafeY - (1 - enter) * 40;

    ctx.fillStyle = "rgba(18, 21, 28, 0.9)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, boxW, boxH, 32);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x + 28, y + 32, 84, 84, 22);
    ctx.fill();

    ctx.fillStyle = "#09090b";
    ctx.font = '800 36px "IBM Plex Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", x + 70, y + 76);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(241, 243, 247, 0.68)";
    ctx.font = '600 24px "IBM Plex Sans", sans-serif';
    ctx.fillText(overlay.title || "Notifikasi · Baru saja", x + 136, y + 54);

    ctx.fillStyle = "#f8fafc";
    ctx.font = '700 30px "IBM Plex Sans", sans-serif';
    const maxChars = 34;
    const label =
      overlay.text.length > maxChars ? `${overlay.text.slice(0, maxChars - 1)}…` : overlay.text;
    ctx.fillText(label, x + 136, y + 100);
  } else if (overlay.type === "promo_badge") {
    ctx.font = '700 28px "JetBrains Mono", monospace';
    const textW = ctx.measureText(overlay.text).width;
    const padX = 34;
    const pillW = Math.min(width * 0.84, textW + padX * 2);
    const pillH = 68;
    const x = (width - pillW) / 2;
    const y = topSafeY + (1 - enter) * 20;

    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x, y, pillW, pillH, 999);
    ctx.fill();

    ctx.fillStyle = "#09090b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(overlay.text, width / 2, y + pillH / 2 + 1);
  } else if (overlay.type === "hook_headline") {
    // 3-Second Sound-Off Bold Hook Headline Card
    const boxW = width * 0.84;
    ctx.font = '800 50px "IBM Plex Sans", sans-serif';
    const lines = wrapLines(ctx, overlay.text, boxW - 80);
    const lineH = 64;
    const boxH = lines.length * lineH + 74;
    const x = (width - boxW) / 2;
    const y = height * 0.21 + (1 - enter) * 32;

    ctx.fillStyle = "rgba(9, 9, 11, 0.86)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, boxW, boxH, 28);
    ctx.fill();
    ctx.stroke();

    // Accent bar inside top of card
    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x + 40, y + 26, 92, 8, 999);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    lines.forEach((line, idx) => {
      ctx.fillText(line, x + 40, y + 72 + idx * lineH);
    });
  } else if (overlay.type === "doodle_highlight") {
    // Organic Hand-Drawn Marker Underline + Sketchy Oval Callout (2026 Anti-Ad Trend)
    const centerY = height * 0.25;
    const boxW = width * 0.78;
    const x = (width - boxW) / 2;

    ctx.fillStyle = "rgba(15, 18, 22, 0.72)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, centerY - 58, boxW, 116, 22);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = '700 40px "IBM Plex Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const clipped =
      overlay.text.length > 26 ? `${overlay.text.slice(0, 25)}…` : overlay.text;
    ctx.fillText(clipped, width / 2, centerY - 4);

    // Animated hand-drawn double marker stroke underneath
    const drawLen = settledPreview ? 1 : Math.min(1, sceneProgress * 3.8);
    const startX = x + 64;
    const endX = startX + (boxW - 128) * drawLen;
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(startX, centerY + 34);
    ctx.quadraticCurveTo(width / 2, centerY + 22, endX, centerY + 36);
    ctx.stroke();

    // Small sketchy pointer arc at top-right corner
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x + boxW - 22, centerY - 44, 24, 0.3, Math.PI * 1.45 * drawLen + 0.3);
    ctx.stroke();
  }

  ctx.restore();
}

function drawKineticCaptions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: SynkcutProject,
  scene: SceneItem,
  timeMs: number
) {
  const sceneWords = project.voiceover.words.filter(
    (w) => w.startMs >= scene.startMs && w.startMs < scene.endMs
  );
  if (sceneWords.length === 0) return;

  const chunkSize = project.globalStyle.captionPreset === "kinetic_punch" ? 2 : 3;
  const chunks: WordTimestamp[][] = [];
  for (let i = 0; i < sceneWords.length; i += chunkSize) {
    chunks.push(sceneWords.slice(i, i + chunkSize));
  }

  const activeChunk =
    chunks.find((ch) => timeMs >= ch[0].startMs && timeMs <= ch[ch.length - 1].endMs) ??
    chunks[chunks.length - 1];

  const baseY = height * 0.67; // Safe above bottom 480px Reels/TikTok UI
  const preset = project.globalStyle.captionPreset;
  const accent = project.globalStyle.accentColor;

  const baseFontSize =
    preset === "kinetic_punch"
      ? 86
      : preset === "luxury_editorial"
        ? 58
        : preset === "clean_minimal"
          ? 54
          : 68;
  const fontFamily =
    preset === "luxury_editorial"
      ? 'Georgia, "Times New Roman", serif'
      : '"IBM Plex Sans", sans-serif';
  const fontWeight = preset === "luxury_editorial" ? "600" : "800";

  ctx.save();
  ctx.textBaseline = "middle";

  const measureChunk = (sz: number) => {
    ctx.font = `${fontWeight} ${sz}px ${fontFamily}`;
    const baseSpaceW = ctx.measureText(" ").width;
    const spW =
      preset === "bold_pop" || preset === "kinetic_punch" ? baseSpaceW * 1.5 : baseSpaceW * 1.15;
    const measured = activeChunk.map((w) => {
      const label =
        preset === "bold_pop" || preset === "kinetic_punch" ? w.word.toUpperCase() : w.word;
      const isActive = timeMs >= w.startMs && timeMs <= w.endMs;
      const wordDur = Math.max(80, w.endMs - w.startMs);
      const wordProg = isActive ? Math.min(1, (timeMs - w.startMs) / Math.min(140, wordDur)) : 0;
      const springBoost =
        isActive && (preset === "bold_pop" || preset === "kinetic_punch")
          ? 1 + 0.13 * easeOutCubic(wordProg)
          : 1;
      return {
        word: w,
        label,
        width: ctx.measureText(label).width * springBoost,
        isActive,
        springBoost,
      };
    });
    const tw =
      measured.reduce((acc, it) => acc + it.width, 0) + spW * Math.max(0, measured.length - 1);
    return { items: measured, spaceW: spW, totalW: tw };
  };

  const maxRowW = width * 0.80;
  let fontSize = baseFontSize;
  let layout = measureChunk(fontSize);
  if (layout.totalW > maxRowW && layout.totalW > 0) {
    fontSize = Math.max(32, Math.floor(baseFontSize * (maxRowW / layout.totalW)));
    layout = measureChunk(fontSize);
  }
  const { items, spaceW, totalW } = layout;

  const isLightMotionBg =
    scene.visualSource === "motion" &&
    Boolean(scene.aiMotion) &&
    isLightAiMotionTheme(scene.aiMotion!.theme);

  if (preset === "clean_minimal" || (isLightMotionBg && preset !== "bold_pop" && preset !== "kinetic_punch")) {
    const padX = 36;
    const padY = 22;
    ctx.fillStyle = "rgba(13, 15, 18, 0.84)";
    roundRectPath(
      ctx,
      (width - totalW) / 2 - padX,
      baseY - fontSize / 2 - padY,
      totalW + padX * 2,
      fontSize + padY * 2,
      24
    );
    ctx.fill();
  }

  let cursorX = (width - totalW) / 2;
  for (const item of items) {
    const centerX = cursorX + item.width / 2;

    ctx.save();
    ctx.translate(centerX, baseY);
    if (item.springBoost > 1) {
      ctx.scale(item.springBoost, item.springBoost);
    }

    ctx.textAlign = "center";

    if (preset === "bold_pop" || preset === "kinetic_punch") {
      ctx.lineWidth = 14;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(10, 12, 16, 0.92)";
      ctx.strokeText(item.label, 0, 0);
    } else if (preset === "neon_tech" && item.isActive) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 24;
    }

    ctx.fillStyle = item.isActive ? accent : "#ffffff";
    ctx.fillText(item.label, 0, 0);
    ctx.restore();

    cursorX += item.width + spaceW;
  }

  ctx.restore();
}

function drawSafeZoneOverlay(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const topPx = (130 / 1920) * height;
  const bottomPx = (480 / 1920) * height;
  const rightPx = (140 / 1080) * width;

  ctx.save();
  ctx.fillStyle = "rgba(239, 68, 68, 0.16)";
  ctx.fillRect(0, 0, width, topPx);
  ctx.fillRect(0, height - bottomPx, width, bottomPx);
  ctx.fillRect(width - rightPx, topPx, rightPx, height - topPx - bottomPx);

  ctx.strokeStyle = "rgba(248, 113, 113, 0.85)";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.strokeRect(24, topPx, width - rightPx - 24, height - topPx - bottomPx);

  ctx.fillStyle = "rgba(254, 202, 202, 0.95)";
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.fillText("SAFE ZONE · TIKTOK / REELS (1080×1920)", 40, topPx - 18);
  ctx.restore();
}

export function renderProjectFrame(
  ctx: CanvasRenderingContext2D,
  project: SynkcutProject,
  timeMs: number,
  options: RenderFrameOptions = {}
) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  const scene = findActiveScene(project, timeMs);
  if (!scene) return;

  const sceneDuration = Math.max(1, scene.endMs - scene.startMs);
  const sceneLocalMs = Math.max(0, timeMs - scene.startMs);
  const sceneProgress = Math.max(0, Math.min(1, sceneLocalMs / sceneDuration));

  const settledPreview = Boolean(options.isPosterThumbnail || (options.isPreviewPaused && sceneLocalMs < 350));

  // 1. Footage OR Native AI Motion + Visual Entry Transition + Optional Split-Screen
  drawFootageWithMotion(
    ctx,
    width,
    height,
    project,
    scene,
    sceneProgress,
    sceneLocalMs,
    options.videoElement,
    options.secondaryVideoElement,
    Boolean(options.isPosterThumbnail),
    settledPreview
  );

  // 2. Scene overlays (Hook Headline, Native Notification, Promo Badge, Doodle Marker)
  for (const overlay of scene.overlays) {
    drawOverlay(
      ctx,
      width,
      height,
      overlay,
      sceneProgress,
      project.globalStyle.accentColor,
      settledPreview
    );
  }

  // 3. Word-level synced kinetic captions
  drawKineticCaptions(ctx, width, height, project, scene, timeMs);

  // 4. Progress bar
  if (project.globalStyle.showProgressBar) {
    const totalMs = Math.max(1, getProjectDurationMs(project));
    const overallProgress = Math.max(0, Math.min(1, timeMs / totalMs));
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.fillRect(0, 0, width, 10);
    ctx.fillStyle = project.globalStyle.accentColor;
    ctx.fillRect(0, 0, width * overallProgress, 10);
  }

  // 5. Optional Safe Zone overlay (preview only — disabled during final export)
  if (options.showSafeZone) {
    drawSafeZoneOverlay(ctx, width, height);
  }
}
