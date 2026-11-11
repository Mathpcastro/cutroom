import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../electron/core/project";
import type { AppSnapshot } from "../src/shared/types";
import { VideosellStudio } from "../src/components/VideosellStudio";
import { planSalesReel } from "../src/components/studio/salesReels";
import { generateSalesReel, initialReelDraft } from "../src/components/studio/ReelCreator";
import type { StudioProfile } from "../src/shared/profile";
import type { CutroomAPI } from "../src/shared/types";

function profile(id: string, name: string): StudioProfile {
  const now = new Date().toISOString();
  return {
    version: 1,
    id,
    name,
    handle: id,
    voice: { provider: "local", voiceId: "local" },
    personality: { description: "", presentation: "" },
    brand: { name, accent: "#000000", ink: "#000000", paper: "#ffffff" },
    instagram: { preferences: {} },
    commercialGoal: "",
    preferences: {},
    createdAt: now,
    updatedAt: now,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const snapshot: AppSnapshot = {
  project: createProject(), connection: { status: "disconnected", models: [] },
  messages: [], jobs: [], packages: [], busy: false, canUndo: false, canRedo: false,
};

describe("VideosellStudio project loading", () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  afterEach(async () => {
    while (roots.length) {
      const root = roots.pop()!;
      await act(async () => root.unmount());
    }
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("accepts a one-scene brief with no headline, sales caption or extra labels", async () => {
    const { window } = parseHTML("<html><body></body></html>");
    Object.assign(globalThis, { window, document: window.document });
    const request = vi.fn(async (method: string) => {
      if (method === "listBrandProofs") return [];
      return { ...snapshot, messages: [{ role: "assistant", text: JSON.stringify({
        title: "Como a caixa chega",
        scenes: [{ narration: "A caixa chega à porta.", visual: "result" }],
      }) }] };
    });
    window.cutroom = { request } as unknown as CutroomAPI;

    const brief = "Mostre uma caixa chegando à porta em um plano só. Sem título na tela ou chamada de venda.";
    const plan = await planSalesReel(profile("teste", "Teste"), brief, false, false, "pt-BR");

    expect(plan.caption).toBe("");
    expect(plan.scenes).toEqual([expect.objectContaining({ headline: "", elements: [], narration: "A caixa chega à porta." })]);
    expect(request).toHaveBeenCalledWith("sendChat", expect.objectContaining({ text: expect.stringContaining(brief) }));
  });

  it("composes the selected visual preset from app input and sends it to the film preview", async () => {
    const { window } = parseHTML("<html><body></body></html>");
    Object.assign(globalThis, { window, document: window.document });
    const motion = [{ shape: { kind: "circle", cx: 200, cy: 500, r: 40 }, fill: "#CCEEFF",
      move: { start: 0, end: 1, x: 300 } }];
    const request = vi.fn(async (method: string, params?: { path?: string; content?: string }) => {
      switch (method) {
        case "listBrandProofs": return [];
        case "sendChat": return { ...snapshot, messages: [{ role: "assistant", text: JSON.stringify({
          title: "Uma gota de chuva",
          scenes: [{ narration: "A gota atravessa a janela.", visual: "result", motion, captions: false }],
        }) }] };
        case "create_film": return { film: "gota", size: "1080x1920" };
        case "write_film_file":
          if (params?.path === "index.html") {
            expect(params.content).toContain("sales-plan");
            expect(params.content).toContain("#CCEEFF");
          }
          return {};
        case "film_voiceover": return { voiceEnd: 3, duration: 3.2 };
        case "film_check": return { errors: [], warnings: [] };
        case "film_stills": return { images: ["frame"], frameTimes: [1], errors: [] };
        case "get_format_guide": return { checklist: [] };
        case "profileLinkProject": return {};
        default: throw new Error(method);
      }
    });
    window.cutroom = { request } as unknown as CutroomAPI;
    const owner = profile("teste", "Teste");

    const session = await generateSalesReel(owner, {
      ...initialReelDraft(owner, false), brief: "Uma gota cruza a janela em um plano. Sem legendas.",
      language: "pt-BR", motionStyle: "kurzgesagt",
    }, vi.fn());

    expect(request).toHaveBeenCalledWith("sendChat", expect.objectContaining({
      text: expect.stringContaining("formas vetoriais"),
    }));
    expect(request).toHaveBeenCalledWith("create_film", expect.objectContaining({ format: "kurzgesagt" }));
    expect(request).toHaveBeenCalledWith("film_stills", expect.objectContaining({ film: "gota" }));
    expect(session.plan?.scenes[0].motion).toEqual(motion);
    expect(session.review?.images).toEqual(["frame"]);
  });

  it("ignores an older profile project response that resolves after the new profile", async () => {
    const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const first = profile("estudio-teste", "Estúdio Teste");
    const second = profile("perfil-alternativo", "Perfil Alternativo");
    const oldProjects = deferred<string[]>();
    const listProjects = vi.fn((profileId: string) =>
      profileId === first.id ? oldProjects.promise : Promise.resolve([]),
    );
    const api = {
      studioProfiles: {
        list: async () => [first, second],
        getActive: async () => first,
        listProjects,
        get: async (profileId: string) => profileId === first.id ? first : second,
        create: async () => first,
        update: async () => first,
        duplicate: async () => first,
        select: async () => {},
        remove: async () => {},
      },
      request: async () => ({ films: [] }),
      onEvent: () => () => {},
      mediaUrl: (path: string) => path,
    } as unknown as CutroomAPI;
    window.cutroom = api;

    const container = window.document.getElementById("root")!;
    const root = createRoot(container as unknown as HTMLElement);
    roots.push(root);
    await act(async () => {
      root.render(<StrictMode><VideosellStudio state={snapshot} run={async () => {}} onOpenAdvanced={() => {}} /></StrictMode>);
    });
    await vi.waitFor(() => expect(listProjects).toHaveBeenCalledWith(first.id));

    const select = window.document.querySelector<HTMLSelectElement>('select[aria-label="Perfil ativo"]')!;
    await act(async () => {
      for (const option of select.querySelectorAll("option")) {
        if (option.getAttribute("value") === second.id) option.setAttribute("selected", "");
        else option.removeAttribute("selected");
      }
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      [...container.querySelectorAll(".studio-nav button")].find((b) => b.textContent?.includes("Meus Reels"))!.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(select.value).toBe(second.id);
      expect(container.textContent).toContain("Você ainda não criou nenhum Reels");
    });

    await act(async () => {
      oldProjects.resolve(["projeto-do-perfil-antigo"]);
      await oldProjects.promise;
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("projeto-do-perfil-antigo");
    expect(container.textContent).toContain("Você ainda não criou nenhum Reels");
  });

  it("distinguishes profile initialization and no-profile from an empty project library", async () => {
    const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const profiles = deferred<StudioProfile[]>();
    const active = deferred<StudioProfile | undefined>();
    const listProjects = vi.fn(() => Promise.resolve([]));
    const api = {
      studioProfiles: {
        list: () => profiles.promise,
        getActive: () => active.promise,
        listProjects,
        get: async () => { throw new Error("not used"); },
        create: async () => { throw new Error("not used"); },
        update: async () => { throw new Error("not used"); },
        duplicate: async () => { throw new Error("not used"); },
        select: async () => {},
        remove: async () => {},
      },
      request: async () => ({ films: [] }),
      onEvent: () => () => {},
      mediaUrl: (path: string) => path,
    } as unknown as CutroomAPI;
    window.cutroom = api;

    const container = window.document.getElementById("root")!;
    const root = createRoot(container as unknown as HTMLElement);
    roots.push(root);
    await act(async () => {
      root.render(<StrictMode><VideosellStudio state={snapshot} run={async () => {}} onOpenAdvanced={() => {}} /></StrictMode>);
    });

    expect(container.textContent).toContain("Carregando perfil ativo…");
    expect(container.textContent).not.toContain("Nenhum projeto vinculado");

    await act(async () => {
      profiles.resolve([]);
      active.resolve(undefined);
      await Promise.all([profiles.promise, active.promise]);
      await Promise.resolve();
    });
    // With no profile, the home is the first-use guide (Spec 4 D).
    expect(container.textContent).toContain("O que você vende?");
    expect(container.textContent).not.toContain("Nenhum projeto vinculado");
    expect(listProjects).not.toHaveBeenCalled();
    const studio = container.querySelector(".videosell-studio")!;
    expect(["light", "dark"]).toContain(studio.getAttribute("data-studio-theme"));
    expect(container.querySelector(".studio-topbar")).toBeTruthy();
    // The theme button cycles Automático → Claro → Escuro.
    const themeButton = container.querySelector(".sidebar-theme") as unknown as HTMLButtonElement;
    await act(async () => { themeButton.click(); });
    await act(async () => { themeButton.click(); });
    expect(studio.getAttribute("data-studio-theme")).toBe("dark");
  });
});
