# Verificação da primeira versão

Data: 17 de outubro de 2026. Plataforma verificada: Windows x64.

## Resultado

- `npm test`: 29 testes aprovados em quatro arquivos.
- `npm run build`: TypeScript e builds Electron/preload/React aprovados.
- Auditoria npm de dependências de produção: zero vulnerabilidades reportadas no momento da execução.
- Revisão visual independente: aprovada em Electron a 1440×900 e 1120×720, sem overflow ou erros de renderer.
- `node tools/check-desktop.mjs --packaged --ai`: fluxo real aprovado com o executável empacotado, sem erros de renderer.
- Instalador NSIS executado em diretório de teste isolado: código de saída 0. O aplicativo instalado abriu com bridge real, catálogo do pacote local e conexão Codex existente com sete modelos, sem erros. O teste não reutilizou `node_modules` do projeto para executar o aplicativo instalado.
- Instalador Windows x64: 335.586.881 bytes. SHA256: `af9eeffd0bf8666d0fc4fda53b3885f33e9e32c15f48abd72385ccf88cbc8767`.

## Fluxo real no aplicativo empacotado

1. Importação de fixture audiovisual real gerada por FFmpeg, com áudio de síntese do Windows.
2. Reprodução pelo protocolo de mídia local do Electron, com seek e imagem decodificada.
3. Corte manual, undo/redo e alterações de zoom/overlay no projeto.
4. Inicialização do Codex App Server 0.163.0 empacotado, reutilizando a sessão ChatGPT existente. Nenhum arquivo de credenciais foi copiado ou alterado pelo CutRoom.
5. Turno real de IA com instrução para consultar o projeto, renomear para “Teste real CutRoom” e ativar legendas. As ferramentas foram executadas e o estado real mudou.
6. Transcrição por worker privado Faster Whisper em CPU e aplicação dos tempos por palavra ao projeto.
7. Exportação pelo mesmo fluxo de diálogo/job utilizado pelo produto.
8. Save/reopen preservando identidade e trechos do projeto; histórico visual salvo também é restaurado.

A exportação inspecionada contém H.264 640×360 a 30 FPS, áudio AAC estéreo a 48 kHz e duração de 7 segundos tanto em áudio quanto em vídeo. Um frame foi extraído para inspeção visual. Os testes do motor verificam loudness, duração, sincronismo, legendas/motions, fonte sem áudio, proxy, caminhos com apóstrofo e cancelamento.

## Transcrição em português

O pacote foi instalado pelo próprio gerenciador, incluindo download do bootstrap uv verificado por SHA256, Python privado gerenciado, dependências com hashes e modelo de revisão fixada. Não foi usado o Python global.

Uma amostra sintética PT-BR foi transcrita localmente como:

> Este é um teste de edição de vídeo local. Podemos remover pausas e adicionar legendas.

As seis palavras de verificação (`teste`, `edição`, `vídeo`, `local`, `pausas`, `legendas`) apareceram no resultado. Isso comprova funcionamento da amostra; não é benchmark de precisão geral.

## Defeitos encontrados e corrigidos

- PyAV recente incompatível com a versão do Faster Whisper: dependência fixada em versão compatível.
- Rename do cache uv bloqueado no Windows: fallback instala os mesmos wheels com hashes via pip no runtime privado.
- Tokens ASR de duração zero: texto unido a um vizinho temporizado, sem inventar limites de fala.
- Corrida entre primeiro request de vídeo e registro da fonte no allowlist: arquivos registrados antes do evento de importação.
- Effect de scroll retornando valor indevido ao React: retorno explicitamente vazio; save/reopen passou sem erro de cleanup.
- IDs de mídia não confiáveis usados como caminho de cache: chave de cache agora usa SHA256; teste de regressão com `../../../outside`.
- Cancelamento de importação: sinal chega ao ffprobe/thumbnail/proxy e impede commit de um resultado cancelado.
- Resolução ímpar/FPS alto: configurações de saída normalizadas antes da edição.
- Retranscrição e histórico salvo: rerun explícito sem duplicar palavras e restauração validada do chat.

## Limites da evidência

Não foi realizado benchmark em máquinas de usuários, reprodução editorial integral de vídeos longos, teste em macOS/Linux ou turno pago com API key própria. A rota de chave tem testes de transporte/isolamento e usa a configuração documentada; o teste real de IA usou a sessão Codex/ChatGPT local.

Não há detecção automática de rosto/atividade da tela nem marketplace público. A aba de pacotes tem um pacote de transcrição funcional e um manifesto versionado para futuras extensões.

Os scripts de smoke em `tools/` guardam evidência em `artifacts/`, ignorado pelo Git, e requerem fixtures locais. `npm test` gera suas próprias fixtures e não requer credenciais. `--ai` faz uma chamada real e usa os limites da conta local; sem essa flag o smoke não faz inferência.
