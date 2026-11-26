import { useEffect, useRef } from "react";
import type { ProjectSummary, SceneOverlay, SynkcutProject } from "../types/scene";
import { rebuildWordsFromScenes } from "../engine/sampleProject";
import { renderProjectFrame } from "../engine/canvasRenderer";

interface ProjectPosterCanvasProps {
  project?: SynkcutProject;
  summary?: ProjectSummary;
  previewTimeMs?: number;
  className?: string;
}

// Shared offscreen 1080x1920 buffer for crisp 4x supersampled thumbnail rendering
let sharedOffscreenCanvas: HTMLCanvasElement | null = null;
let sharedThumbCanvas: HTMLCanvasElement | null = null;
function getOffscreenCanvas(): HTMLCanvasElement {
  if (!sharedOffscreenCanvas) {
    sharedOffscreenCanvas = document.createElement("canvas");
    sharedOffscreenCanvas.width = 1080;
    sharedOffscreenCanvas.height = 1920;
  }
  return sharedOffscreenCanvas;
}

function getThumbCanvas(): HTMLCanvasElement {
  if (!sharedThumbCanvas) {
    sharedThumbCanvas = document.createElement("canvas");
    sharedThumbCanvas.width = 360;
    sharedThumbCanvas.height = 640;
  }
  return sharedThumbCanvas;
}

/**
 * Renders the real video frame at `timeMs` (default: 1.0s / 1000ms) onto an offscreen canvas
 * and encodes a compact 360x640 JPEG data URL (~18-25 KB) for My Projects poster thumbnails.
 */
export function captureProjectPosterDataUrl(
  project: SynkcutProject,
  timeMs = 1000
): string | null {
  if (typeof document === "undefined") return null;
  try {
    const totalMs = project.scenes.reduce((max, s) => Math.max(max, s.endMs || 0), 0);
    const targetMs =
      totalMs > 1200 ? Math.min(timeMs, totalMs - 150) : Math.max(150, Math.round(totalMs * 0.45));

    const offscreen = getOffscreenCanvas();
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return null;

    renderProjectFrame(offCtx, project, targetMs, {
      showSafeZone: false,
      isPosterThumbnail: true,
    });

    const thumb = getThumbCanvas();
    const tCtx = thumb.getContext("2d");
    if (!tCtx) return null;
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = "high";
    tCtx.clearRect(0, 0, thumb.width, thumb.height);
    tCtx.drawImage(offscreen, 0, 0, thumb.width, thumb.height);
    const url = thumb.toDataURL("image/jpeg", 0.78);
    return url.startsWith("data:image/") ? url : null;
  } catch {
    return null;
  }
}

function buildPreviewProjectFromSummary(summary: ProjectSummary): SynkcutProject {
  const overlays: SceneOverlay[] =
    summary.firstOverlayType && summary.firstOverlayText
      ? [
          {
            id: "thumb_ov",
            type: summary.firstOverlayType as SceneOverlay["type"],
            title: summary.firstOverlayTitle || undefined,
            text: summary.firstOverlayText,
            position: "top",
          },
        ]
      : [];

  const text = summary.hookText.trim() || summary.name;
  const proj: SynkcutProject = {
    version: "1.0",
    meta: {
      id: summary.id,
      name: summary.name,
      format: summary.format,
      aspectRatio: "9:16",
      fps: 30,
    },
    globalStyle: {
      captionPreset: summary.captionPreset,
      accentColor: summary.accentColor || "#38E59D",
      showProgressBar: true,
      bgm: { preset: "upbeat_promo", volume: 0.25, autoDucking: true },
      safeZone: "none",
    },
    voiceover: {
      source: "demo",
      audioPath: null,
      trimSilence: true,
      words: [],
    },
    scenes: [
      {
        id: "thumb_scene",
        role:
          summary.format === "education"
            ? "body"
            : summary.format === "review"
              ? "cta"
              : "hook",
        startMs: 0,
        endMs: 3000,
        text,
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0 },
        transitionIn: { preset: "hard_cut", durationMs: 0 },
        sfx: [],
        overlays,
      },
    ],
  };

  proj.voiceover.words = rebuildWordsFromScenes(proj);
  return proj;
}

export default function ProjectPosterCanvas({
  project,
  summary,
  previewTimeMs = 1000,
  className = "",
}: ProjectPosterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const savedPosterUrl =
    (summary?.posterDataUrl && summary.posterDataUrl.startsWith("data:image/")
      ? summary.posterDataUrl
      : null) ||
    (project?.meta?.posterDataUrl && project.meta.posterDataUrl.startsWith("data:image/")
      ? project.meta.posterDataUrl
      : null);

  useEffect(() => {
    if (savedPosterUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const targetProject = project ?? (summary ? buildPreviewProjectFromSummary(summary) : null);
    if (!targetProject) return;

    const draw = () => {
      const offscreen = getOffscreenCanvas();
      const offCtx = offscreen.getContext("2d");
      if (!offCtx) return;

      renderProjectFrame(offCtx, targetProject, previewTimeMs, {
        showSafeZone: false,
        isPosterThumbnail: true,
      });

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    };

    draw();
    document.fonts?.ready.then(draw).catch(() => {});
  }, [project, summary, previewTimeMs, savedPosterUrl]);

  if (savedPosterUrl) {
    return (
      <img
        src={savedPosterUrl}
        alt={summary?.name || project?.meta?.name || "Thumbnail Proyek"}
        className={className}
        style={{ display: "block" }}
        loading="lazy"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={270}
      height={480}
      className={className}
      style={{ display: "block" }}
    />
  );
}
