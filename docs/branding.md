# Marca Videosell

A identidade **Palco digital** usa o nome `Videosell` e a assinatura `Avatares de IA para apresentar e vender seu produto.`. `src/shared/branding.ts` é a fonte única do nome, da assinatura, do viewBox `0 0 64 64`, da paleta e do traço do `V`. `BrandMark` e o gerador usam a mesma geometria: quadrado violeta arredondado, traço branco de 7 px com extremidades arredondadas e ponto lima em `(46, 18)`.

## Geração determinística

Execute na raiz do projeto:

```sh
npx tsx tools/generate-brand.ts
```

O comando valida as fontes e licenças locais e gera, a partir da mesma geometria e das mesmas cores:

- `resources/branding/cutroom-mark.svg` e `cutroom-icon.svg`;
- o favicon `public/cutroom.svg`;
- PNGs de 16, 24, 32, 48, 64, 128, 256, 512 e 1024 px;
- `icon.ico`, com PNGs de 16, 24, 32, 48, 64, 128 e 256 px;
- `icon.icns`, com as entradas `icp4`, `icp5`, `icp6`, `ic07`–`ic10` e `ic11`–`ic14` preenchidas por esses PNGs.

O gerador usa o Chromium do Playwright quando disponível e, como fallback, procura Chrome/Chromium/Edge instalado no sistema. `--browser <caminho-do-executavel>` ou `CHROMIUM_EXECUTABLE_PATH` seleciona um navegador explicitamente. Os arquivos gerados não contêm data, hora ou caminho da máquina; uma nova execução com os mesmos fontes e navegador preserva os bytes.

## Fontes locais

Sora e Inter são distribuídas com o aplicativo em `resources/fonts/Sora-Variable.ttf` e `resources/fonts/Inter-Variable.ttf`. Suas licenças SIL OFL 1.1 estão em `resources/licenses/Sora-OFL.txt` e `resources/licenses/Inter-OFL.txt`. Os arquivos foram obtidos do repositório oficial `google/fonts`, nos caminhos `ofl/sora` e `ofl/inter`, e ficam versionados localmente: o render do aplicativo não precisa baixar fontes nem acessar Google Fonts.

O empacotador mantém `signExecutable: false` enquanto não houver assinatura digital.
