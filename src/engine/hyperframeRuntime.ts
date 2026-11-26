import type { SynkcutProject } from "../types/scene";
import { getProjectDurationMs } from "./sampleProject";
import { isTauriRuntime, registerHyperframePreview } from "../lib/tauriBridge";

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

  // Inject cross-origin-safe postMessage bridge (for live 60fps Studio preview + 5-frame verifier)
  const bridgeScript = `<script>(function(){var r=false;function p(m){try{if(window.parent&&window.parent!==window)window.parent.postMessage(m,'*');}catch(_){}}window.addEventListener('error',function(e){p({type:'hf_error',message:(e&&e.message)?String(e.message):'Script error'});});window.addEventListener('unhandledrejection',function(e){p({type:'hf_error',message:e&&e.reason?String(e.reason.message||e.reason):'Unhandled rejection'});});window.addEventListener('message',function(ev){var d=ev&&ev.data;if(!d||typeof d!=='object')return;if(d.type==='hf_render'&&typeof window.render==='function'){try{window.render(Number(d.t)||0);}catch(err){p({type:'hf_error',message:err&&err.message?err.message:String(err)});}}else if(d.type==='hf_verify'&&Array.isArray(d.samples)){if(typeof window.render!=='function'){p({type:'hf_verified',reqId:d.reqId,ok:false,error:'window.render(t) tidak tersedia.'});return;}try{for(var i=0;i<d.samples.length;i++)window.render(Number(d.samples[i])||0);p({type:'hf_verified',reqId:d.reqId,ok:true});}catch(err){p({type:'hf_verified',reqId:d.reqId,ok:false,error:err&&err.message?err.message:String(err)});}}});function poll(){if(typeof window.render==='function'){if(!r){r=true;p({type:'hf_ready'});}return;}setTimeout(poll,50);}poll();})();</script>`;

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${bridgeScript}\n</head>`);
  } else {
    html = `${bridgeScript}\n${html}`;
  }

  return html;
}

export interface HyperframeVerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verifies a generated HyperFrames HTML composition across 5 timestamps inside a hidden offscreen iframe.
 * Uses Synkcut's local HTTP/1.1 preview server in Tauri (100% identical to MP4 export, zero WebView2 blob/CORS bugs).
 */
export async function verifyHyperframeOffscreen(
  project: SynkcutProject
): Promise<HyperframeVerifyResult> {
  if (typeof document === "undefined" || !isHyperframeProject(project)) {
    return { ok: true };
  }

  let previewUrl: string | null = null;
  let srcdocHtml: string | null = null;

  if (isTauriRuntime()) {
    const localHtml = buildPlayableHyperframeHtml(project, "./vendor/");
    previewUrl = await registerHyperframePreview(localHtml);
  }
  if (!previewUrl) {
    srcdocHtml = buildPlayableHyperframeHtml(project);
  }

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "-9999px";
  iframe.style.width = "1080px";
  iframe.style.height = "1920px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  const reqId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    const result = await new Promise<HyperframeVerifyResult>((resolve) => {
      let settled = false;
      let verifySent = false;

      const onMessage = (ev: MessageEvent) => {
        if (ev.source !== iframe.contentWindow) return;
        const data = ev.data as
          | { type?: string; message?: string; reqId?: string; ok?: boolean; error?: string }
          | null;
        if (!data || typeof data !== "object") return;

        if (data.type === "hf_error") {
          done({ ok: false, error: data.message || "Runtime error pada komposisi HyperFrame." });
          return;
        }
        if (data.type === "hf_ready" && !verifySent) {
          verifySent = true;
          const totalSec = Math.max(4, getProjectDurationMs(project) / 1000);
          const samples = [
            0.5,
            totalSec * 0.25,
            totalSec * 0.5,
            totalSec * 0.75,
            Math.max(0.5, totalSec - 0.5),
          ];
          iframe.contentWindow?.postMessage({ type: "hf_verify", reqId, samples }, "*");
          return;
        }
        if (data.type === "hf_verified" && data.reqId === reqId) {
          done(
            data.ok
              ? { ok: true }
              : { ok: false, error: data.error || "Verifikasi 5-frame HyperFrame gagal." }
          );
        }
      };

      const done = (res: HyperframeVerifyResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(res);
      };

      const timeout = window.setTimeout(() => {
        done({ ok: false, error: "HyperFrame timeout: window.render tidak siap dalam 9 detik." });
      }, 9000);

      window.addEventListener("message", onMessage);

      if (previewUrl) {
        iframe.src = previewUrl;
      } else if (srcdocHtml) {
        iframe.srcdoc = srcdocHtml;
      }
      document.body.appendChild(iframe);
    });

    return result;
  } finally {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}
