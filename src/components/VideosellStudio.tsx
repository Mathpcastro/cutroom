import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileVideo2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { StudioProfile } from "../shared/profile";
import type { AppSnapshot, StudioTab } from "../shared/types";
import { BrandMark } from "./BrandMark";
import { StudioHome, type CreateMode, type StudioProject } from "./studio/StudioHome";
import { AvatarCreator } from "./studio/AvatarCreator";
import { BrandSettings } from "./studio/BrandSettings";
import { VoiceSettings } from "./studio/VoiceSettings";
import { PublishSettings } from "./studio/PublishSettings";
import { StudioNav } from "./studio/StudioNav";
import { ReelCreator, initialReelDraft, type ReelSession } from "./studio/ReelCreator";
import { ReelReview } from "./studio/ReelReview";
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
  state: AppSnapshot;
  run: (method: string, params?: unknown) => Promise<void>;
  onOpenAdvanced: (tab?: StudioTab) => void;
}

const FONT_SCALE_KEY = "videosell.studio.fontScale";
const fontScales = [100, 115, 130] as const;
type FontScale = (typeof fontScales)[number];

function initialFontScale(): FontScale {
  try {
    const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
    return fontScales.includes(saved as FontScale) ? saved as FontScale : 115;
  } catch {
    return 115;
  }
}

interface FilmRecord {
  id: string;
  name: string;
  format?: string;
  createdAt: string;
}

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

export function VideosellStudio({ state, run, onOpenAdvanced }: VideosellStudioProps) {
  const [page, setPage] = useState<StudioPage>("home");
  const [createMode, setCreateMode] = useState<CreateMode>("avatar");
  const [reelSession, setReelSession] = useState<ReelSession | null>(null);
  const [fontScale, setFontScale] = useState<FontScale>(initialFontScale);
  const changeFontScale = useCallback((scale: number) => {
    if (!fontScales.includes(scale as FontScale)) return;
    setFontScale(scale as FontScale);
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(scale));
    } catch {
      /* Storage may be unavailable; the visual preference still works. */
    }
  }, []);
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
    if (mode !== "avatar" && profile && (mode === "without-avatar" || profile.defaultAvatar)) {
      setReelSession({ step: "brief", draft: initialReelDraft(profile, mode === "avatar-reel") });
    } else {
      setReelSession(null);
    }
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
    content = profile?.defaultAvatar ? (
      <AvatarCreator
        profile={profile}
        onProfileChange={(next) => onProfileChange(next, false)}
        onBack={() => setPage("home")}
      />
    ) : (
      <IntermediatePage
        title="Meus avatares"
        eyebrow="SUA APRESENTAÇÃO"
        text="Nenhum avatar está vinculado a este perfil. Nenhum avatar de exemplo será exibido."
        onPage={setPage}
        action={
          <button type="button" className="studio-primary-button" onClick={() => create("avatar")}>
            Criar meu avatar <ArrowRight size={14} />
          </button>
        }
      />
    );
  } else if (page === "create" && createMode === "avatar") {
    content = profile ? (
      <AvatarCreator
        profile={profile}
        onProfileChange={(next) => onProfileChange(next, false)}
        onBack={() => setPage("home")}
      />
    ) : (
      <IntermediatePage
        title="Criar meu avatar"
        eyebrow="PERFIL NECESSÁRIO"
        text="Crie ou selecione um perfil antes de criar e salvar um avatar."
        onPage={setPage}
      />
    );
  } else if (page === "create" && profile && reelSession) {
    content = reelSession.review && reelSession.filmId ? (
      <ReelReview
        session={reelSession}
        onSession={setReelSession}
        onBack={() => setPage("home")}
        onOpenAdvanced={() => onOpenAdvanced("films")}
      />
    ) : (
      <ReelCreator
        profile={profile}
        session={reelSession}
        onSession={setReelSession}
        onReview={setReelSession}
        onBack={() => setPage("home")}
      />
    );
  } else if (page === "create") {
    const needsAvatar = createMode === "avatar-reel" && !profile?.defaultAvatar;
    content = (
      <IntermediatePage
        title={createMode === "avatar-reel" ? "Criar um Reel com avatar" : "Criar sem avatar"}
        eyebrow={needsAvatar ? "AVATAR NECESSÁRIO" : "PERFIL NECESSÁRIO"}
        text={needsAvatar ? "Crie e aprove um avatar no perfil antes de iniciar este fluxo. Para criar sem personagem, use Criar sem avatar." : "Crie ou selecione um perfil antes de criar e vincular um Reel."}
        onPage={setPage}
      />
    );
  } else if (page === "voices" || page === "brand" || page === "publish") {
    const settingsPage = {
      voices: { title: "Vozes", eyebrow: "NARRAÇÃO", description: "Escolha uma voz local ou conecte seu provedor preferido." },
      brand: { title: "Marca", eyebrow: "IDENTIDADE", description: "Defina uma única vez a identidade usada nos seus vídeos." },
      publish: { title: "Conexões", eyebrow: "PUBLICAÇÃO", description: "Conecte seu Instagram e publique somente quando confirmar." },
    }[page];
    content = (
      <div className="studio-settings-page">
        <BackHome onPage={setPage} />
        <header className="studio-settings-heading">
          <span className="studio-eyebrow">{settingsPage.eyebrow}</span>
          <PageTitle>{settingsPage.title}</PageTitle>
          <p>{settingsPage.description}</p>
        </header>
        <div className="studio-settings-card">
          {page === "voices" && <VoiceSettings packages={state.packages} jobs={state.jobs} run={run} />}
          {page === "brand" && <BrandSettings />}
          {page === "publish" && <PublishSettings jobs={state.jobs} />}
        </div>
      </div>
    );
  } else {
    content = (
      <IntermediatePage
        title="Ajustes avançados"
        eyebrow="RECURSOS EXISTENTES"
        text="O editor completo permanece disponível, com timeline, mídia, transcrição, estilos e os painéis atuais."
        onPage={setPage}
      />
    );
  }

  return (
    <div className="videosell-studio" data-font-scale={fontScale}>
      <div className="studio-window-drag" aria-hidden="true" />
      <StudioNav
        page={page}
        onPage={setPage}
        onOpenAdvanced={onOpenAdvanced}
        onProfileChange={onProfileChange}
        fontScale={fontScale}
        onFontScaleChange={changeFontScale}
      />
      <main className="studio-main" id="studio-main-content">
        {content}
      </main>
    </div>
  );
}
