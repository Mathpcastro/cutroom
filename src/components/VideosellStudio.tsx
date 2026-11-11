import type { SalesPlan } from "./studio/salesReels";
import { BrandProofLibrary } from "./studio/BrandProofLibrary";
import { t, useStudioLanguage } from "./studio/studioLanguage";
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
import { BrandOnboarding } from "./studio/BrandOnboarding";
import { VoiceSettings } from "./studio/VoiceSettings";
import { PublishSettings } from "./studio/PublishSettings";
import { StudioNav } from "./studio/StudioNav";
import { ReelCreator, initialReelDraft, type ReelDraft, type ReelOrigin, type ReelSession } from "./studio/ReelCreator";
import { ReelReview } from "./studio/ReelReview";
import { InstagramAnalyticsPage, cachedInstagramAnalytics, topReelReferences } from "./studio/InstagramAnalyticsPage";
import { Radar, ReelRoutine, VideoLibrary } from "./studio/ReelWorkspace";
import { rememberReel, reopenReel, pendingReviews } from "./studio/reelRecords";
import { useReelPilot } from "./studio/ReelPilot";
import "./studio/studio.css";

export type StudioPage =
  | "home"
  | "avatars"
  | "create"
  | "projects"
  | "radar"
  | "analytics"
  | "proofs"
  | "routine"
  | "videos"
  | "voices"
  | "brand"
  | "onboarding"
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
  const language = useStudioLanguage();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const [page, setPage] = useState<StudioPage>("home");
  const [avatarSetupRequest, setAvatarSetupRequest] = useState(0);
  const [createMode, setCreateMode] = useState<CreateMode>("avatar");
  const [reelSession, setReelSession] = useState<ReelSession | null>(null);
  const [opening, setOpening] = useState(false);
  const [openingError, setOpeningError] = useState("");
  const openGeneration = useRef(0);
  function updateSession(next: ReelSession) {
    setReelSession(next);
    if (next.step === "review") rememberReel(next);
  }
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
    openGeneration.current += 1;
    setOpening(false);
    setOpeningError("");
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

  const refreshAfterPilot = useCallback(() => { void loadProjects(); }, [loadProjects]);
  useReelPilot(profile, state.connection.status === "connected" && !state.busy &&
    reelSession?.step !== "generating" && reelSession?.step !== "exporting", refreshAfterPilot);

  const visibleProjects = profile && projectsProfileId === profile.id ? projects : [];
  const visibleProjectsError = profile && projectsProfileId === profile.id ? projectsError : "";

  const create = (mode: CreateMode, brief = "", origin?: ReelOrigin, basePlan?: SalesPlan, baseDraft?: ReelDraft) => {
    if (mode === "avatar" && !profile) {
      setAvatarSetupRequest((previous) => previous + 1);
      return;
    }
    setCreateMode(mode);
    if (mode !== "avatar" && profile) {
      setReelSession({
        step: "brief",
        draft: { ...(baseDraft ?? initialReelDraft(profile, mode === "avatar-reel")), brief, origin },
        variationBase: basePlan,
      });
    } else {
      setReelSession(null);
    }
    setPage("create");
  };

  const navigate = (target: StudioPage) => {
    openGeneration.current += 1;
    setOpening(false);
    setOpeningError("");
    if (target === "create" && (!reelSession || reelSession.draft.profileId !== profile?.id)) {
      create("without-avatar");
      return;
    }
    if (target === "create") setCreateMode("without-avatar");
    setPage(target);
  };

  async function openProject(filmId: string) {
    if (!profile || opening) return;
    const generation = ++openGeneration.current;
    setOpening(true);
    setOpeningError("");
    try {
      const session = await reopenReel(profile.id, filmId);
      if (generation !== openGeneration.current) return;
      if (!session) {
        onOpenAdvanced("films");
        return;
      }
      setCreateMode("without-avatar");
      updateSession(session);
      setPage("create");
    } catch (reason) {
      if (generation === openGeneration.current) setOpeningError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (generation === openGeneration.current) setOpening(false);
    }
  }

  const projectsPage = (
    <div className="studio-intermediate-page studio-projects-page">
      <BackHome onPage={setPage} />
      <div className="studio-library-heading">
        <span className="studio-eyebrow">{t("SEU ACERVO")}</span>
        <PageTitle>{t(t("Projetos"))}</PageTitle>
        <p>{t("Volte aos vídeos criados neste perfil para revisar ou exportar.")}</p>
        {opening && <p role="status">{t(t("Abrindo Reel…"))}</p>}
        {openingError && <p role="alert" className="reel-error">{openingError}</p>}
      </div>
      {profileInitializing && (
        <div className="studio-projects-status" role="status">
          <LoaderCircle size={16} className="spin" /> {t(t("Carregando perfil ativo…"))}
        </div>
      )}
      {!profileInitializing && !profile && (
        <div className="studio-library-empty">
          <FileVideo2 size={29} strokeWidth={1.3} />
          <h2>{t(t("Nenhum perfil selecionado"))}</h2>
          <p>{t(t("Crie ou selecione um perfil para ver os projetos vinculados."))}</p>
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
            <RefreshCw size={13} /> {t("Tentar novamente")}
          </button>
        </div>
      )}
      {!profileInitializing && profile && !projectsLoading && !visibleProjectsError && !visibleProjects.length && (
        <div className="studio-library-empty">
          <FileVideo2 size={29} strokeWidth={1.3} />
          <h2>{t(t("Nenhum projeto vinculado"))}</h2>
          <p>Este perfil ainda não tem filmes associados. Nenhum projeto de exemplo foi criado.</p>
        </div>
      )}
      {!profileInitializing && profile && !projectsLoading && !visibleProjectsError && visibleProjects.length > 0 && (
        <div className="studio-library-grid">
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              disabled={opening}
              onClick={() => void openProject(project.id)}
            >
              <FileVideo2 size={23} strokeWidth={1.4} />
              <strong>{project.name}</strong>
              <span>{project.missing ? "ID vinculado; metadados não encontrados." : project.createdAt}</span>
              <span className="studio-choice-action">{t("Abrir Reel")} <ArrowRight size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const pending = profile ? pendingReviews(profile.id)[0] : undefined;
  const hasReferences = profile && topReelReferences(cachedInstagramAnalytics(profile.id)).length > 0;
  const nextAction = !profile ? undefined : pending ? {
    label: "Revisar vídeo", description: "Um Reel está pronto para sua revisão.",
    run: () => void openProject(pending.filmId),
  } : hasReferences ? {
    label: "Testar uma variação", description: "Use os resultados dos seus Reels para escolher o próximo teste.",
    run: () => setPage("analytics"),
  } : {
    label: visibleProjects.length ? "Criar próximo Reel" : "Criar meu primeiro Reel",
    description: "Comece com um pedido ou use uma ideia do Radar.",
    run: () => create("without-avatar"),
  };

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
        nextAction={nextAction}
      />
    );
  } else if (page === "proofs") {
    content = profile ? <BrandProofLibrary key={profile.id} profileId={profile.id} /> : (
      <IntermediatePage title={t("Provas da marca")} eyebrow="BIBLIOTECA" text="Selecione um perfil para guardar suas provas." onPage={setPage} />
    );
  } else if (page === "analytics") {
    content = profile ? <InstagramAnalyticsPage key={profile.id} profile={profile} onConnect={() => setPage("publish")} onCreate={(brief, origin, basePlan, baseDraft) => create("without-avatar", brief, origin, basePlan, baseDraft)} /> : (
      <IntermediatePage title={t(t("Instagram Analytics"))} eyebrow="DESEMPENHO" text="Selecione um perfil para analisar seus Reels." onPage={setPage} />
    );
  } else if (page === "radar") {
    content = profile ? <Radar key={profile.id} profile={profile} onCreate={(brief, origin) => create("without-avatar", brief, origin)} onAnalytics={() => setPage("analytics")} /> : (
      <IntermediatePage title={t(t("Radar de pautas"))} eyebrow="ESTRATÉGIA" text="Selecione um perfil para sugerir pautas para seu SaaS." onPage={setPage} />
    );
  } else if (page === "routine") {
    content = <ReelRoutine profile={profile} opening={opening} openingError={openingError} onReview={(id) => void openProject(id)} onConnect={() => setPage("publish")} />;
  } else if (page === "videos") {
    content = <VideoLibrary onConnect={() => setPage("publish")} />;
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
        title={t(t("Meus avatares"))}
        eyebrow="SUA APRESENTAÇÃO"
        text="Nenhum avatar está vinculado a este perfil. Nenhum avatar de exemplo será exibido."
        onPage={setPage}
        action={
          <button type="button" className="studio-primary-button" onClick={() => create("avatar")}>
            {t(t("Criar meu avatar"))} <ArrowRight size={14} />
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
        title={t(t("Criar meu avatar"))}
        eyebrow={t("PERFIL NECESSÁRIO")}
        text="Crie ou selecione um perfil antes de criar e salvar um avatar."
        onPage={setPage}
      />
    );
  } else if (page === "create" && profile && reelSession?.draft.profileId === profile.id) {
    content = (
      <>
        <ReelCreator
          key={reelSession.filmId ?? profile.id}
          onRestore={(id) => void openProject(id)}
          profile={profile}
          session={reelSession}
          onSession={updateSession}
          onReview={(next) => { updateSession(next); void loadProjects(); }}
          onBack={() => setPage("home")}
        />
        {reelSession.review && reelSession.filmId && reelSession.step !== "generating" && <ReelReview
          key={reelSession.filmId}
          session={reelSession}
          onSession={updateSession}
          onBack={() => setPage("home")}
          onConnect={() => setPage("publish")}
          onOpenAdvanced={() => onOpenAdvanced("films")}
        />}
      </>
    );
  } else if (page === "create") {
    content = (
      <IntermediatePage
        title={t(t("Criar Reel"))}
        eyebrow={t("PERFIL NECESSÁRIO")}
        text={t("Crie ou selecione um perfil antes de gerar um Reel.")}
        onPage={setPage}
      />
    );
  } else if (page === "brand" || page === "onboarding") {
    content = profile ? <BrandOnboarding key={profile.id + page}
      profile={profile} onboarding={page === "onboarding"}
      onSaved={(next) => { onProfileChange(next, false); setPage("home"); }}
      onAvatar={() => create("avatar")} onSkip={() => setPage("home")}
    /> : <IntermediatePage title={t("Marca")} eyebrow={t("PERFIL NECESSÁRIO")}
      text={t("Crie ou selecione um perfil para preencher a marca.")} onPage={setPage} />;
  } else if (page === "voices" || page === "publish") {
    const settingsPage = {
      voices: { title: t(t("Vozes")), eyebrow: t("NARRAÇÃO"), description: t("Escolha uma voz local ou conecte seu provedor preferido.") },
      publish: { title: t(t("Conexões")), eyebrow: t("PUBLICAÇÃO"), description: t("Conecte seu Instagram e publique somente quando confirmar.") },
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
          {page === "publish" && <PublishSettings jobs={state.jobs} connectionOnly />}
        </div>
      </div>
    );
  } else {
    content = (
      <IntermediatePage
        title={t(t("Ajustes avançados"))}
        eyebrow="RECURSOS EXISTENTES"
        text="O editor completo permanece disponível, com timeline, mídia, transcrição, estilos e os painéis atuais."
        onPage={setPage}
      />
    );
  }

  return (
    <div className="videosell-studio" data-font-scale={fontScale} lang={language}>
      <div className="studio-window-drag" aria-hidden="true" />
      <StudioNav
        page={page}
        onPage={navigate}
        onOpenAdvanced={onOpenAdvanced}
        onProfileChange={onProfileChange}
        avatarSetupRequest={avatarSetupRequest}
        onProfileCreated={(path) => {
          if (path === "avatar") { setCreateMode("avatar"); setReelSession(null); setPage("create"); }
          else setPage("onboarding");
        }}
        fontScale={fontScale}
        onFontScaleChange={changeFontScale}
      />
      <main className="studio-main" id="studio-main-content">
        {content}
      </main>
    </div>
  );
}
