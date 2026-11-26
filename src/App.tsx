import { useCallback, useEffect, useState } from "react";
import {
  FolderKanban,
  KeyRound,
  LayoutTemplate,
  Moon,
  Plus,
  Settings,
  Sun,
  X,
} from "lucide-react";
import {
  CONTENT_FORMAT_LABELS,
  type ByokStatus,
  type ContentFormat,
  type ProjectSummary,
  type SynkcutProject,
} from "./types/scene";
import { BUILTIN_SAMPLES, createBlankProjectForFormat, type SampleTemplate } from "./engine/sampleTemplates";
import { createBreakdown3DPreset, createDefaultAiMotion } from "./engine/aiMotionPresets";
import { rebuildWordsFromScenes } from "./engine/sampleProject";
import { normalizeProject } from "./engine/sceneOps";
import { buildPlayableHyperframeHtml, isHyperframeProject } from "./engine/hyperframeRuntime";
import {
  captureHyperframePoster,
  deleteProject,
  duplicateProject,
  getByokStatus,
  listProjects,
  loadProject,
  renameProject,
  saveProject,
} from "./lib/tauriBridge";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingView from "./components/OnboardingView";
import { captureProjectPosterDataUrl } from "./components/ProjectPosterCanvas";
import ProjectsHomeView from "./components/ProjectsHomeView";
import StudioView from "./components/StudioView";
import WizardView from "./components/WizardView";

type AppView = "loading" | "onboarding" | "projects" | "samples" | "settings" | "wizard" | "studio";

const THEME_STORAGE_KEY = "synkcut_theme_v1";
const FORMAT_ORDER: ContentFormat[] = ["ad_promo", "education", "storytelling", "review"];

function loadInitialTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function SynkcutMark() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="28" height="28" rx="6" fill="var(--accent)" />
      <rect x="6" y="7" width="4" height="14" rx="1.2" fill="#ffffff" />
      <rect x="12" y="5" width="4" height="18" rx="1.2" fill="#ffffff" fillOpacity="0.65" />
      <rect x="18" y="9" width="4" height="10" rx="1.2" fill="#ffffff" />
    </svg>
  );
}

function createAiMotionShowcaseProject(): SynkcutProject {
  const now = new Date().toISOString();
  const s1Motion = createDefaultAiMotion("flow_diagram", "carbon", "Cara Kerja Internet");
  const s2Motion = createDefaultAiMotion("motion_chart", "paper", "Waktu Muat Halaman");
  const s3Motion = createDefaultAiMotion("tech_cards", "blue", "Alur Request Browser");
  s3Motion.subtitle = "Dari lookup DNS sampai halaman dirender";
  if (s3Motion.techCards) {
    s3Motion.techCards.layout = "terminal_code";
  }
  const s4Motion = createDefaultAiMotion("stick_figure", "mint", "Analogi DNS Internet");

  const project: SynkcutProject = {
    version: "1.1",
    meta: {
      id: "demo_ai_motion_m6",
      name: "Cara Kerja Internet (AI Motion)",
      aspectRatio: "9:16",
      fps: 30,
      format: "education",
      createdAt: now,
    },
    globalStyle: {
      captionPreset: "bold_pop",
      accentColor: "#38E59D",
      safeZone: "tiktok_reels",
      showProgressBar: true,
      bgm: {
        preset: "tech_modern",
        volume: 0.22,
        autoDucking: true,
      },
    },
    voiceover: {
      source: "tts",
      audioPath: null,
      trimSilence: true,
      words: [],
    },
    scenes: [
      {
        id: "sc_m1",
        role: "hook",
        startMs: 0,
        endMs: 3600,
        text: "Pernah kepikiran gimana satu klik bisa buka website dalam sekejap?",
        visualSource: "motion",
        aiMotion: s1Motion,
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0.4 },
        transitionIn: { preset: "hard_cut", durationMs: 0 },
        overlays: [],
        sfx: [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.6 }],
      },
      {
        id: "sc_m2",
        role: "body",
        startMs: 3600,
        endMs: 7400,
        text: "Dengan Edge CDN waktu muat halaman turun drastis ke 68 milidetik.",
        visualSource: "motion",
        aiMotion: s2Motion,
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0.4 },
        transitionIn: { preset: "pop_zoom", durationMs: 240 },
        overlays: [],
        sfx: [{ preset: "pop_clean", offsetMs: 0, volume: 0.55 }],
      },
      {
        id: "sc_m3",
        role: "body",
        startMs: 7400,
        endMs: 11200,
        text: "Di balik layar browser cukup jalankan empat langkah jaringan ini.",
        visualSource: "motion",
        aiMotion: s3Motion,
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0.4 },
        transitionIn: { preset: "smooth_crossfade", durationMs: 240 },
        overlays: [],
        sfx: [{ preset: "tech_click", offsetMs: 0, volume: 0.5 }],
      },
      {
        id: "sc_m4",
        role: "cta",
        startMs: 11200,
        endMs: 15200,
        text: "Singkatnya DNS itu seperti buku telepon raksasa internet yang serba cepat.",
        visualSource: "motion",
        aiMotion: s4Motion,
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0.4 },
        transitionIn: { preset: "whip_pan", durationMs: 240 },
        overlays: [],
        sfx: [{ preset: "ding_chime", offsetMs: 0, volume: 0.6 }],
      },
    ],
  };

  project.voiceover.words = rebuildWordsFromScenes(project);
  return project;
}

