import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FORMATS } from "./formats";

/**
 * The CutRoom video skill for Claude Code (~/.claude/skills) and Codex (~/.codex/skills).
 * Generated from the format recipes so it never drifts from what the app ships.
 */
export const SKILL_NAME = "cutroom-videos";

export function cutroomSkill(version: string) {
  const formats = FORMATS.map((f) => `- \`${f.id}\` — **${f.name}** (${f.aspect}, ${f.length}). ${f.goodFor}`).join("\n");
  return `---
name: ${SKILL_NAME}
description: Produz vídeos curtos (Reels, Shorts, anúncios) feitos em código com o CutRoom — aula com apresentador em pixel art, UI motion do produto, voo 3D pela landing page, história de stickman, "e se…", explainer ilustrado. Use quando o usuário pedir um vídeo, reel, anúncio animado, explainer ou "vídeo pro meu SaaS" e o CutRoom estiver conectado por MCP (ferramentas create_film, film_voiceover, render_film).
---

# Vídeos com o CutRoom (v${version})

O CutRoom precisa estar aberto e conectado como servidor MCP. Tudo roda no computador do usuário: a narração (ElevenLabs, OpenAI ou Kokoro offline), a checagem, os quadros e o render. Nunca peça chaves de API no chat: o usuário cadastra no CutRoom, em Vozes.

## Formatos
${formats}

## Fluxo
1. \`get_brand\` → o que a marca vende, para quem, tom, oferta, cores. Se \`configured:false\`, peça ao usuário para preencher a Marca no CutRoom (ou importar do Carrossell).
2. \`list_formats\` / \`get_format_guide{id}\` → escolha o formato pelo objetivo e leia a receita inteira.
3. Escreva o roteiro falado e mostre ao usuário antes de gerar a voz.
4. \`create_film{name, format}\` → a pasta já vem com o filme inicial do formato (a versão do CutRoom, funcionando), \`CUTROOM.md\` e o kit. Se você tem acesso a arquivos, edite a pasta direto; senão use \`write_film_file\`/\`read_film_file\`.
5. \`film_voiceover{film, text}\` → \`timing.js\` com o tempo de cada palavra e o volume por quadro. Se responder \`status:"generating"\`, chame de novo com o mesmo texto.
6. Adapte \`index.html\`: textos, telas, cores; reancore as cenas com \`CR.at("palavra", n, segundosReserva)\`. Música e efeitos: \`search_music\` → \`film_asset\`. Telas reais do produto: \`film_asset{path}\` ou \`film_capture_page{url}\`.
7. \`film_check\` → \`film_stills\` (5–6 momentos) → \`film_review\` (corrija toda nota abaixo de 8 e toda flag) → \`render_film\` (repita até \`status:"done"\`).
8. Entregue o caminho do MP4 (fica em Vídeos/CutRoom) e a linha de crédito da música CC BY para a legenda do post. Postar no Instagram só com confirmação explícita do usuário.

## O que segura a atenção
- Gancho em imagem nos 3 primeiros segundos; novo plano a cada 1,5–3 s; nada parado mais de 1,5 s.
- Mostre em vez de listar; cada elemento entra até 0,15 s depois da palavra que ele mostra.
- Texto ≤ 6 palavras por card, grande, fora da faixa de baixo (interface do Reels).
- Virada no meio; final com pergunta que divide ou CTA claro. Números só os que o usuário deu.
`;
}

/** Writes the skill for Claude Code and Codex; returns the files written. */
export async function installSkill(home: string, version: string) {
  const content = cutroomSkill(version),
    written: string[] = [];
  for (const base of [join(home, ".claude", "skills"), join(home, ".codex", "skills")]) {
    const dir = join(base, SKILL_NAME),
      file = join(dir, "SKILL.md");
    await mkdir(dir, { recursive: true });
    const current = await readFile(file, "utf8").catch(() => "");
    if (current !== content) {
      await writeFile(`${file}.partial`, content, "utf8");
      await rename(`${file}.partial`, file);
    }
    written.push(file);
  }
  return written;
}
