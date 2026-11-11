# Spec 2 — Conectar o Instagram (Composio) de um jeito que qualquer um entenda

## Problema

Para postar, o usuário precisa colar uma "chave do projeto do Composio". A tela atual é um campo de senha com uma frase técnica. Quem nunca usou o Composio não sabe o que é, onde pegar a chave, nem por que a conta não aparece.

## Estado atual

- `src/components/studio/PublishSettings.tsx` (aba **Conexões**, `connectionOnly`): parágrafo, campo de chave, botões "Salvar" e "Atualizar contas", seletor de conta.
- `electron/core/publish.ts` (`Publisher`): `setKey`, `refresh`, `setDefault`, `settings()` → `{ hasKey, accounts, defaultAccount, history, scheduled }`. Chave em `SecretStore` (`publish.composio`).
- `electron/core/composio.ts`: `accounts()` lista contas conectadas **já existentes** no projeto Composio; `accountInfo` descarta contas expiradas ou pessoais. O app **não** inicia a conexão de uma conta nova: isso é feito no painel do Composio (ou pelo Carrossell).
- Erros hoje chegam crus (ex.: `HTTP 401`).

## Requisitos

### A. Assistente em 3 passos, na própria tela

Substituir o campo solto por um passo a passo com estado visível. Cada passo mostra ✓ quando concluído e fica recolhido; só o passo atual fica aberto.

1. **Crie sua conta no Composio** — uma frase explicando em linguagem comum: "O Composio é o serviço que liga o Videosell ao seu Instagram. Você cria uma conta lá, uma vez." Botão **Abrir o Composio** (abre o navegador em `https://app.composio.dev`). Link "Já tenho conta" pula o passo.
2. **Cole a chave do seu projeto** — instrução curta com o caminho exato no painel ("Settings › Project Settings › API Keys"), uma **imagem ilustrando onde fica** (captura real do painel, guardada em `resources/help/`; se o painel mudar, a imagem é só apoio e o texto continua valendo), campo para colar com botão **Colar** (lê a área de transferência) e **Conectar**.
   - Validar o formato antes de enviar e validar a chave na hora (uma chamada de leitura). Chave inválida → mensagem em português: "Essa chave não foi aceita. Confira se você copiou a chave do **projeto** (não a chave pessoal)."
   - Quem usa o Carrossell: aviso "Já usa o Carrossell? Use a mesma chave: as contas conectadas lá aparecem aqui."
3. **Conecte o Instagram** —
   - Se o projeto já tem conta ativa: lista com foto/nome `@usuario`, selo "Pronta para postar", e seleção da conta padrão.
   - Se não tem: botão **Conectar minha conta do Instagram**, que abre a página de autorização. Investigar na documentação atual do Composio a forma suportada de iniciar a conexão pela API (link de conexão para o toolkit `instagram`); se existir, usar e, ao voltar, atualizar a lista sozinho (verificação a cada 5 s por até 2 min, com botão "Já conectei"). Se não existir forma suportada, abrir a página do toolkit Instagram no painel do Composio com instrução de 3 linhas e o mesmo "Já conectei".
   - Explicar os requisitos do Instagram que mais travam, de forma visível antes do clique: a conta precisa ser **Profissional (Criador ou Empresa)**; conta pessoal não publica por API. Link "Como mudar para conta profissional" (ajuda oficial do Instagram).
   - Conta encontrada mas não utilizável (pessoal, expirada): mostrar na lista com o motivo e a ação ("Reconectar", "Mudar para profissional"), em vez de sumir.

### B. Estado da conexão sempre visível

- Um indicador de conexão (ponto verde/âmbar/vermelho + `@usuario` ou "Instagram não conectado") no rodapé da barra lateral e no topo das telas que dependem dela (Rotina, publicar na revisão). Clicar leva ao passo pendente do assistente.
- Qualquer tela que precise do Instagram e não o tenha mostra um cartão único "Conecte o Instagram para postar" com o botão que abre o assistente, em vez de botões desabilitados sem explicação.

### C. Erros que explicam o que fazer

Mapear as falhas conhecidas para mensagens em português com ação:

| Situação | Mensagem | Ação |
|---|---|---|
| 401/403 da chave | "A chave do Composio deixou de funcionar." | Colar nova chave |
| Sem contas | "Seu projeto do Composio ainda não tem um Instagram conectado." | Conectar conta |
| Conta expirada | "A conexão com @usuario expirou." | Reconectar |
| Conta pessoal | "@usuario é uma conta pessoal. O Instagram só permite postar por aplicativos em contas profissionais." | Ver como mudar |
| Sem internet / timeout | "Sem conexão com o Composio. Tente de novo." | Tentar de novo |
| Limite da API | "O Instagram limitou as publicações por agora. Tente mais tarde." | — |

A mensagem técnica original fica num "Detalhes" recolhido, sem nunca exibir a chave.

### D. Desconectar

- "Remover chave deste computador" com confirmação, explicando que os agendamentos param.

## Critérios de aceite

- [ ] Uma pessoa sem conta no Composio chega até "Pronta para postar" seguindo só o que está na tela.
- [ ] Colar uma chave inválida mostra a mensagem certa em menos de 3 s, sem salvar a chave.
- [ ] Com a chave do Carrossell, a conta aparece sozinha no passo 3.
- [ ] Conta pessoal ou expirada aparece com motivo e ação.
- [ ] O indicador de conexão reflete o estado real ao abrir o app e depois de cada ação.
- [ ] A chave nunca aparece em tela, log, snapshot ou resposta de ferramenta (só `••••` + 4 últimos caracteres).
- [ ] A ferramenta MCP `instagram_accounts` devolve o mesmo estado que a tela, incluindo contas não utilizáveis e o motivo.

## Testes

- `tests/composio.test.ts`: validação de chave, mapeamento de erros, contas não utilizáveis com motivo.
- Teste de componente do assistente: estados sem chave, chave inválida, sem contas, conta pronta, conta expirada (com `fetch` simulado).
- Sem chamadas reais ao Composio nos testes.

## Fora do escopo

- Outras redes (TikTok, YouTube).
- Trocar o Composio por integração direta com a Meta.
