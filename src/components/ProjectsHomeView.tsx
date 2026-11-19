import { useState } from "react";
import {
  Check,
  Copy,
  Film,
  FolderOpen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  CONTENT_FORMAT_LABELS,
  type ContentFormat,
  type ProjectSummary,
} from "../types/scene";
import { BUILTIN_SAMPLES, type SampleTemplate } from "../engine/sampleTemplates";

interface ProjectsHomeViewProps {
  projects: ProjectSummary[];
  isLoading: boolean;
  onCreateFormat: (format: ContentFormat) => void;
  onUseSample: (sample: SampleTemplate) => void;
  onOpenProject: (projectId: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

const FORMAT_ORDER: ContentFormat[] = ["ad_promo", "education", "storytelling", "review"];

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
  projects,
  isLoading,
  onCreateFormat,
  onUseSample,
  onOpenProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
}: ProjectsHomeViewProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        {/* Top Action Bar & Format Shortcuts */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">My Projects</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                Semua proyek tersimpan rapi secara lokal di komputer lo. Duplikat kapan saja untuk uji variasi Hook.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onCreateFormat("ad_promo")}
              className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Buat Konten Baru
            </button>
          </div>

          {/* 4 Content Format Quick-Launch Strip */}
          <div
            className="mt-5 grid grid-cols-1 divide-y overflow-hidden rounded-lg sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {FORMAT_ORDER.map((fmt) => {
              const info = CONTENT_FORMAT_LABELS[fmt];
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onCreateFormat(fmt)}
                  className="ui-row flex flex-col items-start justify-between gap-2 p-4 text-left cursor-pointer"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <div>
                    <div className="text-sm font-semibold">{info.label}</div>
                    <div
                      className="mt-1 text-xs leading-relaxed"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {info.shortDesc}
                    </div>
                  </div>
                  <div
                    className="text-[11px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {info.structure}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Saved Projects List / Table */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">
              Proyek Tersimpan{" "}
              <span className="font-mono-num font-normal" style={{ color: "var(--text-muted)" }}>
                ({projects.length})
              </span>
            </h2>
          </div>

