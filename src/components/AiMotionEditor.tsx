import { Plus, Trash2 } from "lucide-react";
import type {
  AiMotionEngine,
  AiMotionSpec,
  AiMotionTheme,
  FlowDiagramConfig,
  MotionChartConfig,
  StickFigureAction,
  StickFigureConfig,
  TechCardsConfig,
} from "../types/scene";
import {
  AI_MOTION_ENGINES,
  AI_MOTION_THEMES,
  createDefaultAiMotion,
} from "../engine/aiMotionPresets";

interface AiMotionEditorProps {
  spec: AiMotionSpec;
  sceneText: string;
  onChange: (next: AiMotionSpec, recordHistory?: boolean) => void;
}

const STICK_ACTIONS: Array<{ id: StickFigureAction; label: string }> = [
  { id: "talk", label: "Bicara" },
  { id: "point", label: "Menunjuk" },
  { id: "think", label: "Mikir" },
  { id: "idea", label: "Dapat Ide" },
  { id: "surprised", label: "Kaget" },
  { id: "cheer", label: "Senang / Sorak" },
  { id: "laugh", label: "Tertawa" },
  { id: "wave", label: "Melambai" },
  { id: "walk", label: "Berjalan" },
  { id: "shrug", label: "Bingung" },
  { id: "sad", label: "Sedih" },
];

