import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Film,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import type {
  ByokStatus,
  ContentFormat,
  CustomDesignDirection,
  ProjectStyleReference,
  StoryboardBeat,
  SynkcutProject,
} from "../types/scene";
import {
  aiAssembleProject,
  aiGenerate3dDiorama,
  aiGenerateBeatCodes,
  aiPlanStoryboard,
  generateTtsAudio,
  isTauriRuntime,
  listenGenerationProgress,
  pickLocalAudio,
  processUserAudio,
  resolveAutoRenderMedium,
  toAssetUrl,
  type FootageInputItem,
  type HookOption,
  type ProcessedAudioResult,
  type StyleReferenceResult,
} from "../lib/tauriBridge";
import { verifyAndRepairProjectBeats } from "../engine/freeformPipeline";
import {
  formatStopwatch,
  toFriendlyAiError,
  type FriendlyErrorInfo,
} from "../lib/friendlyError";

export interface PreProductionDraft {
  projectTitle: string;
  format: ContentFormat;
  visualMode: "motion" | "footage" | "hybrid";
  userPrompt?: string;
  hooks: HookOption[];
  selectedHookId: string;
  bodySegments: string[];
  cta: string;
  fullScript: string;
  audio: ProcessedAudioResult | null;
  beats: StoryboardBeat[];
  aiRecommendedMedium?: "2d_freeform" | "3d_diorama" | null;
  aiMediumReason?: string | null;
  autoDesign?: CustomDesignDirection | null;
  styleRef: StyleReferenceResult | null;
  attachedClips: FootageInputItem[];
  ttsEngine: "auto" | "gemini" | "openai" | "windows_offline";
}

interface PreProductionReviewModalProps {
  draft: PreProductionDraft;
  byokStatus: ByokStatus;
  onClose: () => void;
  onProjectReady: (project: SynkcutProject, generationDurationMs?: number) => Promise<void>;
}

const GEMINI_VOICES = [
  { id: "Kore", label: "Kore (Tegas & Jelas)" },
  { id: "Puck", label: "Puck (Ceria & Ringan)" },
  { id: "Aoede", label: "Aoede (Hangat & Natural)" },
  { id: "Charon", label: "Charon (Berat & Informatif)" },
];

const OPENAI_VOICES = [
  { id: "nova", label: "Nova (Lincah & Jelas)" },
  { id: "coral", label: "Coral (Ramah & Modern)" },
  { id: "onyx", label: "Onyx (Berat & Berwibawa)" },
  { id: "alloy", label: "Alloy (Netral)" },
];

