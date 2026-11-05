# CutRoom como hub de formatos de vídeo (upsell R$ 97 do Carrossell)

Data: 2026-11-05. Branch: `feat/formatos`.

## Objetivo

Quem compra o Carrossell recebe, na página de obrigado, o CutRoom por R$ 97. No CutRoom a pessoa importa a marca (do Carrossell ou à mão), escolhe um formato de vídeo para divulgar o SaaS dela e gera o vídeo pelo próprio app ou mandando o Claude/Codex controlar o CutRoom pelo MCP. Depois publica como Reels no Instagram.

Formatos de referência: os 10 do guia do @theoxmotion ("how to make viral videos with Claude Code for $0") e os 8 da versão em português da @morgsmariana. Em todos, cada quadro é código, com narração e legenda sincronizadas palavra por palavra.

## O que o CutRoom tem hoje (main, 0.6.2)

- MCP local (`desktop-mcp.ts`) com 7 ferramentas: `get_project`, `edit_project`, `transcribe`, `export_video`, `inspect_frame`, `create_blank_canvas`, `import_media`.
- Cenas HyperFrames: HTML/CSS/SVG + lista declarativa de tweens GSAP, renderizadas no Chrome headless, até 120 s por cena e 100 tweens.
- Transcrição local (Faster Whisper) com tempo por palavra, 24 estilos de legenda, exportação H.264/AAC.

## O que impede os formatos hoje

| Limite | Onde | Impacto |
|---|---|---|
| Canvas fixo 1920x1080 | `main.ts` (`create_blank_canvas`), `project.ts` | Reels precisam de 1080x1920 |
| Só o áudio dos clipes | `media.ts` `exportProject` | Sem faixa de narração, música e efeitos sonoros |
| `export_video` abre a janela de salvar | `main.ts` | O agente não termina o vídeo sozinho |
| 100 tweens por cena, só a fonte Barlow, sem imagem | `motion-definition.ts`, `motion-document.ts` | Reel de 45–60 s com cards na palavra falada passa de 100 tweens; logo e fontes da marca não entram |
| Sem marca no projeto | — | Cada vídeo começaria do zero |
| Sem voz sintetizada | — | Os formatos são narrados |

## Fase 1 — motor dos formatos (este branch)

1. **Vertical e tamanhos:** `create_project{aspect: "9:16"|"16:9"|"1:1"|"4:5", duration, background}` cria o canvas no tamanho certo; `create_blank_canvas` aceita `width/height`. Cenas desenhadas em 1080 de largura no vertical.
2. **Faixas de áudio:** `project.audio[] = {id, kind: "voice"|"music"|"sfx", path, start, gain, duck?}`. Exportação mistura com `amix` + `asetpts=N/SR/TB` e abaixa a música sob a voz (`sidechaincompress`). Prévia no player.
3. **Voz (provedores):** ElevenLabs por chave de API (com tempo por caractere → palavras), OpenAI TTS por chave, e voz local leve (pacote opcional). Quando o provedor não dá o tempo, a transcrição local alinha. Ferramentas: `list_voices`, `add_voiceover{text, voice, provider}` → faixa de voz + palavras no projeto.
4. **Música e efeitos:** busca no archive.org filtrando CC0/domínio público pela API sem chave (`search_music{query, mood, bpm?}`, `add_music{id|path}`), mais um pacote pequeno de efeitos sonoros CC0 embutido. Cada faixa guarda origem e licença.
5. **Cenas mais ricas:** limite de tweens maior (ex.: 800), fontes offline da legenda também nas cenas, imagens só como `data:` (logo e prints do SaaS importados pelo app), sem rede.
6. **Marca no projeto:** `brand.json` na pasta de dados (nome, o que vende, público, tom, cores, fontes, logo, link). `get_brand` no MCP; as cenas e legendas usam as cores e fontes da marca.
7. **Formatos:** cada formato = guia para o agente (roteiro, ritmo, estrutura de cenas, regras de qualidade) + kit de cenas (componentes SVG/HTML parametrizados) + receita de exportação. Ferramentas: `list_formats`, `get_format_guide{id}`, `start_format{id, topic}`.
   Lançamento: **explainer com professor** (cards na palavra falada), **UI motion** (uma forma vira 8–12 telas com cursor, 120 BPM), **2D "e se"** (boneco de palito em SVG), **explainer estilo Kurzgesagt** (SVG, sem WebGL). Os formatos são nossos, inspirados nos dos artigos, sem copiar prompts ou repositórios de terceiros.
8. **Fechar o vídeo sem janela:** `export_video{path?}` exporta direto para `Vídeos/CutRoom/` quando chamado pelo agente; `render_preview{time}` devolve um quadro renderizado (não só da fonte) para o agente conferir.
9. **Avaliador:** `review_video` devolve quadros-chave + transcrição + checklist do formato para o agente se avaliar antes de entregar, como os autores fazem com o "avaliador às cegas".

Critério de pronto da fase 1: o Claude Code e o Codex, numa pasta vazia, geram cada um dos 4 formatos pelo MCP, do roteiro ao MP4 9:16 narrado, sem tocar no app; cada vídeo é assistido e conferido (quadros, áudio, sincronia).

## Fase 2 — onboarding

Primeira abertura: (1) marca — "Importar do Carrossell" (CLI `carrossell marca --perfil`, JSON com contexto e Design Kit) ou "Preencher à mão" (link do site ou descrição, logo, cores, fontes, tom, público; a IA conectada monta o contexto); (2) objetivo (divulgar SaaS, vender consultoria, outro); (3) formato com prévia; (4) gerar no app ou copiar a instrução para o Claude/Codex.

## Fase 3 — publicar Reels

Composio direto no CutRoom (chave do PROJETO, cifrada com `safeStorage`), com opção "Importar a conta do Carrossell" (ler a chave/conta que o Carrossell já tem, com permissão). Fluxo: `INSTAGRAM_POST_IG_USER_MEDIA{media_type: REELS, video_file, caption, share_to_feed, cover_url|thumb_offset}` → esperar `status_code: FINISHED` → `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`. Postar sempre com confirmação. Agendamento como no Carrossell (tarefa do sistema).

## Fase 4 — página de upsell e curso

Página de obrigado do Carrossell com o upsell da Cakto: vídeos dos cases dos artigos ao lado da nossa versão de cada formato feita no CutRoom. Copy na linha "carrossel com IA já vende SaaS; com vídeo vende mais" (a alinhar). Aulas novas no curso: formatos, onboarding, publicar.

## Distribuição

Instaladores em `Mathpcastro/cutroom-releases` (público, só releases), link só na área de membros. O repo `cutroom` fica público por enquanto para não quebrar os links do curso; o PR #9 aponta o atualizador para o repo novo.
