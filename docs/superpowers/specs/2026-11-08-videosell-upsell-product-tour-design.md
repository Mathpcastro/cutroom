# Videosell — refinamento do upsell com tour do produto

- Data: 2026-11-08
- Estado: direção autorizada pelo usuário na mesma mensagem que liberou a implementação do estúdio
- Base: `docs/superpowers/specs/2026-11-06-avatar-studio-design.md`, seção 15

## Decisão

A página pública deixará de parecer uma sequência de seis comparações com referências externas. Ela terá **dois comparativos**: apresentador em pixel art e animação de interface. O espaço restante mostrará o Videosell por dentro.

## Mídias

- Substituir os vídeos `professor` e `ui-motion` por versões visualmente melhores, produzidas com o motor e os serviços atuais do Videosell.
- Reutilizar a narração original de cada vídeo, sem trocar voz, texto ou faixa. A faixa de áudio do MP4 final deve ter o mesmo hash de fluxo do original; se o container exigir nova codificação, o áudio decodificado deve ser bit a bit idêntico e a diferença de duração não pode ultrapassar 20 ms.
- Preservar os arquivos antigos até que os novos passem por inspeção visual e auditiva. A substituição será atômica e o processo poderá ser repetido sem alterar a narração.
- Manter posters locais coerentes com os novos vídeos.

## Tour pelo aplicativo

Adicionar uma seção `#produto-por-dentro` com telas reais do aplicativo implementado:

1. Criador visual de avatar.
2. Perfis e identidade da marca.
3. Criação e revisão de Reel.
4. Editor avançado.

As capturas usarão dados de demonstração claramente identificados, não cartões fictícios apresentados como projetos salvos do usuário. Não haverá mockups substituindo telas do produto.

## Estrutura e oferta

- Hero com o novo vídeo de avatar.
- Dois comparativos com créditos e links externos preservados.
- Tour do aplicativo antes do funil comercial.
- Funil, inclusões atuais, custos de terceiros, prova qualificada e oferta final.
- Manter R$ 97, pagamento único, `href="#COMPRAR"` + `data-cakto-upsell` e `href="#RECUSAR"` + `data-cakto-downsell`.
- Não alterar Cakto, checkout, curso ou publicação; não prometer vendas ou viralidade.

## Aceite

- Exatamente dois links `.orig`, um para cada formato escolhido.
- Pelo menos quatro telas reais do aplicativo no tour.
- Novos MP4 1080 × 1920 com narração original comprovada e qualidade visual inspecionada em frames representativos.
- Controller acessível, reduced motion, foco, fallback externo e ausência de overflow preservados.
- Testes, build, smoke test nos quatro viewports e inspeção dos screenshots aprovados.
