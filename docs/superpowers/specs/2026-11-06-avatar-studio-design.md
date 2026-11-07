# Videosell Avatar Studio — Design

- Data: 2026-11-06
- Estado: aprovado pelo usuário, incluindo produto, motor, arquitetura, validação, identidade Palco digital e destino da página de upsell
- Base de implementação: branch `feat/formatos`
- Produto: Videosell, estúdio visual local para criar mascotes ilustrados e Reels, com ou sem avatar

## 1. Contexto

O CutRoom, agora Videosell, começou como um editor de vídeo desktop controlado por texto. A branch `feat/formatos` já contém um motor de filmes em código, formatos visuais, vozes, faixas de áudio, marca, publicação de Reels, editor e integrações MCP. O trabalho atual deve preservar essas capacidades, mas mudar a porta de entrada e o centro do produto.

O novo Videosell será um estúdio no qual uma pessoa cria um mascote ilustrado personalizável, dá voz e personalidade a ele e produz Reels para divulgar ou vender SaaS, aplicativos, consultorias, mentorias, serviços ou outros produtos. A criação sem avatar continuará disponível para todos os formatos que não precisam de personagem.

A referência visual enviada pelo usuário mostra um perfil de conteúdo com um mesmo personagem ilustrado em muitas situações. O requisito de qualidade não é apenas reproduzir uma interface de criação: o motor precisa gerar pixel art autoral, detalhada, consistente e visualmente aprovada pelo usuário.

## 2. Objetivos

1. Abrir o aplicativo em um estúdio de avatares e Reels, não em um editor vazio.
2. Permitir criar um mascote por descrição, foto de referência ou ambos.
3. Gerar arte por código e dados determinísticos, sem depender de um gerador externo de imagens.
4. Oferecer edição visual de aparência, expressões, poses, voz, personalidade e marca.
5. Manter perfis independentes, cada um com avatar, voz, marca, conta social, preferências e projetos.
6. Criar Reels com ou sem avatar, reutilizando os formatos e efeitos existentes.
7. Expor todas as operações da interface pelo MCP local.
8. Manter renderização, armazenamento e pós-produção locais.
9. Preservar o editor completo como ajustes avançados.
10. Tornar a qualidade visual e a consistência do personagem critérios explícitos de aceite.

## 3. Não objetivos

- Avatar fotorrealista ou no estilo HeyGen/Higgsfield.
- Clonagem nativa de voz; vozes clonadas já existentes na conta ElevenLabs continuam utilizáveis.
- Backend Videosell, conta Videosell ou telemetria própria.
- Geração de avatar por modelos externos de imagem neste ciclo.
- Publicação imediata sem confirmação.
- Suporte a Linux neste ciclo.
- Reescrita desnecessária da timeline ou do motor de filmes existente.

## 4. Decisões de produto

### 4.1 Entrada do aplicativo

A tela inicial terá três ações principais:

- Criar meu avatar.
- Criar um Reel.
- Continuar um projeto.

A navegação do estúdio dará acesso a Início, Avatares, Criar Reel, Projetos, Publicar e Configurações. O editor tradicional ficará em Ajustes avançados, incluindo importação de vídeo comum, cortes, timeline, legendas, áudio e efeitos.

### 4.2 Dois fluxos de criação

Com avatar:

`Perfil → Objetivo e oferta → Roteiro → Voz → Formato → Cenas com avatar → Efeitos → Revisão → Exportar ou publicar`

Sem avatar:

`Objetivo e oferta → Roteiro → Voz → Formato → Cenas sem avatar → Efeitos → Revisão → Exportar ou publicar`

`avatarId` será opcional em todo projeto. Pixel art, UI motion, stickman, explainer ilustrado e demais formatos existentes continuarão disponíveis sem exigir personagem. O avatar poderá atuar como apresentador, personagem ou elemento de reforço quando o formato permitir.

### 4.3 Perfis independentes

Cada perfil reúne:

