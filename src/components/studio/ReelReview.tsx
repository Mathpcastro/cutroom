import { useState } from "react";
import { ArrowLeft, CheckCircle2, Download, LoaderCircle, Settings2, TriangleAlert } from "lucide-react";
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
}: {
  session: ReelSession;
  onSession: (session: ReelSession) => void;
  onBack: () => void;
  onOpenAdvanced: () => void;
}) {
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
    <div className="reel-review" data-film-id={session.filmId}>
      <button type="button" className="studio-back-button" onClick={onBack} disabled={exporting}><ArrowLeft size={15} /> Voltar ao início</button>
      <header className="reel-review-header">
        <div>
          <span className="studio-eyebrow">QUADROS REAIS · {review.duration.toFixed(1)} S</span>
          <h1>Revisar Reel</h1>
          <p>Estes quadros foram capturados pelo FilmStudio a partir do HTML, da narração e da timeline do filme.</p>
        </div>
        <span className="reel-film-id">Filme {session.filmId}</span>
      </header>

      <section className="reel-stills" aria-label="Quadros renderizados">
        {review.images.map((image, index) => (
          <figure key={`${review.frameTimes[index]}-${index}`}>
            <img className="reel-review-still" src={image} alt={`Quadro real em ${review.frameTimes[index] ?? 0} segundos`} />
            <figcaption>{(review.frameTimes[index] ?? 0).toFixed(2)} s</figcaption>
          </figure>
        ))}
      </section>

      <div className="reel-findings">
        <section>
          <h2><TriangleAlert size={17} /> Validação</h2>
          {review.errors.length === 0 && review.flags.length === 0 ? (
            <p className="reel-validation-ok"><CheckCircle2 size={15} /> Nenhum erro ou alerta automático nesta revisão.</p>
          ) : (
            <ul>{[...review.errors, ...review.flags].map((finding) => <li key={finding}>{finding}</li>)}</ul>
          )}
        </section>
        {review.checklist.length > 0 && <section><h2>Checklist do formato</h2><ul>{review.checklist.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      </div>

      {exportError && <p className="reel-error" role="alert">{exportError}</p>}
      {exporting && <p className="reel-busy" role="status" data-testid="reel-export-status"><LoaderCircle size={16} className="spin" /> Exportação renderizando em um job real. O MP4 terá áudio de 48 kHz e loudness normalizado.</p>}
      {session.output && <p className="reel-export-done" role="status"><CheckCircle2 size={17} /><span>Exportação concluída: <code data-testid="reel-export-output">{session.output}</code></span></p>}
      {!exporting && !session.output && <span data-testid="reel-export-status" className="reel-export-idle">Exportação não iniciada</span>}

      <footer className="reel-review-actions">
        <button type="button" className="studio-secondary-button" onClick={onOpenAdvanced} disabled={exporting}><Settings2 size={15} /> Abrir no editor avançado</button>
        <button type="button" className="studio-primary-button" onClick={() => void exportFilm()} disabled={exporting}><Download size={15} /> {exporting ? "Exportando…" : session.output ? "Exportar novamente" : "Exportar MP4"}</button>
      </footer>
    </div>
  );
}
