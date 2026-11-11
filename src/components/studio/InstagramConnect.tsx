import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardPaste, ExternalLink, Camera as Instagram, RefreshCw, Trash2 } from "lucide-react";
import { t } from "./studioLanguage";

/** Spec 2: the Instagram connection as a 3-step guide (Composio account → project key → Instagram). */

export interface InstagramAccountInfo { id: string; username?: string; igUserId?: string }
export interface UnusableAccountInfo { id: string; username?: string; problem: "expired" | "personal" | "inactive"; message: string }
export interface PublishState {
  hasKey: boolean;
  keyHint?: string;
  accounts: InstagramAccountInfo[];
  unusable?: UnusableAccountInfo[];
  defaultAccount?: string;
  history: { permalink: string; username: string; publishedAt: string }[];
  scheduled?: { id: string; video: string; at: string; status: string; error?: string; permalink?: string; caption?: string }[];
}

export const INSTAGRAM_CHANGED = "videosell:instagram-changed";
const COMPOSIO_URL = "https://app.composio.dev";
const PROFESSIONAL_HELP = "https://help.instagram.com/502981923235522";

const api = <T,>(method: string, params?: unknown) => window.cutroom!.request<T>(method, params);

/** Same rules as the main process (`keyFormatProblem`), so the user sees the problem before any call. */
export function keyFormatProblem(key: string) {
  const k = key.trim();
  if (!k) return "Cole a chave do projeto.";
  if (/\s/.test(k)) return "A chave não pode ter espaços. Copie de novo, só a chave.";
  if (/^uak_/i.test(k)) return "Essa é a chave pessoal. Use a chave do projeto (Settings › Project Settings › API Keys).";
  if (k.length < 12 || k.length > 200) return "Essa chave não parece completa. Copie de novo a chave do projeto.";
  return "";
}

export function explainError(error: unknown) {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  const details = raw.replace(/\b(ak|uak|sk)_[A-Za-z0-9_-]+/g, "••••");
  if (/não foi aceita/i.test(raw)) return { message: "Essa chave não foi aceita. Confira se você copiou a chave do projeto (não a chave pessoal).", action: "key", details };
  if (/deixou de funcionar|401|403|invalid api key/i.test(raw)) return { message: "A chave do Composio deixou de funcionar.", action: "key", details };
  if (/sem conexão|network|fetch failed|timeout|ENOTFOUND/i.test(raw)) return { message: "Sem conexão com o Composio. Tente de novo.", action: "retry", details };
  if (/expirou|reconect/i.test(raw)) return { message: "A conexão com o Instagram expirou.", action: "connect", details };
  if (/pessoal|profissiona/i.test(raw)) return { message: "O Instagram só permite postar por aplicativos em contas profissionais.", action: "professional", details };
  if (/limitou|limite|rate/i.test(raw)) return { message: "O Instagram limitou as publicações por agora. Tente mais tarde.", details };
  return { message: details || "Algo deu errado.", details };
}

export type ConnectionLevel = "ready" | "warning" | "off";
export function connectionStatus(pub: PublishState | null): { level: ConnectionLevel; label: string; step: 1 | 2 | 3 | 0 } {
  if (!pub || !pub.hasKey) return { level: "off", label: "Instagram não conectado", step: 2 };
  const account = (pub.accounts ?? []).find((a) => a.id === pub.defaultAccount) ?? pub.accounts?.[0];
  if (account) return { level: "ready", label: `@${account.username ?? "conta"}`, step: 0 };
  if (pub.unusable?.length) return { level: "warning", label: pub.unusable[0].message, step: 3 };
  return { level: "warning", label: "Falta conectar o Instagram", step: 3 };
}

