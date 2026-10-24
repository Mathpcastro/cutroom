# Atualização automática do CutRoom no Windows

Data: 2026-10-23
Branch: `feat/windows-auto-update`

## Objetivo

Permitir que instalações do CutRoom que já contenham o atualizador recebam versões futuras pelo GitHub Releases, sem exigir que o usuário volte à landing page ou baixe manualmente cada instalador.

A atualização deve pedir autorização antes do download. Depois do download, o usuário poderá reiniciar imediatamente ou instalar ao fechar o app.

## Limites e compatibilidade

- O escopo é Windows x64 com instalador NSIS, a plataforma desktop validada do projeto.
- macOS, Linux, landing page, provedores de IA e funcionalidades do editor ficam fora do escopo.
- Versões publicadas antes da inclusão do atualizador não podem receber esse recurso retroativamente. O usuário precisará instalar manualmente uma vez a primeira versão que o inclua.
- Não haverá backend próprio, conta CutRoom, telemetria, rollout percentual ou atualização silenciosa sem consentimento.
- O app continuará sem assinatura de código nesta etapa. A verificação de integridade do pacote pelo `electron-updater` não substitui assinatura de código nem elimina avisos do SmartScreen.

## Abordagem

Usar `electron-updater` com o provedor `github`, publicando no repositório `Mathpcastro/cutroom`. O electron-builder gerará os metadados e o pacote diferencial necessários junto com o instalador NSIS.

Alternativas descartadas:

- Manifesto e downloader próprios: mais código e manutenção, sem benefício necessário neste momento.
- Servidor de atualizações: infraestrutura desproporcional ao requisito e contrária à preferência por não manter backend.

## Componentes

### Módulo de atualização

Um módulo em `electron/core/updater.ts` encapsulará a configuração, os eventos e os diálogos do atualizador. Ele terá uma superfície pequena para inicialização e instalação imediata, com dependências injetáveis ou substituíveis nos testes.

Configuração esperada:

- `autoDownload = false`, para que nenhum pacote seja baixado antes do consentimento.
- `autoInstallOnAppQuit = true`, para instalar um pacote já baixado ao fechar.
- Verificação somente em build empacotado do Windows; desenvolvimento e outras plataformas não fazem a verificação automática.

### Integração com o ciclo de vida

`electron/main.ts` inicializará o módulo depois que a janela principal estiver disponível. A verificação ocorrerá uma vez por abertura do app, sem timer ou verificação periódica nesta versão.

O renderer e a ponte IPC não precisarão mudar: os diálogos nativos serão controlados pelo processo principal.

### Publicação

`package.json` declarará o provedor GitHub do electron-builder e a dependência estável do `electron-updater`.

Cada release Windows deverá publicar juntos:

- `CutRoom.Setup.X.Y.Z.exe`;
- `latest.yml`;
- `CutRoom.Setup.X.Y.Z.exe.blockmap`;
- `SHA256SUMS.txt`.

O artefato do workflow Windows incluirá os três primeiros arquivos. A documentação de release explicará que `latest.yml` e `.blockmap` são obrigatórios para clientes existentes descobrirem e baixarem atualizações diferenciais.

## Fluxo do usuário

1. O usuário abre uma versão empacotada do CutRoom no Windows.
2. O app consulta os releases estáveis do GitHub em segundo plano.
3. Se estiver atualizado, nenhuma caixa de diálogo aparece.
4. Se houver uma versão mais recente, o app informa a versão e oferece baixá-la ou adiar.
5. Adiar fecha o diálogo sem iniciar download. Uma nova oferta poderá ocorrer na próxima abertura.
6. Aceitar inicia o download em segundo plano, sem bloquear o editor.
7. Ao concluir, o app oferece **Reiniciar agora** e **Ao fechar**.
8. Reiniciar agora fecha o app, instala e reabre o CutRoom. Ao fechar mantém o editor aberto e instala na saída.

## Erros e estados concorrentes

- Ausência de rede, falha do GitHub, metadados inválidos ou erro de download não impedirão o uso do editor.
- Erros de verificação serão registrados sem diálogo intrusivo.
- Erro depois que o usuário autorizou o download produzirá um aviso compreensível, sem repetir automaticamente a operação.
- Eventos duplicados não deverão abrir várias caixas de diálogo nem iniciar downloads concorrentes.
- Ações tardias de uma verificação ou download não deverão operar sobre uma janela já destruída.
- Fechar antes de concluir o download não instalará um pacote incompleto.

## Segurança e privacidade

- A única comunicação nova será a consulta e o download dos arquivos públicos do GitHub Releases.
- Projetos, mídias, chaves e conteúdo do usuário não serão enviados. O electron-updater cria um UUID aleatório persistente em `.updaterId`, na pasta de dados do app, e o envia ao GitHub no cabeçalho `x-user-staging-id`; esse UUID não é um identificador da conta nem deriva de projetos, mídias ou chaves.
- Não há backend nem telemetria própria do CutRoom. Falhas de rede não impedem o uso do editor.
- O atualizador validará os metadados e a integridade do pacote pelo mecanismo do electron-builder/electron-updater.
- Não será adicionada execução de scripts remotos nem acesso do renderer ao Node.js.

## Testes e validação

Testes unitários com mocks cobrirão:

- Não verificar em desenvolvimento ou fora do Windows.
- Não baixar antes do consentimento.
- Recusar a oferta sem chamar o download.
- Iniciar apenas um download após aceitar.
- Oferecer reinício imediato ou instalação ao sair após o download.
- Não abrir diálogos quando não houver atualização.
- Tratar falhas de verificação e download sem derrubar o app.

Validações de engenharia:

- `npm test` na base e após a implementação.
- `npm run build` após a implementação.
- Geração do instalador Windows para confirmar a presença de `.exe`, `latest.yml` e `.blockmap`.
- Se houver ambiente de release descartável, validar a transição real entre duas versões; caso contrário, esse item ficará explicitamente como validação manual pendente, sem ser declarado como testado.

## Entrega

Todo o trabalho ocorrerá na branch `feat/windows-auto-update` e na worktree isolada `.worktrees/feat-windows-auto-update`. O clone principal, seu diretório de release e a pasta `website/` não serão modificados por esta tarefa.
