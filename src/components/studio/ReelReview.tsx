import { t } from "./studioLanguage";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, LoaderCircle, Settings2, TriangleAlert } from "lucide-react";
import { InstagramActions, ExportedVideoPlayer } from "./InstagramActions";
import type { ReelSession } from "./ReelCreator";

interface RenderResult {
  status: "done" | "rendering" | "blocked" | "failed";
  output?: string;
  error?: string;
  progress?: number;
  step?: string;
  errors?: string[];
}

export function ReelReview({
  session,
  onSession,
  onBack,
  onOpenAdvanced,
  onConnect,
}: {
  session: ReelSession;
  onSession: (session: ReelSession) => void;
  onBack: () => void;
  onOpenAdvanced: () => void;
  onConnect: () => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => { anchor.current?.scrollIntoView({ block: "start" }); }, []);
  const [exportError, setExportError] = useState("");
  const review = session.review;
  if (!review || !session.filmId) return null;
  const exporting = session.step === "exporting";

  async function exportFilm() {
    setExportError("");
    onSession({ ...session, step: "exporting" });
    let current = session;
    try {
      for (;;) {
        const result = await window.cutroom!.request<RenderResult>("render_film", { film: session.filmId });
        if (result.status === "done" && result.output) {
          current = { ...current, step: "review", output: result.output };
          onSession(current);
          return;
        }
        if (result.status === "failed" || result.status === "blocked") {
          throw new Error(result.error || result.errors?.join("\n") || "O render foi bloqueado.");
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setExportError(message);
      onSession({ ...current, step: "review" });
    }
  }

  return (
    <div className="reel-review" ref={anchor} data-film-id={session.filmId}>
      <button type="button" className="studio-back-button" onClick={onBack} disabled={exporting}><ArrowLeft size={15} /> {t("Voltar ao início")}</button>
      <header className="reel-review-header">
        <div>
          <span className="studio-eyebrow">QUADROS REAIS · {review.duration.toFixed(1)} S</span>
          <h1>{t("Revisar Reel")}</h1>
          <p>Estes quadros foram capturados pelo FilmStudio a partir do HTML, da narração e da timeline do filme.</p>
        </div>
        <span className="reel-film-id">Filme {session.filmId}</span>
      </header>

      {session.output && <ExportedVideoPlayer key={session.output} path={session.output} />}
      <section className="reel-stills" aria-label={t("Quadros renderizados")}>
        {review.images.map((image, index) => (
          <figure key={`${review.frameTimes[index]}-${index}`}>
            <img className="reel-review-still" src={image} alt={`Quadro real em ${review.frameTimes[index] ?? 0} segundos`} />
            <figcaption>{(review.frameTimes[index] ?? 0).toFixed(2)} s</figcaption>
          </figure>
        ))}
      </section>

      <div className="reel-findings">
        <section>
          <h2><TriangleAlert size={17} /> {t("Validação")}</h2>
          {review.errors.length === 0 && review.flags.length === 0 ? (
            <p className="reel-validation-ok"><CheckCircle2 size={15} /> {t("Nenhum erro ou alerta automático nesta revisão.")}</p>
          ) : (
            <ul>{[...review.errors, ...review.flags].map((finding) => <li key={finding}>{finding}</li>)}</ul>
          )}
        </section>
        {review.checklist.length > 0 && <section><h2>{t("Checklist do formato")}</h2><ul>{review.checklist.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      </div>

      {exportError && <p className="reel-error" role="alert">{exportError}</p>}
      {exporting && <p className="reel-busy" role="status" data-testid="reel-export-status"><LoaderCircle size={16} className="spin" /> Exportação renderizando em um job real. O MP4 terá áudio de 48 kHz e loudness normalizado.</p>}
      {session.output && <p className="reel-export-done" role="status"><CheckCircle2 size={17} /><span>{t("Exportação concluída:")} <code data-testid="reel-export-output">{session.output}</code></span></p>}
      {!exporting && !session.output && <span data-testid="reel-export-status" className="reel-export-idle">{t("Exportação não iniciada")}</span>}

      <footer className="reel-review-actions">
        <button type="button" className="studio-secondary-button" onClick={onOpenAdvanced} disabled={exporting}><Settings2 size={15} /> {t("Abrir no editor avançado")}</button>
        <button type="button" className="studio-primary-button" onClick={() => void exportFilm()} disabled={exporting}><Download size={15} /> {exporting ? t("Exportando…") : session.output ? t("Exportar novamente") : t("Exportar MP4")}</button>
      </footer>
      {session.output && <InstagramActions key={session.output} video={session.output} initialCaption={session.caption ?? ""} onConnect={onConnect} />}
    </div>
  );
}