/** Shared connection state: any screen can read it, and refresh it after a change. */
export function useInstagramConnection() {
  const [pub, setPub] = useState<PublishState | null>(null);
  const load = useCallback(async () => {
    if (!window.cutroom) return;
    try {
      setPub(await api<PublishState>("getPublishSettings"));
    } catch {
      /* Keep the last state. */
    }
  }, []);
  useEffect(() => {
    void load();
    const update = (event: Event) => {
      const detail = (event as CustomEvent<PublishState | undefined>).detail;
      if (detail) setPub(detail);
      else void load();
    };
    window.addEventListener(INSTAGRAM_CHANGED, update);
    return () => window.removeEventListener(INSTAGRAM_CHANGED, update);
  }, [load]);
  return { pub, reload: load };
}

export function announceInstagram(pub?: PublishState) {
  window.dispatchEvent(new CustomEvent(INSTAGRAM_CHANGED, { detail: pub }));
}

export function ConnectionBadge({ onOpen }: { onOpen: () => void }) {
  const { pub } = useInstagramConnection();
  const status = connectionStatus(pub);
  return (
    <button type="button" className={`studio-connection-badge ${status.level}`} onClick={onOpen} title={t(status.label)}>
      <span className="dot" aria-hidden="true" />
      <Instagram size={13} />
      <span className="label">{t(status.level === "warning" && status.step === 3 && !pub?.accounts.length ? "Falta conectar o Instagram" : status.label)}</span>
    </button>
  );
}

/** Shown wherever posting needs Instagram and it is not there, instead of disabled buttons. */
export function ConnectInstagramCard({ onConnect, text }: { onConnect: () => void; text?: string }) {
  return (
    <div className="studio-connect-card" role="note">
      <Instagram size={20} />
      <div>
        <strong>{t("Conecte o Instagram para postar")}</strong>
        <p>{t(text ?? "Leva uns 3 minutos e é feito uma vez só.")}</p>
      </div>
      <button type="button" className="studio-primary-button" onClick={onConnect}>{t("Conectar agora")}</button>
    </div>
  );
}

function Step({ n, title, done, open, onToggle, children }: { n: number; title: string; done: boolean; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className={`ig-step ${done ? "done" : ""} ${open ? "open" : ""}`}>
      <button type="button" className="ig-step-head" aria-expanded={open} onClick={onToggle}>
        <span className="ig-step-n">{done ? <Check size={14} /> : n}</span>
        <strong>{t(title)}</strong>
        <ChevronDown size={15} className="ig-step-chevron" />
      </button>
      {open && <div className="ig-step-body">{children}</div>}
    </section>
  );
}

function ErrorBox({ error, onAction }: { error: ReturnType<typeof explainError>; onAction?: (action: string) => void }) {
  return (
    <div className="ig-error" role="alert">
      <p>{t(error.message)}</p>
      {error.action === "retry" && <button type="button" className="studio-secondary-button" onClick={() => onAction?.("retry")}>{t("Tentar de novo")}</button>}
      {error.action === "professional" && <button type="button" className="studio-secondary-button" onClick={() => onAction?.("professional")}>{t("Ver como mudar")}</button>}
      {error.details && error.details !== error.message && (
        <details><summary>{t("Detalhes")}</summary><code>{error.details}</code></details>
      )}
    </div>
  );
}

