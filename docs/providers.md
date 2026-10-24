# Conectar uma IA ao CutRoom

Abra **Conversa → Conexão de IA**. O editor oferece seis opções. A conexão e o contexto da IA duram somente a sessão; a chave informada não é salva pelo CutRoom nem incluída no projeto.

| Opção | Como conectar | Uso e cobrança |
| --- | --- | --- |
| Codex | Sessão local do Codex no CutRoom; também pode conectar o Codex como cliente MCP à ponte local | Seu plano/limites ChatGPT-Codex ou créditos de API |
| Claude via terminal | Instale a CLI oficial do Claude Code e execute `claude auth login` no terminal | Sua própria configuração, conta e limites da CLI |
| Claude API | Chave Anthropic | Créditos da API Anthropic, separados da assinatura do chat |
| DeepSeek | Chave DeepSeek | Créditos da sua conta DeepSeek |
| OpenRouter | Chave OpenRouter | Preço e disponibilidade do modelo/provedor escolhido |
| API compatível com OpenAI | URL base, identificador do modelo e chave | Seu serviço; servidor local pode executar o modelo no computador |

O app é gratuito. Modelos remotos podem cobrar pelo uso. O catálogo vem da API conectada; no OpenRouter são mostrados modelos que declaram suporte a ferramentas. Preço baixo ou uma etiqueta gratuita não garantem disponibilidade, qualidade ou ausência de limites.

## Claude via terminal

