import { useCallback, useEffect, useState } from "react";
import type { AppSnapshot } from "../../shared/types";
import { useStudioGuard } from "./useStudioGuard";

interface Voice { id: string; name: string; language?: string; description?: string }

const PROVIDERS = [
  ["kokoro", "Kokoro (offline, sem créditos)"],
  ["elevenlabs", "ElevenLabs (chave própria)"],
  ["openai", "OpenAI (chave própria)"],
  ["local", "Voz do computador"],
] as const;
const api = <T,>(method: string, params?: unknown) => window.cutroom!.request<T>(method, params);

export function VoiceSettings({ packages, jobs, run }: { packages: AppSnapshot["packages"]; jobs: AppSnapshot["jobs"]; run: (m: string, p?: unknown) => Promise<void> }) {
  const { error, notice, guard } = useStudioGuard();
  const [voice, setVoice] = useState<{ keys: Record<string, boolean>; preferences: { provider?: string; voices?: Record<string, string> }; kokoroAvailable: boolean; localAvailable: boolean } | null>(null);
  const [provider, setProvider] = useState("kokoro");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const loadVoices = useCallback(async (p: string) => {
    setVoices([]);
    try {
      setVoices((await api<{ voices: Voice[] }>("listVoices", { provider: p })).voices);
    } catch {
      /* Provider not configured yet: the form explains what to do. */
    }
  }, []);
  useEffect(() => {
    void api<typeof voice>("getVoiceSettings").then((v) => {
      setVoice(v);
      const p = v?.preferences.provider ?? (v?.kokoroAvailable ? "kokoro" : "elevenlabs");
      setProvider(p);
      void loadVoices(p);
    });
  }, [loadVoices, packages]);
  const kokoroPackage = packages.find((p) => p.id === "kokoro-voice");
  const busy = jobs.some((j) => j.status === "running");

  return (
    <section className="studio-section">
      {error && <p className="studio-error" role="alert">{error}</p>}
      {notice && <p className="studio-notice">{notice}</p>}
      <p className="studio-lead">A narração dos vídeos. O Kokoro roda no seu computador, sem internet e sem créditos. ElevenLabs e OpenAI usam a sua chave (o custo é da sua conta).</p>
      <label className="field">
        Provedor padrão
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setKeyInput(""); void loadVoices(e.target.value); }}>
          {PROVIDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {provider === "kokoro" && !voice?.kokoroAvailable && (
        <div className="studio-box">
          <p>A Voz Kokoro ainda não está instalada (≈ 230 MB, download único).</p>
          <button className="button primary" disabled={busy || kokoroPackage?.status === "installing"} onClick={() => void guard(() => run("installPackage", { id: "kokoro-voice" }), "Voz Kokoro instalada.")}>
            {kokoroPackage?.status === "installing" ? "Instalando…" : "Instalar Voz Kokoro"}
          </button>
        </div>
      )}
      {(provider === "elevenlabs" || provider === "openai") && (
        <div className="studio-box">
          <p>{voice?.keys[`voice.${provider}`] ? "Chave cadastrada (guardada cifrada neste computador)." : "Cole a sua chave de API. Ela fica cifrada no seu computador e nunca vai para o chat."}</p>
          <div className="field-pair">
            <input type="password" autoComplete="off" value={keyInput} placeholder={provider === "elevenlabs" ? "Chave da ElevenLabs" : "Chave da OpenAI (sk-…)"} onChange={(e) => setKeyInput(e.target.value)} />
            <button className="button" disabled={!keyInput.trim()} onClick={() => void guard(async () => { setVoice(await api("setVoiceKey", { provider, key: keyInput })); setKeyInput(""); await loadVoices(provider); }, "Chave salva.")}>Salvar</button>
            {voice?.keys[`voice.${provider}`] && <button className="button" onClick={() => void guard(async () => setVoice(await api("setVoiceKey", { provider })), "Chave removida.")}>Remover</button>}
          </div>
        </div>
      )}
      {voices.length > 0 && (
        <label className="field">
          Voz padrão
          <select
            value={voice?.preferences.voices?.[provider] ?? ""}
            onChange={(e) => void guard(async () => { await api("setVoicePreferences", { provider, voices: { ...(voice?.preferences.voices ?? {}), [provider]: e.target.value } }); setVoice(await api("getVoiceSettings")); }, "Voz padrão salva.")}
          >
            <option value="">Escolha…</option>
            {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.language ? ` · ${v.language}` : ""}{v.description ? ` — ${v.description}` : ""}</option>)}
          </select>
        </label>
      )}
      <div className="studio-actions">
        <button className="button primary" onClick={() => void guard(async () => { await api("setVoicePreferences", { provider }); setVoice(await api("getVoiceSettings")); }, "Provedor padrão salvo.")}>Usar este provedor</button>
      </div>
    </section>
  );
}
