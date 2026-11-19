import type { SceneItem, SceneOverlay, SynkcutProject, WordTimestamp } from "../types/scene";
import { getProjectDurationMs } from "./sampleProject";

export interface RenderFrameOptions {
  videoElement?: HTMLVideoElement | null;
  showSafeZone?: boolean;
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
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

function drawProceduralBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SceneItem,
  progress: number
) {
  const palettes: Record<SceneItem["role"], [string, string, string]> = {
    hook: ["#13161f", "#1e1b2e", "#f59e0b"],
    body: ["#0d1520", "#112233", "#38bdf8"],
    cta: ["#0d1915", "#102820", "#34d399"],
  };
  const [c1, c2, accent] = palettes[scene.role];

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, c1);
  bgGrad.addColorStop(1, c2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle architectural grid lines
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

  // Soft studio spotlight (subtle, non-slop radial depth)
  const orbX = width * (0.3 + 0.4 * Math.sin(progress * Math.PI));
  const orbY = height * (0.38 + 0.08 * Math.cos(progress * Math.PI));
  const rad = ctx.createRadialGradient(orbX, orbY, 40, orbX, orbY, width * 0.72);
  rad.addColorStop(0, `${accent}2b`);
  rad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, width, height);

  // Center placeholder studio card so user immediately sees footage motion
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
  ctx.font = '500 32px "Instrument Sans", sans-serif';
  ctx.fillText("Mode Backdrop Demo (Pilih Footage MP4 Lokal)", width / 2, cardY + cardH * 0.56);
  ctx.restore();
}

function drawFootageWithMotion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SceneItem,
  progress: number,
  videoEl?: HTMLVideoElement | null
) {
  const intensity = scene.motion.intensity;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

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

  ctx.save();
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-width / 2, -height / 2);

  if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const targetRatio = width / height;
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

    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, width, height);

    // Subtle bottom readability scrim so captions always stay crisp
    const scrim = ctx.createLinearGradient(0, height * 0.45, 0, height);
    scrim.addColorStop(0, "rgba(0,0,0,0)");
    scrim.addColorStop(0.65, "rgba(0,0,0,0.45)");
    scrim.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  } else {
    drawProceduralBackdrop(ctx, width, height, scene, progress);
  }

  ctx.restore();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: SceneOverlay,
  sceneProgress: number,
  accentColor: string
) {
  const enter = easeOutCubic(Math.min(1, sceneProgress * 5));
  const topSafeY = height * 0.115; // Safe below TikTok/Reels 130px top zone

  ctx.save();
  ctx.globalAlpha = enter;

  if (overlay.type === "notification_banner") {
    const boxW = width * 0.84;
    const boxH = 152;
    const x = (width - boxW) / 2;
    const y = topSafeY - (1 - enter) * 40;

    ctx.fillStyle = "rgba(18, 21, 28, 0.88)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, boxW, boxH, 32);
    ctx.fill();
    ctx.stroke();

    // Mini icon badge
    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x + 28, y + 32, 84, 84, 22);
    ctx.fill();

    ctx.fillStyle = "#0d0f12";
    ctx.font = '800 36px "Instrument Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", x + 70, y + 76);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(241, 243, 247, 0.68)";
    ctx.font = '600 24px "Instrument Sans", sans-serif';
    ctx.fillText(overlay.title || "Notifikasi · Baru saja", x + 136, y + 54);

    ctx.fillStyle = "#f8fafc";
    ctx.font = '700 30px "Instrument Sans", sans-serif';
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

    ctx.fillStyle = "#0d0f12";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(overlay.text, width / 2, y + pillH / 2 + 1);
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

  // Group into chunks of 3 words for punchy TikTok/Reels cadence
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

  const fontSize =
    preset === "kinetic_punch" ? 86 : preset === "luxury_editorial" ? 58 : preset === "clean_minimal" ? 54 : 68;
  const fontFamily =
    preset === "luxury_editorial"
      ? 'Georgia, "Times New Roman", serif'
      : '"Instrument Sans", sans-serif';
  const fontWeight = preset === "luxury_editorial" ? "600" : "800";

  ctx.save();
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";

  const spaceW = ctx.measureText(" ").width;
  const items = activeChunk.map((w) => {
    const label = preset === "bold_pop" || preset === "kinetic_punch" ? w.word.toUpperCase() : w.word;
    const isActive = timeMs >= w.startMs && timeMs <= w.endMs;
    return { word: w, label, width: ctx.measureText(label).width, isActive };
  });

  const totalW = items.reduce((acc, it) => acc + it.width, 0) + spaceW * Math.max(0, items.length - 1);

  // Optional clean minimal container pill
  if (preset === "clean_minimal") {
    const padX = 36;
    const padY = 22;
    ctx.fillStyle = "rgba(13, 15, 18, 0.78)";
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
    if (item.isActive && (preset === "bold_pop" || preset === "kinetic_punch")) {
      ctx.scale(1.12, 1.12);
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
  const sceneProgress = Math.max(0, Math.min(1, (timeMs - scene.startMs) / sceneDuration));

  // 1. Footage / studio backdrop with motion preset
  drawFootageWithMotion(ctx, width, height, scene, sceneProgress, options.videoElement);

  // 2. Scene overlays
  for (const overlay of scene.overlays) {
    drawOverlay(ctx, width, height, overlay, sceneProgress, project.globalStyle.accentColor);
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
