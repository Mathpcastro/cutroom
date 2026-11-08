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
