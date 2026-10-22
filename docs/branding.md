# Marca CutRoom

A marca usa a mesma geometria da landing: duas barras de larguras iguais, alturas 15/21 e inclinação de −13°. Os dados em `src/shared/branding.ts` são compartilhados pelo componente da interface e pelo gerador dos ícones.

`npx tsx tools/generate-brand.ts` gera SVG, PNG e ICO em `resources/branding`, além do favicon em `public/`. É necessário um Chromium instalado pelo Playwright; `--browser <caminho-do-executavel>` permite reutilizar um navegador já disponível. O ICO inclui tamanhos 16, 24, 32, 48, 64, 128 e 256.

A interface herda a cor do tema. O ícone do Windows usa a marca escura sobre um fundo claro arredondado para manter contraste na área de trabalho e na barra de tarefas. A tipografia da marca é Manrope; a licença está em `resources/licenses/Manrope-OFL.txt`.

O empacotador mantém a edição dos recursos do executável habilitada para aplicar os ícones, com `signExecutable: false` enquanto não houver assinatura digital.
