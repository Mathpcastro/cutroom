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
description: Produz vídeos curtos (Reels, Shorts, anúncios) feitos em código com o CutRoom — aula com apresentador em pixel art, UI motion do produto, voo 3D pela landing page, histórias em episódios, "e se…", motion UI explicativo sem avatar. Use quando o usuário pedir um vídeo, reel, anúncio animado, explainer ou "vídeo pro meu SaaS" e o CutRoom estiver conectado por MCP (ferramentas create_film, film_voiceover, render_film).
---

# Vídeos com o CutRoom (v${version})

O CutRoom precisa estar aberto e conectado como servidor MCP. Tudo roda no computador do usuário: a narração (ElevenLabs, OpenAI ou Kokoro offline), a checagem, os quadros e o render. Nunca peça chaves de API no chat: o usuário cadastra no CutRoom, em Vozes.

## Formatos
${formats}

## Fluxo
1. \`get_brand\` → o que a marca vende, para quem, tom, oferta, cores. Se \`configured:false\`, peça ao usuário para preencher a Marca no CutRoom (ou importar do Carrossell).
2. \`list_formats\` / \`get_format_guide{id}\` → leia o guia escolhido. Use os presets para arte e movimento. O briefing define roteiro, cenas, duração e desfecho.
3. Escreva o roteiro falado e mostre ao usuário antes de gerar a voz.
4. \`create_film{name, format}\` → a pasta vem com uma composição inicial, \`CUTROOM.md\` e o kit. Se você tem acesso a arquivos, edite a pasta direto; senão use \`write_film_file\`/\`read_film_file\`.
5. \`film_voiceover{film, text}\` → \`timing.js\` com o tempo de cada palavra e o volume por quadro. Se responder \`status:"generating"\`, chame de novo com o mesmo texto.
6. Monte o filme em \`index.html\` e sincronize as cenas com \`CR.at("palavra", n, segundosReserva)\`. Música e efeitos: \`search_music\` → \`film_asset\`. Telas reais do produto: \`film_asset{path}\` ou \`film_capture_page{url}\`. Efeitos prontos (legendas cinéticas, transições, cursores, notificações): \`list_effects{query}\` → \`film_add_effect{film, name}\`. Acabamento: \`CRM.post(tl, D, {leaks})\` em todo filme.
7. \`film_check\` → \`film_stills\` (5–6 momentos) → \`film_review\` (compare os quadros e as métricas com o pedido) → \`render_film\` (repita até \`status:"done"\`).
8. Entregue o caminho do MP4 (fica em Vídeos/CutRoom) e a linha de crédito da música CC BY para a legenda do post. Postar no Instagram só com confirmação explícita do usuário: \`publish_reel\` (agora) ou \`schedule_reels_daily\` (piloto automático, um Reels por dia).

## O que segura a atenção
- Dê foco visual à abertura e mantenha o ritmo de planos pedido.
- Mostre em vez de listar; cada elemento entra até 0,15 s depois da palavra que ele mostra.
- Texto ≤ 6 palavras por card, grande, fora da faixa de baixo (interface do Reels).
- Use virada, pergunta ou CTA quando o pedido comportar. Números precisam de base.

## Funil orgânico (sem tráfego pago)
Reels (alcance) → visita no perfil → clique no link → venda; os carrosséis do Carrossell fazem o meio (confiança). Quando o pedido for um Reel de venda com CTA de perfil, feche com "link no perfil" falado e na tela (\`CR.profileCTA\`), uma ação só. Legenda: gancho repetido + 2–3 linhas de valor + "👉 link no perfil" + crédito da música. Cadência: 1 Reels por dia no mesmo horário + 1 carrossel por dia.
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
