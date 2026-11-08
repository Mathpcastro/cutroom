import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileVideo2,
  LoaderCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { StudioProfile } from "../shared/profile";
import type { StudioTab } from "../shared/types";
import { BrandMark } from "./BrandMark";
import { StudioHome, type CreateMode, type StudioProject } from "./studio/StudioHome";
import { StudioNav } from "./studio/StudioNav";
import "./studio/studio.css";

export type StudioPage =
  | "home"
  | "avatars"
  | "create"
  | "projects"
  | "voices"
  | "brand"
  | "publish"
  | "settings";

interface VideosellStudioProps {
  onOpenAdvanced: (tab?: StudioTab) => void;
}

interface FilmRecord {
  id: string;
  name: string;
  format?: string;
  createdAt: string;
}

const createCopy: Record<CreateMode, { title: string; text: string }> = {
  avatar: {
    title: "Criar meu avatar",
    text: "O criador visual de avatares será conectado na próxima etapa. Nenhum avatar foi gerado ou substituído por uma ilustração.",
  },
  "avatar-reel": {
    title: "Criar um Reel com avatar",
    text: "O fluxo guiado de Reels com avatar ainda não está disponível. Você pode voltar ao início ou usar os recursos existentes no editor avançado.",
  },
  "without-avatar": {
    title: "Criar sem avatar",
    text: "O novo fluxo guiado sem avatar será conectado na próxima etapa. O Estúdio de vídeos atual continua disponível nos ajustes avançados.",
  },
};

function BackHome({ onPage }: { onPage: (page: StudioPage) => void }) {
  return (
    <button type="button" className="studio-back-button" onClick={() => onPage("home")}>
      <ArrowLeft size={15} /> Voltar ao início
    </button>
  );
}

function PageTitle({ children }: { children: string }) {
  return <h1 tabIndex={-1}>{children}</h1>;
}

function IntermediatePage({
  title,
  eyebrow,
  text,
  onPage,
  action,
}: {
  title: string;
  eyebrow: string;
  text: string;
  onPage: (page: StudioPage) => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="studio-intermediate-page">
      <BackHome onPage={onPage} />
      <div className="studio-intermediate-content">
        <div className="studio-intermediate-mark" aria-hidden="true"><BrandMark size={46} /></div>
        <span className="studio-eyebrow">{eyebrow}</span>
        <PageTitle>{title}</PageTitle>
        <p>{text}</p>
        {action}
      </div>
    </div>
  );
}

