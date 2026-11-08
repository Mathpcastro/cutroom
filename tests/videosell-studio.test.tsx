import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideosellStudio } from "../src/components/VideosellStudio";
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
      root.render(<StrictMode><VideosellStudio onOpenAdvanced={() => {}} /></StrictMode>);
    });
    await vi.waitFor(() => expect(listProjects).toHaveBeenCalledWith(first.id));

    const select = window.document.querySelector("select")!;
    await act(async () => {
      for (const option of select.querySelectorAll("option")) {
        if (option.getAttribute("value") === second.id) option.setAttribute("selected", "");
        else option.removeAttribute("selected");
      }
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(select.value).toBe(second.id);
      expect(container.textContent).toContain("Nenhum projeto vinculado a este perfil ainda.");
    });

    await act(async () => {
      oldProjects.resolve(["projeto-do-perfil-antigo"]);
      await oldProjects.promise;
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("projeto-do-perfil-antigo");
    expect(container.textContent).toContain("Nenhum projeto vinculado a este perfil ainda.");
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
      root.render(<StrictMode><VideosellStudio onOpenAdvanced={() => {}} /></StrictMode>);
    });

    expect(container.textContent).toContain("Carregando perfil ativo…");
    expect(container.textContent).not.toContain("Nenhum projeto vinculado");

    await act(async () => {
      profiles.resolve([]);
      active.resolve(undefined);
      await Promise.all([profiles.promise, active.promise]);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Nenhum perfil selecionado");
    expect(container.textContent).toContain("Crie ou selecione um perfil para ver os projetos vinculados.");
    expect(container.textContent).not.toContain("Nenhum projeto vinculado");
    expect(listProjects).not.toHaveBeenCalled();
  });
});
