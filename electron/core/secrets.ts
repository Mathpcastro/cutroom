import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Minimal surface of Electron's safeStorage, so tests can supply a fake. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/**
 * API keys for voices and publishing. Encrypted by the OS keychain (safeStorage) in
 * `<userData>/integrations.json`, outside projects; never sent to the renderer, agents or logs.
 */
export class SecretStore {
  private file: string;
  private unreadableSecrets = false;
  constructor(
    userDir: string,
    private cipher: Cipher,
  ) {
    this.file = join(userDir, "integrations.json");
  }

  private async read(): Promise<Record<string, string>> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }

  async get(name: string): Promise<string | undefined> {
    const value = (await this.read())[name];
    if (!value) return;
    try {
      return this.cipher.decryptString(Buffer.from(value, "base64"));
    } catch {
      this.unreadableSecrets = true;
      await this.markNeedsReentry();
      return; // The OS key store changed: the integration must be entered again.
    }
  }

  hasUnreadableSecrets() {
    return this.unreadableSecrets;
  }

  private async markNeedsReentry() {
    try {
      const markerPath = join(dirname(this.file), ".videosell-migration.json");
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      marker.secretsNeedReentry = true;
      const partial = `${markerPath}.partial`;
      await writeFile(partial, JSON.stringify(marker, null, 2), { mode: 0o600 });
      await rename(partial, markerPath);
    } catch {
      // Missing or unwritable migration markers must not block normal app use.
    }
  }

  async set(name: string, value: string | undefined) {
    if (value && !this.cipher.isEncryptionAvailable())
      throw new Error("O sistema não oferece armazenamento seguro para chaves.");
    const data = await this.read();
    if (value) data[name] = this.cipher.encryptString(value).toString("base64");
    else delete data[name];
    const partial = `${this.file}.partial`;
    await writeFile(partial, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(partial, this.file);
  }

  /** Which keys exist, with only the last 4 characters visible. */
  async describe(names: string[]) {
    const result: Record<string, string | undefined> = {};
    for (const name of names) {
      const value = await this.get(name);
      result[name] = value ? `••••${value.slice(-4)}` : undefined;
    }
    return result;
  }
}