- Nome, apelido e `@handle`.
- Avatar e revisão padrão.
- Voz e configurações do provedor.
- Personalidade e preferências de apresentação.
- Cores, logotipo e identidade da marca.
- Conta do Instagram e preferências de publicação.
- Objetivo comercial e padrões de conteúdo.
- Projetos criados com o perfil.

A marca e a voz globais atuais serão migradas para um Perfil padrão. Segredos não serão copiados para projetos nem para o perfil: ele guardará somente referências às credenciais protegidas.

## 5. Criador visual de avatar

O criador terá prévia vertical real do personagem e quatro áreas:

1. Aparência.
2. Expressões e poses.
3. Voz e personalidade.
4. Marca.

A criação aceitará texto e/ou foto. A IA propõe a primeira versão e o usuário refina rosto, cabelo, barba, roupa, cores, óculos, boné e acessórios por controles visuais. Detalhes vetoriais personalizados podem ser sugeridos pela IA dentro dos limites do schema.

Ações essenciais:

- Gerar três candidatos com silhuetas e direções visuais diferentes.
- Selecionar um candidato e preservar suas âncoras de identidade.
- Editar partes sem redesenhar o restante.
- Testar expressões, poses, voz e sincronização da boca.
- Salvar rascunho ou finalizar uma revisão.
- Usar o avatar em um Reel.

## 6. Videosell Avatar Engine

### 6.1 Princípio

O motor não será uma simples ampliação do `CR.pixelPresenter` atual. Claude/ChatGPT produzirá código-fonte e dados do personagem dentro de um contrato restrito; o Videosell renderizará esse pacote localmente.

A mesma revisão deve gerar exatamente os mesmos pixels. Prévia, folhas de sprites, MCP e MP4 compartilharão o mesmo rig e renderizador.

### 6.2 Direção de arte e identidade

O gerador extrai de três a seis âncoras de identidade:

- Silhueta e proporção cabeça/corpo.
- Forma do cabelo.
- Formato e espaçamento dos olhos e sobrancelhas.
- Roupa e acessório característico.
- Cores principais.
- Linguagem corporal e personalidade.

Características ocultas ou ambíguas na foto serão marcadas como inferidas. A textura fotográfica não será copiada literalmente; o motor abstrairá os traços reconhecíveis para pixel art.

Depois que um candidato for escolhido, suas âncoras ficam congeladas. Correções devem declarar os `part_id` alterados e não podem redesenhar partes não relacionadas.

### 6.3 Padrão visual inicial

- Grade nativa de 96 × 96 para corpo inteiro.
- Grade nativa de 64 × 64 para retratos.
- Aproximadamente 24–32 cores por personagem.
- Ramps de 3–5 tons por material.
- Sombras frias e highlights quentes, com uma única direção de luz.
- Cel shading e outlines coloridos internos de 1 px.
- Pixel clusters legíveis e densidade uniforme.
- Detalhe concentrado em rosto, cabelo, roupa e um acessório característico.
- Escala somente inteira e nearest-neighbor.
- Sem blur, antialiasing automático, escala fracionária ou pillow shading.
- Sem dithering no rosto ou em partes móveis rápidas; uso restrito em texturas adequadas.
- Antialiasing manual somente em curvas que realmente precisem dele.

A avaliação será feita no tamanho real de celular, não apenas ampliada.

### 6.4 Pacote versionado do avatar

Cada avatar terá um schema versionado contendo, no mínimo:

- `schema_version`.
- Âncoras de identidade e incertezas.
- Canvas e âncora de contato.
- Art bible e regras de luz, outline e materiais.
- Paleta com tokens semânticos.
- Partes com `id`, hierarquia, `z_index`, bounds, pivô e regras de espelhamento.
- Juntas com limites e offsets inteiros.
- Geometria por retângulos, polígonos, paths curtos, runs horizontais ou matrizes pequenas.
- Formas de boca independentes.
- Expressões, poses, animações e correções por `part_id + pose_id`.
- Revisões, resultados de validação e hash do conteúdo.

Assets binários e sprites ficarão como arquivos referenciados, não embutidos em JSON de projeto.

### 6.5 Rig e movimento