export default function PreProductionReviewModal({
  draft,
  byokStatus,
  onClose,
  onProjectReady,
}: PreProductionReviewModalProps) {
  const [projectTitle, setProjectTitle] = useState(draft.projectTitle);
  const [hooks] = useState<HookOption[]>(draft.hooks);
  const [selectedHookId, setSelectedHookId] = useState(draft.selectedHookId);
  const [fullScript, setFullScript] = useState(draft.fullScript);
  const [scriptDirtyForAudio, setScriptDirtyForAudio] = useState(false);

  // Audio Dubbing Review State
  const [ttsEngine, setTtsEngine] = useState<"auto" | "gemini" | "openai" | "windows_offline">(
    draft.ttsEngine
  );
  const [ttsVoice, setTtsVoice] = useState(
    draft.ttsEngine === "openai" ? "nova" : "Kore"
  );
  const [ttsTone, setTtsTone] = useState("santai");
  const [audioResult, setAudioResult] = useState<ProcessedAudioResult | null>(draft.audio);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const genRunIdRef = useRef(0);

  // Storyboard Micro-Beats & Visual Medium Auto-Director State
  const [beats, setBeats] = useState<StoryboardBeat[]>(draft.beats);
  const [aiRecommendedMedium, setAiRecommendedMedium] = useState<"2d_freeform" | "3d_diorama" | null>(
    draft.aiRecommendedMedium ?? null
  );
  const [aiMediumReason, setAiMediumReason] = useState<string | null>(
    draft.aiMediumReason ?? null
  );
  const [autoDesign, setAutoDesign] = useState<CustomDesignDirection | null>(
    draft.autoDesign ?? null
  );
  const [isPlanningBeats, setIsPlanningBeats] = useState(false);
  const [mediumChoice, setMediumChoice] = useState<"auto" | "3d_diorama" | "2d_freeform">("auto");

  const resolvedMedium = resolveAutoRenderMedium({
    preference: mediumChoice,
    styleRef: draft.styleRef,
    aiRecommendedMedium,
    topicOrScript: `${draft.userPrompt ?? ""} ${projectTitle} ${fullScript}`,
  });
  const activeDesign = draft.styleRef?.customDesign ?? autoDesign ?? null;

  // Final Video Generation State
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [friendlyError, setFriendlyError] = useState<FriendlyErrorInfo | null>(null);
  const [failedOn3d, setFailedOn3d] = useState(false);

  useEffect(() => {
    if (!isGeneratingVideo) return;
    const started = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 250);
    return () => window.clearInterval(id);
  }, [isGeneratingVideo]);

  useEffect(() => {
    if (!isGeneratingVideo) return;
    let unlisten: (() => void) | null = null;
    listenGenerationProgress((msg) => setProgressText(msg)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isGeneratingVideo]);

  const isFootageOnly = draft.visualMode === "footage";
  const audioSrcUrl = audioResult?.audioPath ? toAssetUrl(audioResult.audioPath) : null;

  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const onEnd = () => setIsPlayingAudio(false);
    el.addEventListener("ended", onEnd);
    return () => el.removeEventListener("ended", onEnd);
  }, [audioSrcUrl]);

  function handleSelectHook(hook: HookOption) {
    setSelectedHookId(hook.id);
    const bodyAndCta = [
      ...draft.bodySegments.filter((s) => s.trim()),
      draft.cta.trim(),
    ]
      .filter(Boolean)
      .join(" ");
    const nextScript = `${hook.text.trim()} ${bodyAndCta}`.trim();
    setFullScript(nextScript);
    setScriptDirtyForAudio(true);
  }

  function togglePlaySample() {
    const el = audioElRef.current;
    if (!el || !audioSrcUrl) return;
    if (isPlayingAudio) {
      el.pause();
      setIsPlayingAudio(false);
    } else {
      el.currentTime = 0;
      el.play()
        .then(() => setIsPlayingAudio(true))
        .catch(() => setIsPlayingAudio(false));
    }
  }

  async function handleRegenerateAudio(alsoReplanBeats = true) {
    if (!fullScript.trim() || isGeneratingAudio) return;
    setFriendlyError(null);
    setIsGeneratingAudio(true);
    setIsPlayingAudio(false);
    try {
      const res = await generateTtsAudio({
        text: fullScript.trim(),
        voiceName: ttsVoice,
        tone: ttsTone,
        engine: ttsEngine,
      });
      const wasScriptEdited = scriptDirtyForAudio;
      setAudioResult(res);
      setScriptDirtyForAudio(false);

      // Preserve user's edited beat visualConcepts if only voice/tone changed!
      if (alsoReplanBeats && !isFootageOnly) {
        if (wasScriptEdited || beats.length === 0) {
          await handleReplanStoryboard(res.durationMs, res.words);
        } else if (res.durationMs >= 1000) {
          const weights = beats.map((b) =>
            Math.max(1, (b.text || "").trim().split(/\s+/).filter(Boolean).length)
          );
          const totalW = weights.reduce((a, b) => a + b, 0) || 1;
          let cursor = 0;
          setBeats((prev) =>
            prev.map((b, idx) => {
              const startMs = cursor;
              const endMs =
                idx === prev.length - 1
                  ? res.durationMs
                  : Math.min(
                      res.durationMs - (prev.length - 1 - idx) * 600,
                      Math.max(startMs + 600, Math.round(startMs + (weights[idx] / totalW) * res.durationMs))
                    );
              cursor = endMs;
              return { ...b, startMs, endMs };
            })
          );
        }
      }
    } catch (err) {
      setFriendlyError(toFriendlyAiError(err));
    } finally {
      setIsGeneratingAudio(false);
    }
  }

  async function handleUploadOwnAudio() {
    if (!isTauriRuntime()) return;
    const picked = await pickLocalAudio();
    if (!picked) return;
    setFriendlyError(null);
    setIsGeneratingAudio(true);
    setIsPlayingAudio(false);
    try {
      const res = await processUserAudio({
        inputPath: picked,
        trimSilence: true,
        knownScript: fullScript.trim(),
      });
      setAudioResult(res);
      setScriptDirtyForAudio(false);
      if (!isFootageOnly) {
        await handleReplanStoryboard(res.durationMs, res.words);
      }
    } catch (err) {
      setFriendlyError(toFriendlyAiError(err));
    } finally {
      setIsGeneratingAudio(false);
    }
  }

  async function handleReplanStoryboard(
    overrideDurationMs?: number,
    overrideWords?: ProcessedAudioResult["words"]
  ) {
    if (!fullScript.trim() || isPlanningBeats) return;
    setFriendlyError(null);
    setIsPlanningBeats(true);
    try {
      const styleReference: ProjectStyleReference | null = draft.styleRef
        ? {
            sourceType: draft.styleRef.sourceType,
            url: draft.styleRef.url ?? undefined,
            title: draft.styleRef.title,
            thumbnails: draft.styleRef.thumbnails,
            styleDnaSummary: draft.styleRef.styleDnaSummary,
            logoDataUrl: draft.styleRef.logoDataUrl ?? null,
            brandHeadings: draft.styleRef.brandHeadings,
            brandColors: draft.styleRef.brandColors,
            customDesign: draft.styleRef.customDesign,
          }
        : null;

      const planned = await aiPlanStoryboard({
        projectTitle: projectTitle.trim() || "Video Baru",
        format: draft.format,
        fullScript: fullScript.trim(),
        userPrompt: draft.userPrompt ?? null,
        durationMs: overrideDurationMs ?? audioResult?.durationMs ?? 24000,
        words: overrideWords ?? audioResult?.words ?? [],
        customDesign: draft.styleRef?.customDesign ?? null,
        styleReference,
      });
      setBeats(planned.beats);
      if (planned.recommendedMedium) setAiRecommendedMedium(planned.recommendedMedium);
      if (planned.mediumReason) setAiMediumReason(planned.mediumReason);
      if (planned.autoDesign) setAutoDesign(planned.autoDesign);
    } catch (err) {
      setFriendlyError(toFriendlyAiError(err));
    } finally {
      setIsPlanningBeats(false);
    }
  }

  function updateBeatConcept(beatId: string, visualConcept: string) {
    setBeats((prev) =>
      prev.map((b) => (b.id === beatId ? { ...b, visualConcept } : b))
    );
  }

  async function handleConfirmGenerateVideo(overrideMedium?: "2d_freeform" | "3d_diorama") {
    if (isGeneratingVideo || !fullScript.trim()) return;
    const myRunId = ++genRunIdRef.current;
    setFriendlyError(null);
    setFailedOn3d(false);
    const startMs = Date.now();
    setIsGeneratingVideo(true);
    let attempted3d = false;

    try {
      // 1. Ensure dubbing audio is fresh & matches current edited script!
      let activeAudio = audioResult;
      if (!activeAudio || scriptDirtyForAudio) {
        setProgressText("Membuat suara dubbing sinkron dengan script terbaru...");
        activeAudio = await generateTtsAudio({
          text: fullScript.trim(),
          voiceName: ttsVoice,
          tone: ttsTone,
          engine: ttsEngine,
        });
        setAudioResult(activeAudio);
        setScriptDirtyForAudio(false);
      }

      const styleReference: ProjectStyleReference | null = draft.styleRef
        ? {
            sourceType: draft.styleRef.sourceType,
            url: draft.styleRef.url ?? undefined,
            title: draft.styleRef.title,
            thumbnails: draft.styleRef.thumbnails,
            styleDnaSummary: draft.styleRef.styleDnaSummary,
            logoDataUrl: draft.styleRef.logoDataUrl ?? null,
            brandHeadings: draft.styleRef.brandHeadings,
            brandColors: draft.styleRef.brandColors,
            customDesign: draft.styleRef.customDesign,
          }
        : null;

      const customDesign = activeDesign;
      const captionPreset = draft.styleRef?.suggestedCaption ?? "bold_pop";
      const accentColor =
        customDesign?.palette.accentPrimary ?? draft.styleRef?.suggestedAccent ?? "#38E59D";
      const bgmPreset =
        customDesign?.recommendedBgm ||
        (draft.format === "education" ? "lofi_education" : "upbeat_promo");

      // 2A. Footage-only mode: auto-cut multi-footage synced to dubbing audio
      if (isFootageOnly) {
        setProgressText("Memotong otomatis semua footage & menyinkronkan ke dubbing...");
        const project = await aiAssembleProject({
          projectTitle: projectTitle.trim() || "Video Footage Auto-Cut",
          format: draft.format,
          hookText: fullScript.trim(),
          bodySegments: [],
          ctaText: "",
          rawScript: fullScript.trim(),
          audioPath: activeAudio.audioPath || null,
          audioSource: activeAudio.audioPath ? "tts" : "demo",
          trimSilence: true,
          durationMs: activeAudio.durationMs,
          words: activeAudio.words,
          footage: draft.attachedClips,
          captionPreset,
          accentColor,
          motionPreset: customDesign?.preferredMotion ?? "zoom_punch",
          transitionPreset: customDesign?.preferredTransition ?? "pop_zoom",
          overlayMode: "auto",
          bgmPreset,
          autoDucking: true,
          autoSfx: true,
          visualMode: "footage",
          styleReference,
          customDesign,
          autoGenerateVoiceover: false,
        });
        await onProjectReady(project, Date.now() - startMs);
        return;
      }

      // 2B. AI 3D Scene (2-Stage Checkpointed Three.js PBR) OR 2D Freeform Motion!
      let activeBeats = beats;
      if (activeBeats.length === 0) {
        setProgressText("Merancang micro-beat storyboard (2.5–4.5 detik per beat)...");
        const planned = await aiPlanStoryboard({
          projectTitle: projectTitle.trim() || "Video AI Motion",
          format: draft.format,
          fullScript: fullScript.trim(),
          userPrompt: draft.userPrompt ?? null,
          durationMs: activeAudio.durationMs,
          words: activeAudio.words,
          customDesign,
          styleReference,
        });
        activeBeats = planned.beats;
        setBeats(activeBeats);
      } else if (activeAudio.durationMs >= 1000) {
        // Always lock beat timeline 100% to actual voiceover duration so audio & video NEVER drift!
        const oldTotal = activeBeats.reduce((m, b) => Math.max(m, b.endMs), 0);
        if (Math.abs(oldTotal - activeAudio.durationMs) > 250) {
          const weights = activeBeats.map((b) =>
            Math.max(1, (b.text || "").trim().split(/\s+/).filter(Boolean).length)
          );
          const totalW = weights.reduce((a, b) => a + b, 0) || 1;
          let cursor = 0;
          activeBeats = activeBeats.map((b, idx) => {
            const startMs = cursor;
            const endMs =
              idx === activeBeats.length - 1
                ? activeAudio.durationMs
                : Math.min(
                    activeAudio.durationMs - (activeBeats.length - 1 - idx) * 600,
                    Math.max(startMs + 600, Math.round(startMs + (weights[idx] / totalW) * activeAudio.durationMs))
                  );
            cursor = endMs;
            return { ...b, startMs, endMs };
          });
          setBeats(activeBeats);
        }
      }

      const targetBgm = customDesign?.recommendedBgm || bgmPreset;
      const targetMedium = overrideMedium ?? resolvedMedium;

      let rawProject: SynkcutProject;
      if (targetMedium === "3d_diorama" && draft.visualMode !== "hybrid") {
        attempted3d = true;
        setProgressText("Tahap 1/2: Membangun objek, pencahayaan & dunia 3D...");
        rawProject = await aiGenerate3dDiorama({
          projectTitle: projectTitle.trim() || "3D Scene",
          format: draft.format,
          userPrompt: draft.userPrompt ?? null,
          beats: activeBeats,
          words: activeAudio.words,
          customDesign,
          styleReference,
          audioPath: activeAudio.audioPath || null,
          audioSource: activeAudio.audioPath ? "tts" : "demo",
          trimSilence: true,
          captionPreset,
          accentColor,
          bgmPreset: targetBgm,
          autoDucking: true,
          autoSfx: true,
        });
      } else {
        setProgressText(
          `Menulis kode motion 2D baru dari nol untuk ${activeBeats.length} beat secara paralel...`
        );
        rawProject = await aiGenerateBeatCodes({
          projectTitle: projectTitle.trim() || "Video AI Motion",
          format: draft.format,
          userPrompt: draft.userPrompt ?? null,
          beats: activeBeats,
          words: activeAudio.words,
          customDesign,
          styleReference,
          audioPath: activeAudio.audioPath || null,
          audioSource: activeAudio.audioPath ? "tts" : "demo",
          trimSilence: true,
          captionPreset,
          accentColor,
          bgmPreset: targetBgm,
          autoDucking: true,
          autoSfx: true,
          footage: draft.visualMode === "hybrid" ? draft.attachedClips : [],
          visualMode: draft.visualMode,
        });
      }

      // 3. Deliver-and-Verify: 4-frame offscreen sandbox check + automatic AI repair!
      if (genRunIdRef.current !== myRunId) return;
      const verified = await verifyAndRepairProjectBeats(rawProject, (msg) => {
        if (genRunIdRef.current === myRunId) setProgressText(msg);
      });
      if (genRunIdRef.current !== myRunId) return;

      await onProjectReady(verified.project, Date.now() - startMs);
    } catch (err) {
      if (genRunIdRef.current !== myRunId) return;
      setFailedOn3d(attempted3d);
      setFriendlyError(toFriendlyAiError(err));
    } finally {
      if (genRunIdRef.current === myRunId) {
        setIsGeneratingVideo(false);
        setProgressText("");
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(5, 8, 12, 0.72)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl shadow-2xl"
        style={{
          backgroundColor: "var(--bg-panel)",
          border: "1px solid var(--border-strong)",
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3.5"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                <Sparkles className="h-3 w-3" />
                Review Pre-Production
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Cek script, dengarkan sampel suara dubbing, & konsep visual sebelum video digenerate
              </span>
            </div>
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              className="mt-1 -mx-1.5 w-full rounded-md bg-transparent px-1.5 py-0.5 text-base font-bold outline-none transition-colors focus:bg-[var(--bg-elevated)]"
              style={{ color: "var(--text-primary)" }}
              aria-label="Judul proyek"
            />
          </div>
          <button
            type="button"
            disabled={isGeneratingVideo}
            onClick={onClose}
            className="rounded-md p-1.5 cursor-pointer disabled:opacity-40"
            style={{ color: "var(--text-secondary)" }}
            aria-label="Tutup review"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* SECTION 1: HOOKS & SCRIPT */}
          <div
            className="rounded-lg p-4 space-y-3"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                1. Script & Pilihan Hook
              </h3>
              <span className="font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                {fullScript.trim().split(/\s+/).filter(Boolean).length} kata
              </span>
            </div>

            {hooks.length > 0 && !isFootageOnly && (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {hooks.map((h) => {
                  const active = selectedHookId === h.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => handleSelectHook(h)}
                      className="rounded-lg p-2.5 text-left transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--accent-soft)" : "var(--bg-panel)",
                        border: active ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                      }}
                    >
                      <div
                        className="text-[10px] font-bold uppercase"
                        style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}
                      >
                        {h.angle}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-snug">{h.text}</p>
                    </button>
                  );
                })}
              </div>
            )}

            <textarea
              rows={4}
              value={fullScript}
              onChange={(e) => {
                setFullScript(e.target.value);
                setScriptDirtyForAudio(true);
              }}
              placeholder="Edit naskah narasi voiceover di sini..."
              className="ui-input w-full resize-y rounded-lg p-3 text-xs leading-relaxed"
            />
          </div>

          {/* SECTION 2: SAMPEL SUARA DUBBING (AUDIO PLAYER) */}
          <div
            className="rounded-lg p-4 space-y-3"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: scriptDirtyForAudio
                ? "1px solid var(--warning)"
                : "1px solid var(--border-subtle)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4" style={{ color: "var(--accent)" }} />
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  2. Sampel Suara Dubbing (Voiceover)
                </h3>
                {audioResult && (
                  <span
                    className="rounded-full px-2 py-0.5 font-mono-num text-[10px] font-semibold"
                    style={{
                      backgroundColor: "var(--accent-soft)",
                      color: "var(--accent)",
                    }}
                  >
                    {audioResult.providerUsed} · {(audioResult.durationMs / 1000).toFixed(1)} dtk
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {isTauriRuntime() && (
                  <button
                    type="button"
                    disabled={isGeneratingAudio}
                    onClick={handleUploadOwnAudio}
                    className="ui-btn-secondary inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                  >
                    <Upload className="h-3 w-3" />
                    Upload Audio
                  </button>
                )}
                <button
                  type="button"
                  disabled={isGeneratingAudio || !fullScript.trim()}
                  onClick={() => handleRegenerateAudio(true)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold cursor-pointer ${
                    scriptDirtyForAudio ? "ui-btn-primary" : "ui-btn-secondary"
                  }`}
                >
                  {isGeneratingAudio ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {audioResult ? "Generate Ulang Suara" : "Buat Suara Dubbing"}
                </button>
              </div>
            </div>

            {/* Voice & Engine selectors */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={ttsEngine}
                onChange={(e) => {
                  const next = e.target.value as typeof ttsEngine;
                  setTtsEngine(next);
                  setTtsVoice(next === "openai" ? "nova" : "Kore");
                }}
                className="ui-input h-8 rounded-md px-2 text-xs"
              >
                <option value="auto">Engine: Otomatis (Terbaik)</option>
                {byokStatus.providers.gemini?.configured && (
                  <option value="gemini">Gemini TTS</option>
                )}
                {byokStatus.providers.openai?.configured && (
                  <option value="openai">OpenAI TTS</option>
                )}
                <option value="windows_offline">Windows Offline TTS</option>
              </select>

              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                disabled={ttsEngine === "windows_offline"}
                className="ui-input h-8 rounded-md px-2 text-xs disabled:opacity-50"
              >
                {(ttsEngine === "openai" ? OPENAI_VOICES : GEMINI_VOICES).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>

              <select
                value={ttsTone}
                onChange={(e) => setTtsTone(e.target.value)}
                className="ui-input h-8 rounded-md px-2 text-xs"
              >
                <option value="santai">Tone: Santai & Natural</option>
                <option value="persuasif">Tone: Persuasif / Iklan</option>
                <option value="profesional">Tone: Profesional / Edukasi</option>
                <option value="lucu">Tone: Ekspresif / Seru</option>
              </select>
            </div>

            {/* Playable Audio Sample Bar */}
            {audioSrcUrl ? (
              <div
                className="flex items-center gap-3 rounded-lg p-2.5"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <button
                  type="button"
                  onClick={togglePlaySample}
                  className="ui-btn-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full cursor-pointer"
                  aria-label={isPlayingAudio ? "Jeda sampel suara" : "Putar sampel suara"}
                >
                  {isPlayingAudio ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5 translate-x-[1px]" />
                  )}
                </button>
                <audio
                  ref={audioElRef}
                  src={audioSrcUrl}
                  controls
                  className="h-8 w-full"
                />
              </div>
            ) : (
              <div
                className="rounded-lg p-2.5 text-xs"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  color: "var(--text-muted)",
                }}
              >
                Klik <strong>Buat Suara Dubbing</strong> untuk mendengar sampel audio sebelum generate video.
              </div>
            )}

            {scriptDirtyForAudio && (
              <p className="text-[11px]" style={{ color: "var(--warning)" }}>
                Script baru saja diedit — klik <strong>Generate Ulang Suara</strong> untuk preview suara terbaru (atau akan otomatis diperbarui saat klik Generate Video).
              </p>
            )}
          </div>

          {/* SECTION 3: MICRO-BEAT STORYBOARD PLAN (ZERO SAMPLE ASSETS!) */}
          {!isFootageOnly && (
            <div
              className="rounded-lg p-4 space-y-3"
              style={{
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    3. Arahan Otomatis AI Director ({beats.length} Micro-Beat)
                  </h3>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    AI memilih medium, subtitle, &amp; backsound terbaik sesuai prompt/referensi lo — 100% by-code tanpa template &amp; tanpa kredit video AI.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div
                    className="inline-flex rounded-md p-0.5"
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {[
                      { id: "auto" as const, label: "Otomatis AI" },
                      { id: "3d_diorama" as const, label: "3D Diorama" },
                      { id: "2d_freeform" as const, label: "2D Motion" },
                    ].map((opt) => {
                      const active = mediumChoice === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setMediumChoice(opt.id)}
                          className="rounded px-2 py-1 text-[10px] font-semibold cursor-pointer"
                          style={{
                            backgroundColor: active ? "var(--accent-soft)" : "transparent",
                            color: active ? "var(--accent)" : "var(--text-muted)",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={isPlanningBeats || !fullScript.trim()}
                    onClick={() => handleReplanStoryboard()}
                    className="ui-btn-secondary inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer"
                  >
                    {isPlanningBeats ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3" />
                    )}
                    Rancang Ulang
                  </button>
                </div>
              </div>

              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-[11px]"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 font-semibold"
                    style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    {resolvedMedium === "3d_diorama"
                      ? "Aktif: 3D Scene (Three.js)"
                      : "Aktif: 2D Motion Bebas (Canvas + SVG)"}
                  </span>
                  <span>
                    {aiMediumReason ||
                      (resolvedMedium === "3d_diorama"
                        ? "Dunia 3D kustom sesuai prompt · kamera 3D kontinu · BGM & SFX otomatis"
                        : "Kode animasi baru tiap beat · palet & tipografi kustom · BGM & SFX otomatis")}
                  </span>
                </div>
                {activeDesign && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                      {activeDesign.name}
                    </span>
                    {[
                      activeDesign.palette.bgTop,
                      activeDesign.palette.accentPrimary,
                      activeDesign.palette.accentSecondary,
                    ].map((hex, idx) => (
                      <span
                        key={idx}
                        className="h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: hex,
                          border: "1px solid rgba(128,128,128,0.4)",
                        }}
                        title={hex}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {beats.map((beat, idx) => (
                  <div
                    key={beat.id}
                    className="rounded-lg p-3 space-y-2"
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 font-mono-num text-[10px] font-bold uppercase"
                          style={{
                            backgroundColor: "var(--accent-soft)",
                            color: "var(--accent)",
                          }}
                        >
                          Beat {idx + 1} · {beat.role}
                        </span>
                        <span className="font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {(beat.startMs / 1000).toFixed(1)}s – {(beat.endMs / 1000).toFixed(1)}s (
                          {((beat.endMs - beat.startMs) / 1000).toFixed(1)}s)
                        </span>
                        <span className="text-xs font-semibold">{beat.title}</span>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {beat.skillsUsed.slice(0, 3).map((sk) => (
                          <span
                            key={sk}
                            className="rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: "var(--bg-elevated)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {sk}
                          </span>
                        ))}
                      </div>
                    </div>

                    <p className="text-[11px] italic" style={{ color: "var(--text-secondary)" }}>
                      &ldquo;{beat.text}&rdquo;
                    </p>

                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
                        Konsep Visual yang Akan Digambar AI:
                      </label>
                      <input
                        type="text"
                        value={beat.visualConcept}
                        onChange={(e) => updateBeatConcept(beat.id, e.target.value)}
                        className="ui-input h-8 w-full rounded-md px-2.5 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isFootageOnly && (
            <div
              className="flex items-center gap-2.5 rounded-lg p-3.5 text-xs"
              style={{
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <Film className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>{draft.attachedClips.length} klip footage lokal</strong> siap dipotong & disusun otomatis mengikuti narasi dan suara dubbing di atas.
              </span>
            </div>
          )}

          {friendlyError && (
            <div
              className="rounded-xl p-3.5 text-xs space-y-2"
              style={{
                backgroundColor: "var(--danger-soft)",
                border: "1px solid var(--danger)",
              }}
            >
              <div className="font-bold" style={{ color: "var(--danger)" }}>
                {friendlyError.title}
              </div>
              <p style={{ color: "var(--text-primary)" }}>{friendlyError.message}</p>
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {friendlyError.hint}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={isGeneratingVideo}
                  onClick={() => handleConfirmGenerateVideo()}
                  className="ui-btn-primary inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold cursor-pointer"
                >
                  Coba Lagi (Lanjutkan)
                </button>
                {failedOn3d && (
                  <button
                    type="button"
                    disabled={isGeneratingVideo}
                    onClick={() => {
                      setMediumChoice("2d_freeform");
                      handleConfirmGenerateVideo("2d_freeform");
                    }}
                    className="ui-btn-secondary inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold cursor-pointer"
                  >
                    Buat Versi 2D Lebih Cepat
                  </button>
                )}
              </div>
              <details>
                <summary
                  className="cursor-pointer text-[10px] font-medium select-none"
                  style={{ color: "var(--text-muted)" }}
                >
                  Lihat detail teknis
                </summary>
                <pre
                  className="mt-1 overflow-x-auto rounded p-2 font-mono-num text-[10px] whitespace-pre-wrap"
                  style={{ backgroundColor: "var(--bg-panel)", color: "var(--text-secondary)" }}
                >
                  {friendlyError.rawDetail}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            {isGeneratingVideo ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--accent)" }} />
                <span>{progressText || "Meracik video..."}</span>
                <span
                  className="rounded px-1.5 py-0.5 font-mono-num text-[11px] font-bold"
                  style={{
                    backgroundColor: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  {formatStopwatch(elapsedMs)}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" style={{ color: "var(--accent)" }} />
                <span>
                  {isFootageOnly
                    ? "Siap potong otomatis multi-footage + dubbing"
                    : "Mode Tanpa Template · 100% Kode Motion Baru + 4-Frame Auto-Verifier"}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isGeneratingVideo) {
                  genRunIdRef.current += 1;
                  setIsGeneratingVideo(false);
                  setProgressText("");
                } else {
                  onClose();
                }
              }}
              className="ui-btn-secondary rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer"
            >
              {isGeneratingVideo ? "Hentikan Proses" : "Batal"}
            </button>
            <button
              type="button"
              disabled={isGeneratingVideo || isGeneratingAudio || !fullScript.trim()}
              onClick={() => handleConfirmGenerateVideo()}
              className="ui-btn-primary inline-flex items-center gap-2 rounded-lg px-5 py-2 text-xs font-bold cursor-pointer disabled:opacity-45"
            >
              {isGeneratingVideo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {isGeneratingVideo ? "Sedang Generate Video..." : "Setuju & Generate Video Sekarang"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
