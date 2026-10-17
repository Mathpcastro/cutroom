import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { CutroomAPI, EditorEvent } from "../src/shared/types";

const api: CutroomAPI = {
  request: (method, params) =>
    ipcRenderer.invoke("editor:request", method, params),
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