Partes independentes incluirão cabelo posterior, corpo, braços, antebraços, mãos, cabeça, orelhas, olhos, pupilas, sobrancelhas, pálpebras, boca, nariz, cabelo frontal, acessórios e props.

O pacote inicial terá:

- Poses neutra, explicando, apontando, surpreso e comemorando.
- Expressões neutra, feliz, pensativa, surpresa, séria e confiante.
- Bocas A–F e X.
- Respiração de no máximo 1 px no preset inicial.
- Piscadas e pequenos movimentos atrasados de cabelo/acessórios.
- Linha de contato estável e deslocamentos inteiros.
- Gestos de personalidade sem ambiguidade visual nas mãos.

A faixa temporal de boca será independente do desenho. O adaptador inicial poderá usar os tempos e o envelope de voz existentes; a interface admitirá uma fonte de visemas mais precisa posteriormente sem alterar o pacote do avatar.

### 6.6 Geração e revisão

O fluxo será:

1. Interpretar descrição e/ou foto.
2. Definir identidade e art bible.
3. Gerar três candidatos realmente distintos.
4. Renderizar prévias locais.
5. Executar validações determinísticas.
6. Enviar folhas visuais ao modelo com visão, quando disponível.
7. Corrigir somente as partes defeituosas.
8. Preservar o melhor candidato, não necessariamente o último.
9. Repetir por duas a três rodadas ou até atingir o critério.
10. Permitir aprovação manual e salvar a revisão.

Um pacote inválido não substitui uma revisão boa. O usuário sempre pode salvar rascunho; finalização exige os gates ou aprovação manual explícita.

## 7. Qualidade e revisão

### 7.1 Gates técnicos

- Grade e densidade consistentes.
- Escala inteira e nearest-neighbor.
- Nenhuma cor fora da paleta ou alpha parcial acidental.
- Partes, pivôs, estados e bocas obrigatórios presentes.
- Nenhum clipping, acessório solto ou baseline flutuante.
- Âncoras de identidade preservadas.
- Silhueta reconhecível no tamanho real.
- Nenhuma alteração fora dos IDs autorizados durante uma revisão.
- Mesma especificação produz o mesmo resultado.

### 7.2 Rubrica ponderada

A pontuação de referência será 85/100 ou mais:

| Critério | Peso |
| --- | ---: |
| Identidade e apelo | 20 |
| Silhueta e leitura | 15 |
| Pixel craft | 15 |
| Paleta, luz e volume | 15 |
| Expressões e sincronização | 15 |
| Rig e movimento | 15 |
| Exportação e integração | 5 |

As folhas de revisão incluirão neutro, silhueta, escala de cinza, fundos claro/escuro, expressões, bocas e loops de movimento. Sem modelo com visão, os gates determinísticos continuam ativos e a avaliação estética fica com o usuário.

O primeiro marco exige aprovação visual do usuário em um avatar produzido pelo motor. A nota automática não substitui esse aceite.

## 8. Arquitetura

### 8.1 Serviços compartilhados

Interface, IPC e MCP usarão os mesmos casos de uso:

- `AvatarService`: candidatos, partes, revisões, poses e renderização.
- `ProfileService`: perfis, marca, voz, conta social e preferências.
- `FilmService`: Reels com ou sem avatar e integração com formatos.
- `VoiceService`: ElevenLabs, Kokoro, OpenAI e voz do computador.
- `ReviewService`: validações, folhas visuais e histórico de qualidade.
- `RenderService`: sprites, quadros e MP4.
- `PublishService`: exportação, publicação e agendamento.

A geração pela interface reutilizará a configuração de provedores existente. Quando um agente já estiver executando pelo MCP, ele poderá enviar o pacote gerado diretamente, evitando chamadas recursivas de agente.

### 8.2 Perfis, filmes e editor

Três contextos serão preservados:

1. Perfil e avatar versionado.
2. Filme em código, com avatar opcional e snapshot da revisão usada.
3. Projeto do editor avançado, com timeline e faixas já existentes.

