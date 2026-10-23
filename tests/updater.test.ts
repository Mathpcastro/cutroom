import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  UpdateController,
  type UpdateControllerOptions,
} from "../electron/core/updater";

class FakeUpdateClient extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
}

function setup(overrides: Partial<UpdateControllerOptions> = {}) {
  const client = new FakeUpdateClient();
  const dialogs = {
    offer: vi.fn(async (_version: string) => 1),
    ready: vi.fn(async () => 1),
    downloadFailed: vi.fn(async (_message: string) => undefined),
  };
  const logger = { error: vi.fn() };
  const options: UpdateControllerOptions = {
    client,
    dialogs,
    isPackaged: true,
    platform: "win32",
    isWindowAlive: () => true,
    logger,
    ...overrides,
  };
  return { client, dialogs, logger, controller: new UpdateController(options) };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Windows app updates", () => {
  it("only checks packaged Windows builds", () => {
    const unpacked = setup({ isPackaged: false });
    unpacked.controller.start();
    const mac = setup({ platform: "darwin" });
    mac.controller.start();

    expect(unpacked.client.checkForUpdates).not.toHaveBeenCalled();
    expect(mac.client.checkForUpdates).not.toHaveBeenCalled();
  });

  it("checks once and never downloads automatically", () => {
    const { client, controller } = setup();
    controller.start();

    expect(client.autoDownload).toBe(false);
    expect(client.autoInstallOnAppQuit).toBe(true);
    expect(client.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(client.downloadUpdate).not.toHaveBeenCalled();
  });

  it("does nothing visible when no update is available", async () => {
    const { dialogs, controller } = setup();
    controller.start();
    await flush();

    expect(dialogs.offer).not.toHaveBeenCalled();
    expect(dialogs.ready).not.toHaveBeenCalled();
  });

  it("declining the offer does not download", async () => {
    const { client, dialogs, controller } = setup();
    controller.start();
    client.emit("update-available", { version: "0.7.0" });

    await vi.waitFor(() => expect(dialogs.offer).toHaveBeenCalledWith("0.7.0"));
    await flush();
    expect(client.downloadUpdate).not.toHaveBeenCalled();
  });

  it("accepting starts one download even for duplicate events", async () => {
    const { client, dialogs, controller } = setup();
    dialogs.offer.mockResolvedValue(0);
    controller.start();
    client.emit("update-available", { version: "0.7.0" });
    client.emit("update-available", { version: "0.7.0" });

    await vi.waitFor(() => expect(client.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(dialogs.offer).toHaveBeenCalledTimes(1);
  });

  it("restart now installs silently and reopens the app", async () => {
    const { client, dialogs, controller } = setup();
    dialogs.offer.mockResolvedValue(0);
    dialogs.ready.mockResolvedValue(0);
    controller.start();
    client.emit("update-available", { version: "0.7.0" });
    await vi.waitFor(() => expect(client.downloadUpdate).toHaveBeenCalled());
    client.emit("update-downloaded");

    await vi.waitFor(() =>
      expect(client.quitAndInstall).toHaveBeenCalledWith(true, true),
    );
  });

  it("later leaves installation to app quit", async () => {
    const { client, dialogs, controller } = setup();
    dialogs.offer.mockResolvedValue(0);
    dialogs.ready.mockResolvedValue(1);
    controller.start();
    client.emit("update-available", { version: "0.7.0" });
    await vi.waitFor(() => expect(client.downloadUpdate).toHaveBeenCalled());
    client.emit("update-downloaded");

    await vi.waitFor(() => expect(dialogs.ready).toHaveBeenCalled());
    await flush();
    expect(client.quitAndInstall).not.toHaveBeenCalled();
    expect(client.autoInstallOnAppQuit).toBe(true);
  });

  it("check failures stay silent and do not reject startup", async () => {
    const { client, dialogs, logger, controller } = setup();
    client.checkForUpdates.mockRejectedValue(new Error("offline"));
    controller.start();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(dialogs.offer).not.toHaveBeenCalled();
    expect(dialogs.downloadFailed).not.toHaveBeenCalled();
  });

  it("download failure logs and warns once", async () => {
    const { client, dialogs, logger, controller } = setup();
    dialogs.offer.mockResolvedValue(0);
    client.downloadUpdate.mockRejectedValue(new Error("disk full"));
    controller.start();
    client.emit("update-available", { version: "0.7.0" });

    await vi.waitFor(() =>
      expect(dialogs.downloadFailed).toHaveBeenCalledWith("disk full"),
    );
    expect(logger.error).toHaveBeenCalled();
    expect(dialogs.downloadFailed).toHaveBeenCalledTimes(1);
  });

  it("does not prompt or download after the window is gone", async () => {
    const { client, dialogs, controller } = setup({ isWindowAlive: () => false });
    controller.start();
    client.emit("update-available", { version: "0.7.0" });
    await flush();

    expect(dialogs.offer).not.toHaveBeenCalled();
    expect(client.downloadUpdate).not.toHaveBeenCalled();
  });
});
