import { useState } from "react";
import { ArrowRight, Check, ClipboardCopy, MessagesSquare, Sparkles } from "lucide-react";
import type { z } from "zod";
import { t } from "./studioLanguage";
import { structuredReply, studioRequest } from "./salesReels";
import { brandPrompt, brandSuggestion } from "./BrandOnboarding";
import { openAiConnect } from "./AiConnect";

/**
 * Spec 4 D, step 1 — same pattern as the Carrossell onboarding: one field (link or a sentence) and three
 * paths: generate with the connected AI, copy a prompt for the user's own ChatGPT/Claude, or a short
 * interview. The result is always reviewed before saving.
 */

export type BrandDraft = z.infer<typeof brandSuggestion> & { website?: string };

export const INTERVIEW = [
  { key: "what", q: "O que você vende? Em uma ou duas frases.", hint: "Ex.: um app que cria Reels com IA para quem vende pelo Instagram." },
  { key: "who", q: "Para quem? Quem compra e em que momento.", hint: "Ex.: donos de SaaS pequenos, sem tempo para gravar." },
  { key: "pain", q: "Que problema a pessoa tem antes de comprar?", hint: "Ex.: posta pouco, não sabe o que gravar, odeia editar." },
  { key: "why", q: "Por que escolher você e não outra opção?", hint: "Ex.: usa a voz e o avatar da própria pessoa, posta sozinho." },
  { key: "offer", q: "Qual a oferta e a próxima ação que você quer?", hint: "Ex.: assinatura de R$ 147; chamar para testar pelo link." },
  { key: "tone", q: "Como a marca fala?", hint: "Ex.: direto, sem jargão, com humor leve." },
] as const;
type InterviewKey = (typeof INTERVIEW)[number]["key"];

/** Turns the interview answers into the brand fields (no AI needed). */
export function interviewToBrand(name: string, answers: Partial<Record<InterviewKey, string>>): BrandDraft {
  const line = (label: string, value?: string) => (value?.trim() ? `${label}: ${value.trim()}` : "");
  return brandSuggestion.parse({
    name: name.trim() || "Minha marca",
    context: [line("Produto", answers.what), line("Comprador", answers.who), line("Problema antes da compra", answers.pain), line("Diferencial", answers.why)].filter(Boolean).join("\n") || "A preencher.",
    goal: answers.offer?.trim() ?? "",
    tone: answers.tone?.trim() ?? "",
  });
}

/** Accepts the AI answer with or without ```json fences or text around it. */
export function parseBrandAnswer(text: string): BrandDraft {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Não encontrei o JSON na resposta. Cole a resposta completa da sua IA.");
  return brandSuggestion.parse(JSON.parse(raw.slice(start, end + 1)));
}

const isLink = (value: string) => /^(https?:\/\/|[\w-]+\.[\w.-]+\/?)\S*$/i.test(value.trim());