/** Keeps the key out of React state longer than needed: cleared after every attempt. */
export function InstagramConnect({ initialStep }: { initialStep?: 1 | 2 | 3 }) {
  const { pub, reload } = useInstagramConnection();
  const [haveAccount, setHaveAccount] = useState(false);
  const [open, setOpen] = useState<number>(initialStep ?? 0);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<ReturnType<typeof explainError> | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const poll = useRef<number | undefined>(undefined);

  const step1Done = haveAccount || !!pub?.hasKey;
  const step2Done = !!pub?.hasKey;
  const step3Done = !!pub?.accounts.length;
  const current = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 0;
  // With everything done, the account list (step 3) stays visible.
  const shown = open || current || 3;

  useEffect(() => () => window.clearInterval(poll.current), []);

  const run = async (label: string, work: () => Promise<PublishState | void>) => {
    setBusy(label);
    setError(null);
    try {
      const next = await work();
      if (next) announceInstagram(next);
      else await reload();
    } catch (reason) {
      setError(explainError(reason));
    } finally {
      setBusy("");
    }
  };

  const openUrl = (url: string) => void window.cutroom?.request("openHelpLink", { url }).catch(() => window.open(url, "_blank"));

  const connectKey = () => {
    const problem = keyFormatProblem(key);
    if (problem) {
      setError({ message: problem, details: "" });
      return;
    }
    const value = key;
    setKey("");
    void run("key", () => api<PublishState>("setComposioKey", { key: value }));
  };

  const paste = async () => {
    try {
      setKey((await navigator.clipboard.readText()).trim());
    } catch {
      setError({ message: "Não deu para ler a área de transferência. Cole com Ctrl+V.", details: "" });
    }
  };

  const startWaiting = () => {
    window.clearInterval(poll.current);
    setWaiting(true);
    const started = Date.now();
    poll.current = window.setInterval(async () => {
      try {
        const next = await api<PublishState>("refreshInstagram");
        announceInstagram(next);
        if (next.accounts.length || Date.now() - started > 120_000) {
          window.clearInterval(poll.current);
          setWaiting(false);
        }
      } catch {
        /* Keep trying until the 2 minutes are over. */
      }
    }, 5000);
  };

  const connectInstagram = () =>
    void run("connect", async () => {
      await api<{ url: string; mode: string }>("connectInstagram");
      startWaiting();
    });

  return (
    <div className="ig-connect">
      <div className="ig-status-line">
        <span className={`studio-connection-dot ${connectionStatus(pub).level}`} aria-hidden="true" />
        <strong>{t(step3Done ? "Pronto para postar" : "Três passos, uma vez só")}</strong>
        {pub?.hasKey && <small>{t("Chave")} {pub.keyHint ?? "••••"}</small>}
      </div>

      <Step n={1} title="Crie sua conta no Composio" done={step1Done} open={shown === 1} onToggle={() => setOpen(shown === 1 ? -1 : 1)}>
        <p>{t("O Composio é o serviço que liga o Videosell ao seu Instagram. Você cria uma conta lá, uma vez.")}</p>
        <div className="ig-actions">
          <button type="button" className="studio-primary-button" onClick={() => openUrl(COMPOSIO_URL)}>
            {t("Abrir o Composio")} <ExternalLink size={13} />
          </button>
          <button type="button" className="ig-link" onClick={() => { setHaveAccount(true); setOpen(2); }}>{t("Já tenho conta")}</button>
        </div>
      </Step>

      <Step n={2} title="Cole a chave do seu projeto" done={step2Done} open={shown === 2} onToggle={() => setOpen(shown === 2 ? -1 : 2)}>
        <p>{t("No painel do Composio, abra")} <b>Settings › Project Settings › API Keys</b> {t("e copie a chave do projeto.")}</p>
        <figure className="ig-help-figure" aria-label={t("Onde fica a chave do projeto")}>
          <div className="ig-help-nav"><span>Settings</span><span className="on">Project Settings</span><span>Members</span></div>
          <div className="ig-help-panel">
            <span className="ig-help-tab">API Keys</span>
            <div className="ig-help-key"><code>ak_••••••••••••</code><span className="ig-help-copy">{t("Copiar")}</span></div>
          </div>
          <figcaption>{t("Ilustração: o painel pode mudar, o caminho continua o mesmo.")}</figcaption>
        </figure>
        <p className="ig-note">{t("Já usa o Carrossell? Use a mesma chave: as contas conectadas lá aparecem aqui.")}</p>
        <div className="ig-key-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={t("Chave do projeto Composio")}
            placeholder={t(pub?.hasKey ? "Colar uma chave nova" : "Chave do projeto")}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") connectKey(); }}
          />
          <button type="button" className="studio-secondary-button" onClick={() => void paste()}><ClipboardPaste size={13} /> {t("Colar")}</button>
          <button type="button" className="studio-primary-button" disabled={!!busy} onClick={connectKey}>
            {busy === "key" ? t("Conferindo…") : t("Conectar")}
          </button>
        </div>
      </Step>

      <Step n={3} title="Conecte o Instagram" done={step3Done} open={shown === 3} onToggle={() => setOpen(shown === 3 ? -1 : 3)}>
        <p className="ig-note">{t("A conta precisa ser Profissional (Criador ou Empresa). Conta pessoal não publica por aplicativo.")}{" "}
          <button type="button" className="ig-link" onClick={() => openUrl(PROFESSIONAL_HELP)}>{t("Como mudar para conta profissional")}</button>
        </p>
        {!!pub?.accounts.length && (
          <ul className="ig-accounts">
            {pub.accounts.map((account) => (
              <li key={account.id}>
                <label>
                  <input type="radio" name="ig-default" checked={pub.defaultAccount === account.id}
                    onChange={() => void run("default", () => api<PublishState>("setDefaultInstagram", { id: account.id }))} />
                  <strong>@{account.username}</strong>
                </label>
                <span className="ig-ready"><Check size={12} /> {t("Pronta para postar")}</span>
              </li>
            ))}
          </ul>
        )}
        {!!pub?.unusable?.length && (
          <ul className="ig-accounts unusable">
            {pub.unusable.map((account) => (
              <li key={account.id}>
                <div><strong>{account.username ? `@${account.username}` : t("Conta sem nome")}</strong><small>{t(account.message)}</small></div>
                {account.problem === "personal"
                  ? <button type="button" className="studio-secondary-button" onClick={() => openUrl(PROFESSIONAL_HELP)}>{t("Mudar para profissional")}</button>
                  : <button type="button" className="studio-secondary-button" onClick={connectInstagram}>{t("Reconectar")}</button>}
              </li>
            ))}
          </ul>
        )}
        {!pub?.accounts.length && pub?.hasKey && (
          <p>{t("Seu projeto do Composio ainda não tem um Instagram conectado.")}</p>
        )}
        <div className="ig-actions">
          <button type="button" className={pub?.accounts.length ? "studio-secondary-button" : "studio-primary-button"} disabled={!pub?.hasKey || !!busy} onClick={connectInstagram}>
            <Instagram size={13} /> {t(pub?.accounts.length ? "Conectar outra conta" : "Conectar minha conta do Instagram")}
          </button>
          <button type="button" className="studio-secondary-button" disabled={!pub?.hasKey || !!busy} onClick={() => void run("refresh", () => api<PublishState>("refreshInstagram"))}>
            <RefreshCw size={13} /> {t("Já conectei")}
          </button>
        </div>
        {!pub?.hasKey && <small className="ig-why">{t("Primeiro cole a chave do projeto no passo 2.")}</small>}
        {waiting && <p className="ig-waiting" role="status">{t("Esperando a autorização no navegador… a lista atualiza sozinha por até 2 minutos.")}</p>}
      </Step>

      {error && <ErrorBox error={error} onAction={(action) => {
        if (action === "retry") void run("refresh", () => api<PublishState>("refreshInstagram"));
        if (action === "professional") openUrl(PROFESSIONAL_HELP);
      }} />}

      {pub?.hasKey && (
        <div className="ig-remove">
          {!confirmRemove ? (
            <button type="button" className="ig-link" onClick={() => setConfirmRemove(true)}><Trash2 size={12} /> {t("Remover chave deste computador")}</button>
          ) : (
            <div className="ig-remove-confirm" role="alertdialog" aria-label={t("Remover chave")}>
              <p>{t("Sem a chave, os agendamentos param de publicar até você conectar de novo.")}</p>
              <button type="button" className="studio-secondary-button" onClick={() => setConfirmRemove(false)}>{t("Cancelar")}</button>
              <button type="button" className="studio-danger-button" onClick={() => { setConfirmRemove(false); void run("remove", () => api<PublishState>("setComposioKey", {})); }}>{t("Remover chave")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