export default function AiMotionEditor({ spec, sceneText, onChange }: AiMotionEditorProps) {
  function handleEngineChange(engine: AiMotionEngine) {
    const fresh = createDefaultAiMotion(engine, spec.theme, spec.title || sceneText);
    onChange(
      {
        ...fresh,
        title: spec.title || fresh.title,
        subtitle: spec.subtitle ?? fresh.subtitle,
        takeaway: spec.takeaway ?? fresh.takeaway,
      },
      true
    );
  }

  function handleThemeChange(theme: AiMotionTheme) {
    onChange({ ...spec, theme }, true);
  }

  function patchFlow(partial: Partial<FlowDiagramConfig>, record = false) {
    const base = spec.flow ?? createDefaultAiMotion("flow_diagram", spec.theme).flow!;
    onChange({ ...spec, flow: { ...base, ...partial } }, record);
  }

  function patchChart(partial: Partial<MotionChartConfig>, record = false) {
    const base = spec.chart ?? createDefaultAiMotion("motion_chart", spec.theme).chart!;
    onChange({ ...spec, chart: { ...base, ...partial } }, record);
  }

  function patchTechCards(partial: Partial<TechCardsConfig>, record = false) {
    const base = spec.techCards ?? createDefaultAiMotion("tech_cards", spec.theme).techCards!;
    onChange({ ...spec, techCards: { ...base, ...partial } }, record);
  }

  function patchStick(partial: Partial<StickFigureConfig>, record = false) {
    const base = spec.stickFigure ?? createDefaultAiMotion("stick_figure", spec.theme).stickFigure!;
    onChange({ ...spec, stickFigure: { ...base, ...partial } }, record);
  }

  const flow = spec.flow ?? createDefaultAiMotion("flow_diagram", spec.theme).flow!;
  const chart = spec.chart ?? createDefaultAiMotion("motion_chart", spec.theme).chart!;
  const tech = spec.techCards ?? createDefaultAiMotion("tech_cards", spec.theme).techCards!;
  const stick = spec.stickFigure ?? createDefaultAiMotion("stick_figure", spec.theme).stickFigure!;

  return (
    <div className="space-y-3.5">
      {/* Engine Selector */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold">Tipe AI Motion</label>
        <select
          value={spec.engine}
          onChange={(e) => handleEngineChange(e.target.value as AiMotionEngine)}
          className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
        >
          {AI_MOTION_ENGINES.map((eng) => (
            <option key={eng.id} value={eng.id}>
              {eng.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {AI_MOTION_ENGINES.find((e) => e.id === spec.engine)?.shortDesc}
        </p>
      </div>

      {/* 5 Canvas Themes */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold">Tema Kanvas Motion</label>
        <div className="grid grid-cols-5 gap-1.5">
          {AI_MOTION_THEMES.map((th) => {
            const active = spec.theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => handleThemeChange(th.id)}
                className="flex flex-col items-center gap-1 rounded-md py-1.5 text-[11px] font-medium cursor-pointer"
                style={{
                  backgroundColor: active ? "var(--bg-hover)" : "var(--bg-elevated)",
                  border: active
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border-subtle)",
                }}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{
                    backgroundColor: th.bgHex,
                    border: `2px solid ${th.accentHex}`,
                  }}
                />
                <span>{th.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Common Title / Subtitle / Takeaway */}
      <div
        className="space-y-2 rounded-lg p-2.5"
        style={{
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div>
          <label className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            Judul Utama (Panggung Atas)
          </label>
          <input
            type="text"
            value={spec.title}
            onChange={(e) => onChange({ ...spec, title: e.target.value }, false)}
            className="ui-input w-full rounded px-2 py-1.5 text-xs"
            placeholder="Mis. Cara Kerja Internet"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            Subjudul (Opsional)
          </label>
          <input
            type="text"
            value={spec.subtitle ?? ""}
            onChange={(e) => onChange({ ...spec, subtitle: e.target.value }, false)}
            className="ui-input w-full rounded px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            Poin Takeaway (Muncul di Akhir)
          </label>
          <input
            type="text"
            value={spec.takeaway ?? ""}
            onChange={(e) => onChange({ ...spec, takeaway: e.target.value }, false)}
            className="ui-input w-full rounded px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* ========== ENGINE 1: FLOW & DIAGRAM CONTROLS ========== */}
      {spec.engine === "flow_diagram" && (
        <div className="space-y-2.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <label className="mb-1.5 block text-xs font-semibold">Pola Diagram</label>
            <select
              value={flow.pattern}
              onChange={(e) =>
                patchFlow({ pattern: e.target.value as FlowDiagramConfig["pattern"] }, true)
              }
              className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
            >
              <option value="flow">Flow (Alur Berurutan 1 → 2 → 3)</option>
              <option value="spread">Spread (Efek Viral / Bercabang)</option>
              <option value="cycle">Cycle (Siklus Melingkar)</option>
              <option value="converge">Converge (Banyak ke Satu / Sebaliknya)</option>
              <option value="compare">Compare (Perbandingan A vs B)</option>
            </select>
          </div>

          {(flow.pattern === "flow" || flow.pattern === "cycle") && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold">Langkah / Node (2–6)</span>
                {(flow.steps?.length ?? 0) < 6 && (
                  <button
                    type="button"
                    onClick={() =>
                      patchFlow(
                        { steps: [...(flow.steps ?? []), `Langkah ${(flow.steps?.length ?? 0) + 1}`] },
                        true
                      )
                    }
                    className="inline-flex items-center gap-0.5 font-medium cursor-pointer"
                    style={{ color: "var(--accent)" }}
                  >
                    <Plus className="h-3 w-3" /> Tambah
                  </button>
                )}
              </div>
              {(flow.steps ?? []).map((st, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="w-4 font-mono-num text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {idx + 1}.
                  </span>
                  <input
                    type="text"
                    value={st}
                    onChange={(e) => {
                      const next = [...(flow.steps ?? [])];
                      next[idx] = e.target.value;
                      patchFlow({ steps: next }, false);
                    }}
                    className="ui-input min-w-0 flex-1 rounded px-2 py-1 text-xs"
                  />
                  {(flow.steps?.length ?? 0) > 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        patchFlow({ steps: (flow.steps ?? []).filter((_, i) => i !== idx) }, true)
                      }
                      className="p-1 cursor-pointer"
                      style={{ color: "var(--danger)" }}
                      aria-label="Hapus node"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {flow.pattern === "cycle" && (
                <div className="pt-1">
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Teks Tengah Siklus
                  </label>
                  <input
                    type="text"
                    value={flow.center ?? ""}
                    onChange={(e) => patchFlow({ center: e.target.value }, false)}
                    className="ui-input w-full rounded px-2 py-1 text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {flow.pattern === "spread" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Cabang / Node
                </label>
                <input
                  type="number"
                  min={2}
                  max={4}
                  value={flow.branches ?? 3}
                  onChange={(e) => patchFlow({ branches: Number(e.target.value) || 3 }, true)}
                  className="ui-input w-full rounded px-2 py-1.5 font-mono-num text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Kedalaman Ring
                </label>
                <input
                  type="number"
                  min={2}
                  max={4}
                  value={flow.depth ?? 3}
                  onChange={(e) => patchFlow({ depth: Number(e.target.value) || 3 }, true)}
                  className="ui-input w-full rounded px-2 py-1.5 font-mono-num text-xs"
                />
              </div>
            </div>
          )}

          {flow.pattern === "converge" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Arah Aliran
                  </label>
                  <select
                    value={flow.direction ?? "in"}
                    onChange={(e) =>
                      patchFlow({ direction: e.target.value as "in" | "out" }, true)
                    }
                    className="ui-input w-full rounded px-2 py-1.5 text-xs"
                  >
                    <option value="in">Masuk ke Tengah</option>
                    <option value="out">Menyebar Keluar</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Label Tengah
                  </label>
                  <input
                    type="text"
                    value={flow.center ?? "Hasil"}
                    onChange={(e) => patchFlow({ center: e.target.value }, false)}
                    className="ui-input w-full rounded px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Sumber (pisah koma)
                </label>
                <input
                  type="text"
                  value={(flow.sources ?? []).join(", ")}
                  onChange={(e) =>
                    patchFlow(
                      {
                        sources: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .slice(0, 6),
                      },
                      false
                    )
                  }
                  className="ui-input w-full rounded px-2 py-1.5 text-xs"
                />
              </div>
            </div>
          )}

          {flow.pattern === "compare" && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold">Item Perbandingan</div>
              {(flow.groups ?? []).map((g, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1">
                  <input
                    type="text"
                    value={g.label}
                    onChange={(e) => {
                      const next = [...(flow.groups ?? [])];
                      next[idx] = { ...next[idx], label: e.target.value };
                      patchFlow({ groups: next }, false);
                    }}
                    className="ui-input col-span-6 rounded px-2 py-1 text-xs"
                    placeholder="Label"
                  />
                  <input
                    type="number"
                    value={g.value}
                    onChange={(e) => {
                      const next = [...(flow.groups ?? [])];
                      next[idx] = { ...next[idx], value: Number(e.target.value) || 0 };
                      patchFlow({ groups: next }, false);
                    }}
                    className="ui-input col-span-3 rounded px-2 py-1 font-mono-num text-xs"
                  />
                  <input
                    type="text"
                    value={g.unit ?? ""}
                    onChange={(e) => {
                      const next = [...(flow.groups ?? [])];
                      next[idx] = { ...next[idx], unit: e.target.value };
                      patchFlow({ groups: next }, false);
                    }}
                    className="ui-input col-span-3 rounded px-2 py-1 text-xs"
                    placeholder="Unit"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========== ENGINE 2: MOTION CHART CONTROLS ========== */}
      {spec.engine === "motion_chart" && (
        <div className="space-y-2.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold">Jenis Grafik</label>
              <select
                value={chart.chartType}
                onChange={(e) =>
                  patchChart({ chartType: e.target.value as MotionChartConfig["chartType"] }, true)
                }
                className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
              >
                <option value="bar">Bar Chart</option>
                <option value="line">Line Chart</option>
                <option value="stat_counter">Stat Counter</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold">Tren Positif</label>
              <select
                value={chart.goodDirection ?? "up"}
                onChange={(e) =>
                  patchChart({ goodDirection: e.target.value as "up" | "down" }, true)
                }
                className="ui-input w-full rounded-md px-2 py-1.5 text-xs"
              >
                <option value="up">Naik = Bagus</option>
                <option value="down">Turun = Bagus</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                Prefix (Rp / $)
              </label>
              <input
                type="text"
                value={chart.prefix ?? ""}
                onChange={(e) => patchChart({ prefix: e.target.value }, false)}
                className="ui-input w-full rounded px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                Suffix (ms / %)
              </label>
              <input
                type="text"
                value={chart.suffix ?? ""}
                onChange={(e) => patchChart({ suffix: e.target.value }, false)}
                className="ui-input w-full rounded px-2 py-1 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold">Data Angka ({chart.data.length})</span>
              {chart.data.length < 8 && (
                <button
                  type="button"
                  onClick={() =>
                    patchChart(
                      { data: [...chart.data, { label: `Item ${chart.data.length + 1}`, value: 100 }] },
                      true
                    )
                  }
                  className="inline-flex items-center gap-0.5 font-medium cursor-pointer"
                  style={{ color: "var(--accent)" }}
                >
                  <Plus className="h-3 w-3" /> Tambah
                </button>
              )}
            </div>
            {chart.data.map((row, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => {
                    const next = [...chart.data];
                    next[idx] = { ...next[idx], label: e.target.value };
                    patchChart({ data: next }, false);
                  }}
                  className="ui-input min-w-0 flex-1 rounded px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  value={row.value}
                  onChange={(e) => {
                    const next = [...chart.data];
                    next[idx] = { ...next[idx], value: Number(e.target.value) || 0 };
                    patchChart({ data: next }, false);
                  }}
                  className="ui-input w-20 rounded px-2 py-1 font-mono-num text-xs"
                />
                {chart.data.length > 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      patchChart({ data: chart.data.filter((_, i) => i !== idx) }, true)
                    }
                    className="p-1 cursor-pointer"
                    style={{ color: "var(--danger)" }}
                    aria-label="Hapus data"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== ENGINE 3: TECH & UI CARDS CONTROLS ========== */}
      {spec.engine === "tech_cards" && (
        <div className="space-y-2.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <label className="mb-1.5 block text-xs font-semibold">Layout Kartu</label>
            <select
              value={tech.layout}
              onChange={(e) =>
                patchTechCards({ layout: e.target.value as TechCardsConfig["layout"] }, true)
              }
              className="ui-input w-full rounded-md px-2.5 py-2 text-xs font-medium"
            >
              <option value="staggered_steps">Kartu Poin 1-2-3</option>
              <option value="terminal_code">Terminal / Snippet Kode</option>
              <option value="comparison_split">Perbandingan VS (Kiri vs Kanan)</option>
            </select>
          </div>

          {tech.layout === "staggered_steps" && (
            <div className="space-y-2">
              {(tech.cards ?? []).map((c, idx) => (
                <div
                  key={idx}
                  className="space-y-1 rounded-md p-2"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <input
                    type="text"
                    value={c.title}
                    onChange={(e) => {
                      const next = [...(tech.cards ?? [])];
                      next[idx] = { ...next[idx], title: e.target.value };
                      patchTechCards({ cards: next }, false);
                    }}
                    className="ui-input w-full rounded px-2 py-1 text-xs font-semibold"
                    placeholder={`Judul kartu ${idx + 1}`}
                  />
                  <input
                    type="text"
                    value={c.detail ?? ""}
                    onChange={(e) => {
                      const next = [...(tech.cards ?? [])];
                      next[idx] = { ...next[idx], detail: e.target.value };
                      patchTechCards({ cards: next }, false);
                    }}
                    className="ui-input w-full rounded px-2 py-1 text-[11px]"
                    placeholder="Keterangan singkat..."
                  />
                </div>
              ))}
            </div>
          )}

          {tech.layout === "terminal_code" && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Nama File
                  </label>
                  <input
                    type="text"
                    value={tech.codeTitle ?? "app.ts"}
                    onChange={(e) => patchTechCards({ codeTitle: e.target.value }, false)}
                    className="ui-input w-full rounded px-2 py-1 font-mono-num text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Sorot Baris
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, (tech.codeLines ?? []).length)}
                    value={(tech.highlightLine ?? 0) + 1}
                    onChange={(e) =>
                      patchTechCards({ highlightLine: Math.max(0, (Number(e.target.value) || 1) - 1) }, true)
                    }
                    className="ui-input w-full rounded px-2 py-1 font-mono-num text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Baris Kode (1 baris per line)
                </label>
                <textarea
                  rows={4}
                  value={(tech.codeLines ?? []).join("\n")}
                  onChange={(e) =>
                    patchTechCards({ codeLines: e.target.value.split("\n").slice(0, 7) }, false)
                  }
                  className="ui-input w-full resize-none rounded p-2 font-mono-num text-[11px]"
                />
              </div>
            </div>
          )}

          {tech.layout === "comparison_split" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={tech.leftTitle ?? "Sebelum"}
                  onChange={(e) => patchTechCards({ leftTitle: e.target.value }, false)}
                  className="ui-input rounded px-2 py-1 text-xs font-semibold"
                />
                <input
                  type="text"
                  value={tech.rightTitle ?? "Sesudah"}
                  onChange={(e) => patchTechCards({ rightTitle: e.target.value }, false)}
                  className="ui-input rounded px-2 py-1 text-xs font-semibold"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <textarea
                  rows={3}
                  value={(tech.leftItems ?? []).join("\n")}
                  onChange={(e) =>
                    patchTechCards({ leftItems: e.target.value.split("\n").slice(0, 4) }, false)
                  }
                  className="ui-input resize-none rounded p-1.5 text-[11px]"
                />
                <textarea
                  rows={3}
                  value={(tech.rightItems ?? []).join("\n")}
                  onChange={(e) =>
                    patchTechCards({ rightItems: e.target.value.split("\n").slice(0, 4) }, false)
                  }
                  className="ui-input resize-none rounded p-1.5 text-[11px]"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== ENGINE 4: STICK-FIGURE STORY CONTROLS ========== */}
      {spec.engine === "stick_figure" && (
        <div className="space-y-2.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <div>
            <label className="mb-1 block text-xs font-semibold">Latar Panggung</label>
            <select
              value={stick.setting}
              onChange={(e) =>
                patchStick({ setting: e.target.value as StickFigureConfig["setting"] }, true)
              }
              className="ui-input w-full rounded-md px-2.5 py-1.5 text-xs"
            >
              <option value="office">Kantor</option>
              <option value="room">Ruangan</option>
              <option value="street">Jalan / Outdoor</option>
              <option value="classroom">Ruang Kelas</option>
              <option value="plain">Polos Minimalis</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold">Karakter ({stick.figures.length})</div>
            {stick.figures.map((fig, idx) => (
              <div key={fig.id} className="grid grid-cols-12 gap-1">
                <input
                  type="text"
                  value={fig.label ?? fig.id}
                  onChange={(e) => {
                    const next = [...stick.figures];
                    next[idx] = { ...next[idx], label: e.target.value };
                    patchStick({ figures: next }, false);
                  }}
                  className="ui-input col-span-7 rounded px-2 py-1 text-xs"
                  placeholder="Nama"
                />
                <select
                  value={fig.kind}
                  onChange={(e) => {
                    const next = [...stick.figures];
                    next[idx] = { ...next[idx], kind: e.target.value as "person" | "cat" | "dog" };
                    patchStick({ figures: next }, true);
                  }}
                  className="ui-input col-span-5 rounded px-1.5 py-1 text-[11px]"
                >
                  <option value="person">Orang</option>
                  <option value="cat">Kucing</option>
                  <option value="dog">Anjing</option>
                </select>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold">Aksi & Balon Dialog</div>
            {stick.beats.slice(0, 4).map((beat, idx) => (
              <div
                key={idx}
                className="space-y-1 rounded-md p-2"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={beat.who}
                    onChange={(e) => {
                      const next = [...stick.beats];
                      next[idx] = { ...next[idx], who: e.target.value };
                      patchStick({ beats: next }, true);
                    }}
                    className="ui-input rounded px-1.5 py-1 text-[11px]"
                  >
                    {stick.figures.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label || f.id}
                      </option>
                    ))}
                  </select>
                  <select
                    value={beat.action}
                    onChange={(e) => {
                      const next = [...stick.beats];
                      next[idx] = { ...next[idx], action: e.target.value as StickFigureAction };
                      patchStick({ beats: next }, true);
                    }}
                    className="ui-input rounded px-1.5 py-1 text-[11px]"
                  >
                    {STICK_ACTIONS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={beat.say ?? ""}
                  onChange={(e) => {
                    const next = [...stick.beats];
                    next[idx] = { ...next[idx], say: e.target.value };
                    patchStick({ beats: next }, false);
                  }}
                  placeholder="Teks balon dialog (opsional)..."
                  className="ui-input w-full rounded px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== ENGINE 5 STUB: 3D BREAKDOWN ========== */}
      {spec.engine === "breakdown_3d" && (
        <div
          className="rounded-lg p-2.5 text-[11px] leading-relaxed"
          style={{
            backgroundColor: "var(--bg-elevated)",
            border: "1px dashed var(--border-strong)",
            color: "var(--text-secondary)",
          }}
        >
          Mode preview isometrik aktif. Engine <strong>3D WebGL Three.js penuh</strong> (turntable +
          exploded view material studio) akan diaktifkan di <strong>Milestone 7</strong>.
        </div>
      )}
    </div>
  );
}
