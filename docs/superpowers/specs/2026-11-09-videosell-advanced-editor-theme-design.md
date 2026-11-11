# Editor avançado com identidade Videosell

## Objetivo

Unificar visualmente o editor avançado ao estúdio Videosell sem alterar edição, timeline, comandos, projetos ou arte renderizada.

## Abordagem aprovada

Aplicar a identidade Palco digital ao chrome do editor por tokens e regras visuais escopadas em `.app-shell`. Preservar o catálogo de temas e as preferências antigas para compatibilidade; não remover temas nem migrar formatos de projeto nesta etapa.

## Design

- Fundo principal `#F7F6F1`, painéis brancos e texto `#141318`.
- Ações primárias e foco em violeta `#7C5CFF`/`#6445D8`; seleção e detalhes em lima `#C8FF5A` quando houver contraste adequado.
- Inter no chrome e Sora no wordmark/títulos; monoespaçada somente em tempos, código e valores técnicos.
- Bordas suaves e raios discretos, sem alterar dimensões estruturais da timeline, player ou drawers.
- Header, assistente, workspace, timeline, menus, modais e statusbar compartilham a mesma linguagem do estúdio.
- O botão **Voltar ao estúdio** permanece visível e a alternância entre superfícies não recarrega o renderer.

## Limites

- Não alterar IPC, serviços, comandos, estado, templates de vídeo, legendas ASS, overlays ou cores escolhidas pelo usuário.
- Não alterar os quatro arquivos protegidos nem publicar release.
- Não modificar a lógica de `applyTheme`; a preferência persistida continua válida. A aparência Videosell será o tratamento visual do editor avançado.

## Verificação

Estender somente `tools/check-videosell-studio.mjs` para capturar o editor em 1440 × 1000 e 1050 × 700 e verificar tokens/famílias tipográficas computados, retorno ao estúdio, ausência de overflow horizontal e erros de console. Executar uma validação RED e uma final focada com build. Revisar as capturas reais antes de registrar o resultado no Obsidian.
