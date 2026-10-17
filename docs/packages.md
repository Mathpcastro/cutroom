# Contrato dos pacotes locais

A primeira versão tem catálogo controlado: somente o pacote Faster Whisper multilíngue base. Não executa scripts submetidos por terceiros. A interface, o gerenciador de jobs, o status de instalação e a descoberta de capacidades já são compartilhados e permitem acrescentar motores sem modificar o formato do projeto.

Cada entrada do catálogo deve ter identificador estável, versão, descrição, plataforma/arquitetura, capacidades, dependências, requisitos de hardware, licença e origem dos artefatos. A referência inicial está em `resources/packages/transcription-base.json`.

O gerenciador instala na pasta de dados do usuário. O bootstrap uv é fixado por versão e SHA256; dependências Python usam `requirements.lock` com hashes; o modelo usa uma revisão imutável. Falhas de instalação são exibidas e podem ser repetidas. A instalação não modifica PATH, não exige administrador nem altera o Python global.

O marcador de instalação só é escrito depois que o modelo carregou. A transcrição subsequente roda com Hugging Face offline e mantém cache por identidade de mídia (caminho, tamanho e data de modificação). Erros de runtime e cancelamento são propagados ao editor.

Adições futuras devem usar capacidades explícitas, por exemplo `transcription`, `word-timestamps`, `captions`, `audio-analysis`. Uma capacidade deve retornar dados estruturados no projeto; a IA não recebe permissão geral para instalar ou executar código externo. Isso mantém os comandos de edição e o render independentes do fornecedor do pacote.

Downloads Python/Hugging Face podem ser reaproveitados em nova tentativa pelo cache. O ZIP de bootstrap interrompido é baixado novamente. Desinstalação, escolha de modelos/GPU e retomada explícita de downloads pela interface ainda não são oferecidas.
