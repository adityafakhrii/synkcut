import { useEffect, useState } from "react";
import {
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Palette,
  Type,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import type { CustomDesignDirection } from "../types/scene";
import {
  analyzeDesignReference,
  extractThumbnails,
  isTauriRuntime,
  pickLocalVideo,
  type StyleReferenceResult,
} from "../lib/tauriBridge";

export interface DesignReferencePanelProps {
  value: StyleReferenceResult | null;
  onChange: (next: StyleReferenceResult | null) => void;
  compact?: boolean;
}

const LAYER_LABELS: Record<string, string> = {
  yt_4frames: "YouTube · 4 Frame Vision",
  yt_dlp: "yt-dlp · 4 frame",
  gemini_direct: "Gemini Video",
  oembed_thumbnail: "YouTube + Custom AI",
  url_vision: "Web Vision AI",
  url_context: "Web + Custom AI",
  vision_ai: "Vision AI Custom",
  custom_ai: "Custom Art Direction AI",
  local_fallback: "Analisis Warna Lokal",
};

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/**
 * Compress an uploaded/pasted image to JPEG data URL AND extract 4 real dominant/accent hex colors
 * directly on canvas so even text-only Custom Models get authentic reference colors!
 */
export function processReferenceImageBlob(
  blob: Blob,
  maxWidth = 512
): Promise<{ dataUrl: string; sampledColors: string[] }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(objUrl);
          reject(new Error("Gagal memproses gambar referensi."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.84);
        const sampledColors = extractColorsFromCanvas(ctx, w, h);
        URL.revokeObjectURL(objUrl);
        resolve({ dataUrl, sampledColors });
      } catch (err) {
        URL.revokeObjectURL(objUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error("Format gambar tidak dapat dibaca. Gunakan PNG, JPG, atau WebP."));
    };
    img.src = objUrl;
  });
}

function sampleColorsFromDataUrl(dataUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        const w = 64;
        const h = 64;
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(extractColorsFromCanvas(ctx, w, h));
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

function extractColorsFromCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): string[] {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const buckets = new Map<string, { r: number; g: number; b: number; count: number; sat: number }>();
    const step = Math.max(1, Math.floor((w * h) / 600));
    for (let i = 0; i < w * h; i += step) {
      const idx = i * 4;
      const a = data[idx + 3];
      if (a < 180) continue;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Quantize to 32-step buckets
      const qr = Math.round(r / 32) * 32;
      const qg = Math.round(g / 32) * 32;
      const qb = Math.round(b / 32) * 32;
      const key = `${qr},${qg},${qb}`;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const cur = buckets.get(key);
      if (cur) {
        cur.r += r;
        cur.g += g;
        cur.b += b;
        cur.count += 1;
        cur.sat += sat;
      } else {
        buckets.set(key, { r, g, b, count: 1, sat });
      }
    }
    const list = Array.from(buckets.values()).map((b) => ({
      hex: rgbToHex(b.r / b.count, b.g / b.count, b.b / b.count),
      count: b.count,
      avgSat: b.sat / b.count,
    }));
    if (list.length === 0) return [];
    list.sort((a, b) => b.count - a.count);
    const result: string[] = [list[0].hex];
    // Pick most vibrant distinct colors as accents
    const vibrant = [...list].sort((a, b) => b.avgSat * Math.sqrt(b.count) - a.avgSat * Math.sqrt(a.count));
    for (const item of vibrant) {
      if (result.length >= 4) break;
      if (!result.includes(item.hex)) {
        result.push(item.hex);
      }
    }
    return result;
  } catch {
    return [];
  }
}