Cada Reel guardará referência e assets da revisão exata do avatar. Editar o perfil não altera projetos antigos. O usuário poderá atualizar explicitamente um projeto para outra revisão.

O filme continuará sendo a fonte da criação. Ajustes avançados abrirão a pós-produção existente, relacionando filme, assets, projeto e renders sem exigir uma reescrita do schema da timeline.

### 8.3 Cache e reprodução

O cache incluirá hash da revisão do avatar, assets, voz, configuração do render e formato. A alteração de uma revisão não invalida artefatos de projetos antigos. Falhas retomam a partir dos assets válidos já produzidos.

## 9. MCP

Todas as capacidades da interface terão equivalentes MCP. Os nomes exatos poderão ser ajustados à convenção das ferramentas existentes, mas a cobertura funcional será:

| Área | Operações |
| --- | --- |
| Perfis | Criar, ler, listar, atualizar, duplicar e excluir com confirmação |
| Geração | Obter contrato, criar candidatos, analisar referência e selecionar candidato |
| Avatar | Ler, atualizar parte, revisar, duplicar, salvar revisão e listar revisões |
| Inspeção | Renderizar prévia, silhueta, expression sheet, viseme sheet e loops |
| Qualidade | Executar gates, obter rubrica, enviar correção e comparar revisões |
| Voz | Listar/configurar provedores, gerar narração, alinhar áudio e testar boca |
| Reels | Criar com ou sem avatar, definir objetivo, formato, roteiro, cenas e efeitos |
| Render | Validar, gerar stills, renderizar, consultar/cancelar job e abrir resultado |
| Editor | Abrir ajustes avançados e executar as operações já existentes |
| Publicação | Listar contas, exportar, publicar com confirmação e agendar com autorização |

O MCP continuará restrito a loopback autenticado, chamadas serializadas quando necessário e operações de arquivo dentro das pastas permitidas.

## 10. Privacidade e segurança

- Armazenamento, renderização e pós-produção são locais.
- Claude/ChatGPT podem ser remotos; o uso local do aplicativo não significa que toda inferência seja offline.
- A foto de referência fica no armazenamento local e é enviada somente ao provedor escolhido quando o usuário solicita geração ou revisão.
- A foto não entra no MP4 nem em pacotes públicos por padrão.
- Kokoro e voz do computador oferecem narração offline; ElevenLabs e OpenAI são opções remotas.
- Chaves usam `safeStorage`; projetos e perfis guardam somente referências não secretas.
- Código de avatar executa em renderer isolado, sem Node, shell ou acesso livre a arquivos.
- O processo principal nunca executa `eval` de conteúdo produzido pelo modelo.
- Render e revisão local usam CSP e bloqueio de rede.
- Publicação imediata exige confirmação. Agendamentos são autorizados no momento da configuração e depois seguem a autorização dada.
- Resultado incerto de publicação exige reconciliação antes de nova tentativa, evitando posts duplicados.

## 11. Falhas e recuperação

- IA desconectada: avatares existentes, editor, render e ações sem IA continuam funcionando.
- Modelo sem visão: descrição continua disponível; foto exige provedor compatível; revisão estética fica com o usuário.
- Pacote inválido: rejeição com parte e motivo; última revisão boa permanece intacta.
- Qualidade insuficiente: rascunho permitido; finalização exige gates ou aprovação manual.
- Falha de voz/render: roteiro, avatar e cache são preservados para retomada.
- Cancelamento: interrompe o trabalho sem apagar a revisão anterior.
- Escrita de perfil/projeto: temporário seguido de rename para evitar corrupção.
- Publicação com resultado incerto: não repetir automaticamente.

## 12. Testes e aceite

### 12.1 Automatizados

- Schemas, migração de perfis e revisões imutáveis.
- Determinismo de pixels e hashes por revisão.
- Paleta, grade, alpha, contato e escala inteira.
- Estabilidade de identidade e baseline entre estados.
- Golden images do rig e spritesheets.
- Paridade UI × MCP para as mesmas operações.
- Criação de Reel com e sem avatar.
- Voz, legendas, áudio, efeitos, editor e exportação existentes.
- MP4 1080 × 1920, áudio 48 kHz e loudness dentro do padrão do produto.
- Zero requisições externas durante render.
- Testes existentes e build de produção.

