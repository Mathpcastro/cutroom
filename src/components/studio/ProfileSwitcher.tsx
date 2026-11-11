import { t } from "./studioLanguage";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import {
  PROFILE_HANDLE_PATTERN,
  type CreateStudioProfileInput,
  type StudioProfile,
} from "../../shared/profile";
import { useDialogKeyboard } from "../../lib/useDialogKeyboard";

interface ProfileSwitcherProps {
  onProfileCreated?: (path: "brand" | "avatar") => void;
  avatarSetupRequest?: number;
  onProfileChange: (profile: StudioProfile | null, initializing: boolean) => void;
}

export function ProfileSwitcher({ onProfileChange, onProfileCreated, avatarSetupRequest }: ProfileSwitcherProps) {
  const [profiles, setProfiles] = useState<StudioProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const selectedRef = useRef("");
  const loadGeneration = useRef(0);
  const api = window.cutroom?.studioProfiles;

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!api) {
      setLoading(false);
      setError("Os perfis estão disponíveis no aplicativo desktop.");
      onProfileChange(null, false);
      return;
    }
    setLoading(true);
    setError("");
    onProfileChange(null, true);
    try {
      const [items, active] = await Promise.all([api.list(), api.getActive()]);
      if (generation !== loadGeneration.current) return;
      const selected = items.find((item) => item.id === active?.id) ?? items[0];
      if (selected && active?.id !== selected.id) await api.select(selected.id);
      if (generation !== loadGeneration.current) return;
      setProfiles(items);
      selectedRef.current = selected?.id ?? "";
      setSelectedId(selectedRef.current);
      onProfileChange(selected ?? null, false);
    } catch (reason) {
      if (generation !== loadGeneration.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      onProfileChange(null, false);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [api, onProfileChange]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  useDialogKeyboard(creating, () => {
    if (!busy) setCreating(false);
  });

  const select = async (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!api || !profile || profileId === selectedId) return;
    setBusy(true);
    setError("");
    try {
      await api.select(profileId);
      selectedRef.current = profileId;
      setSelectedId(profileId);
      const latest = await api.get(profileId);
      const next = latest ?? profile;
      setProfiles((current) => current.map((item) => item.id === profileId ? next : item));
      onProfileChange(next, false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = useCallback(() => {
    setName("");
    setHandle("");
    setCreateError("");
    setCreating(true);
  }, []);
  useEffect(() => { if (avatarSetupRequest) openCreate(); }, [avatarSetupRequest, openCreate]);

  const create = async (path: "brand" | "avatar") => {
    const cleanName = name.trim() || (path === "avatar" ? t("Meu avatar") : "");
    const cleanHandle = handle.trim() || (path === "avatar" ? "avatar-" + crypto.randomUUID().slice(0, 8) : "");
    if (!cleanName) {
      setCreateError("Informe o nome do perfil.");
      return;
    }
    if (!PROFILE_HANDLE_PATTERN.test(cleanHandle)) {
      setCreateError(
        "O handle deve ter até 32 caracteres, com letras minúsculas, números, ponto, hífen ou sublinhado, sem espaços.",
      );
      return;
    }
    if (!api) return;
    setBusy(true);
    setCreateError("");
    try {
      const input: CreateStudioProfileInput = { name: cleanName, handle: cleanHandle };
      const profile = await api.create(input);
      await api.select(profile.id);
      setProfiles((current) => [...current, profile]);
      selectedRef.current = profile.id;
      setSelectedId(profile.id);
      onProfileChange(profile, false);
      setCreating(false);
      onProfileCreated?.(path);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-switcher" aria-label="Perfil de criação">
      <div className="profile-row">
      <span className="profile-initial" aria-hidden="true">{(profiles.find((p) => p.id === selectedId)?.name ?? "?").trim().charAt(0).toUpperCase()}</span>
      <div className="profile-select-wrap">
        <select
          aria-label={t("Perfil ativo")}
          value={selectedId}
          disabled={loading || busy || !profiles.length}
          onChange={(event) => void select(event.target.value)}
        >
          {!profiles.length && <option value="">Nenhum perfil</option>}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      <button
        type="button"
        className="profile-create-button"
        onClick={openCreate}
        disabled={busy}
        aria-label={t("Criar perfil")}
        title={t("Criar perfil")}
      >
        <Plus size={15} />
      </button>
      </div>
      {loading && (
        <span className="profile-status" role="status">
          <LoaderCircle size={12} className="spin" /> Carregando perfis…
        </span>
      )}
      {!loading && !error && !profiles.length && (
        <span className="profile-status">{t("Crie um perfil para começar.")}</span>
      )}
      {error && (
        <div className="profile-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={11} /> Tentar novamente
          </button>
        </div>
      )}
      {creating && (
        <div className="studio-modal-backdrop">
          <form
            className="profile-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-create-title"
            onSubmit={(event) => { event.preventDefault(); void create("brand"); }}
            noValidate
          >
            <button
              type="button"
              className="profile-dialog-close"
              aria-label="Fechar criação de perfil"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              <X size={18} />
            </button>
            <h2 id="profile-create-title">{t("Criar perfil")}</h2>
            <p>{t("Separe marca, voz e projetos de cada produto ou cliente.")}</p>
            <label>
              {t("Nome do perfil")}
              <input
                autoFocus
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Minha consultoria"
                disabled={busy}
              />
            </label>
            <label>
              {t("Handle do perfil")}
              <input
                value={handle}
                maxLength={32}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="minha-consultoria"
                aria-describedby="profile-handle-hint"
                disabled={busy}
              />
            </label>
            <small id="profile-handle-hint">
              Identificador único, sem espaços. Ele não pode ser igual ao de outro perfil.
            </small>
            {createError && <div className="profile-form-error" role="alert">{createError}</div>}
            <div className="profile-dialog-actions">
              <button type="button" onClick={() => setCreating(false)} disabled={busy}>
                {t("Cancelar")}
              </button>
              <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void create("avatar")}>{t("Começar pelo avatar")}</button>
              <button type="submit" className="studio-primary-button" disabled={busy}>
                {busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                {busy ? "Criando…" : t("Salvar perfil")}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