export default function DesignReferencePanel({
  value,
  onChange,
  compact = false,
}: DesignReferencePanelProps) {
  const [tab, setTab] = useState<"images" | "url" | "local_video" | "prompt">("images");
  const [urlInput, setUrlInput] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [sampledColors, setSampledColors] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global Ctrl+V paste listener whenever this panel is mounted (works on ANY tab!)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageBlobs: Blob[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) imageBlobs.push(file);
        }
      }
      if (imageBlobs.length === 0) return;
      e.preventDefault();
      setTab("images");
      setError(null);
      try {
        const nextUrls: string[] = [];
        const nextColors: string[] = [];
        for (const blob of imageBlobs.slice(0, 3)) {
          const processed = await processReferenceImageBlob(blob);
          nextUrls.push(processed.dataUrl);
          nextColors.push(...processed.sampledColors);
        }
        const mergedImages = [...pastedImages, ...nextUrls].slice(0, 3);
        const mergedColors = Array.from(new Set([...sampledColors, ...nextColors])).slice(0, 6);
        setPastedImages(mergedImages);
        setSampledColors(mergedColors);

        // Auto-generate Custom Design Direction immediately on paste!
        await runAnalyzeImages(mergedImages, mergedColors);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pastedImages, sampledColors]);

  async function runAnalyzeImages(imgs: string[], colors: string[]) {
    if (imgs.length === 0) {
      setError("Tempel (Ctrl+V) atau pilih 1–3 gambar referensi desain terlebih dahulu.");
      return;
    }
    setError(null);
    setIsAnalyzing(true);
    try {
      const res = await analyzeDesignReference({
        sourceType: "images",
        title: `Referensi Desain (${imgs.length} gambar)`,
        thumbnails: imgs,
        designPrompt: promptInput.trim() || null,
        sampledColors: colors,
      });
      onChange(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handlePickImageFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const nextUrls: string[] = [];
      const nextColors: string[] = [];
      for (let i = 0; i < Math.min(3, files.length); i++) {
        const processed = await processReferenceImageBlob(files[i]);
        nextUrls.push(processed.dataUrl);
        nextColors.push(...processed.sampledColors);
      }
      const mergedImages = [...pastedImages, ...nextUrls].slice(0, 3);
      const mergedColors = Array.from(new Set([...sampledColors, ...nextColors])).slice(0, 6);
      setPastedImages(mergedImages);
      setSampledColors(mergedColors);
      await runAnalyzeImages(mergedImages, mergedColors);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      e.target.value = "";
    }
  }

  async function handleAnalyzeUrl() {
    if (!urlInput.trim()) {
      setError("Tempel link YouTube/Shorts atau link website/referensi desain terlebih dahulu.");
      return;
    }
    setError(null);
    setIsAnalyzing(true);
    try {
      const res = await analyzeDesignReference({
        sourceType: "url",
        url: urlInput.trim(),
        designPrompt: promptInput.trim() || null,
        thumbnails: [],
        sampledColors: [],
      });
      onChange(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleAnalyzeLocalClip() {
    setError(null);
    if (!isTauriRuntime()) {
      setError("Pilih klip referensi lokal hanya tersedia di aplikasi desktop Synkcut.");
      return;
    }
    const picked = await pickLocalVideo();
    if (!picked) return;
    setIsAnalyzing(true);
    try {
      const thumbs = await extractThumbnails(picked, 3);
      const sampled = thumbs[0] ? await sampleColorsFromDataUrl(thumbs[0]) : [];
      const fileName = picked.split(/[\\/]/).pop() || "Klip Referensi";
      const res = await analyzeDesignReference({
        sourceType: "local_video",
        title: fileName,
        thumbnails: thumbs,
        designPrompt: promptInput.trim() || null,
        sampledColors: sampled,
      });
      onChange(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleAnalyzeTextDirection() {
    if (!promptInput.trim()) {
      setError("Tulis deskripsi gaya desain yang lo inginkan dulu.");
      return;
    }
    setError(null);
    setIsAnalyzing(true);
    try {
      const res = await analyzeDesignReference({
        sourceType: "prompt",
        designPrompt: promptInput.trim(),
        thumbnails: [],
        sampledColors: [],
      });
      onChange(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateCustomDesignField(updater: (cd: CustomDesignDirection) => CustomDesignDirection) {
    if (!value) return;
    const nextCd = updater(value.customDesign);
    onChange({
      ...value,
      styleDnaSummary: nextCd.summary,
      suggestedAccent: nextCd.palette.accentPrimary,
      customDesign: nextCd,
    });
  }

  return (
    <div className="space-y-2.5">
      {/* 4 Reference Source Tabs */}
      <div
        className="grid grid-cols-4 gap-1 rounded-lg p-0.5"
        style={{
          backgroundColor: "var(--bg-panel)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {[
          { id: "images" as const, label: "Gambar", icon: ImageIcon },
          { id: "url" as const, label: "Link", icon: Link2 },
          { id: "local_video" as const, label: "Klip", icon: Film },
          { id: "prompt" as const, label: "Teks", icon: Type },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setError(null);
              }}
              className="inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors cursor-pointer"
              style={{
                backgroundColor: active ? "var(--bg-elevated)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <Icon className="h-3 w-3" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: IMAGES / SCREENSHOT (CTRL+V OR FILE PICKER) */}
      {tab === "images" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              Tekan <strong>Ctrl+V</strong> tempel screenshot desain, atau unggah gambar (maks 3)
            </span>
            <label className="ui-btn-secondary inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold cursor-pointer">
              <Upload className="h-3 w-3" />
              Pilih Gambar
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handlePickImageFiles}
                className="hidden"
              />
            </label>
          </div>

          {pastedImages.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {pastedImages.map((src, idx) => (
                <div key={idx} className="relative overflow-hidden rounded-md">
                  <img
                    src={src}
                    alt={`Referensi ${idx + 1}`}
                    className="h-14 w-full object-cover"
                    style={{ border: "1px solid var(--border-subtle)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setPastedImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-white cursor-pointer"
                    aria-label="Hapus gambar referensi"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {pastedImages.length > 0 && (
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => runAnalyzeImages(pastedImages, sampledColors)}
              className="ui-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
            >
              {isAnalyzing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {isAnalyzing
                ? "Menghasilkan Arahan Desain Custom..."
                : "Generate Ulang Arahan Desain Custom"}
            </button>
          )}
        </div>
      )}

      {/* TAB 2: LINK (YOUTUBE / SHORTS / WEBSITE / DRIBBBLE / BEHANCE / PINTEREST) */}
      {tab === "url" && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAnalyzeUrl();
                }
              }}
              placeholder="Tempel link YouTube, Shorts, Dribbble, Behance, atau web..."
              className="ui-input h-8 min-w-0 flex-1 rounded-md px-2.5 text-xs"
            />
            <button
              type="button"
              disabled={isAnalyzing || !urlInput.trim()}
              onClick={handleAnalyzeUrl}
              className="ui-btn-secondary h-8 shrink-0 rounded-md px-3 text-xs font-semibold disabled:opacity-45 cursor-pointer"
            >
              {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Analisa"}
            </button>
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Mendukung YouTube/Shorts & URL desain web. Bisa juga langsung tekan{" "}
            <strong>Ctrl+V</strong> screenshot kapan saja.
          </p>
        </div>
      )}

      {/* TAB 3: LOCAL REFERENCE CLIP */}
      {tab === "local_video" && (
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={isAnalyzing || !isTauriRuntime()}
            onClick={handleAnalyzeLocalClip}
            className="ui-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            {isAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Pilih Klip Video Referensi (MP4/MOV)
          </button>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            FFmpeg membaca 3 frame sampel untuk menyusun palet & arahan desain custom.
          </p>
        </div>
      )}

      {/* TAB 4: FREE-TEXT CUSTOM DESIGN PROMPT */}
      {tab === "prompt" && (
        <div className="space-y-2">
          <textarea
            rows={2}
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder="Contoh: Gaya neo-brutalist krem hangat & hitam, border tegas, font display bold, aksen kuning-oranye, pacing cepat..."
            className="ui-input w-full resize-none rounded-md p-2 text-xs leading-relaxed"
          />
          <button
            type="button"
            disabled={isAnalyzing || !promptInput.trim()}
            onClick={handleAnalyzeTextDirection}
            className="ui-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold disabled:opacity-45 cursor-pointer"
          >
            {isAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Palette className="h-3.5 w-3.5" />
            )}
            {isAnalyzing ? "Merancang Arahan Desain..." : "Generate Arahan Desain Custom"}
          </button>
        </div>
      )}

      {isAnalyzing && tab === "images" && pastedImages.length === 0 && (
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Menganalisa referensi & menyusun sistem desain custom...
        </div>
      )}

      {error && (
        <div
          className="rounded-md p-2 text-[11px]"
          style={{
            backgroundColor: "var(--danger-soft)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {/* LIVE CUSTOM DESIGN DIRECTION PREVIEW CARD */}
      {value && value.customDesign && (
        <div
          className="rounded-lg p-3 space-y-2.5"
          style={{
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--accent)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{
                  backgroundColor: value.customDesign.palette.accentPrimary,
                  border: `2px solid ${value.customDesign.palette.bgTop}`,
                }}
              />
              <span className="truncate text-xs font-bold">{value.customDesign.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 font-mono-num text-[10px] font-medium"
                style={{
                  backgroundColor: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                {LAYER_LABELS[value.layerUsed] || "Custom AI"}
              </span>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="p-0.5 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
                aria-label="Hapus arahan desain custom"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Live Color Palette Swatches (Custom Extracted — NOT Templates!) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: "BG", hex: value.customDesign.palette.bgTop },
              { label: "BG2", hex: value.customDesign.palette.bgBottom },
              { label: "Teks", hex: value.customDesign.palette.textPrimary },
              { label: "Aksen", hex: value.customDesign.palette.accentPrimary },
              { label: "Aksen 2", hex: value.customDesign.palette.accentSecondary },
            ].map((sw) => (
              <span
                key={sw.label}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono-num"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
                title={`${sw.label}: ${sw.hex}`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{
                    backgroundColor: sw.hex,
                    border: "1px solid rgba(128,128,128,0.35)",
                  }}
                />
                {sw.label}
              </span>
            ))}
          </div>

          {/* Style Character Tokens */}
          <div className="flex flex-wrap gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <span
              className="rounded px-1.5 py-0.5 font-semibold"
              style={{
                backgroundColor:
                  value.customDesign.renderMedium === "3d_diorama"
                    ? "var(--accent-soft)"
                    : "var(--bg-elevated)",
                color:
                  value.customDesign.renderMedium === "3d_diorama"
                    ? "var(--accent)"
                    : "var(--text-primary)",
              }}
            >
              {value.customDesign.renderMedium === "3d_diorama"
                ? "Medium: 3D Diorama"
                : "Medium: 2D Motion"}
            </span>
            {value.customDesign.captionPlacement === "center_middle" && (
              <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: "var(--bg-elevated)" }}>
                Subtitle: Tengah Shorts
              </span>
            )}
            <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: "var(--bg-elevated)" }}>
              Font: {value.customDesign.typography.headingFont}
            </span>
            <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: "var(--bg-elevated)" }}>
              Pacing: {value.customDesign.pacing}
            </span>
          </div>

          {!compact && value.thumbnails.length > 0 && (
            <div className="grid grid-cols-4 gap-1">
              {value.thumbnails.slice(0, 4).map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`Sampel ${i + 1}`}
                  className="h-10 w-full rounded object-cover"
                  style={{ border: "1px solid var(--border-subtle)" }}
                />
              ))}
            </div>
          )}

          {/* Editable Art Direction Summary */}
          <textarea
            rows={2}
            value={value.customDesign.summary}
            onChange={(e) =>
              updateCustomDesignField((cd) => ({
                ...cd,
                summary: e.target.value,
                artDirectionNotes: e.target.value,
              }))
            }
            aria-label="Arahan Desain Custom"
            className="ui-input w-full resize-none rounded p-1.5 text-[11px] leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}
