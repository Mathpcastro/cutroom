import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { CutroomAPI, EditorEvent } from "../src/shared/types";

const api: CutroomAPI = {
  request: (method, params) =>
    ipcRenderer.invoke("editor:request", method, params),
  studioProfiles: {
    list: () => ipcRenderer.invoke("editor:request", "profileList"),
    getActive: () => ipcRenderer.invoke("editor:request", "profileGetActive"),
    listProjects: (profileId) =>
      ipcRenderer.invoke("editor:request", "profileListProjects", { profileId }),
    get: (profileId) =>
      ipcRenderer.invoke("editor:request", "profileGet", { profileId }),
    create: (input) =>
      ipcRenderer.invoke("editor:request", "profileCreate", input),
    update: (profileId, patch) =>
      ipcRenderer.invoke("editor:request", "profileUpdate", { profileId, patch }),
    duplicate: (profileId, input) =>
      ipcRenderer.invoke("editor:request", "profileDuplicate", { profileId, ...input }),
    select: (profileId) =>
      ipcRenderer.invoke("editor:request", "profileSelect", { profileId }),
    remove: (profileId, confirmation) =>
      ipcRenderer.invoke("editor:request", "profileDelete", { profileId, confirmation }),
  },
  avatarCreator: {
    createStarters: (input) =>
      ipcRenderer.invoke("editor:request", "avatarCreatorCreateStarters", input),
    getRevision: (input) =>
      ipcRenderer.invoke("editor:request", "avatarCreatorGetRevision", input),
    getCandidate: (input) =>
      ipcRenderer.invoke("editor:request", "avatarCreatorGetCandidate", input),
    listRevisions: (input) =>
      ipcRenderer.invoke("editor:request", "avatarCreatorListRevisions", input),
    readArtifact: (input) =>
      ipcRenderer.invoke("editor:request", "avatarCreatorReadArtifact", input),
    selectCandidate: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_select_candidate", input),
    render: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_render", input),
    renderJobId: (input) =>
      ipcRenderer.invoke("editor:request", "avatarCreatorRenderJobId", input),
    validate: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_validate", input),
    revisePart: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_revise_part", input),
    review: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_review", input),
    saveRevision: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_save_revision", input),
    cancel: (jobId) =>
      ipcRenderer.invoke("editor:request", "avatar_cancel", { jobId }),
    importReference: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_import_reference", input),
    analyzeReference: (input) =>
      ipcRenderer.invoke("editor:request", "avatar_analyze_reference", input),
  },
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: EditorEvent) =>
      callback(value);
    ipcRenderer.on("editor:event", listener);
    return () => ipcRenderer.removeListener("editor:event", listener);
  },
  mediaUrl: (path) => `cutroom://media?path=${encodeURIComponent(path)}`,
  pathForFile: (file) => webUtils.getPathForFile(file),
};
contextBridge.exposeInMainWorld("cutroom", api);
