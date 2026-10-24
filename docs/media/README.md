# Demonstrações do README

As animações usam gravações reais do aplicativo, sem respostas ou progresso inventados. A gravação foi feita com o CutRoom 0.5.0; a versão de download atual é 0.6.1. Os vídeos demonstram funções que permanecem no app, mas não mostram a nova conexão multiprovedor.

- `cutroom-demo.mp4`: filme de 43 segundos, H.264, sem áudio. Remotion compõe os trechos reais com títulos, aproximações e transições. O motor de animações do aplicativo é HyperFrames.
- `overview.gif`: primeiros 40 segundos do filme em 2×, 840 pixels de largura e 7 fps, para movimento direto no README.
- `captions.gif` e `motion.gif`: trechos de oito segundos das gravações de legendas e efeitos, em velocidade normal e enquadramento aproximado.
- `workspace-dark.webp` e `workspace-light.webp`: capturas reais dos temas Grafite e Claro.
- `cover.svg`: ilustração vetorial de apresentação com a marca do CutRoom. O cartão de pedido é uma ilustração, não uma captura de execução.

Os fontes do filme e seus registros de captura estão no projeto irmão `cutroom-landing/media`. A fonte de vídeo é um trecho de uma gravação do próprio autor, com a transcrição existente ajustada ao trecho. Foram capturados comandos do editor, edição pelo agente e exportação real. Perfis locais, caminhos privados, gravação original e dados de autenticação não são distribuídos nestes arquivos.

Para regenerar a mídia, com os arquivos finais da landing disponíveis:

```powershell
npm ci
node tools/build-readme-media.mjs ../cutroom-landing/public/assets
```

O script usa FFmpeg da dependência instalada, gera as prévias GIF com paleta reduzida e prepara o MP4 em H.264/yuv420p, BT.709 e sem áudio, para reprodução no navegador. Não instala Remotion no aplicativo nem altera gravações originais.

O vídeo completo usa um anexo de mídia do próprio GitHub, publicado no [PR de documentação #1](https://github.com/Mathpcastro/cutroom/pull/1), para ser reproduzido no player nativo do README. Uma cópia MP4 também está disponível para download nesta pasta. Os GIFs ficam incorporados ao README; não dependem de uma landing privada, de iframes ou de um player HTML externo.
