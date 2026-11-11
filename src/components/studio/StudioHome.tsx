import { t, getStudioLanguage } from "./studioLanguage";
import {
  ArrowRight,
  FileVideo2,
  LoaderCircle,
  Sparkles,
  UserRound,
  Video,
} from "lucide-react";
import { brandTagline } from "../../shared/branding";
import type { StudioProfile } from "../../shared/profile";
import type { StudioPage } from "../VideosellStudio";

export interface StudioProject {
  id: string;
  name: string;
  createdAt?: string;
  format?: string;
  missing?: boolean;
}

export type CreateMode = "avatar" | "avatar-reel" | "without-avatar";

interface StudioHomeProps {
  profile: StudioProfile | null;
  profileInitializing: boolean;
  projects: StudioProject[];
  projectsLoading: boolean;
  projectsError: string;
  onPage: (page: StudioPage) => void;
  nextAction?: { label: string; description: string; run: () => void };
  onCreate: (mode: CreateMode) => void;
}

const choices = [
  {
    mode: "avatar",
    label: "Criar meu avatar",
    description: "Prepare uma apresentação com a sua imagem e identidade.",
    icon: UserRound,
    className: "avatar-choice",
  },
  {
    mode: "without-avatar",
    label: "Criar Reel",
    description: "Descreva a ideia. Escolha com ou sem avatar, vídeo direto ou história.",
    icon: Video,
    className: "video-choice",
  },
] as const;

function projectDate(value?: string) {
  if (!value) return "Metadados não encontrados";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não disponível";
  return new Intl.DateTimeFormat(getStudioLanguage(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function StudioHome({
  profile,
  profileInitializing,
  projects,
  projectsLoading,
  projectsError,
  onPage,
  onCreate,
  nextAction,
}: StudioHomeProps) {
  return (
    <div className="studio-home">
      <header className="studio-home-header">
        <div>
          <span className="studio-eyebrow">{t("PALCO DE CRIAÇÃO")}</span>
          <h1>{t("Seu próximo vídeo começa aqui.")}</h1>
          <p>{t(brandTagline)}</p>
        </div>
        <div className="studio-profile-context" aria-label="Contexto do perfil">
          <span>{t("PERFIL EM USO")}</span>
          <strong>{profileInitializing ? t("Carregando perfil ativo…") : profile?.name ?? t("Nenhum perfil selecionado")}</strong>
          <small>{profileInitializing
            ? "Aguarde a leitura do perfil persistido."
            : profile ? `@${profile.handle}` : "Crie um perfil para organizar seu trabalho."}</small>
        </div>
      </header>

      {nextAction && <section className="studio-next-action" aria-labelledby="next-action-title">
        <div><h2 id="next-action-title">{t("Próximo passo")}</h2><p>{t(nextAction.description)}</p></div>
        <button type="button" className="studio-primary-button" onClick={nextAction.run}>{t(nextAction.label)} <ArrowRight size={16} /></button>
      </section>}

      <section className="studio-creation-section" aria-labelledby="creation-title">
        <div className="studio-section-heading">
          <div>
            <span className="studio-section-index">01</span>
            <h2 id="creation-title">{t("Escolha como quer criar")}</h2>
          </div>
          <span className="studio-section-note">{t("Um ponto de partida, sem fórmulas prontas.")}</span>
        </div>
        <div className="studio-creation-grid studio-creation-grid-unified">
          {choices.map(({ mode, label, description, icon: Icon, className }, index) => (
            <button
              key={mode}
              type="button"
              className={`studio-creation-card ${className}`}
              aria-label={t(label)}
              onClick={() => onCreate(mode)}
            >
              <span className="studio-card-number">0{index + 1}</span>
              <span className="studio-choice-icon"><Icon size={23} strokeWidth={1.5} /></span>
              <strong>{t(label)}</strong>
              <span className="studio-choice-description">{t(description)}</span>
              <span className="studio-choice-action">{t("Começar")} <ArrowRight size={15} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-recent-section" aria-labelledby="recent-title">
        <div className="studio-section-heading">
          <div>
            <span className="studio-section-index">02</span>
            <h2 id="recent-title">{t("Projetos recentes")}</h2>
          </div>
          <button
            type="button"
            className="studio-continue-button"
            aria-label={t("Continuar criando")}
            onClick={() => onPage("projects")}
          >
            {t("Continuar criando")} <ArrowRight size={15} />
          </button>
        </div>
        {profileInitializing && (
          <div className="studio-projects-status" role="status">
            <LoaderCircle size={16} className="spin" /> {t("Carregando perfil ativo…")}
          </div>
        )}
        {!profileInitializing && !profile && (
          <div className="studio-projects-empty">
            <div className="studio-empty-symbol" aria-hidden="true">
              <FileVideo2 size={25} strokeWidth={1.4} />
              <Sparkles size={13} />
            </div>
            <div>
              <strong>{t("Nenhum perfil selecionado")}</strong>
              <p>{t("Crie ou selecione um perfil para ver os projetos vinculados.")}</p>
            </div>
          </div>
        )}
        {!profileInitializing && profile && projectsLoading && (
          <div className="studio-projects-status" role="status">
            <LoaderCircle size={16} className="spin" /> {t("Carregando projetos do perfil…")}
          </div>
        )}
        {!profileInitializing && profile && !projectsLoading && projectsError && (
          <div className="studio-projects-status studio-projects-error" role="alert">
            {projectsError}
          </div>
        )}
        {!profileInitializing && profile && !projectsLoading && !projectsError && !projects.length && (
          <div className="studio-projects-empty">
            <div className="studio-empty-symbol" aria-hidden="true">
              <FileVideo2 size={25} strokeWidth={1.4} />
              <Sparkles size={13} />
            </div>
            <div>
              <strong>{t("Nenhum projeto vinculado a este perfil ainda.")}</strong>
              <p>{t("Quando um filme for associado a este perfil, ele aparecerá aqui.")}</p>
            </div>
          </div>
        )}
        {!profileInitializing && profile && !projectsLoading && !projectsError && projects.length > 0 && (
          <div className="studio-project-list">
            {projects.slice(0, 4).map((project) => (
              <button key={project.id} type="button" onClick={() => onPage("projects")}>
                <span className="studio-project-icon"><FileVideo2 size={19} /></span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{projectDate(project.createdAt)}{project.format ? ` · ${project.format}` : ""}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        )}
      </section>
      <footer className="studio-home-footer">
        <span>VIDEOSSELL / PALCO DIGITAL</span>
        <span>Criação local, identidade sob seu controle.</span>
      </footer>
    </div>
  );
}
