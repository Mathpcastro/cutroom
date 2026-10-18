# Verificação do CutRoom 0.3.0

18 de outubro de 2026. Windows x64.

- `npm test`: 39 testes aprovados em cinco arquivos.
- Build TypeScript, Electron/preload/React e empacotamento de workers/WASM/fontes aprovados.
- `node tools/check-usability.mjs --ai`: dez verificações reais no Electron, sem erros de renderer. Navegação atualizada para os menus; pacote local, limpeza, reprodução, modelo/raciocínio e progresso real do Codex passaram.
- `node tools/check-caption-preview.mjs`: cinco estilos ASS renderizados no player, 24 presets disponíveis e nenhum erro de console ou renderer.
- `node tools/check-design.mjs --packaged`: seis verificações passaram com o executável empacotado. Testou os seis temas através do menu, CSS e aparência nativa, persistência após relançamento, navegação por teclado, painéis, pacotes, legendas, divisão/desfazer pelo menu e janela mínima 1050×700 em Grafite/Claro. Nenhuma alteração de dados do projeto ao trocar o tema; nenhum overflow ou erro de console/renderer.
- Comparação pelo mesmo script, com projeto carregado, painéis padrão, orientação inicial dispensada e sem menus abertos: 34 botões visíveis na 0.2.0 e 19 na 0.3.0, redução de aproximadamente 44%. A contagem depende do estado e dos trechos do projeto; esta é a comparação reproduzida, não uma promessa para toda tela.
- Revisão independente: menus por setas/Home/End/Escape/clique externo com foco restaurado; modelo e raciocínio legíveis em claro/escuro e janela mínima; 24 presets; Ctrl+S/O funcionando a partir do compositor; botão de play dentro da área correta quando o painel lateral está aberto. Nenhum ajuste obrigatório pendente.
- `node tools/check-desktop.mjs --packaged --ai`: oito verificações passaram com o executável final e Codex real, incluindo edição efetivamente aplicada, esforço escolhido `low`, atividade em execução/finalizada, transcrição local, exportação MP4 e save/reopen. Nenhum erro de renderer.
- `node tools/check-usability.mjs --packaged` passou nas nove verificações; `node tools/check-caption-preview.mjs --packaged` passou nas três. Nenhum erro de console/renderer nos testes das legendas empacotadas.

As imagens em `docs/screenshots` são capturas reais da tela vazia do aplicativo empacotado. As demais evidências estão em `artifacts/`, ignorado pelo Git. Fixtures sintéticas verificam a mecânica e o layout; não são filmagens de usuários nem revisão editorial integral de vídeos longos.

Não houve validação em macOS/Linux ou benchmark em computadores de usuários. Os testes `--ai` utilizam inferência real da sessão Codex conectada; `npm test` não requer credenciais.
