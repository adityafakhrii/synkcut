import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Film,
  Layers,
  Loader2,
  Mic,
  Palette,
  Plus,
  Settings2,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import {
  CONTENT_FORMAT_LABELS,
  type ByokStatus,
  type CaptionPreset,
  type ContentFormat,
  type MotionPreset,
  type ProjectStyleReference,
  type SynkcutProject,
  type TransitionPreset,
} from "../types/scene";
import {
  aiAssembleProject,
  aiGenerate3dDiorama,
  aiGenerateBeatCodes,
  aiGenerateScript,
  aiPlanStoryboard,
  extractFootageFrames,
  generateTtsAudio,
  isTauriRuntime,
  listenGenerationProgress,
  pickLocalAudio,
  pickLocalVideos,
  probeMedia,
  processUserAudio,
  resolveAutoRenderMedium,
  toAssetUrl,
  type FootageInputItem,
  type HookOption,
  type PlanStoryboardResponse,
  type ProcessedAudioResult,
  type StyleReferenceResult,
} from "../lib/tauriBridge";
import { verifyAndRepairProjectBeats } from "../engine/freeformPipeline";
import {
  formatStopwatch,
  toFriendlyAiError,
  type FriendlyErrorInfo,
} from "../lib/friendlyError";
import DesignReferencePanel from "./DesignReferencePanel";

interface WizardViewProps {
  initialFormat?: ContentFormat;
  byokStatus: ByokStatus;
  onCancel: () => void;
  onOpenSettings: () => void;
  onSkipToBlank: (format: ContentFormat) => void;
  onProjectCreated: (project: SynkcutProject, generationDurationMs?: number) => void;
}

const FORMAT_LIST: ContentFormat[] = ["ad_promo", "education", "storytelling", "review"];
const TONE_LIST = [
  { id: "santai", label: "Santai (Lo–Gue)" },
  { id: "persuasif", label: "Persuasif (Jualan)" },
  { id: "profesional", label: "Profesional" },
  { id: "lucu", label: "Lucu / Menghibur" },
];
const DURATION_LIST = [15, 30, 60];

const GEMINI_VOICES = [
  { id: "Kore", label: "Kore (Tegas & Jernih)" },
  { id: "Puck", label: "Puck (Energik & Santai)" },
  { id: "Aoede", label: "Aoede (Hangat & Natural)" },
  { id: "Charon", label: "Charon (Berat & Berwibawa)" },
  { id: "Fenrir", label: "Fenrir (Cepat & Dinamis)" },
];

const OPENAI_VOICES = [
  { id: "nova", label: "Nova (Cerah & Modern)" },
  { id: "alloy", label: "Alloy (Seimbang)" },
  { id: "onyx", label: "Onyx (Berat & Tegas)" },
  { id: "shimmer", label: "Shimmer (Ramah)" },
];

const CAPTION_PRESETS: Array<{ id: CaptionPreset; label: string; desc: string }> = [
  { id: "bold_pop", label: "Bold Pop", desc: "Kata aktif membesar + outline tebal" },
  { id: "clean_minimal", label: "Clean Minimal", desc: "Pill bersih untuk edukasi & brand" },
  { id: "kinetic_punch", label: "Kinetic Punch", desc: "2 kata besar per hentakan" },
  { id: "luxury_editorial", label: "Luxury Editorial", desc: "Serif halus bergaya editorial" },
  { id: "neon_tech", label: "Neon Tech", desc: "Sorotan modern untuk tech & gadget" },
];

const MOTION_PRESETS: Array<{ id: MotionPreset; label: string }> = [
  { id: "zoom_punch", label: "Zoom Punch" },
  { id: "smooth_ken_burns", label: "Smooth Ken Burns" },
  { id: "shake_impact", label: "Shake Impact" },
  { id: "slide_reveal", label: "Slide Reveal" },
  { id: "static_clean", label: "Static Clean" },
];

const TRANSITION_PRESETS: Array<{ id: TransitionPreset; label: string }> = [
  { id: "hard_cut", label: "Hard Cut" },
  { id: "whip_pan", label: "Whip Pan" },
  { id: "pop_zoom", label: "Pop Zoom" },
  { id: "glitch_flash", label: "Glitch Flash" },
  { id: "smooth_crossfade", label: "Smooth Crossfade" },
];

const BGM_PRESETS = [
  { id: "upbeat_promo", label: "Upbeat Promo" },
  { id: "lofi_education", label: "Lo-Fi Edukasi" },
  { id: "cinematic_story", label: "Cinematic Story" },
  { id: "tech_modern", label: "Tech Modern" },
  { id: "trendy_funk", label: "Trendy Funk" },
  { id: "chill_aesthetic", label: "Chill Aesthetic" },
];