Revisões por modelos reais serão testes de integração separados, com provedor, modelo e evidências registrados; não serão apresentadas como testes determinísticos.

### 12.2 Aceite de produto

- O aplicativo abre no estúdio.
- Um usuário cria um avatar por texto e outro por foto.
- Dois perfis mantêm voz, marca, conta e projetos separados.
- O avatar aprovado mantém identidade em poses, expressões e vídeos.
- Um Reel com avatar e outro sem avatar são produzidos e exportados.
- Toda ação visual tem cobertura MCP equivalente.
- Projetos e configurações anteriores continuam abrindo.
- O editor avançado continua funcional.
- O avatar de referência do primeiro marco é aprovado visualmente pelo usuário.

## 13. Marcos de implementação

1. Prova do motor: um avatar, três candidatos, folhas de expressões/bocas, movimentos e revisão. Implementação completa da interface fica condicionada à aprovação da qualidade.
2. Estúdio e perfis: nova entrada, criador visual, criação sem avatar e MCP.
3. Reels integrados: voz, formatos, efeitos, revisão, render e ajustes avançados.
4. Identidade e upsell: aplicar Videosell às superfícies visíveis e refazer a página pública de upsell do Carrossell.
5. Migração e acabamento: projetos antigos, configurações atuais, testes ponta a ponta e build.

Cada marco preserva trabalho alheio e alterações locais existentes. A implementação começará pela leitura das quatro modificações não commitadas atuais, sem sobrescrevê-las.

## 14. Identidade Videosell

A direção aprovada é **Palco digital**: profissional e criativa, com interface neutra e avatares expressivos. O nome forma um ecossistema com Carrossell: `vídeo + sell`, assim como Carrossell combina `carrossel + sell`.

- Assinatura de produto: **Avatares de IA para apresentar e vender seu produto**.
- Conceito verbal: **Seu produto ganha rosto, voz e presença**.
- Símbolo: um `V` construído por traços arredondados, acompanhado por um ponto que representa presença e o olhar do avatar; não usar um botão de play genérico como marca principal.
- Wordmark: `Videosell`, com `sell` destacado; a família Carrossell/Videosell deve compartilhar o tratamento do sufixo sem perder símbolos próprios.
- Cores principais: grafite `#141318`, violeta `#7C5CFF`, lima `#C8FF5A`, branco quente `#F7F6F1` e branco `#FFFFFF`.
- Tipografia: Sora para marca e títulos; Inter para interface e textos. Fontes precisam ser empacotadas localmente no aplicativo e ter licença preservada.
- A interface escura usa predominantemente neutros; violeta identifica ações principais e lima é um acento, não uma cor de texto sobre fundo claro.
- O gerador de marca e os ícones existentes serão atualizados para produzir os novos assets, sem transformar o mockup do mascote em asset oficial do motor.

A renomeação visual não autoriza substituir indiscriminadamente identificadores internos. `window.cutroom`, eventos `cutroom:*`, protocolos, extensões, pastas de projetos e contratos MCP persistidos permanecem compatíveis; mudanças de `productName`, títulos e textos visíveis serão feitas separadamente.

A checagem preliminar de nome não comprovou disponibilidade jurídica. Não será exibida nenhuma declaração de marca registrada ou domínio assegurado.

## 15. Página pública de upsell do Carrossell

A página de upsell é a oferta pública do **Videosell apresentada após o acesso ao Carrossell**, não uma tela de planos dentro do aplicativo. A implementação acontece em `site/upsell/index.html` e reutiliza os vídeos e posters locais existentes.

### 15.1 Oferta e posicionamento