export function VideosellStudio({ onOpenAdvanced }: VideosellStudioProps) {
  const [page, setPage] = useState<StudioPage>("home");
  const [createMode, setCreateMode] = useState<CreateMode>("avatar");
  const [profile, setProfile] = useState<StudioProfile | null>(null);
  const [profileInitializing, setProfileInitializing] = useState(true);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectsProfileId, setProjectsProfileId] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const projectsGeneration = useRef(0);

  const onProfileChange = useCallback((next: StudioProfile | null, initializing: boolean) => {
    projectsGeneration.current += 1;
    setProfile(next);
    setProfileInitializing(initializing);
    setProjects([]);
    setProjectsProfileId("");
    setProjectsError("");
    setProjectsLoading(Boolean(next) && !initializing);
  }, []);

  const loadProjects = useCallback(async () => {
    const generation = ++projectsGeneration.current;
    const profileId = profile?.id;
    if (profileInitializing || !profileId) {
      setProjects([]);
      setProjectsProfileId("");
      setProjectsError("");
      setProjectsLoading(false);
      return;
    }
    const api = window.cutroom;
    if (!api) {
      if (generation !== projectsGeneration.current) return;
      setProjects([]);
      setProjectsProfileId(profileId);
      setProjectsError("Os projetos estão disponíveis no aplicativo desktop.");
      setProjectsLoading(false);
      return;
    }
    setProjects([]);
    setProjectsProfileId(profileId);
    setProjectsLoading(true);
    setProjectsError("");
    try {
      const [projectIds, result] = await Promise.all([
        api.studioProfiles.listProjects(profileId),
        api.request<{ films: FilmRecord[] }>("listFilms"),
      ]);
      if (generation !== projectsGeneration.current) return;
      const films = new Map(result.films.map((film) => [film.id, film]));
      const linked = projectIds.map((id): StudioProject => {
        const film = films.get(id);
        return film
          ? { id, name: film.name, createdAt: film.createdAt, format: film.format }
          : { id, name: id, missing: true };
      });
      linked.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setProjects(linked);
    } catch (reason) {
      if (generation !== projectsGeneration.current) return;
      setProjects([]);
      setProjectsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (generation === projectsGeneration.current) setProjectsLoading(false);
    }
  }, [profile, profileInitializing]);

  useEffect(() => {
    void loadProjects();
    return () => {
      projectsGeneration.current += 1;
    };
  }, [loadProjects]);

  const visibleProjects = profile && projectsProfileId === profile.id ? projects : [];
  const visibleProjectsError = profile && projectsProfileId === profile.id ? projectsError : "";

  const create = (mode: CreateMode) => {
    setCreateMode(mode);
    setPage("create");
  };

  const projectsPage = (
    <div className="studio-intermediate-page studio-projects-page">
      <BackHome onPage={setPage} />
      <div className="studio-library-heading">
        <span className="studio-eyebrow">SEU ACERVO</span>
        <PageTitle>Projetos</PageTitle>
        <p>Somente filmes realmente vinculados ao perfil ativo aparecem nesta lista.</p>
      </div>
      {profileInitializing && (
        <div className="studio-projects-status" role="status">
          <LoaderCircle size={16} className="spin" /> Carregando perfil ativo…
        </div>
      )}
      {!profileInitializing && !profile && (
        <div className="studio-library-empty">
          <FileVideo2 size={29} strokeWidth={1.3} />
          <h2>Nenhum perfil selecionado</h2>
          <p>Crie ou selecione um perfil para ver os projetos vinculados.</p>
        </div>
      )}
      {!profileInitializing && profile && projectsLoading && (
        <div className="studio-projects-status" role="status">
          <LoaderCircle size={16} className="spin" /> Carregando projetos…
        </div>
      )}
      {!profileInitializing && profile && !projectsLoading && visibleProjectsError && (
        <div className="studio-projects-status studio-projects-error" role="alert">
          <span>{visibleProjectsError}</span>
          <button type="button" onClick={() => void loadProjects()}>
            <RefreshCw size={13} /> Tentar novamente
          </button>
        </div>
      )}
      {!profileInitializing && profile && !projectsLoading && !visibleProjectsError && !visibleProjects.length && (
        <div className="studio-library-empty">
          <FileVideo2 size={29} strokeWidth={1.3} />
          <h2>Nenhum projeto vinculado</h2>
          <p>Este perfil ainda não tem filmes associados. Nenhum projeto de exemplo foi criado.</p>
        </div>
      )}
      {!profileInitializing && profile && !projectsLoading && !visibleProjectsError && visibleProjects.length > 0 && (
        <div className="studio-library-grid">
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpenAdvanced("films")}
            >
              <FileVideo2 size={23} strokeWidth={1.4} />
              <strong>{project.name}</strong>
              <span>{project.missing ? "ID vinculado; metadados não encontrados." : project.createdAt}</span>
              <span className="studio-choice-action">Abrir filmes <ArrowRight size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  let content: React.ReactNode;
  if (page === "home") {
    content = (
      <StudioHome
        profile={profile}
        profileInitializing={profileInitializing}
        projects={visibleProjects}
        projectsLoading={projectsLoading}
        projectsError={visibleProjectsError}
        onPage={setPage}
        onCreate={create}
      />
    );
  } else if (page === "projects") {
    content = projectsPage;
  } else if (page === "avatars") {
    content = (
      <IntermediatePage
        title="Meus avatares"
        eyebrow="SUA APRESENTAÇÃO"
        text={profile?.defaultAvatar
          ? "Este perfil tem uma revisão de avatar vinculada. A galeria visual será apresentada pelo criador de avatares na próxima etapa."
          : "Nenhum avatar está vinculado a este perfil. O criador visual será conectado na próxima etapa, sem avatares de exemplo."}
        onPage={setPage}
        action={
          <button type="button" className="studio-primary-button" onClick={() => create("avatar")}>
            Criar meu avatar <ArrowRight size={14} />
          </button>
        }
      />
    );
  } else if (page === "create") {
    const copy = createCopy[createMode];
    content = (
      <IntermediatePage
        title={copy.title}
        eyebrow="FLUXO EM PREPARAÇÃO"
        text={copy.text}
        onPage={setPage}
        action={
          <button type="button" className="studio-secondary-action" onClick={() => onOpenAdvanced("start")}>
            <Settings2 size={14} /> Abrir Estúdio de vídeos atual
          </button>
        }
      />
    );
  } else {
    const advanced = {
      voices: { title: "Vozes", tab: "voices" as const, text: "As vozes e os provedores já configuráveis ficam no Estúdio de vídeos do editor avançado." },
      brand: { title: "Marca", tab: "brand" as const, text: "A identidade e a paleta já disponíveis ficam no Estúdio de vídeos do editor avançado." },
      publish: { title: "Conexões", tab: "publish" as const, text: "As conexões de publicação já disponíveis ficam no Estúdio de vídeos do editor avançado." },
      settings: { title: "Ajustes avançados", tab: undefined, text: "O editor completo permanece disponível, com timeline, mídia, transcrição, estilos e os painéis atuais." },
    }[page as "voices" | "brand" | "publish" | "settings"];
    content = (
      <IntermediatePage
        title={advanced.title}
        eyebrow="RECURSOS EXISTENTES"
        text={advanced.text}
        onPage={setPage}
        action={
          <button type="button" className="studio-primary-button" onClick={() => onOpenAdvanced(advanced.tab)}>
            Abrir no editor avançado <ArrowRight size={14} />
          </button>
        }
      />
    );
  }

  return (
    <div className="videosell-studio">
      <div className="studio-window-drag" aria-hidden="true" />
      <StudioNav
        page={page}
        onPage={setPage}
        onOpenAdvanced={onOpenAdvanced}
        onProfileChange={onProfileChange}
      />
      <main className="studio-main" id="studio-main-content">
        {content}
      </main>
    </div>
  );
}
