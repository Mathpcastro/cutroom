# Windows Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao CutRoom para Windows um fluxo de atualização pelo GitHub Releases que pede consentimento antes do download e permite reiniciar imediatamente ou instalar ao fechar.

**Architecture:** Um controlador em `electron/core/updater.ts` concentrará o estado da oferta, download e instalação, com interfaces injetáveis para testes. Um adaptador no mesmo módulo ligará esse controlador ao `electron-updater` e aos diálogos nativos; `electron/main.ts` apenas o iniciará depois de carregar a janela principal.

**Tech Stack:** Electron 44, TypeScript, `electron-updater` 6.8.9, electron-builder 26, NSIS, GitHub Releases, Vitest e GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-windows-auto-update-design.md`

**Isolation:** Executar tudo em `.worktrees/feat-windows-auto-update`, branch `feat/windows-auto-update`. Não editar `website/` nem o clone principal.

---

## Mapa de arquivos

- Criar `electron/core/updater.ts`: estado do fluxo, interfaces do cliente, diálogos nativos e adaptador do `electron-updater`.
- Criar `tests/updater.test.ts`: testes do consentimento, concorrência, erros, plataforma e instalação.
- Modificar `electron/main.ts`: inicialização única após a janela ser carregada.
- Modificar `package.json` e `package-lock.json`: dependência de runtime e provedor GitHub do electron-builder.
- Modificar `.github/workflows/check.yml`: incluir metadados e blockmap no artefato Windows.
- Criar `docs/auto-update.md`: comportamento, limites e procedimento de publicação.
- Modificar `README.md` e `docs/releases/v0.6.1.md`: substituir a afirmação de que não há atualização automática e documentar a migração única.

### Task 1: Restabelecer e validar a base isolada

**Files:**

- Nenhum arquivo versionado.

- [ ] **Step 1: Confirmar a branch e o ponto de partida**

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Expected: branch `feat/windows-auto-update`, commit da especificação presente, nenhuma alteração fora de `artifacts/` ignorado. O commit-base é `1055c37`, que contém a v0.6.1.

- [ ] **Step 2: Diagnosticar o `npm ci` interrompido com saída visível**

O log anterior termina durante `reify`, depois do audit e sem um erro npm. Isso comprova interrupção incompleta, não uma dependência quebrada. Executar com scripts visíveis e sem repetir o audit de rede:

```bash
npm ci --no-audit --no-fund --foreground-scripts
```

Expected: instalação concluída e scripts de Electron/dependências executados. Se o limite do executor for atingido novamente, capturar a última etapa exibida antes de qualquer mudança; não contornar o problema apagando testes ou usando outra versão das dependências.

- [ ] **Step 3: Verificar a árvore instalada**

Run:

```bash
npm ls --depth=0
```

Expected: exit code 0, sem pacotes `invalid`, `missing` ou `extraneous`.

- [ ] **Step 4: Rodar os testes de base**

Run:

```bash
npm test
```

Expected: todos os testes existentes passam antes das mudanças. Se houver falha, registrá-la como problema de base e não iniciar a implementação até distingui-la de uma regressão da branch.

- [ ] **Step 5: Rodar o build de base**

Run:

```bash
npm run build
```

Expected: TypeScript e electron-vite concluem sem erro.

### Task 2: Configurar dependência e publicação GitHub

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Instalar a versão fixa do atualizador**

Run:

```bash
npm install --save-exact electron-updater@6.8.9
```

Expected: `dependencies` contém `"electron-updater": "6.8.9"`; o lockfile mantém as demais versões do projeto.

- [ ] **Step 2: Adicionar o provedor de release**

Em `package.json`, dentro de `build`, imediatamente depois de `directories`, adicionar:

```json
    "publish": [
      {
        "provider": "github",
        "owner": "Mathpcastro",
        "repo": "cutroom",
        "releaseType": "release"
      }
    ],
