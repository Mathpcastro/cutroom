import {
  ArrowRight,
  Clapperboard,
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
    mode: "avatar-reel",
    label: "Criar um Reel com avatar",
    description: "Combine apresentador, roteiro e formato vertical.",
    icon: Clapperboard,
    className: "reel-choice",
  },
  {
    mode: "without-avatar",
    label: "Criar sem avatar",
    description: "Use sua marca, telas e narração para apresentar o produto.",
    icon: Video,
    className: "video-choice",
  },
] as const;

function projectDate(value?: string) {
  if (!value) return "Metadados não encontrados";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
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
}: StudioHomeProps) {
  return (
    <div className="studio-home">
      <header className="studio-home-header">
        <div>
          <span className="studio-eyebrow">PALCO DE CRIAÇÃO</span>
          <h1>Seu próximo vídeo começa aqui.</h1>
          <p>{brandTagline}</p>
        </div>
        <div className="studio-profile-context" aria-label="Contexto do perfil">
          <span>PERFIL EM USO</span>
          <strong>{profileInitializing ? "Carregando perfil ativo…" : profile?.name ?? "Nenhum perfil selecionado"}</strong>
          <small>{profileInitializing
            ? "Aguarde a leitura do perfil persistido."
            : profile ? `@${profile.handle}` : "Crie um perfil para organizar seu trabalho."}</small>
        </div>
      </header>

      <section className="studio-creation-section" aria-labelledby="creation-title">
        <div className="studio-section-heading">
          <div>
            <span className="studio-section-index">01</span>
            <h2 id="creation-title">Escolha como quer criar</h2>
          </div>
          <span className="studio-section-note">Um ponto de partida, sem fórmulas prontas.</span>
        </div>
        <div className="studio-creation-grid">
          {choices.map(({ mode, label, description, icon: Icon, className }, index) => (
            <button
              key={mode}
              type="button"
              className={`studio-creation-card ${className}`}
              aria-label={label}
              onClick={() => onCreate(mode)}
            >
              <span className="studio-card-number">0{index + 1}</span>
              <span className="studio-choice-icon"><Icon size={23} strokeWidth={1.5} /></span>
              <strong>{label}</strong>
              <span className="studio-choice-description">{description}</span>
              <span className="studio-choice-action">Começar <ArrowRight size={15} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-recent-section" aria-labelledby="recent-title">
        <div className="studio-section-heading">
          <div>
            <span className="studio-section-index">02</span>
            <h2 id="recent-title">Projetos recentes</h2>
          </div>
          <button
            type="button"
            className="studio-continue-button"
            aria-label="Continuar criando"
            onClick={() => onPage("projects")}
          >
            Continuar criando <ArrowRight size={15} />
          </button>
        </div>
        {profileInitializing && (
          <div className="studio-projects-status" role="status">
            <LoaderCircle size={16} className="spin" /> Carregando perfil ativo…
          </div>
        )}
        {!profileInitializing && !profile && (
          <div className="studio-projects-empty">
            <div className="studio-empty-symbol" aria-hidden="true">
              <FileVideo2 size={25} strokeWidth={1.4} />
              <Sparkles size={13} />
            </div>
            <div>
              <strong>Nenhum perfil selecionado</strong>
              <p>Crie ou selecione um perfil para ver os projetos vinculados.</p>
            </div>
          </div>
        )}
        {!profileInitializing && profile && projectsLoading && (
          <div className="studio-projects-status" role="status">
            <LoaderCircle size={16} className="spin" /> Carregando projetos do perfil…
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
              <strong>Nenhum projeto vinculado a este perfil ainda.</strong>
              <p>Quando um filme for associado a este perfil, ele aparecerá aqui.</p>
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