Instale a CLI pelo [guia oficial](https://code.claude.com/docs/en/setup), abra um terminal e execute:

```text
claude auth login
claude auth status
```

É necessária a versão 2.1.248 ou superior. Se precisar, execute `claude update`. O CutRoom procura o executável nativo em `~/.local/bin` e no PATH; em Avançado é possível informar seu caminho absoluto. No Windows, selecione `claude.exe`, não um script `.cmd` ou PowerShell.

O CutRoom chama a CLI oficial instalada pelo usuário, sem modificar ou empacotar o binário e sem ler seus tokens. Não cria um login próprio com Claude. Configurações de autenticação e variáveis de ambiente do terminal continuam sendo gerenciadas pela CLI; se você usa uma URL/proxy/modelos personalizados no ambiente, essa configuração também se aplica.

O catálogo agora vem da inicialização da própria CLI, sem executar uma solicitação ao modelo. O seletor mostra o nome com versão, o identificador resolvido e o alias usado, quando a CLI informa esses dados. Modelos personalizados de gateways são exibidos com sua identidade real, sem receber um nome Claude inventado. Se a CLI não informar a resolução de um alias, isso aparece explicitamente; a identidade informada pela resposta também é mostrada quando diverge da seleção. A opção inicial segue o padrão da CLI. Disponibilidade e limites continuam dependendo da conta e da configuração. [Regras oficiais para integrações com Claude Code](https://code.claude.com/docs/en/legal-and-compliance).

## Modelo e raciocínio

No menu de modelos, confira nome, versão, ID e descrição. Os níveis de raciocínio vêm das capacidades do modelo naquele provedor, não de uma lista única para todas as IAs. O OpenRouter usa os esforços e restrições publicados no catálogo; Claude API e DeepSeek usam seus próprios metadados. Servidores compatíveis que não informam capacidade de esforço continuam com o controle gerenciado pelo provedor.

Fora do Codex, **Padrão do provedor** não envia um esforço explícito. Selecionar Baixo, Médio ou outro nível disponível envia exatamente aquela opção; resetar volta a omitir o parâmetro. O app não presume que Alto seja o padrão de Claude ou de todas as APIs. O Codex mantém os esforços e o padrão informados por seu App Server.

## Codex (cliente MCP externo)

O mesmo servidor MCP local também pode ser registrado no Codex CLI/IDE que aceite servidores MCP por `stdio`. O servidor usa o mesmo caminho absoluto do Node e o mesmo script da ponte indicados na seção anterior. No `~/.codex/config.toml`, adicione:

```toml
[mcp_servers.cutroom]
command = "/caminho/absoluto/para/node"
args = ["/caminho/absoluto/para/cutroom-claude-desktop-bridge.cjs"]
```

Reinicie o cliente Codex e confirme que `cutroom` aparece entre os servidores MCP. Com o CutRoom aberto, o agente pode ler e editar o projeto, criar um canvas, importar mídia, transcrever, inspecionar quadros e solicitar a exportação. O CutRoom continua exigindo confirmação na janela de salvar o vídeo. Consulte também a [documentação oficial de MCP no Codex](https://developers.openai.com/learn/docs-mcp).

## Claude Desktop (integração MCP externa)

O CutRoom inclui um servidor MCP local que permite ao aplicativo oficial **Claude Desktop** inspecionar a timeline e aplicar comandos de edição diretamente no editor em tempo real.

Para conectar o Claude Desktop:

1. No arquivo `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) ou `%APPDATA%\Claude\claude_desktop_config.json` (Windows), adicione em `mcpServers`:

```json
{
  "mcpServers": {
    "cutroom": {
      "command": "/caminho/absoluto/para/node",
      "args": ["/caminho/para/cutroom-claude-desktop-bridge.cjs"]
    }
  }
}
```

   - **Script da ponte:** no app instalado ele fica em `/Applications/CutRoom.app/Contents/Resources/tools/cutroom-claude-desktop-bridge.cjs` (macOS) ou, na pasta de instalação padrão do Windows, `%LOCALAPPDATA%\Programs\CutRoom\resources\tools\cutroom-claude-desktop-bridge.cjs`; num clone do repositório, em `tools/`.
   - **Node 18 ou mais novo:** use o caminho absoluto (`which node` no macOS, `where node` no Windows). Apps gráficos do macOS não herdam o PATH do terminal, então `"command": "node"` costuma falhar com Node instalado via Homebrew ou nvm.
   - A ponte só conversa com o CutRoom aberto neste computador (`127.0.0.1`), autenticada por um token que o app grava em `claude-desktop-mcp.json` na pasta de dados dele, legível só pelo seu usuário. Exportar sempre abre a janela de salvar do CutRoom para você confirmar.

2. Abra o CutRoom e reinicie o Claude Desktop. O Claude Desktop detectará as ferramentas do CutRoom (`get_project`, `edit_project`, `create_blank_canvas`, `import_media`, `inspect_frame`, `transcribe`, `export_video`).
3. Você pode conversar diretamente com o Claude no Claude Desktop (por exemplo: *"Claude, crie um canvas de 15 segundos e adicione uma animação de título"* ou *"Remova os silêncios do vídeo aberto no CutRoom"*) e a timeline responderá ao vivo.

## Servidor local ou outro serviço compatível

Informe a URL **base** da API de Chat Completions, por exemplo `http://localhost:11434/v1` para um Ollama configurado, e o identificador de um modelo já instalado que suporte ferramentas. O CutRoom não instala esses modelos automaticamente. Para serviços remotos use HTTPS e a chave do serviço; HTTP e chave vazia são aceitos apenas em loopback local.

O servidor deve implementar `POST /chat/completions` com streaming SSE e tool calling. `GET /models` é usado para descoberta; quando esse endpoint não existe (404/405/501), o modelo informado manualmente é usado. Conectar não garante que todo modelo compatível com chat execute ferramentas corretamente.

## O que é enviado e o que fica local

Os provedores usam as mesmas cinco ferramentas: ler o projeto, editar a timeline, transcrever, inspecionar um quadro e exportar. Elas passam pelos validadores e histórico de edição do CutRoom. O agente não recebe acesso livre a shell, plugins ou arquivos. A CLI do Claude usa um servidor MCP temporário autenticado, apenas em loopback e com essas ferramentas.

Arquivos originais, transcrição e renderização são processados no computador. Metadados, transcrição e quadros solicitados podem ser enviados ao modelo escolhido. Um modelo só recebe quadros quando declara suporte a imagem; modelos de texto ainda podem editar a partir da transcrição.

Trocar de modelo inicia um contexto novo na API, pois assinaturas de raciocínio e imagens podem ser incompatíveis entre modelos. A timeline e o histórico de desfazer são preservados. Reconectar limpa o contexto do provedor.

## Progresso e cancelamento

O chat recebe texto em streaming, etapas das ferramentas, conclusão, falhas e cancelamento. O conteúdo interno de raciocínio do provedor não é exibido. Cancelar interrompe a solicitação e o processamento local em andamento; edições concluídas antes do cancelamento permanecem na timeline e podem ser desfeitas.

## Validação da versão 0.6.0

Transportes e ferramentas cobertos por testes: OpenAI compatível em HTTP real local, Anthropic Messages, preservação de raciocínio DeepSeek, autenticação OpenRouter, SSE fragmentado, falhas, cancelamento e servidor MCP autenticado. A CLI oficial também foi exercitada ponta a ponta com um modelo HTTP local **simulado**, lendo e editando um projeto de teste. A interface foi avaliada com conexões simuladas, em claro/escuro e várias larguras. O teste de inferência externa da CLI excedeu o prazo; não é declarado como aprovado. As APIs pagas não foram exercitadas com chaves reais de clientes.

Na 0.6.1, foram acrescentados testes de descoberta de modelos pela CLI, resolução de versões/aliases, metadados OpenRouter, esforço padrão omitido, níveis incompatíveis e identidade real retornada pelo modelo. A consulta ao catálogo foi verificada com a CLI instalada sem inferência. O fluxo nativo de edição continua sendo exercitado com API local simulada.
