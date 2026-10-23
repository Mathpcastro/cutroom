# macOS e Linux: estado e caminho de implementação

O CutRoom usa Electron, React e TypeScript, mas **somente Windows x64 está validado e disponível para download**. Gerar um pacote para outro sistema não basta para garantir que transcrição, animações e exportação funcionem.

## O que já pode ser reaproveitado

- Interface, temas, timeline, modelo de projeto e comandos.
- Ponte IPC isolada e processamento por subprocessos com argumentos separados.
- Resolução do executável Codex para Windows, macOS e Linux, em x64 e ARM64, em `electron/core/codex.ts`. Isso ainda precisa de teste nas novas plataformas.

## Bloqueios atuais

| Área | Estado atual | Trabalho necessário |
| --- | --- | --- |
| Transcrição local | `electron/core/packages.ts` seleciona uv, hash, extração, caminho do Python e lock com hashes por alvo (Windows x64, macOS x64 e arm64). | Validar num Mac real: instalação das wheels, modelo, permissões de execução e cancelamento. Linux ainda não tem alvo. |
| Efeitos e animações | `electron/core/motion-package.ts` baixa o Chrome Headless Shell de cada alvo com hash próprio e marca o binário como executável no macOS. | Validar renderização e cache num Mac real. |
| Binários npm | FFmpeg, ffprobe e Codex são distribuídos pelas dependências. | Conferir disponibilidade e empacotamento por alvo; testar codecs, áudio, legendas e processo auxiliar no app empacotado. |
| Instaladores | `npm run dist` gera NSIS Windows; `npm run dist:mac` gera `.dmg` com ícone `.icns` (precisa rodar num Mac, na arquitetura da máquina). | Gerar e testar os `.dmg` Intel e Apple Silicon; decidir assinatura/notarização; adicionar Linux. |
| CI | `.github/workflows/check.yml` roda no Windows; `.github/workflows/macos.yml` testa e gera os `.dmg` em macOS arm64 e Intel. | Adicionar jobs nos sistemas de destino e reter artefatos de teste, sem publicar plataformas ainda não validadas. |

## Ordem sugerida

1. Separar as definições de runtime por sistema e arquitetura, preservando a verificação de integridade dos downloads.
2. Adaptar transcrição e animações e verificar dependências/binários em cada alvo.
3. Gerar `.dmg` para macOS Apple Silicon e Intel; começar Linux x64 com AppImage e `.deb`. Isso é uma proposta de distribuição, não uma disponibilidade atual.
4. No macOS, preparar assinatura Developer ID e notarização para distribuição. Assinatura macOS exige um ambiente macOS; o CI pode usar um runner desse sistema.
5. Validar instalação limpa, importação, reprodução com e sem legendas, transcrição, comandos, conexão Codex, efeitos, cancelamento, salvar/reabrir e exportação de um vídeo real. Só então adicionar os downloads ao site.

A interface exige pouca adaptação; o maior esforço está nos motores locais, distribuição e testes em cada plataforma. Não há prazo definido para essas versões.

Referências oficiais: [build multiplataforma do electron-builder](https://www.electron.build/v26/docs/features/multi-platform-build/), [assinatura e notarização do Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing).