- Manter o aviso de que o acesso ao Carrossell está garantido.
- Apresentar o Videosell como o complemento em vídeo do Carrossell: avatares de IA, formatos em código, narração e publicação para apresentar produtos e abrir caminho para vendas.
- Manter o preço já existente de **R$ 97, pagamento único**, sem criar planos, assinatura do Videosell, trial, desconto ou garantia inexistentes.
- Não prometer viralidade, faturamento ou vendas. Resultados citados continuam identificados como resultados individuais, não garantia.
- Explicar que Claude, Codex, provedores de IA e vozes premium podem ter custos próprios nas contas do usuário.

### 15.2 Estrutura

1. Hero com a proposta Carrossell + Videosell, CTA principal e uma demonstração vertical real.
2. Formatos e efeitos produzidos no Videosell, incluindo criação com e sem avatar somente quando o recurso correspondente estiver implementado.
3. Comparativo visual entre referências/originais e resultados gerados, restaurando o uso dos elementos `.orig` e mantendo links e créditos quando exigidos.
4. Funil orgânico: Reels, visita ao perfil, clique no link e oferta, sem apresentar a última etapa como resultado garantido.
5. O que está incluído, limitações, custos de terceiros e fechamento da oferta.

A copy será reescrita para a nova proposta, mas preço, integrações e afirmações factuais não serão inventados. Recursos ainda não disponíveis não serão anunciados como entregues.

### 15.3 Cakto e comportamento

- Preservar `href="#COMPRAR"` e `data-cakto-upsell` nos CTAs principais, e `href="#RECUSAR"` e `data-cakto-downsell` na recusa, para a integração da Cakto.
- Não adicionar checkout falso, confirmação de compra, contador regressivo falso ou publicação automática.
- Não alterar o curso, a oferta ou qualquer configuração na Cakto; a entrega é somente o arquivo e seus assets locais.
- Vídeos tocam sem som somente quando visíveis, pausam fora da viewport e oferecem controle de áudio acessível.
- Respeitar `prefers-reduced-motion`, navegação por teclado, foco visível, contraste, textos alternativos e layout móvel sem overflow horizontal acidental.

### 15.4 Aceite da página

- Identidade Videosell consistente com a direção Palco digital e relação visual clara com Carrossell.
- Todos os vídeos, posters e links locais resolvem sem erro.
- CTAs mantêm os atributos esperados pela Cakto.
- Desktop e celular apresentam hero, comparativos e oferta sem sobreposição ou corte.
- Nenhum erro de console, promessa comercial não suportada ou recurso futuro apresentado como atual.

## 16. Referências pesquisadas

- `Gamezxz/pixel-art-studio`, MIT: build script como fonte da arte, primitivas de pixel, ramps, outlines, revisão see → critique → fix e exportação determinística. https://github.com/Gamezxz/pixel-art-studio
- `dbinky/claude-fairy-pixel-art`, MIT: exemplo de Claude produzindo assets determinísticos por código, sem gerador de imagem. https://github.com/dbinky/claude-fairy-pixel-art
- `gykim80/perfectpixel-studio`, MIT: conceitos de qualidade, melhor candidato, paleta compartilhada e estabilidade de frames. Não implica adotar seus provedores de imagem. https://github.com/gykim80/perfectpixel-studio
- `Themis-Foundry/pixel-sprite-animator`, MIT: contrato anatômico, baseline e transformações determinísticas. https://github.com/Themis-Foundry/pixel-sprite-animator
- `dicebear/dicebear` e `dicebear/styles`: arquitetura de seed e opções; estilos Pixel Art e Pixel Art Neutral sob CC0. Podem servir como referência, não como padrão visual final. https://github.com/dicebear/dicebear e https://github.com/dicebear/styles
- `Orama-Interactive/Pixelorama`, MIT no código principal: referência para algoritmos e acabamento; assets de terceiros exigem auditoria separada. https://github.com/Orama-Interactive/Pixelorama
- Universal LPC Character Generator não será incorporado indiscriminadamente devido à mistura de licenças de assets, incluindo CC BY-SA, OGA-BY e GPL.

Todo código ou asset adaptado terá licença verificada e aviso preservado. Referências de técnica não autorizam copiar assets com licenciamento incompatível.
