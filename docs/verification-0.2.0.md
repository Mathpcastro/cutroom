# Verificação do CutRoom 0.2.0

18 de outubro de 2026. Windows x64.

- `npm test`: 39 testes aprovados em cinco arquivos, incluindo transporte Codex, cancelamento, persistência, edição, FFmpeg e legendas.
- `npm run build`: TypeScript, Electron, preload, renderer, workers, WASM e fontes aprovados.
- `npm audit --omit=dev`: zero vulnerabilidades reportadas no momento do teste.
- `node tools/check-usability.mjs --ai`: dez verificações reais no Electron, sem erros de renderer. Incluiu primeira abertura e persistência da orientação, navegação para Pacotes, pré-requisito ausente, pausa sem ASR, remoção de muleta temporizada, repetição sem cortes, seleção por teclado, catálogo real do Codex, atividade ao vivo e falha posterior sem herdar confirmação antiga.
- Reprodução real com 12 interações rápidas entre play, pausa e busca, passagem por corte e troca de arquivo fonte: sem o erro de interrupção de `play()`.
- `node tools/check-caption-preview.mjs`: JASSUB, worker e WASM empacotados carregaram; cinco estilos ASS atualizados no player, 24 cards presentes e nenhum erro de console ou renderer.
- `npx tsx tools/check-caption-engine.ts`: 24 imagens diferentes renderizadas por libass, folha de contato inspecionada e três MP4s nativos exportados com a transcrição real da fixture local.
- Revisão independente no Electron: arrastar o tamanho até 160 gera um único job; desfazer volta para 64. Falha por pacote ausente restaura a seleção de legenda persistida. Nenhuma ferramenta enfileirada é executada depois de Interromper.
- `node tools/check-desktop.mjs --packaged --ai`: oito verificações passaram com o executável empacotado e Codex real. O agente aplicou as edições, emitiu eventos de ferramenta em execução, terminou sem atividades presas e usou o esforço escolhido `low`. Transcrição, exportação MP4 e save/reopen passaram sem erros de renderer.
- `node tools/check-usability.mjs --packaged`: nove verificações passaram, incluindo perfil novo, pré-requisitos, limpeza, reprodução e catálogo do Codex. `node tools/check-caption-preview.mjs --packaged` também passou com zero erros de console ou renderer.

Os testes do transporte comprovam que o esforço de raciocínio selecionado chega a `turn/start`, que o catálogo determina os valores suportados e que o início de uma ferramenta é emitido antes do término de seu processamento. Resumos disponibilizados pelo serviço são mostrados; o aplicativo não solicita nem exibe raciocínio interno bruto.

As evidências são gravadas em `artifacts/`, ignorado pelo Git. Os testes de UI precisam das fixtures locais; `npm test` gera suas próprias mídias e não depende de credenciais. `--ai` utiliza uma chamada real da conta Codex conectada.

Limites: os testes usam mídias curtas e não constituem revisão editorial integral de gravações longas. Não houve benchmark em computadores de usuários nem validação macOS/Linux ou API key paga. A timeline conserva tempos exatos; a exportação arredonda cada trecho ao frame, podendo acumular até meio frame por corte. Os estilos e a geração ASS são compartilhados entre a prévia e a exportação.
