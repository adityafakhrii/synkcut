import type {
  CustomDesignDirection,
  DesignFontFamily,
  SceneItem,
  SceneOverlay,
  SynkcutProject,
  WordTimestamp,
} from "../types/scene";
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

const FONT_STACKS: Record<DesignFontFamily, string> = {
  sans: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", Cambria, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  display: '"Impact", "Arial Black", "IBM Plex Sans", sans-serif',
};

function resolveFont(family?: DesignFontFamily): string {
  return family && FONT_STACKS[family] ? FONT_STACKS[family] : FONT_STACKS.sans;
}

function cornerRadiusFor(design: CustomDesignDirection | null | undefined, base: number): number {
  if (!design) return base;
  if (design.visualStyle.cornerStyle === "sharp") return Math.min(6, base * 0.25);
  if (design.visualStyle.cornerStyle === "pill") return Math.round(base * 1.45);
  return base;
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
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function findActiveScene(project: SynkcutProject, timeMs: number): SceneItem | null {
  const scenes = project?.scenes ?? [];
  for (const scene of scenes) {
    if (timeMs >= scene.startMs && timeMs < scene.endMs) {
      return scene;
    }
  }
  return scenes[scenes.length - 1] ?? null;
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
  if (vw <= 0 || vh <= 0) return;
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
  const custom = project.globalStyle?.customDesign ?? null;
  const safeAccent = project.globalStyle?.accentColor || "#38e59d";
  const formatPalettes: Record<string, [string, string, string]> = {
    ad_promo: ["#0a1410", "#11241c", safeAccent],
    education: ["#09131d", "#0e2233", safeAccent || "#38bdf8"],
    storytelling: ["#171310", "#241b15", safeAccent || "#f59e0b"],
    review: ["#091714", "#0f2720", safeAccent],
  };
  const roleFallback: Record<string, [string, string, string]> = {
    hook: ["#13161f", "#1e1b2e", "#f59e0b"],
    body: ["#0d1520", "#112233", "#38bdf8"],
    cta: ["#0d1915", "#102820", "#34d399"],
  };

  const [c1, c2, accent] = custom
    ? [custom.palette.bgTop, custom.palette.bgBottom, custom.palette.accentPrimary]
    : isPosterThumbnail
      ? formatPalettes[project.meta?.format] ?? formatPalettes.ad_promo
      : roleFallback[scene.role] ?? roleFallback.body;

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, c1);
  bgGrad.addColorStop(1, c2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  const pattern = custom?.visualStyle.backgroundPattern ?? "grid";
  const gridStroke = custom?.isLight ? "rgba(18, 22, 28, 0.06)" : "rgba(255, 255, 255, 0.045)";

  if (pattern === "dots") {
    ctx.fillStyle = gridStroke;
    const step = 72;
    const shiftY = (progress * 36) % step;
    for (let x = step / 2; x <= width; x += step) {
      for (let y = -step; y <= height + step; y += step) {
        ctx.beginPath();
        ctx.arc(x, y + shiftY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === "diagonal") {
    ctx.strokeStyle = gridStroke;
    ctx.lineWidth = 2;
    const step = 96;
    const shift = (progress * 48) % step;
    for (let i = -height; i <= width + height; i += step) {
      ctx.beginPath();
      ctx.moveTo(i + shift, 0);
      ctx.lineTo(i - height * 0.5 + shift, height);
      ctx.stroke();
    }
  } else if (pattern === "grid") {
    ctx.strokeStyle = gridStroke;
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
  }

  const orbX = width * (0.3 + 0.4 * Math.sin(progress * Math.PI));
  const orbY = height * (0.38 + 0.08 * Math.cos(progress * Math.PI));
  const rad = ctx.createRadialGradient(orbX, orbY, 40, orbX, orbY, width * 0.72);
  rad.addColorStop(0, accent.startsWith("#") ? `${accent}30` : "rgba(56,229,157,0.18)");
  rad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, width, height);

  if (!isPosterThumbnail) {
    const cardW = width * 0.78;
    const cardH = height * 0.34;
    const cardX = (width - cardW) / 2;
    const cardY = height * 0.27;
    const radCard = cornerRadiusFor(custom, 32);

    if (custom?.visualStyle.cardStyle === "brutalist") {
      ctx.fillStyle = custom.palette.accentPrimary;
      roundRectPath(ctx, cardX + 10, cardY + 10, cardW, cardH, radCard);
      ctx.fill();
    }

    ctx.fillStyle = custom ? custom.palette.surfaceBg : "rgba(255, 255, 255, 0.04)";
    ctx.strokeStyle = custom ? custom.palette.surfaceBorder : "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = custom?.visualStyle.cardStyle === "brutalist" ? 4 : 2;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, radCard);
    ctx.fill();
    ctx.stroke();

    const safeRole = typeof scene.role === "string" ? scene.role.toUpperCase() : "SCENE";
    ctx.fillStyle = accent;
    ctx.font = `700 26px ${FONT_STACKS.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      custom ? `${custom.name.toUpperCase().slice(0, 26)} · ${safeRole}` : `SCENE: ${safeRole}`,
      width / 2,
      cardY + cardH * 0.42
    );

    ctx.fillStyle = custom ? custom.palette.textPrimary : "rgba(241, 243, 247, 0.78)";
    ctx.font = `500 30px ${resolveFont(custom?.typography.bodyFont)}`;
    ctx.fillText(
      "Pasang Footage Lokal atau Aktifkan AI Motion",
      width / 2,
      cardY + cardH * 0.56
    );
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
  const safeMotion = scene.motion ?? { preset: "static_clean", intensity: 0.5 };
  const safeTrans = scene.transitionIn ?? { preset: "hard_cut", durationMs: 0 };
  const intensity = isAiMotion ? 0 : Number.isFinite(safeMotion.intensity) ? safeMotion.intensity : 0.75;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let alpha = 1;

  if (!isAiMotion) {
    switch (safeMotion.preset) {
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

  const transDur = safeTrans.durationMs || 0;
  const inTrans = transDur > 0 && sceneLocalMs < transDur && !isPosterThumbnail;
  const trProgress = inTrans ? Math.max(0, Math.min(1, sceneLocalMs / transDur)) : 1;
  const trEase = easeOutExpo(trProgress);

  if (inTrans) {
    switch (safeTrans.preset) {
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

  const overlays = Array.isArray(scene.overlays) ? scene.overlays : [];
  const splitOverlay = overlays.find((o) => o?.type === "split_screen");
  const customDesign = project.globalStyle?.customDesign ?? null;
  const accentColor =
    customDesign?.palette.accentPrimary || project.globalStyle?.accentColor || "#38E59D";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-width / 2, -height / 2);

  if (isAiMotion && scene.aiMotion) {
    const durSec = Math.max(0.8, (scene.endMs - scene.startMs) / 1000);
    try {
      renderAiMotionScene(
        ctx,
        width,
        height,
        scene.aiMotion,
        progress,
        durSec,
        accentColor,
        settledPreview,
        customDesign
      );
    } catch (err) {
      console.warn("[Synkcut] AI Motion render fallback:", err);
      drawProceduralBackdrop(ctx, width, height, project, scene, progress, isPosterThumbnail);
    }
  } else if (splitOverlay) {
    const halfH = Math.round(height / 2);

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
      botGrad.addColorStop(0, customDesign?.palette.bgBottom || "#121820");
      botGrad.addColorStop(1, customDesign?.palette.bgTop || "#090d12");
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, halfH, width, height - halfH);
      if (!isPosterThumbnail) {
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.font = `600 28px ${FONT_STACKS.mono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          String(splitOverlay.text || "SPLIT-SCREEN · B-ROLL DETAIL"),
          width / 2,
          halfH + (height - halfH) * 0.45
        );
      }
    }
    ctx.restore();

    ctx.fillStyle = accentColor;
    ctx.fillRect(0, halfH - 3, width, 6);

    const splitText = String(splitOverlay.text || "");
    if (splitText) {
      ctx.font = `700 24px ${FONT_STACKS.mono}`;
      const tw = ctx.measureText(splitText.toUpperCase()).width;
      const bw = Math.min(width * 0.72, tw + 44);
      const bh = 50;
      ctx.fillStyle = customDesign?.palette.surfaceBg || "rgba(9, 9, 11, 0.92)";
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      roundRectPath(ctx, (width - bw) / 2, halfH - bh / 2, bw, bh, cornerRadiusFor(customDesign, 999));
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = customDesign?.palette.textPrimary || "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(splitText.toUpperCase(), width / 2, halfH + 1);
    }
  } else if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    drawCoverVideo(ctx, videoEl, 0, 0, width, height, 1);

    const scrim = ctx.createLinearGradient(0, height * 0.45, 0, height);
    scrim.addColorStop(0, "rgba(0,0,0,0)");
    scrim.addColorStop(0.65, "rgba(0,0,0,0.42)");
    scrim.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);

    // Subtle custom-design top accent trim bar on footage if Custom Design Direction is active
    if (customDesign && customDesign.visualStyle.cardStyle === "brutalist") {
      ctx.strokeStyle = customDesign.palette.accentPrimary;
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, width - 10, height - 10);
    }
  } else {
    drawProceduralBackdrop(ctx, width, height, project, scene, progress, isPosterThumbnail);
  }

  ctx.restore();

  if (inTrans) {
    ctx.save();
    if (safeTrans.preset === "whip_pan") {
      const blurAlpha = (1 - trEase) * 0.42;
      const streak = ctx.createLinearGradient(0, 0, width, 0);
      streak.addColorStop(0, `rgba(255,255,255,${blurAlpha})`);
      streak.addColorStop(0.5, "rgba(255,255,255,0)");
      streak.addColorStop(1, `rgba(0,0,0,${blurAlpha})`);
      ctx.fillStyle = streak;
      ctx.fillRect(0, 0, width, height);
    } else if (safeTrans.preset === "pop_zoom") {
      const flash = Math.max(0, 1 - trProgress * 2.5) * 0.36;
      ctx.fillStyle = `rgba(255,255,255,${flash})`;
      ctx.fillRect(0, 0, width, height);
    } else if (safeTrans.preset === "glitch_flash") {
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
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
  settledPreview = false,
  customDesign?: CustomDesignDirection | null
) {
  if (!overlay || overlay.type === "split_screen") return;

  const overlayText = String(overlay.text ?? "");
  const overlayTitle = String(overlay.title ?? "Notifikasi · Baru saja");
  const enter = settledPreview ? 1 : easeOutCubic(Math.min(1, sceneProgress * 5));
  const topSafeY = height * 0.115;

  const surfaceBg = customDesign?.palette.surfaceBg || "rgba(18, 21, 28, 0.9)";
  const surfaceBorder = customDesign?.palette.surfaceBorder || "rgba(255, 255, 255, 0.18)";
  const primaryText = customDesign?.palette.textPrimary || "#f8fafc";
  const secondaryText = customDesign?.palette.textSecondary || "rgba(241, 243, 247, 0.68)";
  const accentInk = customDesign?.palette.accentInk || "#09090b";
  const headingFont = resolveFont(customDesign?.typography.headingFont);
  const bodyFont = resolveFont(customDesign?.typography.bodyFont);
  const isBrutalist = customDesign?.visualStyle.cardStyle === "brutalist";

  ctx.save();
  ctx.globalAlpha = enter;

  if (overlay.type === "notification_banner") {
    const boxW = width * 0.84;
    const boxH = 152;
    const x = (width - boxW) / 2;
    const y = topSafeY - (1 - enter) * 40;
    const rad = cornerRadiusFor(customDesign, 32);

    if (isBrutalist) {
      ctx.fillStyle = accentColor;
      roundRectPath(ctx, x + 8, y + 8, boxW, boxH, rad);
      ctx.fill();
    }

    ctx.fillStyle = surfaceBg;
    ctx.strokeStyle = isBrutalist ? primaryText : surfaceBorder;
    ctx.lineWidth = isBrutalist ? 4 : 2;
    roundRectPath(ctx, x, y, boxW, boxH, rad);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x + 28, y + 32, 84, 84, cornerRadiusFor(customDesign, 22));
    ctx.fill();

    ctx.fillStyle = accentInk;
    ctx.font = `800 36px ${headingFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", x + 70, y + 76);

    ctx.textAlign = "left";
    ctx.fillStyle = secondaryText;
    ctx.font = `600 24px ${bodyFont}`;
    ctx.fillText(overlayTitle.slice(0, 36), x + 136, y + 54);

    ctx.fillStyle = primaryText;
    ctx.font = `700 30px ${headingFont}`;
    const maxChars = 34;
    const label =
      overlayText.length > maxChars ? `${overlayText.slice(0, maxChars - 1)}…` : overlayText;
    ctx.fillText(label, x + 136, y + 100);
  } else if (overlay.type === "promo_badge") {
    ctx.font = `700 28px ${resolveFont(customDesign?.typography.captionFont || "mono")}`;
    const textW = ctx.measureText(overlayText).width;
    const padX = 34;
    const pillW = Math.min(width * 0.84, textW + padX * 2);
    const pillH = 68;
    const x = (width - pillW) / 2;
    const y = topSafeY + (1 - enter) * 20;
    const rad =
      customDesign?.visualStyle.cornerStyle === "sharp" ? 6 : 999;

    if (isBrutalist) {
      ctx.fillStyle = customDesign?.isLight ? "#111318" : "#ffffff";
      roundRectPath(ctx, x + 6, y + 6, pillW, pillH, rad);
      ctx.fill();
    }

    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x, y, pillW, pillH, rad);
    ctx.fill();

    ctx.fillStyle = accentInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(overlayText.slice(0, 38), width / 2, y + pillH / 2 + 1);
  } else if (overlay.type === "hook_headline") {
    const boxW = width * 0.84;
    ctx.font = `800 50px ${headingFont}`;
    const lines = wrapLines(ctx, overlayText, boxW - 80);
    const lineH = 64;
    const boxH = Math.max(1, lines.length) * lineH + 74;
    const x = (width - boxW) / 2;
    const y = height * 0.21 + (1 - enter) * 32;
    const rad = cornerRadiusFor(customDesign, 28);

    if (isBrutalist) {
      ctx.fillStyle = accentColor;
      roundRectPath(ctx, x + 10, y + 10, boxW, boxH, rad);
      ctx.fill();
    }

    ctx.fillStyle = surfaceBg;
    ctx.strokeStyle = isBrutalist ? primaryText : surfaceBorder;
    ctx.lineWidth = isBrutalist ? 4 : 2;
    roundRectPath(ctx, x, y, boxW, boxH, rad);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    roundRectPath(ctx, x + 40, y + 26, 92, 8, cornerRadiusFor(customDesign, 999));
    ctx.fill();

    ctx.fillStyle = primaryText;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    lines.forEach((line, idx) => {
      ctx.fillText(line, x + 40, y + 72 + idx * lineH);
    });
  } else if (overlay.type === "doodle_highlight") {
    const centerY = height * 0.25;
    const boxW = width * 0.78;
    const x = (width - boxW) / 2;
    const rad = cornerRadiusFor(customDesign, 22);

    ctx.fillStyle = surfaceBg;
    ctx.strokeStyle = surfaceBorder;
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, centerY - 58, boxW, 116, rad);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = primaryText;
    ctx.font = `700 40px ${headingFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const clipped =
      overlayText.length > 26 ? `${overlayText.slice(0, 25)}…` : overlayText;
    ctx.fillText(clipped, width / 2, centerY - 4);

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
  const words = Array.isArray(project.voiceover?.words) ? project.voiceover.words : [];
  const sceneWords = words.filter(
    (w) => w && typeof w.word === "string" && w.startMs >= scene.startMs && w.startMs < scene.endMs
  );
  if (sceneWords.length === 0) return;

  const custom = project.globalStyle?.customDesign ?? null;
  const preset = project.globalStyle?.captionPreset ?? "bold_pop";
  const accent =
    custom?.palette.accentPrimary || project.globalStyle?.accentColor || "#38E59D";

  const chunkSize =
    preset === "kinetic_punch" || custom?.pacing === "snappy" ? 2 : 3;
  const chunks: WordTimestamp[][] = [];
  for (let i = 0; i < sceneWords.length; i += chunkSize) {
    chunks.push(sceneWords.slice(i, i + chunkSize));
  }

  const activeChunk =
    chunks.find((ch) => timeMs >= ch[0].startMs && timeMs <= ch[ch.length - 1].endMs) ??
    chunks[chunks.length - 1];
  if (!activeChunk || activeChunk.length === 0) return;

  const baseY = height * 0.67;

  const captionLook = custom?.visualStyle.captionLook ?? null;
  const useUppercase = custom
    ? custom.typography.captionUppercase
    : preset === "bold_pop" || preset === "kinetic_punch";

  const baseFontSize =
    preset === "kinetic_punch"
      ? 84
      : captionLook === "editorial_bar" || preset === "luxury_editorial"
        ? 58
        : captionLook === "minimal_clean" || preset === "clean_minimal"
          ? 54
          : 66;

  const fontFamily = custom
    ? resolveFont(custom.typography.captionFont)
    : preset === "luxury_editorial"
      ? FONT_STACKS.serif
      : FONT_STACKS.sans;

  const fontWeight =
    custom?.typography.captionFont === "serif" || preset === "luxury_editorial" ? "700" : "800";

  ctx.save();
  ctx.textBaseline = "middle";

  const measureChunk = (sz: number) => {
    ctx.font = `${fontWeight} ${sz}px ${fontFamily}`;
    const baseSpaceW = ctx.measureText(" ").width;
    const spW = useUppercase ? baseSpaceW * 1.45 : baseSpaceW * 1.15;
    const measured = activeChunk.map((w) => {
      const safeWord = String(w.word ?? "");
      const label = useUppercase ? safeWord.toUpperCase() : safeWord;
      const isActive = timeMs >= w.startMs && timeMs <= w.endMs;
      const wordDur = Math.max(80, w.endMs - w.startMs);
      const wordProg = isActive ? Math.min(1, (timeMs - w.startMs) / Math.min(140, wordDur)) : 0;
      const springBoost =
        isActive && (preset === "bold_pop" || preset === "kinetic_punch" || captionLook === "bold_outline")
          ? 1 + 0.12 * easeOutCubic(wordProg)
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

  const maxRowW = width * 0.8;
  let fontSize = baseFontSize;
  let layout = measureChunk(fontSize);
  if (layout.totalW > maxRowW && layout.totalW > 0) {
    fontSize = Math.max(32, Math.floor(baseFontSize * (maxRowW / layout.totalW)));
    layout = measureChunk(fontSize);
  }
  const { items, spaceW, totalW } = layout;

  const isLightMotionBg = custom
    ? custom.isLight && scene.visualSource === "motion"
    : scene.visualSource === "motion" &&
      Boolean(scene.aiMotion) &&
      isLightAiMotionTheme(scene.aiMotion!.theme);

  const needsPillBg = custom
    ? captionLook === "custom_pill" ||
      captionLook === "glass_tag" ||
      captionLook === "editorial_bar" ||
      (isLightMotionBg && captionLook !== "bold_outline")
    : preset === "clean_minimal" ||
      (isLightMotionBg && preset !== "bold_pop" && preset !== "kinetic_punch");

  if (needsPillBg) {
    const padX = 36;
    const padY = 22;
    const bx = (width - totalW) / 2 - padX;
    const by = baseY - fontSize / 2 - padY;
    const bw = totalW + padX * 2;
    const bh = fontSize + padY * 2;
    const rad =
      captionLook === "editorial_bar"
        ? 8
        : cornerRadiusFor(custom, 24);

    if (custom?.visualStyle.cardStyle === "brutalist") {
      ctx.fillStyle = accent;
      roundRectPath(ctx, bx + 7, by + 7, bw, bh, rad);
      ctx.fill();
    }

    ctx.fillStyle = custom
      ? custom.isLight
        ? "rgba(15, 18, 26, 0.90)"
        : custom.palette.surfaceBg
      : "rgba(13, 15, 18, 0.84)";
    roundRectPath(ctx, bx, by, bw, bh, rad);
    ctx.fill();

    if (custom && (captionLook === "glass_tag" || captionLook === "editorial_bar" || custom.visualStyle.cardStyle === "brutalist")) {
      ctx.strokeStyle = captionLook === "editorial_bar" ? accent : custom.palette.surfaceBorder;
      ctx.lineWidth = captionLook === "editorial_bar" ? 3 : 2;
      ctx.stroke();
    }
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

    const useOutline = custom
      ? captionLook === "bold_outline" || (!needsPillBg && !isLightMotionBg)
      : preset === "bold_pop" || preset === "kinetic_punch";

    if (useOutline) {
      ctx.lineWidth = 14;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(10, 12, 16, 0.92)";
      ctx.strokeText(item.label, 0, 0);
    } else if ((preset === "neon_tech" || custom?.visualStyle.cardStyle === "neon") && item.isActive) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 24;
    }

    const inactiveColor =
      custom && !needsPillBg && isLightMotionBg ? custom.palette.textPrimary : "#ffffff";
    ctx.fillStyle = item.isActive ? accent : inactiveColor;
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
  ctx.font = `600 22px ${FONT_STACKS.mono}`;
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

  const sceneDuration = Math.max(1, (scene.endMs || 2500) - (scene.startMs || 0));
  const sceneLocalMs = Math.max(0, timeMs - (scene.startMs || 0));
  const sceneProgress = Math.max(0, Math.min(1, sceneLocalMs / sceneDuration));

  const settledPreview = Boolean(
    options.isPosterThumbnail || (options.isPreviewPaused && sceneLocalMs < 350)
  );
  const customDesign = project.globalStyle?.customDesign ?? null;
  const accentColor =
    customDesign?.palette.accentPrimary || project.globalStyle?.accentColor || "#38E59D";

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
  const overlays = Array.isArray(scene.overlays) ? scene.overlays : [];
  for (const overlay of overlays) {
    drawOverlay(
      ctx,
      width,
      height,
      overlay,
      sceneProgress,
      accentColor,
      settledPreview,
      customDesign
    );
  }

  // 3. Word-level synced kinetic captions
  drawKineticCaptions(ctx, width, height, project, scene, timeMs);

  // 4. Progress bar
  if (project.globalStyle?.showProgressBar) {
    const totalMs = Math.max(1, getProjectDurationMs(project));
    const overallProgress = Math.max(0, Math.min(1, timeMs / totalMs));
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.fillRect(0, 0, width, 10);
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, width * overallProgress, 10);
  }

  // 5. Optional Safe Zone overlay (preview only — disabled during final export)
  if (options.showSafeZone) {
    drawSafeZoneOverlay(ctx, width, height);
  }
}