function createBreakdown3DShowcaseProject(presetId: "smartphone" | "laptop" = "smartphone"): SynkcutProject {
  const now = new Date().toISOString();
  const mainPreset = createBreakdown3DPreset(presetId);
  const secondPreset = createBreakdown3DPreset(presetId === "smartphone" ? "earbuds" : "smartwatch");

  const project: SynkcutProject = {
    version: "1.1",
    meta: {
      id: `demo_3d_${presetId}_m7`,
      name: presetId === "smartphone" ? "Bedah Smartphone 3D" : "Anatomi Laptop 3D",
      aspectRatio: "9:16",
      fps: 30,
      format: "education",
      createdAt: now,
    },
    globalStyle: {
      captionPreset: "bold_pop",
      accentColor: "#38E59D",
      safeZone: "tiktok_reels",
      showProgressBar: true,
      bgm: {
        preset: "tech_modern",
        volume: 0.22,
        autoDucking: true,
      },
    },
    voiceover: {
      source: "tts",
      audioPath: null,
      trimSilence: true,
      words: [],
    },
    scenes: [
      {
        id: "sc_3d_1",
        role: "hook",
        startMs: 0,
        endMs: 4600,
        text:
          presetId === "smartphone"
            ? "Pernah lihat 6 lapisan komponen di dalam HP setipis delapan milimeter?"
            : "Begini cara laptop tipis memadatkan chip kencang dan baterai besar.",
        visualSource: "motion",
        aiMotion: {
          engine: "breakdown_3d",
          theme: presetId === "smartphone" ? "carbon" : "paper",
          title: mainPreset.title,
          subtitle: mainPreset.subtitle,
          takeaway: mainPreset.takeaway,
          breakdown3d: mainPreset.config,
        },
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0.4 },
        transitionIn: { preset: "hard_cut", durationMs: 0 },
        overlays: [],
        sfx: [{ preset: "whoosh_fast", offsetMs: 0, volume: 0.6 }],
      },
      {
        id: "sc_3d_2",
        role: "body",
        startMs: 4600,
        endMs: 9200,
        text: "Setiap lapisan dirancang presisi agar dingin stabil dan super hemat daya.",
        visualSource: "motion",
        aiMotion: {
          engine: "breakdown_3d",
          theme: "blue",
          title: secondPreset.title,
          subtitle: secondPreset.subtitle,
          takeaway: secondPreset.takeaway,
          breakdown3d: secondPreset.config,
        },
        media: { path: null, trimStartMs: 0, fit: "cover" },
        motion: { preset: "static_clean", intensity: 0.4 },
        transitionIn: { preset: "pop_zoom", durationMs: 240 },
        overlays: [],
        sfx: [{ preset: "pop_clean", offsetMs: 0, volume: 0.55 }],
      },
    ],
  };

  project.voiceover.words = rebuildWordsFromScenes(project);
  return project;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(loadInitialTheme);
  const [view, setView] = useState<AppView>("loading");
  const [wizardFormat, setWizardFormat] = useState<ContentFormat>("ad_promo");
  const [wizardSessionKey, setWizardSessionKey] = useState(0);
  const [hasActiveWizardDraft, setHasActiveWizardDraft] = useState(false);
  const [returnViewFromSettings, setReturnViewFromSettings] = useState<AppView | null>(null);
  const [showNewPicker, setShowNewPicker] = useState(false);
  const [byokStatus, setByokStatus] = useState<ByokStatus>({
    activeProvider: "gemini",
    onboardingCompleted: false,
    providers: {
      gemini: { configured: false, maskedKey: null, model: "gemini-3.5-flash-lite", baseUrl: null },
      openai: { configured: false, maskedKey: null, model: "gpt-4.1-mini", baseUrl: null },
      openrouter: {
        configured: false,
        maskedKey: null,
        model: "google/gemini-3-flash-preview",
        baseUrl: null,
      },
      custom: { configured: false, maskedKey: null, model: "", baseUrl: null },
    },
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [activeProject, setActiveProject] = useState<SynkcutProject | null>(null);
  const [studioInitOpts, setStudioInitOpts] = useState<{
    manualOpen?: boolean;
    manualTab?: "visual" | "style" | "audio";
    timeMs?: number;
    generationDurationMs?: number;
  }>({});

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  const refreshProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (err) {
      console.error("Gagal memuat daftar proyek:", err);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      const [status] = await Promise.all([getByokStatus(), refreshProjects()]);
      if (!active) return;
      setByokStatus(status);

      const hash = window.location.hash.replace("#", "");
      if (hash === "projects" || hash === "projects-light" || hash === "settings") {
        if (hash === "projects-light") setTheme("light");
        else if (hash === "projects") setTheme("dark");
        setView(hash === "settings" ? "settings" : "projects");
        return;
      }
      if (hash === "wizard" || hash === "wizard-light") {
        setTheme(hash === "wizard-light" ? "light" : "dark");
        setHasActiveWizardDraft(true);
        setView("wizard");
        return;
      }
      if (hash === "samples" || hash === "samples-light") {
        setTheme(hash === "samples-light" ? "light" : "dark");
        setView("samples");
        return;
      }
      if (hash === "studio" || hash === "studio-light") {
        setTheme(hash === "studio-light" ? "light" : "dark");
        setStudioInitOpts({});
        setActiveProject(createBlankProjectForFormat("ad_promo"));
        setView("studio");
        return;
      }
      if (
        hash === "studio-motion" ||
        hash === "studio-motion-light" ||
        hash === "studio-manual"
      ) {
        setTheme(hash === "studio-motion-light" ? "light" : "dark");
        const opts =
          hash === "studio-motion-light"
            ? { manualOpen: false, timeMs: 5800 }
            : hash === "studio-manual"
              ? { manualOpen: true, manualTab: "visual" as const, timeMs: 2200 }
              : { manualOpen: false, timeMs: 2200 };
        setStudioInitOpts(opts);
        setActiveProject(createAiMotionShowcaseProject());
        setView("studio");
        return;
      }
      if (hash === "studio-motion-3d" || hash === "studio-motion-3d-light") {
        const isLight = hash === "studio-motion-3d-light";
        setTheme(isLight ? "light" : "dark");
        setStudioInitOpts({ manualOpen: false, timeMs: 3600 });
        setActiveProject(createBreakdown3DShowcaseProject(isLight ? "laptop" : "smartphone"));
        setView("studio");
        return;
      }

      const hasAnyKey = Object.values(status.providers).some((p) => p.configured);
      if (!status.onboardingCompleted && !hasAnyKey) {
        setView("onboarding");
      } else {
        setView("projects");
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, [refreshProjects]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  async function handleStartWizard(format: ContentFormat) {
    setShowNewPicker(false);
    setWizardFormat(format);
    setWizardSessionKey((k) => k + 1);
    setHasActiveWizardDraft(true);
    setReturnViewFromSettings(null);
    setView("wizard");
  }

  function handleOpenSettingsFrom(fromView: AppView) {
    setReturnViewFromSettings(fromView);
    setView("settings");
  }

  async function handleCreateBlankFormat(format: ContentFormat) {
    setShowNewPicker(false);
    setHasActiveWizardDraft(false);
    const fresh = createBlankProjectForFormat(format);
    await saveProject(fresh);
    await refreshProjects();
    setActiveProject(fresh);
    setView("studio");
  }

  async function handleWizardProjectCreated(
    project: SynkcutProject,
    generationDurationMs?: number
  ) {
    const safeProject = normalizeProject(project);
    if (!safeProject.meta.posterDataUrl) {
      const poster = isHyperframeProject(safeProject)
        ? await captureHyperframePoster({
            html: buildPlayableHyperframeHtml(safeProject, "./vendor/"),
            timeSec: 1.0,
          })
        : captureProjectPosterDataUrl(safeProject, 1000);
      if (poster) {
        safeProject.meta = { ...safeProject.meta, posterDataUrl: poster };
      }
    }
    setHasActiveWizardDraft(false);
    setReturnViewFromSettings(null);
    await saveProject(safeProject);
    await refreshProjects();
    setStudioInitOpts(generationDurationMs ? { generationDurationMs } : {});
    setActiveProject(safeProject);
    setView("studio");
  }

  async function handleUseSample(sample: SampleTemplate) {
    const fresh = normalizeProject(sample.buildProject());
    const poster = captureProjectPosterDataUrl(fresh, 1000);
    if (poster) {
      fresh.meta = { ...fresh.meta, posterDataUrl: poster };
    }
    await saveProject(fresh);
    await refreshProjects();
    setActiveProject(fresh);
    setView("studio");
  }

  async function handleOpenProject(projectId: string) {
    try {
      const loaded = normalizeProject(await loadProject(projectId));
      // Backfill 1-second video frame thumbnail for projects without a saved poster
      if (!loaded.meta.posterDataUrl) {
        const poster = isHyperframeProject(loaded)
          ? await captureHyperframePoster({
              html: buildPlayableHyperframeHtml(loaded, "./vendor/"),
              timeSec: 1.0,
            })
          : captureProjectPosterDataUrl(loaded, 1000);
        if (poster) {
          loaded.meta = { ...loaded.meta, posterDataUrl: poster };
          saveProject(loaded)
            .then(() => refreshProjects())
            .catch(() => {});
        }
      }
      setActiveProject(loaded);
      setView("studio");
    } catch (err) {
      console.error("Gagal membuka proyek:", err);
    }
  }

  async function handleDuplicateProject(projectId: string) {
    await duplicateProject(projectId);
    await refreshProjects();
  }

  async function handleRenameProject(projectId: string, newName: string) {
    await renameProject(projectId, newName);
    await refreshProjects();
  }

  async function handleDeleteProject(projectId: string) {
    await deleteProject(projectId);
    await refreshProjects();
  }

  /* Full-bleed Studio Editor */
  if (view === "studio" && activeProject) {
    return (
      <ErrorBoundary
        key={`eb_${activeProject.meta.id}`}
        fallbackTitle="Studio Editor mengalami gangguan render"
        recoverLabel="Pulihkan Editor"
        onBackHome={() => {
          setStudioInitOpts({});
          refreshProjects();
          setView("projects");
        }}
      >
        <StudioView
          key={activeProject.meta.id}
          initialProject={activeProject}
          byokStatus={byokStatus}
          theme={theme}
          initialManualOpen={studioInitOpts.manualOpen}
          initialManualTab={studioInitOpts.manualTab}
          initialTimeMs={studioInitOpts.timeMs}
          generationDurationMs={studioInitOpts.generationDurationMs}
          onToggleTheme={toggleTheme}
          onBackHome={() => {
            setStudioInitOpts({});
            refreshProjects();
            setView("projects");
          }}
          onProjectSaved={refreshProjects}
        />
      </ErrorBoundary>
    );
  }

  /* Full-screen First-Run Onboarding */
  if (view === "onboarding") {
    return (
      <div
        className="flex h-screen flex-col overflow-hidden"
        style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
      >
        <header
          className="flex h-14 shrink-0 items-center justify-between border-b px-6"
          style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2.5">
            <SynkcutMark />
            <span className="text-base font-bold tracking-tight">Synkcut</span>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md cursor-pointer"
            aria-label="Ganti tema Dark atau Light Studio"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <OnboardingView
          mode="onboarding"
          byokStatus={byokStatus}
          onStatusChange={setByokStatus}
          onDone={() => setView("projects")}
        />
      </div>
    );
  }

  const activeProviderConfigured = byokStatus.providers[byokStatus.activeProvider]?.configured;
  const providerDisplayName =
    byokStatus.activeProvider === "gemini"
      ? "Gemini"
      : byokStatus.activeProvider === "openai"
        ? "OpenAI"
        : byokStatus.activeProvider === "openrouter"
          ? "OpenRouter"
          : "Custom";

  /* Native Desktop Shell: Left Workspace Sidebar + Full-Bleed Right Pane */
  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Left Workspace Sidebar (228px fixed) */}
      <aside
        className="flex w-[228px] shrink-0 flex-col border-r"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {/* Brand Row */}
        <div
          className="flex h-14 shrink-0 items-center justify-between border-b px-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            type="button"
            onClick={() => setView("projects")}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <SynkcutMark />
            <span className="text-[15px] font-bold tracking-tight">Synkcut</span>
          </button>
          <span
            className="font-mono-num text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            v3.1
          </span>
        </div>

        {/* Primary CTA */}
        <div className="p-3">
          <button
            type="button"
            onClick={() => setShowNewPicker(true)}
            className="ui-btn-primary flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-xs font-semibold cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Buat Konten Baru
          </button>
        </div>

        {/* Workspace Navigation */}
        <nav className="flex-1 space-y-0.5 px-2.5 py-1">
          <button
            type="button"
            onClick={() => setView("projects")}
            className="ui-row flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium cursor-pointer"
            style={{
              backgroundColor: view === "projects" ? "var(--bg-elevated)" : "transparent",
              color: view === "projects" ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <span className="flex items-center gap-2.5">
              <FolderKanban className="h-4 w-4" />
              My Projects
            </span>
            <span
              className="font-mono-num text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              {projects.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setView("samples")}
            className="ui-row flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium cursor-pointer"
            style={{
              backgroundColor: view === "samples" ? "var(--bg-elevated)" : "transparent",
              color: view === "samples" ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <span className="flex items-center gap-2.5">
              <LayoutTemplate className="h-4 w-4" />
              Sample Bawaan
            </span>
            <span className="font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
              {BUILTIN_SAMPLES.length}
            </span>
          </button>

          {hasActiveWizardDraft && (
            <button
              type="button"
              onClick={() => setView("wizard")}
              className="ui-row flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-semibold cursor-pointer"
              style={{
                backgroundColor: view === "wizard" ? "var(--accent-soft)" : "var(--bg-elevated)",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
              }}
            >
              <span className="truncate">Lanjutkan Wizard</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
            </button>
          )}

          <button
            type="button"
            onClick={() => handleOpenSettingsFrom(view)}
            className="ui-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium cursor-pointer"
            style={{
              backgroundColor: view === "settings" ? "var(--bg-elevated)" : "transparent",
              color: view === "settings" ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <Settings className="h-4 w-4" />
            Pengaturan AI
          </button>
        </nav>

        {/* Pinned Sidebar Footer: BYOK Status + Theme Switcher */}
        <div
          className="space-y-2.5 border-t p-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            type="button"
            onClick={() => handleOpenSettingsFrom(view)}
            className="ui-btn-secondary flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs cursor-pointer"
          >
            <span className="flex items-center gap-2 min-w-0">
              <KeyRound
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: activeProviderConfigured ? "var(--success)" : "var(--role-hook)" }}
              />
              <span className="truncate font-medium">
                {activeProviderConfigured ? `BYOK · ${providerDisplayName}` : "Atur BYOK"}
              </span>
            </span>
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: activeProviderConfigured ? "var(--success)" : "var(--role-hook)",
              }}
            />
          </button>

          {/* Segmented Dark / Light Studio Switch */}
          <div
            className="grid grid-cols-2 rounded-md p-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className="flex items-center justify-center gap-1.5 rounded py-1.5 transition-colors cursor-pointer"
              style={{
                backgroundColor: theme === "dark" ? "var(--bg-panel)" : "transparent",
                color: theme === "dark" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <Moon className="h-3 w-3" />
              Dark
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className="flex items-center justify-center gap-1.5 rounded py-1.5 transition-colors cursor-pointer"
              style={{
                backgroundColor: theme === "light" ? "var(--bg-panel)" : "transparent",
                color: theme === "light" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <Sun className="h-3 w-3" />
              Light
            </button>
          </div>
        </div>
      </aside>

      {/* Right Main Pane */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {view === "loading" && (
          <div
            className="flex flex-1 items-center justify-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Menyiapkan workspace lokal Synkcut...
          </div>
        )}

        {(view === "projects" || view === "samples") && (
          <ProjectsHomeView
            section={view}
            projects={projects}
            byokStatus={byokStatus}
            isLoading={isLoadingProjects}
            onNavigateSamples={() => setView("samples")}
            onOpenNewModal={() => setShowNewPicker(true)}
            onInstantProjectCreated={handleWizardProjectCreated}
            onUseSample={handleUseSample}
            onOpenProject={handleOpenProject}
            onDuplicateProject={handleDuplicateProject}
            onRenameProject={handleRenameProject}
            onDeleteProject={handleDeleteProject}
          />
        )}

        {/* Keep Wizard mounted while draft is active so switching to Settings to change AI model NEVER wipes generated script/audio! */}
        {hasActiveWizardDraft && (
          <div className={view === "wizard" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}>
            <WizardView
              key={wizardSessionKey}
              initialFormat={wizardFormat}
              byokStatus={byokStatus}
              onCancel={() => {
                setHasActiveWizardDraft(false);
                setReturnViewFromSettings(null);
                setView("projects");
              }}
              onOpenSettings={() => handleOpenSettingsFrom("wizard")}
              onSkipToBlank={handleCreateBlankFormat}
              onProjectCreated={handleWizardProjectCreated}
            />
          </div>
        )}

        {view === "settings" && (
          <OnboardingView
            mode="settings"
            byokStatus={byokStatus}
            onStatusChange={setByokStatus}
            returnLabel={
              returnViewFromSettings === "wizard" || hasActiveWizardDraft
                ? "Kembali ke Wizard"
                : undefined
            }
            onDone={() => {
              const target =
                returnViewFromSettings === "wizard" || hasActiveWizardDraft
                  ? "wizard"
                  : "projects";
              setReturnViewFromSettings(null);
              setView(target);
            }}
          />
        )}
      </div>

      {/* Focused Format Picker Dialog for "+ Buat Konten Baru" */}
      {showNewPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
          onClick={() => setShowNewPicker(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-lg shadow-2xl"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-5 py-3.5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div>
                <h2 className="text-sm font-bold">Pilih Format Konten</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Struktur Hook, Body, dan CTA disiapkan otomatis sesuai format yang dipilih.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewPicker(false)}
                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                aria-label="Tutup dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              {FORMAT_ORDER.map((fmt, idx) => {
                const info = CONTENT_FORMAT_LABELS[fmt];
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => handleStartWizard(fmt)}
                    className="ui-row flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left cursor-pointer"
                    style={{
                      borderBottom:
                        idx < FORMAT_ORDER.length - 1 ? "1px solid var(--border-subtle)" : "none",
                    }}
                  >
                    <div>
                      <div className="text-sm font-semibold">{info.label}</div>
                      <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {info.shortDesc}
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-[11px] font-medium"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {info.structure}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
