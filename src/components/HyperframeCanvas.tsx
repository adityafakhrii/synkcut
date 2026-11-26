import { useEffect, useMemo, useRef, useState } from "react";
import type { SynkcutProject } from "../types/scene";
import { buildPlayableHyperframeHtml } from "../engine/hyperframeRuntime";
import { isTauriRuntime, registerHyperframePreview } from "../lib/tauriBridge";

interface HyperframeCanvasProps {
  project: SynkcutProject;
  currentTimeMs: number;
  showSafeZone?: boolean;
  onRuntimeError?: (err: string | null) => void;
}

/**
 * Live 60fps deterministic 1080x1920 HyperFrames preview player inside StudioView.
 * Uses Synkcut's Rust localhost HTTP/1.1 preview server + postMessage bridge in Tauri
 * so ES modules (Three.js r187 + s3-kit.js) and GSAP 3 run 1:1 with MP4 export.
 */
export default function HyperframeCanvas({
  project,
  currentTimeMs,
  showSafeZone = false,
  onRuntimeError,
}: HyperframeCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const timeRef = useRef(currentTimeMs);
  timeRef.current = currentTimeMs;

  const [scale, setScale] = useState(0.32);
  const [isLoading, setIsLoading] = useState(true);
  const [runtimeErr, setRuntimeErr] = useState<string | null>(null);

  const playableHtmlLocal = useMemo(
    () => buildPlayableHyperframeHtml(project, "./vendor/"),
    [project]
  );
  const playableHtmlOrigin = useMemo(
    () => buildPlayableHyperframeHtml(project),
    [project]
  );

  // Dynamically measure container height/width so the 1080x1920 stage fits pixel-perfectly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        setScale(Math.min(rect.width / 1080, rect.height / 1920));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load composition via Rust localhost HTTP server (Tauri) or srcdoc (browser dev) + postMessage bridge
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !playableHtmlLocal) return;
    readyRef.current = false;
    setIsLoading(true);
    setRuntimeErr(null);
    onRuntimeError?.(null);

    let cancelled = false;

    const onMessage = (ev: MessageEvent) => {
      if (cancelled || ev.source !== iframe.contentWindow) return;
      const data = ev.data as { type?: string; message?: string } | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "hf_ready") {
        readyRef.current = true;
        setIsLoading(false);
        setRuntimeErr(null);
        onRuntimeError?.(null);
        iframe.contentWindow?.postMessage(
          { type: "hf_render", t: timeRef.current / 1000 },
          "*"
        );
      } else if (data.type === "hf_error") {
        const msg = data.message || "Error render HyperFrames";
        setIsLoading(false);
        setRuntimeErr(msg);
        onRuntimeError?.(msg);
      }
    };

    window.addEventListener("message", onMessage);

    const timeoutId = window.setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        setIsLoading(false);
        const msg = "window.render(t) belum tersedia pada komposisi HTML.";
        setRuntimeErr(msg);
        onRuntimeError?.(msg);
      }
    }, 9000);

    (async () => {
      let url: string | null = null;
      if (isTauriRuntime()) {
        url = await registerHyperframePreview(playableHtmlLocal);
      }
      if (cancelled) return;
      if (url) {
        iframe.removeAttribute("srcdoc");
        iframe.src = url;
      } else {
        iframe.removeAttribute("src");
        iframe.srcdoc = playableHtmlOrigin;
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    };
  }, [playableHtmlLocal, playableHtmlOrigin, onRuntimeError]);

  // Synchronous 60fps seek on every timeline scrub or animation frame via postMessage
  useEffect(() => {
    if (!readyRef.current) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "hf_render", t: currentTimeMs / 1000 }, "*");
  }, [currentTimeMs]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: "#0e1218" }}
    >
      <iframe
        ref={iframeRef}
        title="HyperFrames 9:16 Preview"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "1080px",
          height: "1920px",
          border: 0,
          transformOrigin: "center center",
          transform: `translate(-50%, -50%) scale(${scale})`,
          pointerEvents: "none",
          display: "block",
        }}
      />

      {isLoading && !runtimeErr && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium"
          style={{ backgroundColor: "rgba(14, 18, 24, 0.72)", color: "#e2e8f0" }}
        >
          Memuat mesin HyperFrames 3D + GSAP...
        </div>
      )}

      {runtimeErr && (
        <div
          className="absolute inset-x-3 bottom-3 rounded-lg p-2.5 text-[11px]"
          style={{
            backgroundColor: "rgba(127, 29, 29, 0.92)",
            color: "#fef2f2",
            border: "1px solid rgba(248, 113, 113, 0.5)",
          }}
        >
          HyperFrames Warning: {runtimeErr}
        </div>
      )}

      {showSafeZone && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-x-0 top-0 border-b border-dashed"
            style={{
              height: "10%",
              backgroundColor: "rgba(239, 68, 68, 0.14)",
              borderColor: "rgba(239, 68, 68, 0.7)",
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0 border-t border-dashed"
            style={{
              height: "20%",
              backgroundColor: "rgba(239, 68, 68, 0.14)",
              borderColor: "rgba(239, 68, 68, 0.7)",
            }}
          />
          <div
            className="absolute top-[10%] right-0 bottom-[20%] border-l border-dashed"
            style={{
              width: "14%",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              borderColor: "rgba(239, 68, 68, 0.6)",
            }}
          />
        </div>
      )}
    </div>
  );
}