          <div
            className="overflow-hidden rounded-lg"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {isLoading ? (
              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {[1, 2, 3].map((row) => (
                  <div key={row} className="flex items-center justify-between px-4 py-3.5">
                    <div
                      className="h-4 w-56 animate-pulse rounded"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    />
                    <div
                      className="h-4 w-28 animate-pulse rounded"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    />
                  </div>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-start justify-between gap-4 px-5 py-7 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Belum ada proyek lokal tersimpan</div>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                      Mulai dari 4 format konten di atas atau klik &ldquo;Pakai Sample Ini&rdquo; di bawah untuk langsung masuk ke Studio.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUseSample(BUILTIN_SAMPLES[0])}
                  className="ui-btn-secondary shrink-0 rounded-md px-3.5 py-2 text-xs font-semibold cursor-pointer"
                >
                  Coba Sample Pertama
                </button>
              </div>
            ) : (
              <div>
                {/* Table Header */}
                <div
                  className="grid grid-cols-12 items-center border-b px-4 py-2.5 text-[11px] font-semibold"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-muted)",
                    backgroundColor: "var(--bg-elevated)",
                  }}
                >
                  <div className="col-span-5">Nama Proyek</div>
                  <div className="col-span-2">Format</div>
                  <div className="col-span-1 text-right">Scene</div>
                  <div className="col-span-1 text-right">Durasi</div>
                  <div className="col-span-1 text-right hidden sm:block">Diubah</div>
                  <div className="col-span-3 sm:col-span-2 text-right">Aksi</div>
                </div>

                {/* Project Rows */}
                <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {projects.map((item) => {
                    const isRenaming = renamingId === item.id;
                    const isConfirmingDelete = confirmDeleteId === item.id;
                    const fmtLabel =
                      CONTENT_FORMAT_LABELS[item.format]?.label || item.format;

                    return (
                      <div
                        key={item.id}
                        className="ui-row grid grid-cols-12 items-center gap-2 px-4 py-3 text-xs"
                        style={{ borderColor: "var(--border-subtle)" }}
                      >
                        {/* Project Name */}
                        <div className="col-span-5 flex items-center gap-2.5 min-w-0">
                          <Film
                            className="h-4 w-4 shrink-0"
                            style={{ color: item.hasFootage ? "var(--accent)" : "var(--text-muted)" }}
                          />
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
                                aria-label="Simpan nama baru"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingId(null)}
                                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                                aria-label="Batal ubah nama"
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

                        {/* Format */}
                        <div className="col-span-2 truncate" style={{ color: "var(--text-secondary)" }}>
                          {fmtLabel}
                        </div>

                        {/* Scene count */}
                        <div className="col-span-1 text-right font-mono-num" style={{ color: "var(--text-secondary)" }}>
                          {item.sceneCount}
                        </div>

                        {/* Duration */}
                        <div className="col-span-1 text-right font-mono-num" style={{ color: "var(--text-secondary)" }}>
                          {formatDuration(item.durationMs)}
                        </div>

                        {/* Updated */}
                        <div
                          className="col-span-1 hidden truncate text-right font-mono-num text-[11px] sm:block"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {formatUpdatedAt(item.updatedAt)}
                        </div>

                        {/* Row Actions */}
                        <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-1">
                          {isConfirmingDelete ? (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteProject(item.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="rounded px-2 py-1 text-[11px] font-semibold cursor-pointer"
                                style={{
                                  backgroundColor: "var(--danger)",
                                  color: "#ffffff",
                                }}
                              >
                                Hapus
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="ui-btn-secondary rounded px-2 py-1 text-[11px] font-medium cursor-pointer"
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
                                title="Duplikat proyek (A/B test Hook)"
                                aria-label="Duplikat proyek"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => startRename(item)}
                                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                                title="Ganti nama proyek"
                                aria-label="Ganti nama proyek"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(item.id)}
                                className="ui-btn-secondary flex h-7 w-7 items-center justify-center rounded cursor-pointer"
                                title="Hapus proyek"
                                aria-label="Hapus proyek"
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
          </div>
        </section>

        {/* Built-in Sample Templates (Foundation for Phase 2 Community Remix) */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: "var(--accent)" }} />
              <h2 className="text-sm font-bold">Mulai dari Sample Bawaan</h2>
            </div>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Klik sample untuk langsung remix dengan footage & teks lo sendiri
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {BUILTIN_SAMPLES.map((sample) => {
              const fmtInfo = CONTENT_FORMAT_LABELS[sample.format];
              return (
                <div
                  key={sample.id}
                  className="flex flex-col justify-between gap-4 rounded-lg p-4"
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold">{sample.title}</h3>
                      <span
                        className="font-mono-num text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {sample.durationLabel} · 9:16
                      </span>
                    </div>
                    <p
                      className="mt-1 text-xs leading-relaxed"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {sample.summary}
                    </p>

                    {/* Mini Role Structure Strip */}
                    <div className="mt-3 flex gap-1">
                      {sample.roles.map((role, idx) => (
                        <div
                          key={idx}
                          className="h-1.5 flex-1 rounded-full"
                          style={{
                            backgroundColor:
                              role === "hook"
                                ? "var(--role-hook)"
                                : role === "body"
                                  ? "var(--role-body)"
                                  : "var(--role-cta)",
                          }}
                          title={role.toUpperCase()}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <span>{fmtInfo.label}</span>
                      <span>·</span>
                      <span>{sample.captionLabel}</span>
                      <span>·</span>
                      <span>{sample.motionLabel}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onUseSample(sample)}
                      className="ui-btn-secondary rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer"
                    >
                      Pakai Sample Ini
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
