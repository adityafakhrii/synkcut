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
function getOffscreenCanvas(): HTMLCanvasElement {
  if (!sharedOffscreenCanvas) {
    sharedOffscreenCanvas = document.createElement("canvas");
    sharedOffscreenCanvas.width = 1080;
    sharedOffscreenCanvas.height = 1920;
  }
  return sharedOffscreenCanvas;
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
      accentColor: summary.accentColor || "#BEF264",
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
  previewTimeMs = 1150,
  className = "",
}: ProjectPosterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
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
  }, [project, summary, previewTimeMs]);

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
