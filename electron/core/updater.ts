import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";

export interface UpdateClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(
    event: "update-available",
    listener: (info: { version: string }) => void,
  ): this;
  on(event: "update-downloaded", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
}

export interface UpdateDialogs {
  offer(version: string): Promise<number>;
  ready(): Promise<number>;
  downloadFailed(message: string): Promise<void>;
}

export interface UpdateControllerOptions {
  client: UpdateClient;
  dialogs: UpdateDialogs;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  isWindowAlive(): boolean;
  logger: Pick<Console, "error">;
}

export class UpdateController {
  private offered = false;
  private downloading = false;
  private downloaded = false;

  constructor(private readonly options: UpdateControllerOptions) {}

  start(): void {
    const { client, isPackaged, platform } = this.options;
    if (!isPackaged || platform !== "win32") return;

    client.autoDownload = false;
    client.autoInstallOnAppQuit = true;
    client.on("update-available", (info) => {
      void this.offer(info.version).catch((error) =>
        this.log("Falha ao oferecer atualização do CutRoom:", error),
      );
    });
    client.on("update-downloaded", () => {
      void this.ready().catch((error) =>
        this.log("Falha ao concluir atualização do CutRoom:", error),
      );
    });
    client.on("error", (error) =>
      this.log("Falha no atualizador do CutRoom:", error),
    );
    void client
      .checkForUpdates()
      .catch((error) =>
        this.log("Falha ao verificar atualizações do CutRoom:", error),
      );
  }

  private async offer(version: string): Promise<void> {
    if (
      this.offered ||
      this.downloading ||
      this.downloaded ||
      !this.options.isWindowAlive()
    )
      return;

    this.offered = true;
    const response = await this.options.dialogs.offer(version);
    if (response !== 0 || !this.options.isWindowAlive()) return;

    this.downloading = true;
    try {
      await this.options.client.downloadUpdate();
    } catch (error) {
      this.downloading = false;
      this.log("Falha ao baixar atualização do CutRoom:", error);
      if (this.options.isWindowAlive()) {
        await this.options.dialogs.downloadFailed(errorMessage(error));
      }
    }
  }

  private async ready(): Promise<void> {
    if (this.downloaded || !this.options.isWindowAlive()) return;
    this.downloaded = true;
    const response = await this.options.dialogs.ready();
    if (response === 0 && this.options.isWindowAlive()) {
      this.options.client.quitAndInstall(true, true);
    }
  }

  private log(message: string, error: unknown): void {
    this.options.logger.error(message, error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startWindowsAutoUpdate(window: BrowserWindow): void {
  const isWindowAlive = () => !window.isDestroyed();
  const dialogs: UpdateDialogs = {
    async offer(version) {
      const { response } = await dialog.showMessageBox(window, {
        type: "info",
        buttons: ["Baixar agora", "Depois"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: "Atualização disponível",
        message: `O CutRoom ${version} está disponível.`,
        detail: "Deseja baixar a atualização em segundo plano?",
      });
      return response;
    },
    async ready() {
      const { response } = await dialog.showMessageBox(window, {
        type: "info",
        buttons: ["Reiniciar agora", "Ao fechar"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: "Atualização pronta",
        message: "A nova versão do CutRoom foi baixada.",
        detail: "Reinicie agora para instalar ou instale ao fechar o app.",
      });
      return response;
    },
    async downloadFailed(message) {
      await dialog.showMessageBox(window, {
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        noLink: true,
        title: "Falha na atualização",
        message: "Não foi possível baixar a atualização do CutRoom.",
        detail: `${message}\n\nVocê pode continuar usando o editor e tentar novamente na próxima abertura.`,
      });
    },
  };

  new UpdateController({
    client: autoUpdater,
    dialogs,
    isPackaged: app.isPackaged,
    platform: process.platform,
    isWindowAlive,
    logger: console,
  }).start();
}
