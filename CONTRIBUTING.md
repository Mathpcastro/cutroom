# Contribuir com o CutRoom

O CutRoom é um projeto aberto, em desenvolvimento. Correções, melhorias de interface, documentação, testes e ajuda para levar o app a macOS e Linux são bem-vindos. Você também pode ajudar relatando problemas com passos para reproduzir.

O código original está sob a [licença MIT](LICENSE). Dependências e binários mantêm suas próprias licenças; consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Ao enviar código, você concorda em disponibilizar sua contribuição sob a MIT e confirma que pode compartilhá-la.

## Começar

1. Procure uma [issue existente](https://github.com/Mathpcastro/cutroom/issues) antes de abrir outra. Para mudanças grandes, descreva a proposta em uma issue antes de implementar.
2. Faça um fork do repositório e clone **seu fork**. Crie uma branch para a mudança.
3. Instale Node.js 24+ e Git. Na pasta do projeto, rode:

```sh
npm ci
npm run dev
```

Windows x64 é a única plataforma validada nesta versão. O app inclui FFmpeg e Codex via npm; a transcrição e o renderizador de animações são downloads opcionais pela aba Pacotes. Não é necessário instalar Python globalmente. Veja os [limites e próximos passos para outras plataformas](docs/portability.md).

## Onde mexer

| Parte | Local |
| --- | --- |
| Interface React e temas | `src/components/`, `src/styles.css`, `src/themes.css` |
| Modelo de projeto e comandos compartilhados | `src/shared/` |
| Electron, IPC e processamento local | `electron/` e `electron/core/` |
| Transcrição Python e dependências fixadas | `resources/workers/` |
| Testes de lógica e integração | `tests/` |
| Guias de uso | `docs/` |

## Antes de abrir um pull request

Para mudanças de código, rode:

```sh
npm test
npm run build
```

Teste o fluxo afetado no app. Para mudanças visuais, confira tema escuro e claro e anexe uma imagem ou gravação. Para processamento de vídeo, use uma mídia que você possa compartilhar e confira o resultado exportado, além da prévia. Documentação não exige gerar um novo instalador.

Preserve os arquivos originais, o histórico de desfazer/refazer e as fronteiras de segurança do Electron. Não habilite Node.js no renderer nem passe texto do usuário diretamente para um shell. Dependências e downloads novos devem ter licença compatível e verificação de integridade.

Abra o pull request do seu fork para `main`. Descreva o problema, o que mudou, como verificou e qualquer limite conhecido. Prefira mudanças pequenas, sem reformatações ou arquivos gerados que não pertençam ao assunto. O CI também executa testes e build no Windows; a revisão do mantenedor precede a integração.

## Relatar problemas e sugerir melhorias

Use os [formulários de issues](https://github.com/Mathpcastro/cutroom/issues/new/choose). Inclua versão do CutRoom, sistema operacional, passos e o resultado observado. Remova chaves de API, tokens, transcrições privadas e dados pessoais de logs e capturas. Vídeos mínimos de exemplo ajudam muito.

Não precisa saber programar: reproduzir um bug, melhorar um texto e conferir uma exportação também são contribuições úteis.