```

O resultado desse trecho deve ser:

```json
    "directories": {
      "output": "release"
    },
    "publish": [
      {
        "provider": "github",
        "owner": "Mathpcastro",
        "repo": "cutroom",
        "releaseType": "release"
      }
    ],
    "files": [
```

- [ ] **Step 3: Conferir a configuração sem gerar release**

Run:

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; const p=JSON.parse(readFileSync('package.json','utf8')); if(p.dependencies['electron-updater']!=='6.8.9') throw new Error('dependency'); const pub=p.build.publish[0]; if(pub.provider!=='github'||pub.owner!=='Mathpcastro'||pub.repo!=='cutroom'||pub.releaseType!=='release') throw new Error('publish'); console.log('updater and publish config OK');"
git diff --check
```

Expected: `updater and publish config OK` e nenhum erro de whitespace.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: configure GitHub app updates"
```

### Task 3: Implementar o fluxo de consentimento com TDD

**Files:**

- Create: `tests/updater.test.ts`
- Create: `electron/core/updater.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/updater.test.ts` com:

```ts
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

    await vi.waitFor(() =>
      expect(client.downloadUpdate).toHaveBeenCalledTimes(1),
    );
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
    const { client, dialogs, controller } = setup({
      isWindowAlive: () => false,
    });
    controller.start();
    client.emit("update-available", { version: "0.7.0" });
    await flush();

    expect(dialogs.offer).not.toHaveBeenCalled();
    expect(client.downloadUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar a falha esperada**

Run:

```bash
npx vitest run tests/updater.test.ts
```

Expected: FAIL porque `../electron/core/updater` ainda não existe.

- [ ] **Step 3: Implementar o controlador e o adaptador**

Criar `electron/core/updater.ts` com:

```ts
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
```

- [ ] **Step 4: Rodar os testes do controlador**

Run:

```bash
npx vitest run tests/updater.test.ts
```

Expected: os 10 testes passam, sem promessas rejeitadas não tratadas.

- [ ] **Step 5: Rodar a suíte completa e commit**

```bash
npm test
git add electron/core/updater.ts tests/updater.test.ts
git commit -m "feat: add consented Windows app updates"
```

Expected: toda a suíte passa antes do commit.

### Task 4: Ligar o atualizador ao ciclo de vida do app

**Files:**

- Modify: `electron/main.ts:55-60`
- Modify: `electron/main.ts:1264-1268`

- [ ] **Step 1: Importar o inicializador**

Depois do bloco de import de `chat-command-effects`, adicionar:

```ts
import { startWindowsAutoUpdate } from "./core/updater";
```

- [ ] **Step 2: Iniciar somente depois da janela carregar**

Imediatamente depois deste bloco existente:

```ts
if (process.env.ELECTRON_RENDERER_URL)
  await window.loadURL(process.env.ELECTRON_RENDERER_URL);
else await window.loadFile(join(here, "../dist/index.html"));
```

adicionar:

```ts
startWindowsAutoUpdate(window);
```

Não adicionar IPC, handler no renderer ou timer.

- [ ] **Step 3: Verificar compilação e testes**

```bash
npm run build
npm test
```

Expected: build e todos os testes passam; o bundle principal referencia `electron-updater`, que permanece externalizado pelo `externalizeDepsPlugin` e empacotado como dependência de produção.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: check for updates when Windows app opens"
```

### Task 5: Publicar artefatos e documentar a migração

**Files:**

- Modify: `.github/workflows/check.yml:24-28`
- Create: `docs/auto-update.md`
- Modify: `README.md:164-175`
- Modify: `docs/releases/v0.6.1.md:1-12`

- [ ] **Step 1: Incluir os arquivos obrigatórios no artefato do workflow**

Substituir o último `with` por:

```yaml
with:
  name: cutroom-windows-x64
  if-no-files-found: error
  path: |
    release/*.exe
    release/*.exe.blockmap
    release/latest.yml
```

- [ ] **Step 2: Criar o guia de atualização e release**

Criar `docs/auto-update.md` com:

```markdown
# Atualização automática no Windows

Nas versões do CutRoom que incluem o atualizador, o app consulta os releases estáveis do GitHub ao abrir. Nenhum pacote é baixado sem autorização. O usuário pode adiar a oferta, reiniciar para instalar depois do download ou deixar a instalação para quando fechar o app.

A consulta usa apenas os arquivos públicos de `Mathpcastro/cutroom`. Não envia projetos, mídias, chaves, identificadores ou telemetria. Falhas de rede não impedem o uso do editor.

## Migração única

Versões anteriores ao atualizador não conseguem descobrir nem instalar esse recurso sozinhas. Quem as utiliza precisa instalar manualmente a primeira versão com atualização automática. Depois disso, as versões seguintes usam o fluxo dentro do app.

O macOS continua fora desse fluxo. O app ainda não possui assinatura de código; integridade do pacote e assinatura de código são proteções diferentes, e o SmartScreen pode continuar exibindo aviso.

## Publicar uma atualização Windows

1. Atualize a versão e as notas de release e gere o instalador com `npm run dist`. Mantenha juntos o `.exe`, o `.exe.blockmap` correspondente e `latest.yml` produzidos em `release/`; calcule o SHA-256 do instalador e grave `SHA256SUMS.txt` segundo o procedimento já usado pelo projeto.
2. Crie o release como rascunho e envie todos esses arquivos antes de publicá-lo. Não substitua `latest.yml` por um arquivo escrito manualmente.
3. Publique como release estável, não como prerelease. O `latest.yml` precisa apontar para o mesmo instalador e a mesma versão anexados.
4. Aguarde o workflow de macOS terminar antes de considerar o release completo; ele acrescenta os DMGs e suas entradas ao `SHA256SUMS.txt`.
5. Confira se o release contém EXE, blockmap, `latest.yml`, os dois DMGs e o checksum consolidado.

Para uma atualização já publicada, os clientes novos baixam o instalador pela página do release. Os clientes com atualizador leem `latest.yml`, verificam a versão e baixam pelo GitHub depois do consentimento. O blockmap permite baixar somente as partes alteradas quando a atualização diferencial estiver disponível.

## Verificação real obrigatória

Antes de anunciar o fluxo como validado de ponta a ponta, instale uma versão descartável com o atualizador, publique uma versão de teste posterior em um repositório de teste e confirme: oferta, recusa sem download, aceite, download, reinício, versão resultante e preservação dos dados do usuário. Testes unitários e geração de artefatos não substituem essa verificação.
```

- [ ] **Step 3: Atualizar a afirmação no README**

Substituir `Não há atualização automática nesta prévia. Feche o CutRoom antes de instalar uma nova versão.` por:

```markdown
No Windows, as versões que já incluem o atualizador avisam quando há uma novidade e só baixam com sua autorização. Você pode reiniciar para instalar ou deixar para fechar o app. A primeira versão com esse recurso precisa ser instalada manualmente; o macOS continua sem atualização automática. [Como funcionam as atualizações](docs/auto-update.md).
```

- [ ] **Step 4: Atualizar as notas da v0.6.1 sem inventar validação**

Substituir o penúltimo parágrafo de `docs/releases/v0.6.1.md` por:

```markdown
O editor continua gratuito; limites e custos dos modelos seguem sua conta. No Windows, esta versão inclui verificação de atualizações pelo GitHub Releases, com consentimento antes do download e instalação ao reiniciar ou fechar. Quem vem de uma versão anterior precisa instalar esta versão manualmente uma última vez. A prévia do macOS continua sem atualização automática e os instaladores continuam sem assinatura digital.
```

Não alterar os números da seção `Validação` nesse passo; os resultados novos só serão acrescentados depois de executados.

- [ ] **Step 5: Validar YAML, links internos e diff**

Run:

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; const text=readFileSync('.github/workflows/check.yml','utf8'); for (const item of ['release/*.exe','release/*.exe.blockmap','release/latest.yml','if-no-files-found: error']) if(!text.includes(item)) throw new Error(item); console.log('workflow artifacts OK');"
git diff --check
git diff --stat main...HEAD
```

Expected: `workflow artifacts OK`, nenhum erro de whitespace e nenhum arquivo de `website/` no diff.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/check.yml docs/auto-update.md README.md docs/releases/v0.6.1.md
git commit -m "docs: document Windows update releases"
```

### Task 6: Verificar o pacote e preparar a entrega

**Files:**

- Modify somente se uma verificação revelar um defeito no escopo: arquivos das Tasks 2–5.

- [ ] **Step 1: Rodar formatação somente nos arquivos tocados**

```bash
npx prettier --check electron/core/updater.ts electron/main.ts tests/updater.test.ts package.json .github/workflows/check.yml docs/auto-update.md docs/releases/v0.6.1.md README.md docs/superpowers/specs/2026-10-23-windows-auto-update-design.md docs/superpowers/plans/2026-10-23-windows-auto-update.md
```

Expected: todos os arquivos formatados. Se necessário, rodar `npx prettier --write` com a mesma lista explícita, revisar o diff e commitar apenas essas correções.

- [ ] **Step 2: Rodar a validação completa**

```bash
npm test
npm run build
```

Expected: toda a suíte e o build passam. Registrar quantidade real de testes e duração observada, sem reutilizar números antigos.

- [ ] **Step 3: Gerar o instalador Windows**

```bash
npm run dist
```

Expected: electron-builder conclui sem publicar nada e gera instalador, metadados e blockmap em `release/`.

- [ ] **Step 4: Verificar os artefatos e metadados**

```bash
node --input-type=module -e "import { existsSync, readFileSync } from 'node:fs'; const version=JSON.parse(readFileSync('package.json','utf8')).version; const exe='release/CutRoom.Setup.'+version+'.exe'; const files=[exe,exe+'.blockmap','release/latest.yml']; for(const file of files){if(!existsSync(file))throw new Error('missing '+file);console.log(file)} const latest=readFileSync('release/latest.yml','utf8'); if(!latest.includes('version: '+version)||!latest.includes('sha512:'))throw new Error('invalid latest.yml'); console.log('latest.yml metadata OK');"
```

Expected: os três caminhos existem e `latest.yml` contém a versão do pacote e hash `sha512`.

- [ ] **Step 5: Revisar escopo e segurança do diff**

```bash
git status --short --branch
git diff --check main...HEAD
git diff --name-only main...HEAD
git diff main...HEAD -- package.json electron/main.ts electron/core/updater.ts .github/workflows/check.yml
```

Expected: worktree limpa; somente arquivos previstos; `website/` ausente; `autoDownload = false`; nenhuma alteração em `webPreferences`; nenhum segredo ou endpoint além do repositório público.

- [ ] **Step 6: Commitar o plano executado e registrar a validação pendente**

Se os checkboxes do plano forem marcados durante a execução, commitar somente essa mudança:

```bash
git add docs/superpowers/plans/2026-10-23-windows-auto-update.md
git commit -m "docs: record Windows updater implementation"
```

A entrega deve separar explicitamente:

- validado: testes, build e artefatos efetivamente gerados;
- não validado: atualização real entre duas versões publicadas, até que o teste descartável de ponta a ponta seja executado;
- migração: usuários de versões sem atualizador instalam a primeira versão com o recurso manualmente.
