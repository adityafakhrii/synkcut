import { useCallback, useEffect, useState } from "react";
import { KeyRound, Moon, Settings, Sun } from "lucide-react";
import type {
  ByokStatus,
  ContentFormat,
  ProjectSummary,
  SynkcutProject,
} from "./types/scene";
import { createBlankProjectForFormat, type SampleTemplate } from "./engine/sampleTemplates";
import {
  deleteProject,
  duplicateProject,
  getByokStatus,
  listProjects,
  loadProject,
  renameProject,
  saveProject,
} from "./lib/tauriBridge";
import OnboardingView from "./components/OnboardingView";
import ProjectsHomeView from "./components/ProjectsHomeView";
import StudioView from "./components/StudioView";

type AppView = "loading" | "onboarding" | "home" | "settings" | "studio";

const THEME_STORAGE_KEY = "synkcut_theme_v1";

function loadInitialTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(loadInitialTheme);
  const [view, setView] = useState<AppView>("loading");
  const [byokStatus, setByokStatus] = useState<ByokStatus>({
    activeProvider: "gemini",
    onboardingCompleted: false,
    providers: {
      gemini: { configured: false, maskedKey: null },
      openai: { configured: false, maskedKey: null },
      openrouter: { configured: false, maskedKey: null },
    },
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [activeProject, setActiveProject] = useState<SynkcutProject | null>(null);

  // Sync theme to document root & persist
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

  // Boot app: load BYOK status & saved projects
  useEffect(() => {
    let active = true;
    async function boot() {
      const [status] = await Promise.all([getByokStatus(), refreshProjects()]);
      if (!active) return;
      setByokStatus(status);

      const hasAnyKey = Object.values(status.providers).some((p) => p.configured);
      if (!status.onboardingCompleted && !hasAnyKey) {
        setView("onboarding");
      } else {
        setView("home");
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

  async function handleCreateFormat(format: ContentFormat) {
    const fresh = createBlankProjectForFormat(format);
    await saveProject(fresh);
    await refreshProjects();
    setActiveProject(fresh);
    setView("studio");
  }

  async function handleUseSample(sample: SampleTemplate) {
    const fresh = sample.buildProject();
    await saveProject(fresh);
    await refreshProjects();
    setActiveProject(fresh);
    setView("studio");
  }

  async function handleOpenProject(projectId: string) {
    try {
      const loaded = await loadProject(projectId);
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

  // Full-bleed Studio view
  if (view === "studio" && activeProject) {
    return (
      <StudioView
        key={activeProject.meta.id}
        initialProject={activeProject}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBackHome={() => {
          refreshProjects();
          setView("home");
        }}
        onProjectSaved={refreshProjects}
      />
    );
  }

  const activeProviderConfigured = byokStatus.providers[byokStatus.activeProvider]?.configured;
  const providerDisplayName =
    byokStatus.activeProvider === "gemini"
      ? "Gemini"
      : byokStatus.activeProvider === "openai"
        ? "OpenAI"
        : "OpenRouter";

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Persistent Desktop Shell Bar */}
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b px-5"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setView("home")}
            className="flex items-center gap-2 cursor-pointer"
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-extrabold"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}
            >
              S
            </div>
            <span className="text-base font-bold tracking-tight">Synkcut</span>
          </button>

          {view !== "onboarding" && (
            <nav className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setView("home")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer"
                style={{
                  backgroundColor: view === "home" ? "var(--bg-elevated)" : "transparent",
                  color: view === "home" ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                My Projects
              </button>
              <button
                type="button"
                onClick={() => setView("settings")}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer"
                style={{
                  backgroundColor: view === "settings" ? "var(--bg-elevated)" : "transparent",
                  color: view === "settings" ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                <Settings className="h-3.5 w-3.5" />
                Pengaturan AI
              </button>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView("settings")}
            className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium cursor-pointer"
            title="Atur API Key BYOK"
          >
            <KeyRound
              className="h-3.5 w-3.5"
              style={{ color: activeProviderConfigured ? "var(--success)" : "var(--role-hook)" }}
            />
            <span>
              {activeProviderConfigured
                ? `BYOK: ${providerDisplayName}`
                : "BYOK Belum Diatur"}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="ui-btn-secondary flex h-8 w-8 items-center justify-center rounded-md cursor-pointer"
            title={theme === "dark" ? "Ganti ke Light Studio" : "Ganti ke Dark Studio"}
            aria-label="Ganti tema Dark atau Light Studio"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      {view === "loading" && (
        <div className="flex flex-1 items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
          Menyiapkan workspace lokal Synkcut...
        </div>
      )}

      {view === "onboarding" && (
        <OnboardingView
          mode="onboarding"
          byokStatus={byokStatus}
          onStatusChange={setByokStatus}
          onDone={() => setView("home")}
        />
      )}

      {view === "settings" && (
        <OnboardingView
          mode="settings"
          byokStatus={byokStatus}
          onStatusChange={setByokStatus}
          onDone={() => setView("home")}
        />
      )}

      {view === "home" && (
        <ProjectsHomeView
          projects={projects}
          isLoading={isLoadingProjects}
          onCreateFormat={handleCreateFormat}
          onUseSample={handleUseSample}
          onOpenProject={handleOpenProject}
          onDuplicateProject={handleDuplicateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
        />
      )}
    </div>
  );
}