const ACCENT_SWATCHES = ["#38E59D", "#F59E0B", "#38BDF8", "#F43F5E", "#FFFFFF"];

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)} dtk`;
}

export default function WizardView({
  initialFormat = "ad_promo",
  byokStatus,
  onCancel,
  onOpenSettings,
  onSkipToBlank,
  onProjectCreated,
}: WizardViewProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1: Visual Mode, Optional Custom Design Reference, Brief & Script
  const [visualMode, setVisualMode] = useState<"motion" | "footage" | "hybrid">(
    initialFormat === "education" ? "motion" : "hybrid"
  );
  const [mediumChoice, setMediumChoice] = useState<"auto" | "3d_diorama" | "2d_freeform">("auto");
  const [showRefPanel, setShowRefPanel] = useState(false);
  const [styleRefResult, setStyleRefResult] = useState<StyleReferenceResult | null>(null);
  const [scriptInputMode, setScriptInputMode] = useState<"structured" | "raw">("structured");
  const [rawScript, setRawScript] = useState("");

  const [format, setFormat] = useState<ContentFormat>(initialFormat);
  const [tone, setTone] = useState("santai");
  const [targetDuration, setTargetDuration] = useState(30);
  const [topic, setTopic] = useState("");
  const [projectTitle, setProjectTitle] = useState("Konten Baru");
  const [hooks, setHooks] = useState<HookOption[]>([
    {
      id: "h1",
      angle: "Pain Point",
      text: "Capek bikin konten lama tapi views masih segitu-gitu aja?",
    },
    {
      id: "h2",
      angle: "Curiosity",
      text: "Ternyata satu perubahan di tiga detik pertama ini bisa langsung naikkan retensi!",
    },
    {
      id: "h3",
      angle: "Bold Claim",
      text: "Cukup dua menit, footage mentah langsung jadi konten siap tayang.",
    },
  ]);
  const [selectedHookId, setSelectedHookId] = useState("h1");
  const [bodySegments, setBodySegments] = useState<string[]>([
    "Tunjukkan masalah utama dan demo produk lo secara langsung dengan visual yang dekat.",
    "Berikan satu bukti nyata atau keunggulan yang membedakan produk lo dari yang lain.",
  ]);
  const [ctaText, setCtaText] = useState("Cek link sekarang sebelum promo minggu ini selesai!");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptProviderUsed, setScriptProviderUsed] = useState<string | null>(null);
  const wizardTopicRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = wizardTopicRef.current;
    if (!el) return;
    el.style.height = "auto";
    const minH = 84;
    const maxH = 260;
    const nextH = Math.min(maxH, Math.max(minH, el.scrollHeight));
    el.style.height = `${nextH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }, [topic]);

  // Step 2: Footage & Audio Auto-Sync
  const [footageClips, setFootageClips] = useState<FootageInputItem[]>([]);
  const [isLoadingFootage, setIsLoadingFootage] = useState(false);
  const [audioTab, setAudioTab] = useState<"tts" | "recorded">("tts");
  const [ttsEngine, setTtsEngine] = useState<"gemini" | "openai" | "windows_offline">(
    byokStatus.providers.gemini?.configured
      ? "gemini"
      : byokStatus.providers.openai?.configured
        ? "openai"
        : "windows_offline"
  );
  const [ttsVoice, setTtsVoice] = useState(
    byokStatus.providers.openai?.configured && !byokStatus.providers.gemini?.configured
      ? "nova"
      : "Kore"
  );
  const [trimSilence, setTrimSilence] = useState(true);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioResult, setAudioResult] = useState<ProcessedAudioResult | null>(null);

  // Mic Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Optional Advanced Manual Overrides (Hidden inside collapsed accordion by default — AI Auto-Director handles everything!)
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>("bold_pop");
  const [accentColor, setAccentColor] = useState("#38E59D");
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("zoom_punch");
  const [transitionPreset, setTransitionPreset] = useState<TransitionPreset>("pop_zoom");
  const overlayMode = "auto" as const;
  const [bgmPreset, setBgmPreset] = useState("auto");
  const [autoDucking, setAutoDucking] = useState(true);
  const [autoSfx, setAutoSfx] = useState(true);
  const [isAssembling, setIsAssembling] = useState(false);
  const [assembleStatus, setAssembleStatus] = useState("");
  const [assembleElapsedMs, setAssembleElapsedMs] = useState(0);
  const [assembleError, setAssembleError] = useState<FriendlyErrorInfo | null>(null);
  const [failedOn3d, setFailedOn3d] = useState(false);

  // Checkpoint cache so retrying NEVER repeats already-completed Storyboard planning!
  const storyboardCheckpointRef = useRef<{
    key: string;
    planned: PlanStoryboardResponse;
  } | null>(null);
  const assembleRunIdRef = useRef(0);

  useEffect(() => {
    if (!isAssembling) return;
    const startedAt = Date.now();
    setAssembleElapsedMs(0);
    const id = window.setInterval(() => {
      setAssembleElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(id);
  }, [isAssembling]);

  useEffect(() => {
    if (!isAssembling) return;
    let unlisten: (() => void) | null = null;
    listenGenerationProgress((msg) => setAssembleStatus(msg)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isAssembling]);

  const selectedHookText =
    hooks.find((h) => h.id === selectedHookId)?.text || hooks[0]?.text || "";

  const structuredScriptText = [selectedHookText, ...bodySegments.filter((s) => s.trim()), ctaText]
    .filter((s) => s.trim())
    .join(" ");

  const fullScriptText =
    scriptInputMode === "raw" ? rawScript.trim() : structuredScriptText;

  const resolvedMedium = resolveAutoRenderMedium({
    preference: mediumChoice,
    styleRef: styleRefResult,
    topicOrScript: `${topic} ${projectTitle} ${fullScriptText}`,
  });

  const hasAnyByok = Object.values(byokStatus.providers).some((p) => p.configured);
  const isFootageMandatoryMissing = visualMode === "footage" && footageClips.length === 0;
  const isScriptMandatoryMissing = fullScriptText.trim().length === 0;

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  function applyStyleSuggestions(res: StyleReferenceResult | null) {
    setStyleRefResult(res);
    if (!res) return;
    setCaptionPreset(res.suggestedCaption);
    setAccentColor(res.customDesign?.palette.accentPrimary || res.suggestedAccent);
    if (res.customDesign?.preferredMotion) {
      setMotionPreset(res.customDesign.preferredMotion);
    }
    if (res.customDesign?.preferredTransition) {
      setTransitionPreset(res.customDesign.preferredTransition);
    }
    if (res.customDesign?.recommendedBgm) {
      setBgmPreset(res.customDesign.recommendedBgm);
    }
  }

  async function handleGenerateScript() {
    setScriptError(null);
    if (!topic.trim()) {
      setScriptError("Tulis dulu topik, produk, atau pesan utama konten lo.");
      return;
    }

    setIsGeneratingScript(true);
    try {
      const res = await aiGenerateScript({
        topic: topic.trim(),
        format,
        tone,
        targetDurationSec: targetDuration,
        visualMode,
        styleReferenceSummary:
          styleRefResult?.customDesign?.artDirectionNotes ??
          styleRefResult?.styleDnaSummary ??
          null,
      });
      setProjectTitle(res.projectTitle);
      setHooks(res.hooks);
      setSelectedHookId(res.hooks[0]?.id || "h1");
      setBodySegments(res.bodySegments);
      setCtaText(res.cta);
      setRawScript(
        [res.hooks[0]?.text || "", ...res.bodySegments, res.cta]
          .filter((s) => s.trim())
          .join("\n")
      );
      setScriptProviderUsed(res.providerUsed);
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingScript(false);
    }
  }

  async function handleAddFootage() {
    if (!isTauriRuntime()) return;
    const paths = await pickLocalVideos();
    if (paths.length === 0) return;

    setIsLoadingFootage(true);
    setAudioError(null);
    try {
      const added: FootageInputItem[] = [];
      for (const path of paths) {
        if (footageClips.some((c) => c.path === path)) continue;
        const info = await probeMedia(path);
        const frames = await extractFootageFrames(path, 4);
        const fileName = path.split(/[\\/]/).pop() || "footage.mp4";
        added.push({
          path,
          fileName,
          durationMs: info.durationMs,
          thumbnails: frames.map((f) => f.dataUrl),
          frameTimestampsMs: frames.map((f) => f.timestampMs),
        });
      }
      setFootageClips((prev) => [...prev, ...added]);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingFootage(false);
    }
  }

  async function handleGenerateTts() {
    setAudioError(null);
    if (!fullScriptText.trim()) {
      setAudioError("Script kosong. Lengkapi Hook, Body, dan CTA di Langkah 1.");
      return;
    }
    setIsProcessingAudio(true);
    try {
      const res = await generateTtsAudio({
        text: fullScriptText,
        voiceName: ttsVoice,
        tone,
        engine: ttsEngine,
      });
      setAudioResult(res);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessingAudio(false);
    }
  }

  async function handleUploadUserAudio() {
    setAudioError(null);
    const picked = await pickLocalAudio();
    if (!picked) return;
    setIsProcessingAudio(true);
    try {
      const res = await processUserAudio({
        inputPath: picked,
        trimSilence,
        knownScript: fullScriptText,
      });
      setAudioResult(res);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessingAudio(false);
    }
  }

  async function handleToggleRecording() {
    setAudioError(null);
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);

        setIsProcessingAudio(true);
        try {
          const res = await processUserAudio({
            recordedBytes: bytes,
            recordedExt: "webm",
            trimSilence,
            knownScript: fullScriptText,
          });
          setAudioResult(res);
        } catch (err) {
          setAudioError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsProcessingAudio(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setAudioError("Akses mikrofon ditolak atau tidak tersedia. Pastikan izin mic Windows aktif.");
    }
  }

  async function handleAssembleProject(overrideMedium?: "2d_freeform" | "3d_diorama") {
    setAssembleError(null);
    setFailedOn3d(false);
    if (isScriptMandatoryMissing) {
      setAssembleError(
        toFriendlyAiError("Script video wajib diisi di Langkah 1 sebelum meracik video.")
      );
      return;
    }
    if (isFootageMandatoryMissing) {
      setAssembleError(
        toFriendlyAiError("Mode Footage wajib melampirkan minimal 1 video footage di Langkah 2.")
      );
      return;
    }
    const myRunId = ++assembleRunIdRef.current;
    const startMs = Date.now();
    setIsAssembling(true);
    let attempted3d = false;
    try {
      const styleReference: ProjectStyleReference | null = styleRefResult
        ? {
            sourceType: styleRefResult.sourceType,
            url: styleRefResult.url ?? undefined,
            title: styleRefResult.title,
            thumbnails: styleRefResult.thumbnails,
            styleDnaSummary: styleRefResult.styleDnaSummary,
            customDesign: styleRefResult.customDesign,
          }
        : null;

      // Detect if Step 1 script was edited after Step 2 TTS sample was generated!
      let finalAudio = audioResult;
      if (
        finalAudio &&
        audioTab === "tts" &&
        finalAudio.transcript &&
        finalAudio.transcript.trim() !== fullScriptText.trim()
      ) {
        finalAudio = null;
      }

      const resolvedBgm =
        bgmPreset === "auto"
          ? styleRefResult?.customDesign?.recommendedBgm ||
            (format === "education" ? "lofi_education" : "upbeat_promo")
          : bgmPreset;

      // v2.3.0 Parallel TTS + Storyboard + Checkpointing (35-50% faster & never restarts finished stages!)
      if ((visualMode === "motion" || visualMode === "hybrid") && isTauriRuntime() && hasAnyByok) {
        const checkpointKey = `${projectTitle.trim()}::${format}::${fullScriptText.trim()}::${styleRefResult?.customDesign?.name ?? ""}`;
        const cachedSb =
          storyboardCheckpointRef.current?.key === checkpointKey
            ? storyboardCheckpointRef.current.planned
            : null;

        let planned: PlanStoryboardResponse;
        if (!finalAudio && !cachedSb && fullScriptText.trim()) {
          setAssembleStatus("Membuat suara dubbing & storyboard secara paralel...");
          const estMs = Math.max(
            6000,
            Math.round(fullScriptText.trim().split(/\s+/).filter(Boolean).length * 410)
          );
          const [ttsRes, sbRes] = await Promise.allSettled([
            generateTtsAudio({
              text: fullScriptText.trim(),
              voiceName: ttsVoice,
              tone,
              engine: ttsEngine,
            }),
            aiPlanStoryboard({
              projectTitle: projectTitle.trim() || topic.trim().slice(0, 32) || "Konten Baru",
              format,
              fullScript: fullScriptText.trim(),
              durationMs: estMs,
              words: [],
              customDesign: styleRefResult?.customDesign ?? null,
              styleReference,
            }),
          ]);
          if (assembleRunIdRef.current !== myRunId) return;
          if (ttsRes.status === "fulfilled") {
            finalAudio = ttsRes.value;
            setAudioResult(finalAudio);
          }
          if (sbRes.status === "rejected") {
            throw sbRes.reason;
          }
          planned = sbRes.value;
          storyboardCheckpointRef.current = { key: checkpointKey, planned };
        } else {
          if (!finalAudio && fullScriptText.trim()) {
            setAssembleStatus("1/3 Membuat suara dubbing & sinkronisasi kata...");
            try {
              finalAudio = await generateTtsAudio({
                text: fullScriptText.trim(),
                voiceName: ttsVoice,
                tone,
                engine: ttsEngine,
              });
              if (assembleRunIdRef.current !== myRunId) return;
              setAudioResult(finalAudio);
            } catch {
              finalAudio = null;
            }
          }
          if (cachedSb) {
            planned = cachedSb;
            setAssembleStatus("Melanjutkan dari checkpoint storyboard...");
          } else {
            setAssembleStatus("2/3 Merancang storyboard micro-beat...");
            planned = await aiPlanStoryboard({
              projectTitle: projectTitle.trim() || topic.trim().slice(0, 32) || "Konten Baru",
              format,
              fullScript: fullScriptText.trim(),
              durationMs: finalAudio?.durationMs ?? targetDuration * 1000,
              words: finalAudio?.words ?? [],
              customDesign: styleRefResult?.customDesign ?? null,
              styleReference,
            });
            if (assembleRunIdRef.current !== myRunId) return;
            storyboardCheckpointRef.current = { key: checkpointKey, planned };
          }
        }

        // Lock parallel storyboard beat timings 100% to actual voiceover duration!
        let syncedBeats = planned.beats;
        if (finalAudio && finalAudio.durationMs >= 1000 && syncedBeats.length > 0) {
          const weights = syncedBeats.map((b) =>
            Math.max(1, (b.text || "").trim().split(/\s+/).filter(Boolean).length)
          );
          const totalW = weights.reduce((a, b) => a + b, 0) || 1;
          let cursor = 0;
          syncedBeats = syncedBeats.map((b, idx) => {
            const startMs = cursor;
            const endMs =
              idx === syncedBeats.length - 1
                ? finalAudio!.durationMs
                : Math.min(
                    finalAudio!.durationMs - (syncedBeats.length - 1 - idx) * 600,
                    Math.max(
                      startMs + 600,
                      Math.round(startMs + (weights[idx] / totalW) * finalAudio!.durationMs)
                    )
                  );
            cursor = endMs;
            return { ...b, startMs, endMs };
          });
        }

        const effectiveCustomDesign =
          styleRefResult?.customDesign ?? planned.autoDesign ?? null;
        const effectiveMedium = overrideMedium
          ? overrideMedium
          : resolveAutoRenderMedium({
              preference: mediumChoice,
              styleRef: styleRefResult,
              aiRecommendedMedium: planned.recommendedMedium ?? null,
              topicOrScript: `${topic} ${projectTitle} ${fullScriptText}`,
            });
        const effectiveAccent =
          effectiveCustomDesign?.palette.accentPrimary || accentColor;
        const effectiveBgm =
          bgmPreset === "auto"
            ? effectiveCustomDesign?.recommendedBgm || resolvedBgm
            : bgmPreset;

        let rawProj: SynkcutProject;
        if (effectiveMedium === "3d_diorama" && (visualMode === "motion" || footageClips.length === 0)) {
          attempted3d = true;
          setAssembleStatus("Tahap 1/2: Membangun objek, pencahayaan & dunia 3D...");
          rawProj = await aiGenerate3dDiorama({
            projectTitle: projectTitle.trim() || topic.trim().slice(0, 32) || "3D Scene",
            format,
            beats: syncedBeats,
            words: finalAudio?.words ?? [],
            customDesign: effectiveCustomDesign,
            styleReference,
            audioPath: finalAudio?.audioPath ?? null,
            audioSource: finalAudio?.audioPath ? (audioTab === "tts" ? "tts" : "recorded") : "demo",
            trimSilence,
            captionPreset,
            accentColor: effectiveAccent,
            bgmPreset: effectiveBgm,
            autoDucking,
            autoSfx,
          });
        } else {
          setAssembleStatus(
            `3/3 Menulis kode motion 2D untuk ${syncedBeats.length} beat secara paralel...`
          );
          rawProj = await aiGenerateBeatCodes({
            projectTitle: projectTitle.trim() || topic.trim().slice(0, 32) || "Konten Baru",
            format,
            beats: syncedBeats,
            words: finalAudio?.words ?? [],
            customDesign: effectiveCustomDesign,
            styleReference,
            audioPath: finalAudio?.audioPath ?? null,
            audioSource: finalAudio?.audioPath ? (audioTab === "tts" ? "tts" : "recorded") : "demo",
            trimSilence,
            captionPreset,
            accentColor: effectiveAccent,
            bgmPreset: effectiveBgm,
            autoDucking,
            autoSfx,
            footage: visualMode === "motion" ? [] : footageClips,
            visualMode,
          });
        }

        if (assembleRunIdRef.current !== myRunId) return;
        const verified = await verifyAndRepairProjectBeats(rawProj, (msg) => {
          if (assembleRunIdRef.current === myRunId) setAssembleStatus(msg);
        });
        if (assembleRunIdRef.current !== myRunId) return;
        storyboardCheckpointRef.current = null;
        onProjectCreated(verified.project, Date.now() - startMs);
        return;
      }

      if (!finalAudio && fullScriptText.trim()) {
        setAssembleStatus("Membuat suara dubbing & sinkronisasi kata...");
        try {
          finalAudio = await generateTtsAudio({
            text: fullScriptText.trim(),
            voiceName: ttsVoice,
            tone,
            engine: ttsEngine,
          });
          if (assembleRunIdRef.current !== myRunId) return;
          setAudioResult(finalAudio);
        } catch {
          finalAudio = null;
        }
      }

      setAssembleStatus("Merakit video & memotong footage otomatis sesuai dubbing...");
      const project = await aiAssembleProject({
        projectTitle: projectTitle.trim() || topic.trim().slice(0, 32) || "Konten Baru",
        format,
        hookText: selectedHookText,
        bodySegments: bodySegments.filter((s) => s.trim().length > 0),
        ctaText,
        rawScript: scriptInputMode === "raw" ? rawScript.trim() : null,
        audioPath: finalAudio?.audioPath ?? null,
        audioSource: finalAudio?.audioPath ? (audioTab === "tts" ? "tts" : "recorded") : "tts",
        trimSilence,
        durationMs: finalAudio?.durationMs ?? 0,
        words: finalAudio?.words ?? [],
        footage: visualMode === "motion" ? [] : footageClips,
        captionPreset,
        accentColor: styleRefResult?.customDesign?.palette.accentPrimary || accentColor,
        motionPreset,
        transitionPreset,
        overlayMode,
        bgmPreset: resolvedBgm,
        autoDucking,
        autoSfx,
        visualMode,
        motionTheme: styleRefResult?.suggestedTheme ?? "carbon",
        preferredEngines: ["custom_code"],
        styleReference,
        customDesign: styleRefResult?.customDesign ?? null,
        autoGenerateVoiceover: !finalAudio,
        ttsEngine,
        ttsVoice,
        ttsTone: tone,
      });
      if (assembleRunIdRef.current !== myRunId) return;
      onProjectCreated(project, Date.now() - startMs);
    } catch (err) {
      if (assembleRunIdRef.current !== myRunId) return;
      setFailedOn3d(attempted3d);
      setAssembleError(toFriendlyAiError(err));
    } finally {
      if (assembleRunIdRef.current === myRunId) {
        setIsAssembling(false);
        setAssembleStatus("");
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top Wizard Header + 3-Step Indicator */}
      <header
        className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Batal
          </button>
          <h1 className="text-base font-bold tracking-tight">Wizard Racik Konten</h1>
        </div>

        {/* Clean 2-Step Sat-Set Progress */}
        <div className="hidden items-center gap-2 md:flex">
          {[
            { num: 1 as const, label: "Ide, Referensi & Script" },
            { num: 2 as const, label: "Suara & Rencana AI" },
          ].map((s, idx) => {
            const active = step === s.num;
            const done = step > s.num;
            return (
              <div key={s.num} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(s.num)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-elevated)" : "transparent",
                    color: active
                      ? "var(--text-primary)"
                      : done
                        ? "var(--text-secondary)"
                        : "var(--text-muted)",
                    border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
                  }}
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full font-mono-num text-[11px] font-bold"
                    style={{
                      backgroundColor: done
                        ? "var(--accent)"
                        : active
                          ? "var(--cta-bg)"
                          : "var(--bg-elevated)",
                      color: done ? "#ffffff" : active ? "var(--cta-fg)" : "var(--text-muted)",
                    }}
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : s.num}
                  </span>
                  {s.label}
                </button>
                {idx < 1 && (
                  <span className="h-[1px] w-6" style={{ backgroundColor: "var(--border-subtle)" }} />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenSettings}
            className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer"
            title="Ganti provider atau model AI tanpa mereset script & progress Wizard"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: hasAnyByok ? "var(--success)" : "var(--warning)" }}
            />
            {byokStatus.providers[byokStatus.activeProvider]?.model || byokStatus.activeProvider}
            <span style={{ color: "var(--accent)" }}>· Ganti</span>
          </button>
          <button
            type="button"
            onClick={() => onSkipToBlank(format)}
            className="text-xs font-medium hover:underline cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            Lewati ke Studio
          </button>
        </div>
      </header>

      {/* Main Wizard Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-5xl">
          {/* BYOK Hint Banner if not configured */}
          {!hasAnyByok && (
            <div
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-xs"
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>
                API Key BYOK belum diatur. Kamu tetap bisa edit manual, atau hubungkan Gemini Key
                gratis untuk mengaktifkan AI Script, TTS, dan Multimodal Director.
              </span>
              <button
                type="button"
                onClick={onOpenSettings}
                className="ui-btn-secondary shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer"
              >
                Atur BYOK Sekarang
              </button>
            </div>
          )}

          {/* ==================== STEP 1: IDE & SCRIPT ==================== */}
          {step === 1 && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left: Brief Input */}
              <div className="ui-panel rounded-xl p-5 lg:col-span-5 space-y-4">
                <div>
                  <h2 className="text-sm font-bold">Brief Konten</h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Pilih mode visual (AI Motion / Footage / Campur), tulis topik, dan tambahkan
                    referensi gaya bila perlu.
                  </p>
                </div>

                {/* 3 Visual Modes Selector */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Mode Visual Video</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      {
                        id: "motion" as const,
                        label: "AI Motion",
                        sub: "Tanpa footage",
                        icon: Shapes,
                      },
                      {
                        id: "footage" as const,
                        label: "Footage",
                        sub: "Klip lokal",
                        icon: Film,
                      },
                      {
                        id: "hybrid" as const,
                        label: "Campur",
                        sub: "Hybrid",
                        icon: Layers,
                      },
                    ].map((vm) => {
                      const Icon = vm.icon;
                      const active = visualMode === vm.id;
                      return (
                        <button
                          key={vm.id}
                          type="button"
                          onClick={() => {
                            setVisualMode(vm.id);
                            if (vm.id === "footage" && !rawScript.trim()) {
                              setScriptInputMode("raw");
                            }
                          }}
                          className="flex flex-col items-start gap-0.5 rounded-lg p-2.5 text-left transition-colors cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--accent)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          <span
                            className="inline-flex items-center gap-1 text-xs font-bold"
                            style={{ color: active ? "var(--accent)" : "var(--text-primary)" }}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {vm.label}
                          </span>
                          <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {vm.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Format Konten</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FORMAT_LIST.map((f) => {
                      const active = format === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFormat(f)}
                          className="ui-row rounded-md px-3 py-2 text-left text-xs font-medium cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--border-strong)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          {CONTENT_FORMAT_LABELS[f].label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Gaya Bahasa</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                    >
                      {TONE_LIST.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Target Durasi</label>
                    <div className="grid grid-cols-3 gap-1">
                      {DURATION_LIST.map((d) => {
                        const active = targetDuration === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setTargetDuration(d)}
                            className="rounded-md py-2 font-mono-num text-xs font-semibold cursor-pointer"
                            style={{
                              backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                              border: active
                                ? "1px solid var(--border-strong)"
                                : "1px solid var(--border-subtle)",
                            }}
                          >
                            {d}s
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="wizard-topic" className="mb-1.5 block text-xs font-semibold">
                    Topik / Produk / Promo
                  </label>
                  <textarea
                    ref={wizardTopicRef}
                    id="wizard-topic"
                    rows={3}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Contoh: Cara kerja DNS internet dalam 30 detik, atau kopi susu gula aren botolan 1 liter Rp45.000..."
                    className="ui-input w-full resize-none rounded-lg p-3 text-xs leading-relaxed"
                    style={{ minHeight: 84, maxHeight: 260 }}
                  />
                </div>

                {/* Custom Design Reference Panel (Images / Ctrl+V / URL / Clip / Text Prompt) */}
                <div
                  className="rounded-lg p-3 space-y-2.5"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: styleRefResult
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowRefPanel((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold">
                        <Palette className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                        <span>Referensi & Arahan Desain Custom</span>
                      </div>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {styleRefResult
                          ? `Desain Custom Aktif: ${styleRefResult.customDesign.name}`
                          : "Gambar/Ctrl+V, Link YouTube/Web, Klip Lokal, atau Deskripsi Teks"}
                      </p>
                    </div>
                    {showRefPanel ? (
                      <ChevronUp className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                    )}
                  </button>

                  {showRefPanel && (
                    <div className="border-t pt-2.5" style={{ borderColor: "var(--border-subtle)" }}>
                      <DesignReferencePanel
                        value={styleRefResult}
                        onChange={applyStyleSuggestions}
                      />
                    </div>
                  )}
                </div>

                {scriptError && (
                  <div
                    className="rounded-md p-3 text-xs"
                    style={{
                      backgroundColor: "var(--danger-soft)",
                      border: "1px solid var(--danger)",
                      color: "var(--danger)",
                    }}
                  >
                    {scriptError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isGeneratingScript}
                  onClick={handleGenerateScript}
                  className="ui-btn-primary flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingScript ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Meracik 3 Opsi Hook & Script...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate 3 Opsi Hook & Script
                    </>
                  )}
                </button>
              </div>

              {/* Right: Hook Picker + Inline Editable Body & CTA */}
              <div className="ui-panel rounded-xl p-5 lg:col-span-7 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Judul Proyek
                    </label>
                    <input
                      type="text"
                      value={projectTitle}
                      onChange={(e) => setProjectTitle(e.target.value)}
                      className="ui-input h-8 w-full rounded-md px-2.5 text-sm font-semibold"
                    />
                  </div>
                  {scriptProviderUsed && (
                    <span
                      className="mt-4 shrink-0 rounded px-2 py-1 font-mono-num text-[11px]"
                      style={{
                        backgroundColor: "var(--success-soft)",
                        color: "var(--success)",
                      }}
                    >
                      AI: {scriptProviderUsed}
                    </span>
                  )}
                </div>

                {/* Mode Toggle: Tempel Script Utuh vs Struktur Hook-Body-CTA */}
                <div
                  className="grid grid-cols-2 gap-1 rounded-lg p-1"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setScriptInputMode("raw")}
                    className="rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: scriptInputMode === "raw" ? "var(--bg-panel)" : "transparent",
                      color: scriptInputMode === "raw" ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    Tempel Script Utuh {visualMode === "footage" ? "(Disarankan)" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScriptInputMode("structured")}
                    className="rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor:
                        scriptInputMode === "structured" ? "var(--bg-panel)" : "transparent",
                      color:
                        scriptInputMode === "structured"
                          ? "var(--text-primary)"
                          : "var(--text-muted)",
                    }}
                  >
                    Struktur Hook–Body–CTA
                  </button>
                </div>

                {scriptInputMode === "raw" ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold">
                        Script Lengkap Video <span style={{ color: "var(--danger)" }}>*Wajib</span>
                      </span>
                      <span className="font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {rawScript.trim() ? rawScript.trim().split(/\s+/).length : 0} kata
                      </span>
                    </div>
                    <textarea
                      rows={10}
                      value={rawScript}
                      onChange={(e) => setRawScript(e.target.value)}
                      placeholder="Tempel seluruh naskah / script video lo di sini. AI akan memecahnya otomatis menjadi rangkaian cut video yang sinkron persis dengan suara voiceover..."
                      className="ui-input w-full resize-none rounded-lg p-3 text-xs leading-relaxed"
                    />
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Tips: Pisahkan kalimat dengan titik atau baris baru agar ritme potong cut antar
                      footage makin tajam dan alami.
                    </p>
                  </div>
                ) : (
                  <>
                {/* 3 Hook Options */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: "var(--role-hook)" }}
                      />
                      Pilih 1 dari 3 Opsi Hook (0–3 detik)
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Klik untuk pilih · bisa langsung edit
                    </span>
                  </div>

                  <div className="space-y-2">
                    {hooks.map((h) => {
                      const active = selectedHookId === h.id;
                      return (
                        <div
                          key={h.id}
                          onClick={() => setSelectedHookId(h.id)}
                          className="rounded-lg p-3 transition-colors cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                            border: active
                              ? "1px solid var(--border-strong)"
                              : "1px solid var(--border-subtle)",
                          }}
                        >
                          <div className="mb-1.5 flex items-center justify-between">
                            <span
                              className="text-[11px] font-semibold"
                              style={{
                                color: active ? "var(--accent)" : "var(--text-secondary)",
                              }}
                            >
                              {h.angle}
                            </span>
                            {active && (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-semibold"
                                style={{ color: "var(--accent)" }}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Dipilih
                              </span>
                            )}
                          </div>
                          <textarea
                            rows={2}
                            value={h.text}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              setSelectedHookId(h.id);
                              setHooks((prev) =>
                                prev.map((item) =>
                                  item.id === h.id ? { ...item, text: e.target.value } : item
                                )
                              );
                            }}
                            className="ui-input w-full resize-none rounded p-2 text-xs leading-relaxed"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Body Segments */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: "var(--role-body)" }}
                      />
                      Body ({bodySegments.length} segmen)
                    </span>
                    <button
                      type="button"
                      onClick={() => setBodySegments((prev) => [...prev, ""])}
                      className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Segmen
                    </button>
                  </div>

                  <div className="space-y-2">
                    {bodySegments.map((seg, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <textarea
                          rows={2}
                          value={seg}
                          onChange={(e) =>
                            setBodySegments((prev) =>
                              prev.map((item, i) => (i === idx ? e.target.value : item))
                            )
                          }
                          placeholder={`Segmen body ${idx + 1}...`}
                          className="ui-input flex-1 resize-none rounded-md p-2.5 text-xs leading-relaxed"
                        />
                        {bodySegments.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setBodySegments((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="ui-btn-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-md cursor-pointer"
                            style={{ color: "var(--danger)" }}
                            aria-label="Hapus segmen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "var(--role-cta)" }}
                    />
                    CTA / Penutup
                  </label>
                  <textarea
                    rows={2}
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    className="ui-input w-full resize-none rounded-md p-2.5 text-xs leading-relaxed"
                  />
                </div>
                  </>
                )}

                <div
                  className="flex items-center justify-between border-t pt-4"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <span className="text-[11px]" style={{ color: isScriptMandatoryMissing ? "var(--danger)" : "var(--text-muted)" }}>
                    {isScriptMandatoryMissing ? "Script wajib diisi sebelum lanjut." : "Script siap untuk disinkronkan ke suara & cut."}
                  </span>
                  <button
                    type="button"
                    disabled={isScriptMandatoryMissing}
                    onClick={() => setStep(2)}
                    className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold disabled:opacity-45 cursor-pointer"
                  >
                    Lanjut: Suara &amp; Rencana AI
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 2 (FINAL SAT-SET): SUARA & RENCANA OTOMATIS AI ==================== */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Left Column: Voiceover Dubbing (+ Multi-Footage Uploader when Footage/Hybrid) */}
                <div className="space-y-4 lg:col-span-6">
                  {/* Voiceover Card */}
                  <div className="ui-panel rounded-xl p-5 space-y-4">
                    <div>
                      <h2 className="text-sm font-bold">1. Suara Dubbing (Voiceover)</h2>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        Dengarkan sampel suaranya dulu, atau langsung klik Buat Video agar AI membuat suara otomatis.
                      </p>
                    </div>

                    <div
                      className="grid grid-cols-2 rounded-lg p-1"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setAudioTab("tts")}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                        style={{
                          backgroundColor: audioTab === "tts" ? "var(--bg-panel)" : "transparent",
                          color: audioTab === "tts" ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        TTS AI
                      </button>
                      <button
                        type="button"
                        onClick={() => setAudioTab("recorded")}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold cursor-pointer"
                        style={{
                          backgroundColor: audioTab === "recorded" ? "var(--bg-panel)" : "transparent",
                          color: audioTab === "recorded" ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        <Mic className="h-3.5 w-3.5" />
                        Suara Sendiri
                      </button>
                    </div>

                    {audioTab === "tts" ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-semibold">Mesin TTS</label>
                            <select
                              value={ttsEngine}
                              onChange={(e) => {
                                const next = e.target.value as "gemini" | "openai" | "windows_offline";
                                setTtsEngine(next);
                                if (next === "gemini") setTtsVoice("Kore");
                                if (next === "openai") setTtsVoice("nova");
                              }}
                              className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                            >
                              <option value="gemini">Gemini Native TTS</option>
                              <option value="openai">OpenAI TTS</option>
                              <option value="windows_offline">Windows Offline (Gratis)</option>
                            </select>
                          </div>
                          {ttsEngine !== "windows_offline" && (
                            <div>
                              <label className="mb-1 block text-xs font-semibold">Karakter Suara</label>
                              <select
                                value={ttsVoice}
                                onChange={(e) => setTtsVoice(e.target.value)}
                                className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
                              >
                                {(ttsEngine === "gemini" ? GEMINI_VOICES : OPENAI_VOICES).map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={isProcessingAudio || !isTauriRuntime()}
                          onClick={handleGenerateTts}
                          className="ui-btn-secondary flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          {isProcessingAudio ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Membuat Sampel Suara &amp; Sinkronisasi Kata...
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3.5 w-3.5" />
                              {audioResult ? "Generate Ulang Sampel Suara" : "Buat & Dengarkan Sampel Suara"}
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <label
                          className="flex items-center justify-between rounded-lg px-3 py-2 text-xs cursor-pointer"
                          style={{
                            backgroundColor: "var(--bg-elevated)",
                            border: "1px solid var(--border-subtle)",
                          }}
                        >
                          <span>Potong Jeda Kosong Otomatis (&gt;0,4 dtk)</span>
                          <input
                            type="checkbox"
                            checked={trimSilence}
                            onChange={(e) => setTrimSilence(e.target.checked)}
                          />
                        </label>

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            disabled={isProcessingAudio || !isTauriRuntime()}
                            onClick={handleToggleRecording}
                            className="flex h-9 items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                            style={{
                              backgroundColor: isRecording ? "var(--danger)" : "var(--cta-bg)",
                              color: isRecording ? "#ffffff" : "var(--cta-fg)",
                            }}
                          >
                            {isRecording ? (
                              <>
                                <Square className="h-3.5 w-3.5 fill-current" />
                                Stop ({recordSeconds}s)
                              </>
                            ) : (
                              <>
                                <Mic className="h-3.5 w-3.5" />
                                Rekam Mic
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={isProcessingAudio || isRecording || !isTauriRuntime()}
                            onClick={handleUploadUserAudio}
                            className="ui-btn-secondary flex h-9 items-center justify-center gap-2 rounded-md text-xs font-semibold disabled:opacity-50 cursor-pointer"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Upload MP3/WAV
                          </button>
                        </div>
                      </div>
                    )}

                    {audioError && (
                      <div
                        className="rounded-md p-3 text-xs"
                        style={{
                          backgroundColor: "var(--danger-soft)",
                          border: "1px solid var(--danger)",
                          color: "var(--danger)",
                        }}
                      >
                        {audioError}
                      </div>
                    )}

                    {audioResult && (
                      <div
                        className="rounded-lg p-3 space-y-2"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          border: "1px solid var(--accent)",
                        }}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className="inline-flex items-center gap-1.5 font-semibold"
                            style={{ color: "var(--success)" }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Suara Siap · {audioResult.providerUsed}
                          </span>
                          <span className="font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {formatSec(audioResult.durationMs)} · {audioResult.words.length} kata
                          </span>
                        </div>
                        <audio
                          controls
                          src={toAssetUrl(audioResult.audioPath)}
                          className="h-8 w-full"
                        />
                      </div>
                    )}
                  </div>

                  {/* Local Footage Card (ONLY when Footage or Hybrid mode is active!) */}
                  {visualMode !== "motion" && (
                    <div className="ui-panel rounded-xl p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h2 className="text-sm font-bold">
                            {visualMode === "hybrid"
                              ? "Klip Footage Lokal (Opsional)"
                              : "Klip Footage Lokal (*Wajib min. 1)"}
                          </h2>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                            AI memotong dan menyusun klip secara otomatis sinkron dengan suara dubbing.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isLoadingFootage || !isTauriRuntime()}
                          onClick={handleAddFootage}
                          className="ui-btn-primary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          {isLoadingFootage ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          Tambah Video
                        </button>
                      </div>

                      {footageClips.length === 0 ? (
                        <div
                          className="rounded-lg p-4 text-center text-xs"
                          style={{
                            backgroundColor: "var(--bg-elevated)",
                            border: "1px dashed var(--border-strong)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          Belum ada klip footage ditambahkan.
                          {visualMode === "hybrid" && " Jika kosong, AI akan mengisi penuh dengan AI Motion."}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {footageClips.map((clip) => (
                            <div
                              key={clip.path}
                              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
                              style={{
                                backgroundColor: "var(--bg-elevated)",
                                border: "1px solid var(--border-subtle)",
                              }}
                            >
                              <span className="truncate font-semibold">{clip.fileName}</span>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                                  {formatSec(clip.durationMs)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFootageClips((prev) => prev.filter((c) => c.path !== clip.path))
                                  }
                                  className="p-1 cursor-pointer"
                                  style={{ color: "var(--danger)" }}
                                  aria-label="Hapus klip"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right Column: Zero-Friction AI Auto-Director Card ("Terima Jadi") */}
                <div className="ui-panel rounded-xl p-5 lg:col-span-6 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent)" }}
                      >
                        <Sparkles className="h-3 w-3" />
                        AI Auto-Director · Terima Jadi
                      </span>
                      <h2 className="mt-1.5 text-sm font-bold">2. Rencana Otomatis AI</h2>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        Semua gaya visual, transisi, subtitle, dan backsound sudah dipilihkan AI sesuai prompt &amp; referensi lo — tanpa perlu pusing atur template.
                      </p>
                    </div>
                  </div>

                  {/* Simple 1-Row Medium Switch (ONLY for Motion/Hybrid!) */}
                  {visualMode !== "footage" && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold">Gaya Visual Utama</label>
                      <div
                        className="grid grid-cols-3 gap-1 rounded-lg p-1"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        {[
                          { id: "auto" as const, label: "Otomatis AI", Icon: Sparkles },
                          { id: "3d_diorama" as const, label: "3D Scene", Icon: Box },
                          { id: "2d_freeform" as const, label: "2D Motion", Icon: Shapes },
                        ].map((opt) => {
                          const active = mediumChoice === opt.id;
                          const OptIcon = opt.Icon;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setMediumChoice(opt.id)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold transition-colors cursor-pointer"
                              style={{
                                backgroundColor: active ? "var(--bg-panel)" : "transparent",
                                color: active ? "var(--accent)" : "var(--text-muted)",
                                border: active ? "1px solid var(--accent)" : "1px solid transparent",
                              }}
                            >
                              <OptIcon className="h-3.5 w-3.5 shrink-0" />
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Plain-Indonesian Auto-Director Summary */}
                  <div
                    className="rounded-lg p-3.5 space-y-2.5 text-xs"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span style={{ color: "var(--text-muted)" }}>Medium Visual</span>
                      <span className="text-right font-semibold">
                        {visualMode === "footage"
                          ? `Auto-Cut ${footageClips.length} Klip Footage`
                          : resolvedMedium === "3d_diorama"
                            ? "3D Diorama & Karakter (Three.js · 0 Kredit Video)"
                            : "2D Motion Bebas AI (Tanpa Template)"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <span style={{ color: "var(--text-muted)" }}>Arahan Gaya</span>
                      <span className="text-right font-semibold">
                        {styleRefResult?.customDesign?.name
                          ? `Meniru "${styleRefResult.customDesign.name}"`
                          : "Dirancang otomatis dari topik & script"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <span style={{ color: "var(--text-muted)" }}>Subtitle &amp; Audio</span>
                      <span className="text-right font-semibold">
                        {resolvedMedium === "3d_diorama"
                          ? "Subtitle Tengah Shorts · BGM & SFX Otomatis"
                          : "Subtitle Kinetik Sinkron · BGM & SFX Otomatis"}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <span style={{ color: "var(--text-muted)" }}>Verifikasi Kualitas</span>
                      <span className="text-right font-semibold" style={{ color: "var(--accent)" }}>
                        Cek 4 Frame + Auto-Repair Aktif
                      </span>
                    </div>
                  </div>

                  {/* Hidden Collapsed Accordion for Optional Power-User Overrides */}
                  <details
                    className="rounded-lg"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <summary
                      className="flex cursor-pointer items-center justify-between px-3.5 py-2.5 text-xs font-semibold select-none"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Settings2 className="h-3.5 w-3.5" />
                        Sesuaikan Manual (Opsional)
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        Subtitle · BGM · SFX
                      </span>
                    </summary>

                    <div
                      className="space-y-3 border-t p-3.5 text-xs"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold">Style Subtitle</label>
                          <select
                            value={captionPreset}
                            onChange={(e) => setCaptionPreset(e.target.value as CaptionPreset)}
                            className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
                          >
                            {CAPTION_PRESETS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold">Backsound (BGM)</label>
                          <select
                            value={bgmPreset}
                            onChange={(e) => setBgmPreset(e.target.value)}
                            className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
                          >
                            <option value="auto">Otomatis Dipilihkan AI</option>
                            <option value="none">Tanpa BGM</option>
                            {BGM_PRESETS.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold">Warna Sorotan</label>
                        <div className="flex items-center gap-2">
                          {ACCENT_SWATCHES.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              onClick={() => setAccentColor(hex)}
                              className="h-6 w-6 rounded-full cursor-pointer"
                              style={{
                                backgroundColor: hex,
                                border:
                                  accentColor === hex
                                    ? "2px solid var(--text-primary)"
                                    : "1px solid var(--border-strong)",
                              }}
                              aria-label={`Pilih warna ${hex}`}
                            />
                          ))}
                        </div>
                      </div>

                      {visualMode === "footage" && (
                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold">Motion Klip</label>
                            <select
                              value={motionPreset}
                              onChange={(e) => setMotionPreset(e.target.value as MotionPreset)}
                              className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
                            >
                              {MOTION_PRESETS.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold">Transisi</label>
                            <select
                              value={transitionPreset}
                              onChange={(e) => setTransitionPreset(e.target.value as TransitionPreset)}
                              className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
                            >
                              {TRANSITION_PRESETS.map((tr) => (
                                <option key={tr.id} value={tr.id}>
                                  {tr.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center justify-between rounded px-2.5 py-1.5 text-[11px] cursor-pointer" style={{ backgroundColor: "var(--bg-panel)" }}>
                          <span>Auto-Ducking BGM</span>
                          <input
                            type="checkbox"
                            checked={autoDucking}
                            onChange={(e) => setAutoDucking(e.target.checked)}
                          />
                        </label>
                        <label className="flex items-center justify-between rounded px-2.5 py-1.5 text-[11px] cursor-pointer" style={{ backgroundColor: "var(--bg-panel)" }}>
                          <span>Auto SFX Transisi</span>
                          <input
                            type="checkbox"
                            checked={autoSfx}
                            onChange={(e) => setAutoSfx(e.target.checked)}
                          />
                        </label>
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              {assembleError && (
                <div
                  className="rounded-xl p-4 text-xs space-y-2.5"
                  style={{
                    backgroundColor: "var(--danger-soft)",
                    border: "1px solid var(--danger)",
                  }}
                >
                  <div className="font-bold" style={{ color: "var(--danger)" }}>
                    {assembleError.title}
                  </div>
                  <p className="leading-relaxed" style={{ color: "var(--text-primary)" }}>
                    {assembleError.message}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {assembleError.hint}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isAssembling}
                      onClick={() => handleAssembleProject()}
                      className="ui-btn-primary inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold cursor-pointer"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Coba Lagi (Lanjutkan)
                    </button>
                    {failedOn3d && (
                      <button
                        type="button"
                        disabled={isAssembling}
                        onClick={() => {
                          setMediumChoice("2d_freeform");
                          handleAssembleProject("2d_freeform");
                        }}
                        className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold cursor-pointer"
                      >
                        <Shapes className="h-3.5 w-3.5" />
                        Buat Versi 2D Lebih Cepat
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium cursor-pointer"
                    >
                      Ganti Model AI
                    </button>
                  </div>
                  <details className="pt-1">
                    <summary
                      className="cursor-pointer text-[10px] font-medium select-none"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Lihat detail teknis
                    </summary>
                    <pre
                      className="mt-1.5 overflow-x-auto rounded p-2 font-mono-num text-[10px] whitespace-pre-wrap"
                      style={{
                        backgroundColor: "var(--bg-panel)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {assembleError.rawDetail}
                    </pre>
                  </details>
                </div>
              )}

              {/* Final Sat-Set Action Strip */}
              <div className="ui-panel flex flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-4">
                <div className="space-y-0.5 text-xs">
                  <div className="font-bold">{projectTitle || "Konten Baru"}</div>
                  <div className="font-mono-num text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {visualMode === "footage"
                      ? `Footage (${footageClips.length} klip)`
                      : resolvedMedium === "3d_diorama"
                        ? "3D Scene (By-Code)"
                        : "2D Motion Bebas AI"}
                    {" · "}
                    {audioResult
                      ? `Suara tersinkron (${formatSec(audioResult.durationMs)})`
                      : "Suara dubbing otomatis"}
                    {styleRefResult ? ` · Ref: ${styleRefResult.customDesign.name}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAssembling) {
                        assembleRunIdRef.current += 1;
                        setIsAssembling(false);
                        setAssembleStatus("");
                      } else {
                        setStep(1);
                      }
                    }}
                    className="ui-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-medium cursor-pointer"
                  >
                    {isAssembling ? (
                      <>
                        <Square className="h-3.5 w-3.5" />
                        Hentikan
                      </>
                    ) : (
                      <>
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Kembali
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={isAssembling || isFootageMandatoryMissing}
                    onClick={() => handleAssembleProject()}
                    className="ui-btn-primary inline-flex h-10 items-center gap-2 rounded-md px-5 text-xs font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {isAssembling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{assembleStatus || "AI Director sedang meracik video..."}</span>
                        <span
                          className="rounded px-1.5 py-0.5 font-mono-num text-[11px] font-bold"
                          style={{ backgroundColor: "rgba(0,0,0,0.22)" }}
                        >
                          {formatStopwatch(assembleElapsedMs)}
                        </span>
                      </>
                    ) : isFootageMandatoryMissing ? (
                      <>
                        <Upload className="h-4 w-4" />
                        Pilih Min. 1 Footage Dulu
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        {storyboardCheckpointRef.current ? "Lanjutkan Buat Video" : "Buat Video Sekarang"}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
