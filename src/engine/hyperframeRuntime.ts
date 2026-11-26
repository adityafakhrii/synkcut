import type { SynkcutProject } from "../types/scene";
import { getProjectDurationMs } from "./sampleProject";

export interface HyperframeTranscriptBeat {
  id: string;
  role: string;
  title: string;
  text: string;
  startSec: number;
  speechEndSec: number;
  endSec: number;
  words: Array<{ word: string; start: number; end: number }>;
}

export interface HyperframeTranscript {
  totalDurationSec: number;
  fps: number;
  totalFrames: number;
  beats: HyperframeTranscriptBeat[];
  words: Array<{ word: string; start: number; end: number }>;
}

export function isHyperframeProject(project: SynkcutProject | null | undefined): boolean {
  return Boolean(
    project?.hyperframe?.html && project.hyperframe.html.trim().length > 120
  );
}

/**
 * Builds the exact audio-locked transcript JSON injected into every HyperFrames HTML composition.
 * Works seamlessly with Synkcut's Gemini / OpenAI / Windows Neural TTS word timestamps.
 */
export function buildHyperframeTranscript(project: SynkcutProject): HyperframeTranscript {
  const totalMs = Math.max(4000, getProjectDurationMs(project));
  const totalSec = Number((totalMs / 1000).toFixed(3));
  const fps = project.meta.fps || 30;
  const allWords = (project.voiceover?.words ?? []).map((w) => ({
    word: w.word,
    start: Number((w.startMs / 1000).toFixed(3)),
    end: Number((w.endMs / 1000).toFixed(3)),
  }));

  const beats: HyperframeTranscriptBeat[] = project.scenes.map((sc, idx) => {
    const startSec = Number((sc.startMs / 1000).toFixed(3));
    const endSec = Number((Math.max(sc.startMs + 600, sc.endMs) / 1000).toFixed(3));
    const beatWords = allWords.filter((w) => w.end > startSec && w.start < endSec);
    const speechEndSec =
      beatWords.length > 0 ? Math.min(endSec, beatWords[beatWords.length - 1].end) : endSec;

    return {
      id: sc.id || `beat-${idx}`,
      role: sc.role || (idx === 0 ? "hook" : idx === project.scenes.length - 1 ? "cta" : "body"),
      title: sc.aiMotion?.title || sc.text.split(/\s+/).slice(0, 4).join(" "),
      text: sc.text || "",
      startSec,
      speechEndSec: Number(speechEndSec.toFixed(3)),
      endSec,
      words: beatWords,
    };
  });

  return {
    totalDurationSec: totalSec,
    fps,
    totalFrames: Math.max(30, Math.round(totalSec * fps)),
    beats,
    words: allWords,
  };
}

/**
 * Prepares a self-contained, 100% offline-deterministic HTML document for both:
 * - StudioView live 60fps iframe preview (`vendorBaseUrl = window.location.origin + '/vendor/'`)
 * - Rust Headless Edge/Chrome CDP MP4 export (`vendorBaseUrl = './vendor/'`)
 */
export function buildPlayableHyperframeHtml(
  project: SynkcutProject,
  vendorBaseUrl?: string
): string {
  const rawHtml = project.hyperframe?.html || "";
  if (!rawHtml.trim()) return "";

  const base =
    vendorBaseUrl ??
    (typeof window !== "undefined" && window.location?.origin
      ? `${window.location.origin}/vendor/`
      : "./vendor/");

  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const transcript = buildHyperframeTranscript(project);
  const safeJson = JSON.stringify(transcript).replace(/<\//g, "<\\/");

  let html = rawHtml;

  // Rewrite any CDN GSAP / Three.js references to Synkcut's local vendored offline copies!
  html = html.replace(
    /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)[^"']*gsap[^"']*\.js/gi,
    `${normalizedBase}gsap.min.js`
  );
  html = html.replace(
    /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|esm\.sh)[^"']*three(?:\.module)?(?:\.min)?\.js/gi,
    `${normalizedBase}three.module.js`
  );
  html = html.replace(/(['"])(?:\.\/|\/)vendor\//g, `$1${normalizedBase}`);

  // Inject exact audio-locked transcript JSON
  if (html.includes("/*TRANSCRIPT*/null")) {
    html = html.replace("/*TRANSCRIPT*/null", safeJson);
  } else {
    const injectScript = `<script>window.__SYNKCUT_TRANSCRIPT__ = ${safeJson};</script>`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${injectScript}\n</head>`);
    } else {
      html = `${injectScript}\n${html}`;
    }
  }

  return html;
}

export interface HyperframeVerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verifies a generated HyperFrames HTML composition across 5 timestamps inside a hidden offscreen iframe.
 * Catches syntax errors, missing window.render(), WebGL crashes, or GSAP exceptions before entering Studio.
 */
export async function verifyHyperframeOffscreen(
  project: SynkcutProject
): Promise<HyperframeVerifyResult> {
  if (typeof document === "undefined" || !isHyperframeProject(project)) {
    return { ok: true };
  }

  const html = buildPlayableHyperframeHtml(project);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";
  iframe.style.width = "1080px";
  iframe.style.height = "1920px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  try {
    const result = await new Promise<HyperframeVerifyResult>((resolve) => {
      let settled = false;
      const done = (res: HyperframeVerifyResult) => {
        if (settled) return;
        settled = true;
        resolve(res);
      };

      const timeout = window.setTimeout(() => {
        done({ ok: false, error: "HyperFrame timeout: window.render tidak siap dalam 8 detik." });
      }, 8000);

      iframe.onload = () => {
        const win = iframe.contentWindow as (Window & { render?: (t: number) => void }) | null;
        if (!win) {
          window.clearTimeout(timeout);
          done({ ok: false, error: "Gagal mengakses contentWindow iframe HyperFrame." });
          return;
        }

        let runtimeErr: string | null = null;
        win.addEventListener("error", (ev) => {
          runtimeErr = ev.message || "Runtime error pada komposisi HyperFrame.";
        });

        const started = Date.now();
        const poll = () => {
          if (runtimeErr) {
            window.clearTimeout(timeout);
            done({ ok: false, error: runtimeErr });
            return;
          }
          if (typeof win.render === "function") {
            try {
              const totalSec = Math.max(4, getProjectDurationMs(project) / 1000);
              const samples = [0.5, totalSec * 0.25, totalSec * 0.5, totalSec * 0.75, Math.max(0.5, totalSec - 0.5)];
              for (const t of samples) {
                win.render(t);
              }
              window.clearTimeout(timeout);
              done(runtimeErr ? { ok: false, error: runtimeErr } : { ok: true });
            } catch (err) {
              window.clearTimeout(timeout);
              done({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            return;
          }
          if (Date.now() - started > 6500) {
            window.clearTimeout(timeout);
            done({ ok: false, error: "Fungsi window.render(t) tidak didefinisikan di komposisi HTML." });
            return;
          }
          window.setTimeout(poll, 120);
        };
        poll();
      };

      iframe.src = blobUrl;
      document.body.appendChild(iframe);
    });

    return result;
  } finally {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    URL.revokeObjectURL(blobUrl);
  }
}
