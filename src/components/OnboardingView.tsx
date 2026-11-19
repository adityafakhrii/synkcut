import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ByokProvider, ByokStatus, ConnectionTestResult } from "../types/scene";
import {
  completeOnboarding,
  deleteByokKey,
  openExternalUrl,
  saveByokKey,
  setActiveProvider,
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
  portalLabel: string;
  portalUrl: string;
  steps: string[];
}

const PROVIDER_LIST: ProviderMeta[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    badge: "Disarankan · Kuota Gratis",
    summary: "Mendukung generate script, TTS, dan membaca thumbnail footage multimodal dengan kuota gratis harian.",
    keyPlaceholder: "AIzaSy...",
    portalLabel: "Buka Google AI Studio",
    portalUrl: "https://aistudio.google.com/apikey",
    steps: [
      "Buka Google AI Studio dan masuk menggunakan akun Google biasa.",
      "Klik tombol Create API Key lalu pilih proyek baru atau yang sudah ada.",
      "Salin key berawalan AIza..., tempel di kolom bawah, lalu klik Tes Koneksi.",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    summary: "Cocok jika lo sudah memiliki saldo API OpenAI untuk GPT-4o, Whisper transcription, dan TTS.",
    keyPlaceholder: "sk-proj-...",
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
    summary: "Satu API key untuk berpindah-pindah model (Gemini, Claude, GPT) sesuai kebutuhan dan budget.",
    keyPlaceholder: "sk-or-v1-...",
    portalLabel: "Buka OpenRouter Keys",
    portalUrl: "https://openrouter.ai/keys",
    steps: [
      "Login ke OpenRouter lalu buka halaman Keys.",
      "Klik Create Key dan atur batas pemakaian jika perlu.",
      "Salin key berawalan sk-or-..., tempel di bawah, lalu klik Tes Koneksi.",
    ],
  },
];

export default function OnboardingView({
  mode,
  byokStatus,
  onStatusChange,
  onDone,
}: OnboardingViewProps) {
  const [selected, setSelected] = useState<ByokProvider>(byokStatus.activeProvider || "gemini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const activeMeta = PROVIDER_LIST.find((p) => p.id === selected) ?? PROVIDER_LIST[0];
  const currentInfo = byokStatus.providers[selected];

  function handleSelectProvider(provider: ByokProvider) {
    setSelected(provider);
    setApiKeyInput("");
    setTestResult(null);
    setErrorMsg(null);
    setSavedNotice(null);
  }

  async function handleTestConnection() {
    setErrorMsg(null);
    setSavedNotice(null);
    setTestResult(null);
    setIsTesting(true);
    try {
      const result = await testByokConnection(
        selected,
        apiKeyInput.trim() ? apiKeyInput.trim() : undefined
      );
      setTestResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSaveKey() {
    setErrorMsg(null);
    setSavedNotice(null);

    // If user already has key stored and left input empty, simply switch active provider
    if (!apiKeyInput.trim() && currentInfo?.configured) {
      setIsSaving(true);
      try {
        const next = await setActiveProvider(selected);
        onStatusChange(next);
        if (mode === "onboarding") {
          onDone();
        } else {
          setSavedNotice(`${activeMeta.name} ditetapkan sebagai provider aktif.`);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (apiKeyInput.trim().length < 8) {
      setErrorMsg("Masukkan API Key yang valid sebelum menyimpan.");
      return;
    }

    setIsSaving(true);
    try {
      const next = await saveByokKey(selected, apiKeyInput.trim(), true);
      onStatusChange(next);
      setApiKeyInput("");
      if (mode === "onboarding") {
        onDone();
      } else {
        setSavedNotice(`API Key ${activeMeta.name} tersimpan aman di Windows Credential Manager.`);
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
      setSavedNotice("API Key berhasil dihapus dari Windows Credential Manager.");
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

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            {mode === "settings" && (
              <button
                type="button"
                onClick={onDone}
                className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Kembali ke My Projects
              </button>
            )}
            <h1 className="text-xl font-bold tracking-tight">
              {mode === "onboarding"
                ? "Hubungkan AI Provider (BYOK)"
                : "Pengaturan AI Provider (BYOK)"}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Synkcut memakai API Key milik lo sendiri agar bebas biaya langganan dan tanpa kuota kredit.
              Key disimpan terenkripsi di Windows Credential Manager dan tidak pernah dikirim ke server pihak ketiga.
            </p>
          </div>

          {mode === "onboarding" && (
            <button
              type="button"
              onClick={handleSkipOnboarding}
              className="ui-btn-secondary shrink-0 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
            >
              Lewati dulu
            </button>
          )}
        </div>

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

            <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {PROVIDER_LIST.map((provider) => {
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
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: "var(--accent)" }}
                      >
                        {provider.badge}
                      </span>
                    )}

                    {info?.maskedKey && (
                      <span
                        className="font-mono-num text-[11px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {info.maskedKey}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Step-by-Step Guide & Key Form */}
          <div className="p-6 md:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">{activeMeta.name}</h2>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {activeMeta.summary}
                </p>
              </div>

              <button
                type="button"
                onClick={() => openExternalUrl(activeMeta.portalUrl)}
                className="ui-btn-secondary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
              >
                {activeMeta.portalLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 3-Step Visual Guide */}
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
              <ol className="m-0 space-y-2 pl-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {activeMeta.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Key Input */}
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="synkcut-api-key" className="text-xs font-semibold">
                  API Key {activeMeta.name}
                </label>
                {currentInfo?.configured && (
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
                    currentInfo?.configured
                      ? `Tersimpan (${currentInfo.maskedKey}) — isi untuk mengganti`
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

            {/* Status / Test Feedback */}
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
                  {testResult.detail && (
                    <div className="mt-0.5 opacity-85">{testResult.detail}</div>
                  )}
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

            {/* Action Buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Terenkripsi lokal di Windows Credential Manager</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isTesting || (!apiKeyInput.trim() && !currentInfo?.configured)}
                  onClick={handleTestConnection}
                  className="ui-btn-secondary inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Tes Koneksi
                </button>

                <button
                  type="button"
                  disabled={isSaving || (!apiKeyInput.trim() && !currentInfo?.configured)}
                  onClick={handleSaveKey}
                  className="ui-btn-primary inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {mode === "onboarding" ? (
                    <>
                      Simpan & Mulai
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
    </div>
  );
}
