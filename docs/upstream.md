# Upstream, implementação e licenças

Verificado em 17 de outubro de 2026.

## Mecânica de edição

O projeto local [browser-use/video-use](https://github.com/browser-use/video-use), no commit [`43cfc566833548093455c9d4a46bd69913b7e552`](https://github.com/browser-use/video-use/tree/43cfc566833548093455c9d4a46bd69913b7e552), foi consultado em `helpers/render.py`. Sua licença é MIT, copyright 2026 Browser Use. O fluxo de medição e aplicação de `loudnorm` em duas passagens e a suavização de cortes com fades de áudio de 30 ms orientaram esta implementação. Não incorporamos o aplicativo nem executamos seus scripts Python no motor de exportação.

O motor TypeScript em `electron/core/media.ts` foi implementado para o CutRoom: processos FFmpeg com argumentos separados, gráficos em arquivos, segmentos temporários, concatenação, exportação MP4, legenda ASS, cancelamento, proteção da origem e troca do destino somente após conclusão. O domínio `electron/core/project.ts` também é independente: projeto imutável, validação, tempos de origem e conversão para a timeline.

A integração Codex foi escrita para este projeto sobre o subprocesso stdio JSON-RPC do app-server, com autenticação gerenciada pelo próprio Codex. O pacote `@openai/codex@0.163.0` identifica sua licença como Apache-2.0 e seu repositório como [openai/codex](https://github.com/openai/codex). Referências oficiais consultadas: [app-server](https://learn.chatgpt.com/docs/app-server) e [configuração](https://learn.chatgpt.com/docs/config-file/config-reference). Essa integração não copia arquivos de credenciais nem implementa um cadastro/OAuth próprio.

As regras de estilo vieram da skill local `edicao-padrao-videos`: pausas com 160 ms de respiro, preservação maior em pausas longas, muletas, zooms configuráveis, preto/laranja/branco, motions discretos, abertura promocional sem abaixar o áudio original e alvo de −14 LUFS. A regra conservadora para muletas preserva todo token `é` isolado, por ser ambíguo; remove `ééé`, `né`, hesitações explícitas e `tipo` fora de expressões como `tipo de` e `um tipo`. A remoção depende de transcrição com tempo por palavra.

Não há análise automática de atividade da tela neste motor. Aceleração e foco de zoom são comandos explícitos. O preset corta pausas detectadas ou intervalos entre palavras, remove muletas claras, divide planos longos e alterna zoom leve. Não afirma detectar rosto, movimento ou sentido de uma frase.

## Editores consultados

- [OpenCut](https://github.com/OpenCut-app/OpenCut): o [README](https://github.com/OpenCut-app/OpenCut/blob/main/README.md) apresenta o editor aberto e informa sua reescrita. A [licença consultada](https://github.com/OpenCut-app/OpenCut/blob/main/LICENSE) é MIT. Foi referência de produto; nenhum código, componente ou recurso visual foi copiado.
- [LosslessCut](https://github.com/mifi/lossless-cut): o [README](https://github.com/mifi/lossless-cut/blob/master/README.md) descreve uma interface FFmpeg focada em operações sem recodificação. A [licença consultada](https://github.com/mifi/lossless-cut/blob/master/LICENSE) é GPL versão 2. Foi referência conceitual para cortes, projetos e histórico; nenhum código GPL desse editor foi incorporado. O CutRoom recodifica a exportação para permitir zoom, texto e velocidade; não promete exportação sem perdas.

## Dependências binárias

O pacote `ffmpeg-static@5.3.0` contém uma distribuição FFmpeg separada do código CutRoom. A instalação Windows consultada inclui `ffmpeg.exe.LICENSE` com GPLv3 e `ffmpeg.exe.README` com informações do fornecedor. `ffprobe-static@3.1.0` fornece o executável ffprobe. Licenças dos wrappers npm não substituem as licenças dos binários e seus componentes.

Uma distribuição deve preservar os avisos e os arquivos de licença correspondentes, além de cumprir as obrigações aplicáveis ao binário FFmpeg efetivamente empacotado, inclusive disponibilização de código-fonte correspondente. Não se deve apresentar todo o pacote binário como exclusivamente MIT. O código original do CutRoom é separado dessas dependências. Consulte a [página oficial de aspectos legais do FFmpeg](https://ffmpeg.org/legal.html) ao preparar a distribuição.

## Contrato de tempos e renderização

`trim`, `split`, `remove_range`, detecção de pausas e `hook` usam segundos no arquivo de origem. Cada trecho mantém `mediaId`, `start`, `end` e `speed`. Motions usam segundos na saída do projeto. O gancho copia a faixa para o começo por padrão; `move: true` remove sua ocorrência anterior. Palavras são mapeadas novamente para cada ocorrência, inclusive ganchos duplicados.

Depois de cortes e mudanças de velocidade, os motions existentes são reposicionados pelo conteúdo de origem que sobreviveu. Um motion totalmente removido desaparece. O reset restaura proporção, resolução par e FPS da primeira mídia. Arquivos que o Chromium não reproduz diretamente (por exemplo, HEVC/MKV/MOV) ganham proxy H.264/AAC MP4 em cache, limitado a 1280×720, sem alterar os arquivos e os tempos de origem. A geração de cada proxy tem limite de 20 minutos e limpa saídas parciais.

Cada segmento é quantizado ao FPS da saída, com pelo menos um frame. O áudio usa a mesma duração, estéreo a 48 kHz, `atempo` em cadeia e fades de até 30 ms. Vídeos sem áudio recebem silêncio; não são tratados como fontes de fala. A medição de loudness vem depois dos cortes. Áudio digitalmente silencioso evita parâmetros `-inf`. As legendas e motions são aplicados por ASS no fim, mantendo a fala original sem ducking na promoção. O render final usa H.264/AAC, MP4 com faststart, resolução e FPS configurados no projeto.

O motion de fluxo revela progressivamente itens separados por `→`, `->` ou quebras de linha; a distribuição dos passos é uniforme ao longo do motion. A capa preenche o quadro com recorte durante seu intervalo e aplica degradê forte. Trechos acelerados, mudos e de pelo menos 4× recebem etiqueta `>> Nx` automaticamente.

A renderização usa CPU/libx264 para funcionar sem presumir GPU NVENC. Intermediários H.264 de baixa compressão e áudio PCM limitam o tamanho dos argumentos e o número de entradas abertas, com custo de espaço temporário e uma recodificação adicional. O original permanece intacto. Cancelamento e falha removem os temporários da operação e preservam um destino anterior.

## Verificação reproduzível

Execute `npm test -- tests/project.test.ts tests/media.test.ts`. Os testes geram vídeo e áudio reais, verificam sonda/miniaturas, pausas, cortes, limites de origem, velocidade, preservação do verbo `é`, gancho duplicado/movido, tempos de legendas, resolução/FPS, sincronismo A/V, loudness, fontes sem áudio, nomes de caminho com apóstrofo e cancelamento. Isso verifica a mecânica com fixtures; não substitui revisão editorial de uma gravação completa.

## Comandos do domínio

Todos recebem `{name, args}` e retornam um novo projeto validado, sem mutar o anterior. IDs selecionam trechos; quando `clipId` é omitido em `zoom` e `speed`, todos os trechos são selecionados.

| `name` | `args` |
| --- | --- |
| `remove_range` | `{start,end,clipId?,mediaId?}` em segundos de origem; fonte é inferida se só houver uma mídia |
| `trim` | `{clipId,start,end}` em segundos de origem, dentro do trecho atual |
| `split` | `{clipId,time}` em segundos de origem, estritamente dentro do trecho |
| `delete_clip` | `{clipId}` |
| `zoom` | `{clipId?,factor,focusX?,focusY?}`, fator 1–4 e focos normalizados 0–1 |
| `speed` | `{clipId?,factor,muted?}`, fator 0,1–16 |
| `captions` | `{enabled}` booleano |
| `normalize` | `{enabled,targetLufs?}`, alvo de −30 a −5 |
| `overlay` | `{kind,text,start,end}` em segundos da saída; tipos `title`, `statement`, `callout`, `flow`, `promo`, `cover` |
| `remove_silence` | `{ranges:[{mediaId,start,end}]}` em segundos de origem, após análise assíncrona |
| `remove_fillers` | `{}`; requer `project.words` com tempos por palavra |
| `preset` | `{ranges?}`; pausas detectadas ou inferidas entre palavras, muletas, planos longos, zoom e −14 LUFS |
| `hook` | `{mediaId,start,end,move?}` em segundos de origem; cópia por padrão |
| `reset` | `{}`; restaura todos os originais e limpa motions |
| `rename` | `{name}` |
