# Preset Edição limpa

Adaptado da skill edicao-padrao-videos de Matheus Castro. Use as ferramentas do editor, sem escrever comandos de shell.

1. Faça inventário das fontes e consulte a transcrição. Transcreva localmente quando a operação precisar de palavras e o pacote estiver instalado. Nunca invente falas ou tempos.
2. Reduza pausas a aproximadamente 0,16 s, mantendo cerca de 0,30 s no fim de frases. Preserve contexto e palavras completas. Se houver espera ativa numa demonstração, prefira time-lapse mutado de 2,5x a 12x quando apropriado, em vez de remover uma ação necessária.
3. Remova muletas inequívocas (né, ah, uh, uhm, hum e hesitações). Preserve "tipo de", "um tipo" e o verbo "é". Se a transcrição omitir uma hesitação, não suponha seus tempos.
4. Use zooms pontuais e poucos: tela cerca de 1,25x, rosto cerca de 1,55x. Não presuma a posição da câmera. Use enquadramento normalizado e alterne com plano aberto; preserve legibilidade da tela.
5. Títulos, statements, callouts e fluxos são opcionais e devem explicar o conteúdo. Use texto curto dentro da área segura, acompanhado do áudio original. Não invente ofertas, links ou informações promocionais.
6. Abertura promocional e capa com degradê/texto só quando solicitadas, usando o texto fornecido. Não abaixe a fala para inserir promoção.
7. Hook: copie um resultado real para o início só quando solicitado ou sustentado pelo material; não invente prova.
8. Normalize a fala para aproximadamente -14 LUFS quando solicitado. Não substitua áudio original por voz gerada.
9. Revise a timeline após alterar tempos. Não confunda tempos na fonte com tempos no projeto. Explique as alterações, preserve originais e permita desfazer.

As funções do editor incluem cortes, zoom/foco, velocidade e mute, legendas, normalização, título, statement, callout, fluxo, promoção, capa, hook e preset completo. Você pode aplicar qualquer uma isoladamente a pedido do usuário.

# Efeitos e animações (HyperFrames)

Quando o usuário pedir animações, use `edit_project` com `motion`. Leia o projeto antes; os intervalos de motion usam segundos da timeline após cortes e velocidades, enquanto palavras usam segundos da fonte. Transcreva se precisar localizar uma frase sem palavras disponíveis. Nunca invente os tempos.

Prefira motion curto e útil: títulos, identificação, destaque, etapas, número e diagrama. Mode overlay preserva imagem e áudio; fullscreen cobre a imagem mantendo a voz. Alterações entram no projeto, com desfazer, sem exportar automaticamente. As cenas de etapas aceitam até seis itens.

Para um layout original, crie HTML/CSS local e movimentos GSAP declarativos em `animations`. Sem JavaScript livre, recursos externos ou CSS animation/transition; todo movimento deve poder avançar e voltar junto do vídeo. Não instale ferramentas: a renderização depende do pacote Efeitos e animações em Pacotes. A prévia funciona antes desse download. Use a cor de destaque do projeto, Barlow, alto contraste, texto curto e espaço livre. Animações de entrada e saída devem caber na duração da cena.
