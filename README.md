# CutRoom

Um editor de vídeo desktop controlado por texto. Converse com seu Codex, acompanhe a edição no player e ajuste os detalhes na timeline. Os arquivos e a renderização ficam no seu computador.

**Open source · Windows x64 · versão inicial em desenvolvimento**

[Baixar a prévia para Windows](https://github.com/Mathpcastro/cutroom/releases/tag/v0.1.0)

## O que funciona

- Chat à esquerda e workspace de vídeo à direita, com player, mídia, transcrição e timeline.
- Codex App Server empacotado: reutiliza a sessão local do Codex, sem conta ou cadastro CutRoom.
- Opção de chave OpenAI própria, mantida somente na memória da conexão local.
- Cortar/dividir trechos, desfazer/refazer, ajustar zoom/foco, velocidade e áudio.
- Detectar pausas e remover muletas a partir da transcrição, preservando expressões como “tipo de” e o verbo “é”.
- Preset **Edição limpa**, adaptado da skill de edição de Matheus Castro.
- Legendas por palavra, títulos, frases em tela cheia, callouts, fluxos, promoção, capa e hook.
- Normalização de áudio em duas passagens e exportação local H.264/AAC MP4.
- Salvar/reabrir projetos; os vídeos originais são preservados.
- Pacote instalável de transcrição local Faster Whisper, com Python privado e modelo multilíngue. Depois da instalação, transcreve offline.

## Instalar e conectar

O instalador de prévia está em [Releases](https://github.com/Mathpcastro/cutroom/releases). Esta versão é para **Windows x64**. Não é necessário instalar Python ou FFmpeg para usar o instalador.

O app não tem autenticação própria. Para usar o plano ChatGPT, primeiro conecte o CLI oficial do Codex no seu computador:

```powershell
npm install -g @openai/codex
codex login
```

O npm/CLI é necessário somente para preparar uma sessão caso você ainda não tenha Codex conectado. O CutRoom inclui seu próprio motor Codex e reutiliza a autenticação local existente. Alternativamente, em **Conectar Codex → Usar minha chave de API**, informe sua própria chave OpenAI. Ela não é incluída no projeto nem salva pelo CutRoom.

1. Importe um vídeo.
2. Clique em **Conecte o Codex**.
3. Na aba **Pacotes**, instale **Transcrição local** quando quiser recursos de fala e legendas. O download ocupa centenas de MB e exige internet na primeira instalação.
4. Peça uma edição no chat, confira o resultado e clique em **Exportar**.

Exemplos:

> Transcreva o vídeo, remova os silêncios e os “né” sem cortar palavras. Use poucos zooms.

> Adicione um callout com “Tudo roda no seu PC” entre 4 e 7 segundos da timeline.

> Divida o trecho em 12 segundos da fonte e acelere a espera para 6x, sem áudio.

> Use o trecho de 30 a 33 segundos como teaser no início, mantendo também a versão original no vídeo.

O app é gratuito. A inferência usa os limites do seu plano Codex/ChatGPT ou os créditos da sua API. A transcrição local e a renderização não consomem créditos de IA. Texto da transcrição e frames solicitados pelo agente podem ser enviados ao provedor da IA; “local” não significa que o modelo de chat roda offline.

## Desenvolvimento

Requer Node.js 24+ e Git. Os binários FFmpeg, ffprobe e Codex vêm das dependências npm.

```powershell
git clone https://github.com/Mathpcastro/cutroom.git
cd cutroom
npm ci
npm run dev
```

```powershell
npm test
npm run build
npm run dist
```

`npm run dist` gera o instalador NSIS em `release/`. A transcrição baixa um runtime independente dentro dos dados do aplicativo; não usa nem modifica o Python global. Builds para macOS/Linux não foram validados e o pacote de transcrição inicial foi preparado para Windows x64.

## Arquitetura

- **Electron/React/TypeScript**: interface e ponte isolada, sem Node no renderer.
- **Projeto declarativo**: as ações manuais e a IA alteram o mesmo modelo, com histórico reversível.
- **Codex App Server por stdio**: sessão local, ferramentas de edição próprias e streaming. Integrações herdadas, shell e plugins são desativados para a conversa do editor.
- **FFmpeg/ffprobe**: processamento por subprocessos, com argumentos separados e gráficos em arquivos.
- **Faster Whisper**: worker Python com dependências fixadas por hash e modelo de revisão fixada, instalado sob demanda.

Não há Remotion, backend hospedado, telemetria própria ou login CutRoom. Não há dependência do OpenCut ou do LosslessCut. A análise de reaproveitamento está em [docs/upstream.md](docs/upstream.md).

## Pacotes e evolução

A aba Pacotes é a primeira base para um catálogo gratuito de motores locais. O pacote de transcrição já fornece fala, tempos por palavra e dados para legendagem. Novos pacotes devem declarar versão, plataforma, tamanho, dependências, licença e capacidades; veja [docs/packages.md](docs/packages.md). Submissões públicas e instalação arbitrária de plugins não fazem parte desta versão.

## Limites desta versão

- O modelo de chat depende de internet e da sua conta. Login customizado “Sign in with ChatGPT” e suporte Claude não estão implementados.
- Presets não detectam rosto/atividade de tela automaticamente; o agente pode inspecionar frames e comandar foco e velocidade.
- Tempos ASR podem ser imprecisos, especialmente em hesitações. Revise os cortes. Tokens sem duração são unidos ao texto vizinho sem inventar novos tempos.
- Player mostra uma composição interativa; tipografia e fades da exportação ASS podem variar. A prévia final deve ser conferida no MP4.
- A exportação inicial usa CPU. Pode ocupar espaço temporário considerável e levar tempo em vídeos longos.
- Instaladores iniciais não têm assinatura de código. Não há promessa de suporte comercial.

## Licenças

O código original do CutRoom é [MIT](LICENSE). Dependências e binários conservam suas próprias licenças, incluindo Codex Apache-2.0, Barlow OFL e FFmpeg GPLv3. Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) e os avisos distribuídos em `resources/licenses/`.
