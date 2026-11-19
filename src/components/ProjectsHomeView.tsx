import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  FolderOpen,
  LayoutGrid,
  List,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  CONTENT_FORMAT_LABELS,
  type ContentFormat,
  type ProjectSummary,
} from "../types/scene";
import { BUILTIN_SAMPLES, type SampleTemplate } from "../engine/sampleTemplates";
import ProjectPosterCanvas from "./ProjectPosterCanvas";

interface ProjectsHomeViewProps {
  section: "projects" | "samples";
  projects: ProjectSummary[];
  isLoading: boolean;
  onNavigateSamples: () => void;
  onOpenNewModal: () => void;
  onUseSample: (sample: SampleTemplate) => void;
  onOpenProject: (projectId: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

const FORMAT_FILTERS: Array<{ id: "all" | ContentFormat; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "ad_promo", label: "Iklan" },
  { id: "education", label: "Edukasi" },
  { id: "storytelling", label: "Storytelling" },
  { id: "review", label: "Review" },
];

function formatDuration(ms: number): string {
  const sec = Math.max(0, ms / 1000);
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function formatUpdatedAt(iso: string): string {
  try {
    const dt = new Date(iso);
    return dt.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Baru saja";
  }
}

export default function ProjectsHomeView({
  section,
  projects,
  isLoading,
  onNavigateSamples,
  onOpenNewModal,
  onUseSample,
  onOpenProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
}: ProjectsHomeViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<"all" | ContentFormat>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const samplePreviewProjects = useMemo(
    () =>
      Object.fromEntries(
        BUILTIN_SAMPLES.map((sample) => [sample.id, sample.buildProject(sample.title)])
      ),
    []
  );

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((p) => {
      if (formatFilter !== "all" && p.format !== formatFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.hookText.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [projects, searchQuery, formatFilter]);

  const filteredSamples = useMemo(() => {
    if (formatFilter === "all") return BUILTIN_SAMPLES;
    return BUILTIN_SAMPLES.filter((s) => s.format === formatFilter);
  }, [formatFilter]);

  function startRename(item: ProjectSummary) {
    setConfirmDeleteId(null);
    setRenamingId(item.id);
    setRenameValue(item.name);
  }

  async function commitRename(projectId: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      await onRenameProject(projectId, trimmed);
    }
    setRenamingId(null);
  }

  /* ---------------- DEDICATED SAMPLE GALLERY VIEW ---------------- */
  if (section === "samples") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6"
          style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold tracking-tight">Sample Bawaan</h1>
            <span className="font-mono-num text-xs" style={{ color: "var(--text-muted)" }}>
              {filteredSamples.length} template
            </span>
          </div>

          <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
            {FORMAT_FILTERS.map((f) => {
              const active = formatFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormatFilter(f.id)}
                  className="rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-panel)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <p className="mb-5 text-xs" style={{ color: "var(--text-secondary)" }}>
            Pilih sample untuk langsung membuat proyek baru lengkap dengan struktur Hook–Body–CTA, gaya caption, dan motion—tinggal ganti footage lokal & teksnya.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {filteredSamples.map((sample) => {
              const fmtInfo = CONTENT_FORMAT_LABELS[sample.format];
              const previewProj = samplePreviewProjects[sample.id];
              return (
                <div
                  key={sample.id}
                  className="group flex flex-col overflow-hidden rounded-lg transition-colors"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onUseSample(sample)}
                    className="relative aspect-[9/16] w-full overflow-hidden bg-black text-left cursor-pointer"
                  >
                    <ProjectPosterCanvas
                      project={previewProj}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                    <span
                      className="absolute top-2.5 left-2.5 rounded px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: "rgba(13, 15, 18, 0.78)",
                        color: "#f1f3f7",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      {fmtInfo.label}
                    </span>
                    <span
                      className="font-mono-num absolute right-2.5 bottom-2.5 rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: "rgba(13, 15, 18, 0.82)",
                        color: "#f1f3f7",
                      }}
                    >
                      {sample.durationLabel.slice(0, 5)}
                    </span>
                  </button>

                  <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
                    <div>
                      <h2 className="text-sm font-bold">{sample.title}</h2>
                      <p
                        className="mt-1 line-clamp-2 text-xs leading-relaxed"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {sample.summary}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        <span>{sample.captionLabel}</span>
                        <span>·</span>
                        <span>{sample.motionLabel}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUseSample(sample)}
                        className="ui-btn-secondary w-full rounded-md py-2 text-xs font-semibold cursor-pointer"
                      >
                        Pakai Sample Ini
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- MY PROJECTS WORKSPACE ---------------- */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sticky Contextual Desktop Toolbar */}
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5 shrink-0">
          <h1 className="text-base font-bold tracking-tight">My Projects</h1>
          <span className="font-mono-num text-xs" style={{ color: "var(--text-muted)" }}>
            {projects.length}
          </span>
        </div>

        {/* Center/Right Controls: Search + Format Filter + Grid/List */}
        <div className="flex items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-2.5 h-3.5 w-3.5"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari proyek..."
              className="ui-input h-8 w-44 rounded-md pr-7 pl-8 text-xs lg:w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
                aria-label="Hapus pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Format Filter Pills */}
          <div
            className="hidden items-center gap-0.5 rounded-md p-0.5 xl:flex"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {FORMAT_FILTERS.map((f) => {
              const active = formatFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormatFilter(f.id)}
                  className="rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-panel)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Grid / List Toggle */}
          <div
            className="flex items-center rounded-md p-0.5"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className="flex h-7 w-7 items-center justify-center rounded cursor-pointer"
              style={{
                backgroundColor: viewMode === "grid" ? "var(--bg-panel)" : "transparent",
                color: viewMode === "grid" ? "var(--text-primary)" : "var(--text-muted)",
              }}
              title="Tampilan Grid Poster"
              aria-label="Tampilan Grid Poster"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className="flex h-7 w-7 items-center justify-center rounded cursor-pointer"
              style={{
                backgroundColor: viewMode === "list" ? "var(--bg-panel)" : "transparent",
                color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)",
              }}
              title="Tampilan List"
              aria-label="Tampilan List"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Main Workspace */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-9">
        {/* Saved Projects Area */}
        <section>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="overflow-hidden rounded-lg"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    className="aspect-[9/16] w-full animate-pulse"
                    style={{ backgroundColor: "var(--bg-elevated)" }}
                  />
                  <div className="p-3 space-y-2">
                    <div
                      className="h-3.5 w-3/4 animate-pulse rounded"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    />
                    <div
                      className="h-3 w-1/2 animate-pulse rounded"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center rounded-lg px-6 py-14 text-center"
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px dashed var(--border-strong)",
              }}
            >
              <div
                className="flex h-11 w-11 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <FolderOpen className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-sm font-bold">
                {projects.length === 0
                  ? "Workspace lo masih kosong"
                  : "Tidak ada proyek yang cocok"}
              </h2>
              <p
                className="mt-1 max-w-md text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {projects.length === 0
                  ? "Buat konten baru dari 4 format siap pakai atau pilih salah satu sample di bawah untuk langsung masuk ke Studio."
                  : "Coba ubah kata kunci pencarian atau reset filter format di toolbar atas."}
              </p>
              <div className="mt-5 flex items-center gap-2.5">
                {projects.length === 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={onOpenNewModal}
                      className="ui-btn-primary inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Buat Konten Baru
                    </button>
                    <button
                      type="button"
                      onClick={onNavigateSamples}
                      className="ui-btn-secondary inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold cursor-pointer"
                    >
                      Lihat Sample Bawaan
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setFormatFilter("all");
                    }}
                    className="ui-btn-secondary h-8 rounded-md px-3.5 text-xs font-semibold cursor-pointer"
                  >
                    Reset Filter
                  </button>
                )}
              </div>
            </div>
          ) : viewMode === "grid" ? (
            /* VISUAL 9:16 POSTER GRID (DEFAULT) */
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredProjects.map((item) => {
                const isRenaming = renamingId === item.id;
                const isConfirmingDelete = confirmDeleteId === item.id;
                const fmtLabel = CONTENT_FORMAT_LABELS[item.format]?.label || item.format;

                return (
                  <div
                    key={item.id}
                    className="group flex flex-col overflow-hidden rounded-lg transition-colors"
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {/* Live 9:16 Poster Preview */}
                    <button
                      type="button"
                      onClick={() => onOpenProject(item.id)}
                      className="relative aspect-[9/16] w-full overflow-hidden bg-black text-left cursor-pointer"
                    >
                      <ProjectPosterCanvas
                        summary={item}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />

                      {/* Hover Play Indicator */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 group-hover:bg-black/25">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                          style={{
                            backgroundColor: "var(--cta-bg)",
                            color: "var(--cta-fg)",
                          }}
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </div>
                      </div>

                      {/* Top-Left Format Pill */}
                      <span
                        className="absolute top-2 left-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: "rgba(13, 15, 18, 0.78)",
                          color: "#f1f3f7",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        {fmtLabel}
                      </span>

                      {/* Bottom-Right Duration Pill */}
                      <span
                        className="font-mono-num absolute right-2 bottom-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: "rgba(13, 15, 18, 0.82)",
                          color: "#f1f3f7",
                        }}
                      >
                        {formatDuration(item.durationMs)}
                      </span>
                    </button>

                    {/* Clean Card Metadata Footer */}
                    <div className="flex flex-col gap-2 p-3">
                      {isRenaming ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(item.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="ui-input h-7 min-w-0 flex-1 rounded px-2 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => commitRename(item.id)}
                            className="ui-btn-primary flex h-7 w-7 shrink-0 items-center justify-center rounded cursor-pointer"
                            aria-label="Simpan nama baru"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="ui-btn-secondary flex h-7 w-7 shrink-0 items-center justify-center rounded cursor-pointer"
                            aria-label="Batal"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenProject(item.id)}
                          className="truncate text-left text-xs font-bold hover:underline cursor-pointer"
                          title={item.name}
                        >
                          {item.name}
                        </button>
                      )}

                      <div
                        className="flex items-center justify-between gap-2 text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <span className="truncate font-mono-num">
                          {item.sceneCount} scene · {formatUpdatedAt(item.updatedAt)}
                        </span>
                      </div>

                      {/* Subtle Action Row */}
                      {isConfirmingDelete ? (
                        <div className="flex items-center justify-between gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteProject(item.id);
                              setConfirmDeleteId(null);
                            }}
                            className="flex-1 rounded py-1 text-[11px] font-semibold cursor-pointer"
                            style={{ backgroundColor: "var(--danger)", color: "#ffffff" }}
                          >
                            Hapus permanen
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="ui-btn-secondary rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-between border-t pt-2"
                          style={{ borderColor: "var(--border-subtle)" }}
                        >
                          <button
                            type="button"
                            onClick={() => onOpenProject(item.id)}
                            className="text-[11px] font-semibold hover:underline cursor-pointer"
                            style={{ color: "var(--text-primary)" }}
                          >
                            Buka Studio
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onDuplicateProject(item.id)}
                              className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                              title="Duplikat proyek (A/B test Hook)"
                              aria-label="Duplikat proyek"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startRename(item)}
                              className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                              title="Ganti nama"
                              aria-label="Ganti nama"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="ui-btn-secondary flex h-6 w-6 items-center justify-center rounded cursor-pointer"
                              title="Hapus proyek"
                              aria-label="Hapus proyek"
                              style={{ color: "var(--danger)" }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* PRECISION LIST VIEW (ZERO COLUMN COLLISION) */
            <div
              className="overflow-x-auto rounded-lg"
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="min-w-[760px]">
                {/* Header */}
                <div
                  className="grid items-center gap-4 border-b px-4 py-2.5 text-[11px] font-semibold"
                  style={{
                    gridTemplateColumns: "minmax(220px, 1fr) 136px 70px 84px 142px 156px",
                    borderColor: "var(--border-subtle)",
                    backgroundColor: "var(--bg-elevated)",
                    color: "var(--text-muted)",
                  }}
                >
                  <div>Nama Proyek</div>
                  <div>Format</div>
                  <div className="text-right">Scene</div>
                  <div className="text-right">Durasi</div>
                  <div className="text-right">Terakhir Diubah</div>
                  <div className="text-right">Aksi</div>
                </div>

                {/* Rows */}
                {filteredProjects.map((item, idx) => {
                  const isRenaming = renamingId === item.id;
                  const isConfirmingDelete = confirmDeleteId === item.id;
                  const fmtLabel = CONTENT_FORMAT_LABELS[item.format]?.label || item.format;

                  return (
                    <div
                      key={item.id}
                      className="ui-row grid items-center gap-4 px-4 py-2.5 text-xs"
                      style={{
                        gridTemplateColumns: "minmax(220px, 1fr) 136px 70px 84px 142px 156px",
                        borderBottom:
                          idx < filteredProjects.length - 1
                            ? "1px solid var(--border-subtle)"
                            : "none",
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="h-11 w-[25px] shrink-0 overflow-hidden rounded-sm bg-black"
                          style={{ border: "1px solid var(--border-subtle)" }}
                        >
                          <ProjectPosterCanvas summary={item} className="h-full w-full object-cover" />
                        </div>

                        {isRenaming ? (
                          <div className="flex flex-1 items-center gap-1.5">
                            <input
                              type="text"
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename(item.id);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="ui-input h-7 flex-1 rounded px-2 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => commitRename(item.id)}
                              className="ui-btn-primary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingId(null)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenProject(item.id)}
                            className="truncate text-left font-semibold hover:underline cursor-pointer"
                          >
                            {item.name}
                          </button>
                        )}
                      </div>

                      <div className="truncate whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {fmtLabel}
                      </div>

                      <div className="text-right font-mono-num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {item.sceneCount}
                      </div>

                      <div className="text-right font-mono-num whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {formatDuration(item.durationMs)}
                      </div>

                      <div
                        className="text-right font-mono-num text-[11px] whitespace-nowrap"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {formatUpdatedAt(item.updatedAt)}
                      </div>

                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {isConfirmingDelete ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteProject(item.id);
                                setConfirmDeleteId(null);
                              }}
                              className="rounded px-2 py-1 text-[11px] font-semibold cursor-pointer"
                              style={{ backgroundColor: "var(--danger)", color: "#ffffff" }}
                            >
                              Hapus
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="ui-btn-secondary rounded px-2 py-1 text-[11px] cursor-pointer"
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onOpenProject(item.id)}
                              className="ui-btn-secondary rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                            >
                              Buka
                            </button>
                            <button
                              type="button"
                              onClick={() => onDuplicateProject(item.id)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                              title="Duplikat"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startRename(item)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                              title="Ganti nama"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                              title="Hapus"
                              style={{ color: "var(--danger)" }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Compact Visual Sample Shelf (1 clean row linking to full Sample tab) */}
        <section className="border-t pt-6" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold">Mulai dari Sample Bawaan</h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                Klik salah satu poster untuk langsung remix dengan footage & skrip lo sendiri.
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateSamples}
              className="inline-flex items-center gap-1 text-xs font-semibold hover:underline cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              Semua Sample ({BUILTIN_SAMPLES.length})
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {BUILTIN_SAMPLES.slice(0, 4).map((sample) => {
              const previewProj = samplePreviewProjects[sample.id];
              return (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => onUseSample(sample)}
                  className="group ui-row flex items-center gap-3.5 rounded-lg p-2.5 text-left cursor-pointer"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    className="h-24 w-[54px] shrink-0 overflow-hidden rounded bg-black"
                    style={{ border: "1px solid var(--border-subtle)" }}
                  >
                    <ProjectPosterCanvas
                      project={previewProj}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">{sample.title}</div>
                    <div
                      className="mt-1 text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {sample.captionLabel} · {sample.motionLabel}
                    </div>
                    <div
                      className="mt-2 font-mono-num text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {sample.durationLabel.slice(0, 5)} · 9:16
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
