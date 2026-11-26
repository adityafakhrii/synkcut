import { useEffect, useMemo, useRef, useState } from "react";
import type { SynkcutProject } from "../types/scene";
import { buildPlayableHyperframeHtml } from "../engine/hyperframeRuntime";

interface HyperframeCanvasProps {
  project: SynkcutProject;
  currentTimeMs: number;
  showSafeZone?: boolean;
  onRuntimeError?: (err: string | null) => void;
}

/**
 * Live 60fps deterministic 1080x1920 HyperFrames preview player inside StudioView.
 * Scales smoothly to fit any desktop viewport while keeping exact 1:1 fidelity with CDP MP4 export.
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

  const playableHtml = useMemo(() => buildPlayableHyperframeHtml(project), [project]);

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

  // Load composition into isolated blob URL iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !playableHtml) return;
    readyRef.current = false;
    setIsLoading(true);
    setRuntimeErr(null);
    onRuntimeError?.(null);

    const blob = new Blob([playableHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    let cancelled = false;

    const handleLoad = () => {
      if (cancelled) return;
      const win = iframe.contentWindow as (Window & { render?: (t: number) => void }) | null;
      if (!win) return;

      win.addEventListener("error", (ev) => {
        if (cancelled) return;
        const msg = ev.message || "Error render HyperFrames";
        setRuntimeErr(msg);
        onRuntimeError?.(msg);
      });

      const started = Date.now();
      const waitForRender = () => {
        if (cancelled) return;
        if (typeof win.render === "function") {
          readyRef.current = true;
          setIsLoading(false);
          try {
            win.render(timeRef.current / 1000);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setRuntimeErr(msg);
            onRuntimeError?.(msg);
          }
          return;
        }
        if (Date.now() - started < 6000) {
          window.setTimeout(waitForRender, 80);
        } else {
          setIsLoading(false);
          const msg = "window.render(t) belum tersedia pada komposisi HTML.";
          setRuntimeErr(msg);
          onRuntimeError?.(msg);
        }
      };
      waitForRender();
    };

    iframe.addEventListener("load", handleLoad, { once: true });
    iframe.src = url;

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", handleLoad);
      URL.revokeObjectURL(url);
    };
  }, [playableHtml, onRuntimeError]);

  // Synchronous 60fps seek on every timeline scrub or animation frame
  useEffect(() => {
    if (!readyRef.current) return;
    const win = iframeRef.current?.contentWindow as
      | (Window & { render?: (t: number) => void })
      | null;
    if (!win || typeof win.render !== "function") return;
    try {
      win.render(currentTimeMs / 1000);
    } catch {
      // Ignore transient frame errors during fast scrub
    }
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
        sandbox="allow-scripts allow-same-origin"
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