export function WhatYouSell({ aiConnected, initial, onReady, onSkip }: {
  aiConnected: boolean;
  initial?: string;
  onReady: (draft: BrandDraft) => Promise<void> | void;
  onSkip: () => void;
}) {
  const [what, setWhat] = useState(initial ?? "");
  const [path, setPath] = useState<"" | "prompt" | "interview">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [answers, setAnswers] = useState<Partial<Record<InterviewKey, string>>>({});
  const [question, setQuestion] = useState(0);
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const source = what.trim();
  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason));

  async function generate() {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      let material = source;
      let site: string | undefined;
      if (isLink(source)) {
        const page = await studioRequest<{ url: string; title: string; text: string }>("readProductPage", { url: source });
        material = JSON.stringify(page);
        site = page.url;
      }
      const proposal = await structuredReply(brandPrompt(material), "Montar a marca a partir do que você vende", brandSuggestion);
      setDraft({ ...proposal, website: site });
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    setPath("prompt");
    setError("");
    try {
      await navigator.clipboard.writeText(brandPrompt(source));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function usePasted() {
    try {
      setError("");
      setDraft({ ...parseBrandAnswer(pasted), website: isLink(source) ? source : undefined });
    } catch (reason) {
      fail(reason);
    }
  }

  if (draft)
    return (
      <div className="wys">
        <p className="wys-lead">{t("Confira e ajuste. Dá para melhorar depois em Ajustes › Perfil e marca.")}</p>
        <label className="reel-field">{t("Nome da marca")}<input value={draft.name} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="reel-field">{t("O que vende e para quem")}<textarea rows={6} value={draft.context} maxLength={9000} onChange={(e) => setDraft({ ...draft, context: e.target.value })} /></label>
        <label className="reel-field">{t("Oferta e próxima ação")}<textarea rows={2} value={draft.goal} maxLength={2000} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} /></label>
        <label className="reel-field">{t("Tom da marca")}<input value={draft.tone} maxLength={1000} onChange={(e) => setDraft({ ...draft, tone: e.target.value })} /></label>
        {error && <p className="reel-error" role="alert">{error}</p>}
        <div className="reel-action-row">
          <button type="button" className="studio-primary-button" disabled={saving || !draft.name.trim()} onClick={() => {
            setSaving(true);
            setError("");
            Promise.resolve(onReady(draft)).catch(fail).finally(() => setSaving(false));
          }}>{saving ? t("Salvando…") : t("Salvar e continuar")} <ArrowRight size={14} /></button>
          <button type="button" className="ig-link" onClick={() => setDraft(null)}>{t("Voltar")}</button>
        </div>
      </div>
    );

  if (path === "interview") {
    const item = INTERVIEW[question];
    return (
      <div className="wys">
        <div className="wys-interview-progress" aria-hidden="true">{INTERVIEW.map((q, i) => <span key={q.key} className={i < question ? "done" : i === question ? "current" : ""} />)}</div>
        <label className="reel-field wys-question">{`${question + 1}/${INTERVIEW.length} · ${t(item.q)}`}
          <textarea rows={3} autoFocus value={answers[item.key] ?? ""} placeholder={t(item.hint)} maxLength={1500}
            onChange={(e) => setAnswers({ ...answers, [item.key]: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) setQuestion(Math.min(question + 1, INTERVIEW.length - 1)); }} />
        </label>
        <div className="reel-action-row">
          {question > 0 && <button type="button" className="studio-secondary-button" onClick={() => setQuestion(question - 1)}>{t("Anterior")}</button>}
          {question < INTERVIEW.length - 1
            ? <button type="button" className="studio-primary-button" onClick={() => setQuestion(question + 1)}>{t(answers[item.key]?.trim() ? "Próxima" : "Pular pergunta")} <ArrowRight size={14} /></button>
            : <button type="button" className="studio-primary-button" onClick={() => setDraft({ ...interviewToBrand("", answers), website: isLink(source) ? source : undefined })}>{t("Ver o resumo")} <ArrowRight size={14} /></button>}
          <button type="button" className="ig-link" onClick={() => setPath("")}>{t("Escolher outro caminho")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wys">
      <label className="reel-field">{t("Link ou descrição do que você vende")}
        <textarea rows={2} value={what} maxLength={2000} disabled={busy}
          placeholder={t("https://seuproduto.com.br  ou  agenda online para clínicas pequenas, R$ 49 por mês")}
          onChange={(e) => { setWhat(e.target.value); setPath(path === "prompt" ? "" : path); }} />
      </label>
      <div className="wys-paths" role="group" aria-label={t("Como montar a sua marca")}>
        <button type="button" className="wys-path main" disabled={busy || (aiConnected && !source)} onClick={() => (aiConnected ? void generate() : openAiConnect())}
          title={!aiConnected ? t("Conecte a IA para usar este caminho.") : !source ? t("Cole um link ou escreva uma frase.") : ""}>
          <b><Sparkles size={16} /> {t("Gerar com a minha IA")}</b>
          <small>{t(aiConnected ? "Recomendado. Lê o link e monta tudo em 1 a 2 minutos." : "Recomendado. Clique para conectar a sua IA (1 minuto).")}</small>
        </button>
        <button type="button" className="wys-path" disabled={!source || busy} onClick={() => void copyPrompt()} title={!source ? t("Cole um link ou escreva uma frase.") : ""}>
          <b><ClipboardCopy size={16} /> {t("Copiar prompt para o meu ChatGPT ou Claude")}</b>
          <small>{t("Usa o que a sua IA já sabe sobre você. Depois cole a resposta aqui.")}</small>
        </button>
        <button type="button" className="wys-path" disabled={busy} onClick={() => { setPath("interview"); setQuestion(0); }}>
          <b><MessagesSquare size={16} /> {t("Responder a entrevista")}</b>
          <small>{t("Seis perguntas rápidas. Não precisa de IA.")}</small>
        </button>
      </div>
      {busy && <p className="reel-busy" role="status">{t("Lendo o que você vende e montando a sua marca…")}</p>}
      {error && <p className="reel-error" role="alert">{error}</p>}
      {path === "prompt" && (
        <div className="wys-prompt">
          <div className="reel-action-row">
            <b>{t("1. Cole no ChatGPT ou no Claude")}</b>
            <button type="button" className="studio-secondary-button" onClick={() => void copyPrompt()}>{copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {t(copied ? "Copiado" : "Copiar prompt")}</button>
          </div>
          <pre className="wys-prompt-box">{brandPrompt(source)}</pre>
          <label className="reel-field">{t("2. Cole aqui a resposta da sua IA")}
            <textarea rows={5} value={pasted} maxLength={20000} onChange={(e) => setPasted(e.target.value)} />
          </label>
          <button type="button" className="studio-primary-button" disabled={!pasted.trim()} onClick={usePasted}>{t("Usar esta resposta")} <ArrowRight size={14} /></button>
        </div>
      )}
      <button type="button" className="ig-link wys-skip" onClick={onSkip}>{t("Pular por enquanto")}</button>
    </div>
  );
}
