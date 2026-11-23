import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ByokProvider, ByokStatus, ConnectionTestResult } from "../types/scene";
import {
  completeOnboarding,
  deleteByokKey,
  fetchProviderModels,
  openExternalUrl,
  saveProviderConfig,
  testByokConnection,
} from "../lib/tauriBridge";

interface OnboardingViewProps {
  mode: "onboarding" | "settings";
  byokStatus: ByokStatus;
  onStatusChange: (status: ByokStatus) => void;
  onDone: () => void;
}

interface ProviderMeta {
  id: ByokProvider;
  name: string;
  badge?: string;
  summary: string;
  keyPlaceholder: string;
  modelPlaceholder: string;
  defaultModel: string;
  presetModels: Array<{ id: string; label: string }>;
  portalLabel?: string;
  portalUrl?: string;
  steps?: string[];
}

const CUSTOM_ENDPOINT_PRESETS: Array<{
  label: string;
  baseUrl: string;
  model: string;
}> = [
  { label: "Ollama Lokal", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:14b" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1", model: "local-model" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
];

const PROVIDER_LIST: ProviderMeta[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    badge: "Disarankan · Kuota Gratis",
    summary:
      "Mendukung generate script, TTS, AI Director, dan analisa visual multimodal dengan kuota gratis harian.",
    keyPlaceholder: "AIzaSy... atau AQ.A...",
    modelPlaceholder: "gemini-3.8-flash",
    defaultModel: "gemini-3.8-flash",
    presetModels: [
      { id: "gemini-3.8-flash", label: "gemini-3.8-flash (Disarankan)" },
      { id: "gemini-3.8-flash-lite", label: "gemini-3.8-flash-lite (Super Cepat)" },
      { id: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
      { id: "gemini-2.5-flash", label: "gemini-2.5-flash (Akun Lama)" },
    ],
    portalLabel: "Buka Google AI Studio",
    portalUrl: "https://aistudio.google.com/apikey",
    steps: [
      "Buka Google AI Studio dan masuk menggunakan akun Google biasa.",
      "Klik tombol Create API Key lalu pilih proyek baru atau yang sudah ada.",
      "Salin key (berawalan AIza... atau AQ.A...), tempel di bawah, lalu klik Tes Koneksi.",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    summary:
      "Cocok jika lo sudah memiliki saldo API OpenAI untuk seri GPT-4.1 / GPT-5, Whisper transcription, dan TTS.",
    keyPlaceholder: "sk-proj-...",
    modelPlaceholder: "gpt-4.1-mini",
    defaultModel: "gpt-4.1-mini",
    presetModels: [
      { id: "gpt-4.1-mini", label: "gpt-4.1-mini (Disarankan)" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4.1", label: "gpt-4.1" },
      { id: "gpt-5-mini", label: "gpt-5-mini" },
    ],
    portalLabel: "Buka OpenAI Platform",
    portalUrl: "https://platform.openai.com/api-keys",
    steps: [
      "Masuk ke dashboard OpenAI Platform pada menu API Keys.",
      "Klik Create new secret key dan beri nama misalnya Synkcut.",
      "Salin secret key berawalan sk-..., tempel di bawah, lalu klik Tes Koneksi.",
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    summary:
      "Satu API key untuk berpindah-pindah model (Gemini, Claude, GPT, atau router gratis openrouter/free).",
    keyPlaceholder: "sk-or-v1-...",
    modelPlaceholder: "google/gemini-3.8-flash",
    defaultModel: "google/gemini-3.8-flash",
    presetModels: [
      { id: "google/gemini-3.8-flash", label: "google/gemini-3.8-flash" },
      { id: "openai/gpt-4.1-mini", label: "openai/gpt-4.1-mini" },
      { id: "openrouter/free", label: "openrouter/free (Gratis)" },
      { id: "anthropic/claude-sonnet-4", label: "anthropic/claude-sonnet-4" },
    ],
    portalLabel: "Buka OpenRouter Keys",
    portalUrl: "https://openrouter.ai/keys",
    steps: [
      "Login ke OpenRouter lalu buka halaman Keys.",
      "Klik Create Key dan atur batas pemakaian jika perlu.",
      "Salin key berawalan sk-or-..., pilih model (atau openrouter/free), lalu klik Tes Koneksi.",
    ],
  },
  {
    id: "custom",
    name: "Custom Model",
    badge: "OpenAI-Compatible · Lokal / Cloud",
    summary:
      "Pakai model pilihan lo sendiri dari Ollama lokal, LM Studio, DeepSeek, Groq, Mistral, atau proxy API OpenAI-compatible apa pun.",
    keyPlaceholder: "Opsional untuk Ollama/LM Studio lokal (atau sk-...)",
    modelPlaceholder: "Mis. deepseek-chat, llama-3.3-70b-versatile, qwen2.5:14b",
    defaultModel: "",
    presetModels: [],
  },
];

export default function OnboardingView({
  mode,
  byokStatus,
  onStatusChange,
  onDone,
}: OnboardingViewProps) {
  const initialProvider: ByokProvider = byokStatus.activeProvider || "gemini";
  const [selected, setSelected] = useState<ByokProvider>(initialProvider);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelInput, setModelInput] = useState<string>(() => {
    const info = byokStatus.providers[initialProvider];
    const meta = PROVIDER_LIST.find((p) => p.id === initialProvider);
    return info?.model || meta?.defaultModel || "";
  });
  const [baseUrlInput, setBaseUrlInput] = useState<string>(
    () => byokStatus.providers.custom?.baseUrl || ""
  );
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const activeMeta = PROVIDER_LIST.find((p) => p.id === selected) ?? PROVIDER_LIST[0];
  const currentInfo = byokStatus.providers[selected];
  const isCustom = selected === "custom";

  function handleSelectProvider(provider: ByokProvider) {
    setSelected(provider);
    setApiKeyInput("");
    const meta = PROVIDER_LIST.find((p) => p.id === provider);
    const info = byokStatus.providers[provider];
    setModelInput(info?.model || meta?.defaultModel || "");
    if (provider === "custom") {
      setBaseUrlInput(info?.baseUrl || "");
    }
    setDiscoveredModels([]);
    setTestResult(null);
    setErrorMsg(null);
    setSavedNotice(null);
  }

  async function handleFetchLiveModels() {
    setErrorMsg(null);
    setSavedNotice(null);
    setIsFetchingModels(true);
    try {
      const list = await fetchProviderModels({
        provider: selected,
        apiKey: apiKeyInput.trim() || undefined,
        baseUrl: isCustom ? baseUrlInput.trim() || undefined : undefined,
      });
      setDiscoveredModels(list);
      if (list.length > 0 && !modelInput.trim()) {
        setModelInput(list[0]);
      }
      if (list.length === 0) {
        setErrorMsg("Tidak ada model aktif ditemukan dari endpoint ini.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingModels(false);
    }
  }

  async function handleTestConnection() {
    setErrorMsg(null);
    setSavedNotice(null);
    setTestResult(null);
    setIsTesting(true);
    try {
      const result = await testByokConnection(
        selected,
        apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
        modelInput.trim() ? modelInput.trim() : undefined,
        isCustom && baseUrlInput.trim() ? baseUrlInput.trim() : undefined
      );
      setTestResult(result);
      if (result.ok && result.resolvedModel && result.resolvedModel !== modelInput.trim()) {
        setModelInput(result.resolvedModel);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSaveConfig() {
    setErrorMsg(null);
    setSavedNotice(null);

    if (isCustom) {
      if (!baseUrlInput.trim()) {
        setErrorMsg("Isi Base URL endpoint terlebih dahulu (mis. https://api.deepseek.com/v1).");
        return;
      }
      if (!modelInput.trim()) {
        setErrorMsg("Isi nama Model ID terlebih dahulu (mis. deepseek-chat atau qwen2.5:14b).");
        return;
      }
    } else if (!apiKeyInput.trim() && !currentInfo?.configured) {
      setErrorMsg("Masukkan API Key yang valid sebelum menyimpan.");
      return;
    } else if (apiKeyInput.trim() && apiKeyInput.trim().length < 8) {
      setErrorMsg("API Key terlalu pendek. Pastikan lo menyalin key secara utuh.");
      return;
    }

    setIsSaving(true);
    try {
      const next = await saveProviderConfig({
        provider: selected,
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : null,
        model: modelInput.trim() || activeMeta.defaultModel,
        baseUrl: isCustom ? baseUrlInput.trim() : undefined,
        setActive: true,
      });
      onStatusChange(next);
      setApiKeyInput("");
      if (mode === "onboarding") {
        onDone();
      } else {
        const activeModelLabel = modelInput.trim() || activeMeta.defaultModel;
        setSavedNotice(
          isCustom
            ? `Custom Model (${activeModelLabel}) disimpan & ditetapkan sebagai provider aktif.`
            : `${activeMeta.name} (${activeModelLabel}) tersimpan aman & aktif dipakai.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteKey(provider: ByokProvider) {
    setErrorMsg(null);
    setSavedNotice(null);
    setTestResult(null);
    try {
      const next = await deleteByokKey(provider);
      onStatusChange(next);
      if (provider === "custom") {
        setBaseUrlInput("");
        setModelInput("");
      }
      setSavedNotice(
        provider === "custom"
          ? "Konfigurasi Custom Model berhasil dihapus."
          : "API Key berhasil dihapus dari Windows Credential Manager."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSkipOnboarding() {
    try {
      const next = await completeOnboarding();
      onStatusChange(next);
    } catch {
      // Allow proceeding even if storage fails in preview
    }
    onDone();
  }

  const canTestOrSave = isCustom
    ? Boolean(baseUrlInput.trim() && modelInput.trim())
    : Boolean(apiKeyInput.trim() || currentInfo?.configured);

  const content = (
    <div className={mode === "onboarding" ? "mx-auto w-full max-w-4xl" : "w-full max-w-5xl"}>
      {/* Header (shown in onboarding; settings uses workspace toolbar) */}
      {mode === "onboarding" && (
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Hubungkan AI Provider (BYOK)</h1>
            <p
              className="mt-1.5 max-w-2xl text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Synkcut memakai API Key atau Custom Model milik lo sendiri agar bebas biaya langganan
              dan tanpa kuota kredit. Key disimpan terenkripsi di Windows Credential Manager dan
              tidak pernah dikirim ke server pihak ketiga.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSkipOnboarding}
            className="ui-btn-secondary shrink-0 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
          >
            Lewati dulu
          </button>
        </div>
      )}

      {/* Main 2-Column Configuration Surface */}
      <div
        className="grid grid-cols-1 overflow-hidden rounded-lg md:grid-cols-12"
        style={{
          backgroundColor: "var(--bg-panel)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {/* Left: Provider Selector List */}
        <div
          className="border-b md:col-span-4 md:border-r md:border-b-0"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div
            className="border-b px-4 py-3 text-xs font-semibold"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            Pilih Provider AI
          </div>

          <div>
            {PROVIDER_LIST.map((provider, idx) => {
              const info = byokStatus.providers[provider.id];
              const isSelected = selected === provider.id;
              const isActiveProvider = byokStatus.activeProvider === provider.id;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSelectProvider(provider.id)}
                  className="ui-row flex w-full flex-col items-start gap-1.5 px-4 py-3.5 text-left cursor-pointer"
                  style={{
                    backgroundColor: isSelected ? "var(--accent-soft)" : "transparent",
                    borderBottom:
                      idx < PROVIDER_LIST.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{provider.name}</span>
                    {info?.configured ? (
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: "var(--success-soft)",
                          color: "var(--success)",
                        }}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {isActiveProvider ? "Aktif" : "Siap"}
                      </span>
                    ) : (
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Belum diatur
                      </span>
                    )}
                  </div>

                  {provider.badge && (
                    <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
                      {provider.badge}
                    </span>
                  )}

                  {info?.configured && (
                    <span
                      className="max-w-full truncate font-mono-num text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {provider.id === "custom"
                        ? info.model || info.baseUrl
                        : `${info.model || provider.defaultModel}${info.maskedKey ? ` · ${info.maskedKey}` : ""}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Provider Guide, Model Selector & Credentials Form */}
        <div className="p-6 md:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-md">
              <h2 className="text-base font-bold">{activeMeta.name}</h2>
              <p
                className="mt-1 text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {activeMeta.summary}
              </p>
            </div>

            {activeMeta.portalUrl && activeMeta.portalLabel && (
              <button
                type="button"
                onClick={() => openExternalUrl(activeMeta.portalUrl!)}
                className="ui-btn-secondary inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
              >
                {activeMeta.portalLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Preset Quick-Fill Bar for Custom Model OR 3-Step Guide for Cloud Providers */}
          {isCustom ? (
            <div
              className="mt-5 rounded-md p-4 space-y-2.5"
              style={{
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="text-xs font-semibold">Preset Cepat Endpoint OpenAI-Compatible</div>
              <div className="flex flex-wrap gap-1.5">
                {CUSTOM_ENDPOINT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setBaseUrlInput(preset.baseUrl);
                      setModelInput(preset.model);
                      setErrorMsg(null);
                      setTestResult(null);
                    }}
                    className="ui-btn-secondary rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Klik preset di atas untuk isi otomatis, atau ketik Base URL &amp; Model ID dari
                server/proxy OpenAI-compatible pilihan lo.
              </p>
            </div>
          ) : (
            activeMeta.steps && (
              <div
                className="mt-5 rounded-md p-4"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="mb-2.5 text-xs font-semibold">
                  Cara ambil API Key (kurang dari 1 menit)
                </div>
                <ol
                  className="m-0 list-decimal space-y-2 pl-5 text-xs leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {activeMeta.steps.map((step, i) => (
                    <li key={i} className="pl-1">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )
          )}

          {/* Custom Model: Base URL Input */}
          {isCustom && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="synkcut-custom-url" className="text-xs font-semibold">
                  Base URL Endpoint
                </label>
                {currentInfo?.configured && (
                  <button
                    type="button"
                    onClick={() => handleDeleteKey("custom")}
                    className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
                    style={{ color: "var(--danger)" }}
                  >
                    <Trash2 className="h-3 w-3" />
                    Reset Custom Model
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <Globe
                  className="pointer-events-none absolute left-3 h-4 w-4"
                  style={{ color: "var(--text-muted)" }}
                />
                <input
                  id="synkcut-custom-url"
                  type="url"
                  value={baseUrlInput}
                  onChange={(e) => {
                    setBaseUrlInput(e.target.value);
                    setErrorMsg(null);
                    setSavedNotice(null);
                  }}
                  placeholder="https://api.deepseek.com/v1 atau http://localhost:11434/v1"
                  className="ui-input w-full rounded-md py-2.5 pr-3 pl-9 font-mono-num text-xs"
                />
              </div>
            </div>
          )}

          {/* API Key Input */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="synkcut-api-key" className="text-xs font-semibold">
                {isCustom ? "API Key (Opsional untuk Ollama / LM Studio)" : `API Key ${activeMeta.name}`}
              </label>
              {!isCustom && currentInfo?.configured && (
                <button
                  type="button"
                  onClick={() => handleDeleteKey(selected)}
                  className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
                  style={{ color: "var(--danger)" }}
                >
                  <Trash2 className="h-3 w-3" />
                  Hapus Key Tersimpan
                </button>
              )}
            </div>

            <div className="relative flex items-center">
              <KeyRound
                className="pointer-events-none absolute left-3 h-4 w-4"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                id="synkcut-api-key"
                type={showKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setErrorMsg(null);
                  setSavedNotice(null);
                }}
                placeholder={
                  currentInfo?.maskedKey
                    ? `Tersimpan (${currentInfo.maskedKey}) — isi untuk mengganti`
                    : isCustom
                      ? activeMeta.keyPlaceholder
                      : `Tempel key di sini (${activeMeta.keyPlaceholder})`
                }
                className="ui-input w-full rounded-md py-2.5 pr-10 pl-9 font-mono-num text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 p-1 cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
                aria-label={showKey ? "Sembunyikan API Key" : "Tampilkan API Key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Model ID Selector (Preset + Custom Input + Live Discovery) */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="synkcut-model-id" className="text-xs font-semibold">
                Model AI {isCustom ? "(Wajib)" : "(Bisa pilih atau ketik custom)"}
              </label>
              <button
                type="button"
                disabled={
                  isFetchingModels ||
                  (isCustom ? !baseUrlInput.trim() : !apiKeyInput.trim() && !currentInfo?.configured)
                }
                onClick={handleFetchLiveModels}
                className="inline-flex items-center gap-1 text-xs font-medium hover:underline disabled:opacity-45 cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                {isFetchingModels ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Cek Daftar Model Aktif
              </button>
            </div>

            <div className="relative flex items-center">
              <Cpu
                className="pointer-events-none absolute left-3 h-4 w-4"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                id="synkcut-model-id"
                type="text"
                value={modelInput}
                onChange={(e) => {
                  setModelInput(e.target.value);
                  setErrorMsg(null);
                  setSavedNotice(null);
                }}
                placeholder={activeMeta.modelPlaceholder}
                className="ui-input w-full rounded-md py-2.5 pr-3 pl-9 font-mono-num text-xs"
              />
            </div>

            {activeMeta.presetModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {activeMeta.presetModels.map((preset) => {
                  const active = modelInput.trim() === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setModelInput(preset.id);
                        setTestResult(null);
                        setSavedNotice(null);
                      }}
                      className="rounded-md px-2 py-1 font-mono-num text-[11px] font-medium transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--accent-soft)" : "var(--bg-elevated)",
                        color: active ? "var(--accent)" : "var(--text-secondary)",
                        border: active
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border-subtle)",
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}

            {discoveredModels.length > 0 && (
              <div
                className="rounded-md p-2.5 space-y-1.5"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Model aktif terdeteksi dari akun/endpoint ({discoveredModels.length}):
                </div>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {discoveredModels.map((id) => {
                    const active = modelInput.trim() === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setModelInput(id);
                          setTestResult(null);
                        }}
                        className="rounded px-2 py-0.5 font-mono-num text-[11px] cursor-pointer"
                        style={{
                          backgroundColor: active ? "var(--accent-soft)" : "var(--bg-panel)",
                          color: active ? "var(--accent)" : "var(--text-primary)",
                          border: active
                            ? "1px solid var(--accent)"
                            : "1px solid var(--border-subtle)",
                        }}
                      >
                        {id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {testResult && (
            <div
              className="mt-4 flex items-start gap-2.5 rounded-md p-3 text-xs"
              style={{
                backgroundColor: testResult.ok ? "var(--success-soft)" : "var(--danger-soft)",
                border: `1px solid ${testResult.ok ? "var(--success)" : "var(--danger)"}`,
                color: testResult.ok ? "var(--success)" : "var(--danger)",
              }}
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <div className="font-semibold">{testResult.message}</div>
                {testResult.detail && <div className="mt-0.5 opacity-85">{testResult.detail}</div>}
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              className="mt-4 rounded-md p-3 text-xs font-medium"
              style={{
                backgroundColor: "var(--danger-soft)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
            >
              {errorMsg}
            </div>
          )}

          {savedNotice && (
            <div
              className="mt-4 flex items-center gap-2 rounded-md p-3 text-xs font-medium"
              style={{
                backgroundColor: "var(--success-soft)",
                border: "1px solid var(--success)",
                color: "var(--success)",
              }}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{savedNotice}</span>
            </div>
          )}

          <div
            className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Terenkripsi lokal di Windows Credential Manager</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isTesting || !canTestOrSave}
                onClick={handleTestConnection}
                className="ui-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {isTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Tes Koneksi
              </button>

              <button
                type="button"
                disabled={isSaving || !canTestOrSave}
                onClick={handleSaveConfig}
                className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mode === "onboarding" ? (
                  <>
                    Simpan &amp; Mulai
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                ) : (
                  "Simpan Pengaturan"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (mode === "onboarding") {
    return (
      <div className="ui-ambient-surface flex min-h-0 flex-1 overflow-y-auto px-6 py-10">
        {content}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex h-14 shrink-0 items-center justify-between border-b px-6"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5">
          <h1 className="text-base font-bold tracking-tight">Pengaturan AI (BYOK)</h1>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            · Penyimpanan terenkripsi lokal
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">{content}</div>
    </div>
  );
}
