import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MotionSkillInfo } from "../types/scene";
import {
  deleteCustomMotionSkill,
  importMotionSkillUrl,
  listMotionSkills,
  saveCustomMotionSkill,
  toggleMotionSkill,
} from "../lib/tauriBridge";

const QUICK_REPO_SUGGESTIONS = [
  { label: "LottieFiles Motion Design Skill", url: "https://github.com/LottieFiles/motion-design-skill" },
  { label: "iart-ai Motion Skills", url: "https://github.com/iart-ai/motion-skills" },
];

export default function MotionSkillsSettings() {
  const [skills, setSkills] = useState<MotionSkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Custom Motion");
  const [newContent, setNewContent] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    listMotionSkills()
      .then((res) => setSkills(res))
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(skill: MotionSkillInfo) {
    setErrorMsg(null);
    try {
      const next = await toggleMotionSkill(skill.id, !skill.enabled);
      setSkills(next);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleImportUrl(targetUrl?: string) {
    const u = (targetUrl ?? importUrl).trim();
    if (!u) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setIsImporting(true);
    try {
      const next = await importMotionSkillUrl(u);
      setSkills(next);
      setImportUrl("");
      setStatusMsg("Skill berhasil diimpor & aktif otomatis untuk AI Motion Director!");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newContent.trim()) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const next = await saveCustomMotionSkill({
        name: newName.trim(),
        category: newCategory.trim() || "Kustom",
        content: newContent.trim(),
      });
      setSkills(next);
      setNewName("");
      setNewContent("");
      setShowAddForm(false);
      setStatusMsg("Skill kustom disimpan dan aktif otomatis!");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(skillId: string) {
    setErrorMsg(null);
    try {
      const next = await deleteCustomMotionSkill(skillId);
      setSkills(next);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg p-4 space-y-3"
        style={{
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Sparkles className="h-4 w-4" style={{ color: "var(--accent)" }} />
              Motion Skills Brain ({enabledCount}/{skills.length} aktif)
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              AI Director otomatis memilih skill terbaik per beat untuk menghasilkan animasi kode bebas tanpa template (berbasis LottieFiles Motion Craft, Disney 12 Principles, iart-ai/motion-skills, & SkillDB).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="ui-btn-secondary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Skill (.md)
          </button>
        </div>

        {/* GitHub / Raw Markdown URL Importer */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Impor dari URL GitHub repo atau raw SKILL.md..."
              className="ui-input h-9 flex-1 rounded-md px-3 text-xs"
            />
            <button
              type="button"
              disabled={isImporting || !importUrl.trim()}
              onClick={() => handleImportUrl()}
              className="ui-btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold cursor-pointer disabled:opacity-45"
            >
              {isImporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Impor Skill
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Impor cepat:
            </span>
            {QUICK_REPO_SUGGESTIONS.map((s) => (
              <button
                key={s.url}
                type="button"
                disabled={isImporting}
                onClick={() => handleImportUrl(s.url)}
                className="rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                + {s.label}
              </button>
            ))}
          </div>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleAddManual}
            className="space-y-2.5 rounded-lg p-3"
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nama skill (mis. Apple Launch Typography)"
                className="ui-input h-8 rounded-md px-2.5 text-xs"
              />
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Kategori (mis. Tipografi / 3D / Produk)"
                className="ui-input h-8 rounded-md px-2.5 text-xs"
              />
            </div>
            <textarea
              rows={4}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Tempel isi panduan SKILL.md (aturan timing, easing, layout, gaya gerak)..."
              className="ui-input w-full rounded-md p-2.5 font-mono-num text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="ui-btn-secondary rounded-md px-3 py-1.5 text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="ui-btn-primary rounded-md px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
              >
                Simpan Skill
              </button>
            </div>
          </form>
        )}

        {statusMsg && (
          <div
            className="flex items-center gap-2 rounded-md p-2.5 text-xs"
            style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {statusMsg}
          </div>
        )}
        {errorMsg && (
          <div
            className="rounded-md p-2.5 text-xs"
            style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger)" }}
          >
            {errorMsg}
          </div>
        )}
      </div>

      {/* Skill List */}
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat Motion Skills...
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => {
            const open = expandedId === skill.id;
            return (
              <div
                key={skill.id}
                className="rounded-lg p-3.5"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  border: skill.enabled
                    ? "1px solid var(--border-strong)"
                    : "1px solid var(--border-subtle)",
                  opacity: skill.enabled ? 1 : 0.65,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold">{skill.name}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: "var(--bg-elevated)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {skill.category}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {skill.source}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {skill.summary}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggle(skill)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                        skill.enabled ? "ui-btn-primary" : "ui-btn-secondary"
                      }`}
                    >
                      {skill.enabled ? "Aktif" : "Nonaktif"}
                    </button>
                    {!skill.builtIn && (
                      <button
                        type="button"
                        onClick={() => handleDelete(skill.id)}
                        className="rounded-md p-1.5 cursor-pointer"
                        style={{ color: "var(--danger)" }}
                        title="Hapus skill kustom"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : skill.id)}
                      className="rounded-md p-1.5 cursor-pointer"
                      style={{ color: "var(--text-muted)" }}
                      aria-label="Lihat aturan skill"
                    >
                      {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {open && (
                  <pre
                    className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md p-3 font-mono-num text-[11px] leading-relaxed"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {skill.content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
