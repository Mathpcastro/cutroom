# Videosell Advanced Editor Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a identidade Palco digital ao editor avançado sem alterar comportamento ou arte renderizada.

**Architecture:** Mapear os tokens legados para os valores canônicos de `src/shared/branding.ts` e adicionar regras visuais escopadas em `.app-shell`. Preservar `applyTheme`, comandos, dimensões estruturais e compatibilidade.

**Tech Stack:** CSS, React/Electron, Playwright, TypeScript/Vite.

---

### Task 1: Contrato visual e tema Palco digital

**Files:**
- Modify: `tools/check-videosell-studio.mjs`
- Modify: `src/themes.css`
- Modify: `src/styles.css`
- Read: `src/shared/branding.ts`

- [ ] **Step 1: Escrever a verificação RED**

Ao abrir `Ajustes avançados`, capturar `.app-shell` e exigir:

```js
const style = await page.locator(".app-shell").evaluate((element) => {
  const root = getComputedStyle(element);
  return {
    background: root.getPropertyValue("--bg").trim(),
    accent: root.getPropertyValue("--accent").trim(),
    font: root.fontFamily,
  };
});
if (style.background.toLowerCase() !== "#f7f6f1" || style.accent.toLowerCase() !== "#6445d8" || !style.font.includes("Inter")) {
  throw new Error(`Advanced editor does not use Palco digital: ${JSON.stringify(style)}`);
}
```

Adicionar capturas reais em 1440 × 1000 e 1050 × 700, retorno ao estúdio e verificação de overflow horizontal.

- [ ] **Step 2: Confirmar RED**

Run: `node tools/check-videosell-studio.mjs --red`
Expected: FAIL porque o editor ainda usa `--bg: #181818`, acento neutro e Segoe UI.

- [ ] **Step 3: Implementar o tema escopado**

Em `src/themes.css`, definir em `.app-shell` os tokens existentes com os valores Palco digital:

```css
.app-shell {
  --bg: #f7f6f1;
  --panel: #ffffff;
  --raised: #efedf5;
  --hover: #e9e3f7;
  --text: #141318;
  --muted: #66636d;
  --line: #dedbd3;
  --line-strong: #b9b1ca;
  --accent: #6445d8;
  --accent-ink: #ffffff;
  --accent-soft: #eee9f7;
  --lime: #c8ff5a;
  color-scheme: light;
  font-family: "Inter", "Segoe UI", sans-serif;
}
```

Em `src/styles.css`, adicionar somente refinamentos de fonte, bordas e cores escopados em `.app-shell`; Sora no wordmark e títulos, sem alterar grid, alturas, player, timeline ou templates.

- [ ] **Step 4: Validar uma vez**

Run: `npm run build && node tools/check-videosell-studio.mjs`
Expected: build PASS, contrato visual PASS, navegação existente PASS, zero console/page errors e nenhum overflow nos dois tamanhos.

- [ ] **Step 5: Revisar capturas e salvar**

Inspecionar os PNGs reais. Se não houver defeito visual, registrar nota 20 e 22 no Obsidian e commitar somente os arquivos desta etapa:

```bash
git add src/themes.css src/styles.css tools/check-videosell-studio.mjs docs/superpowers/plans/2026-11-09-videosell-advanced-editor-theme.md
git commit -m "feat: apply Videosell theme to advanced editor"
```
