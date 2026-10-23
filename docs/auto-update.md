# Atualização automática no Windows

Nas versões do CutRoom que incluem o atualizador, o app consulta os releases estáveis do GitHub ao abrir. Nenhum pacote é baixado sem autorização. O usuário pode adiar a oferta, reiniciar para instalar depois do download ou deixar a instalação para quando fechar o app.

A consulta usa apenas os arquivos públicos de `Mathpcastro/cutroom`. Não envia projetos, mídias, chaves, identificadores ou telemetria. Falhas de rede não impedem o uso do editor.

## Migração única

Versões anteriores ao atualizador não conseguem descobrir nem instalar esse recurso sozinhas. Quem as utiliza precisa instalar manualmente a primeira versão com atualização automática. Depois disso, as versões seguintes usam o fluxo dentro do app.

O macOS continua fora desse fluxo. O app ainda não possui assinatura de código; integridade do pacote e assinatura de código são proteções diferentes, e o SmartScreen pode continuar exibindo aviso.

## Publicar uma atualização Windows

1. Atualize a versão e as notas de release e gere o instalador com `npm run dist`. Mantenha juntos o `.exe`, o `.exe.blockmap` correspondente e `latest.yml` produzidos em `release/`. Na raiz do repositório, gere o checksum do instalador:

   ```powershell
   $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
   $installer = "CutRoom.Setup.$version.exe"
   $hash = (Get-FileHash -Algorithm SHA256 "release/$installer").Hash.ToLowerInvariant()
   [System.IO.File]::WriteAllText((Join-Path $PWD "release/SHA256SUMS.txt"), "$hash  $installer`n", [System.Text.Encoding]::ASCII)
   ```

   Isso grava uma linha no formato `<sha256>  <nome-do-installer>` em `release/SHA256SUMS.txt`, sem caminho de diretório e com o hash em minúsculas. A gravação é ASCII, sem CRLF nem BOM; o `` `n `` entre crases garante LF para compatibilidade com verificadores Unix e com o workflow macOS.

2. Crie o release como rascunho e envie todos esses arquivos antes de publicá-lo. Não substitua `latest.yml` por um arquivo escrito manualmente.
3. Publique como release estável, não como prerelease. O `latest.yml` precisa apontar para o mesmo instalador e a mesma versão anexados.
4. Aguarde o workflow de macOS terminar antes de considerar o release completo; ele acrescenta os DMGs e suas entradas ao `SHA256SUMS.txt`.
5. Confira se o release contém EXE, blockmap, `latest.yml`, os dois DMGs e o `SHA256SUMS.txt` consolidado com exatamente três linhas: uma para o EXE e uma para cada DMG, todas sem caminhos de diretório.

Para uma atualização já publicada, os clientes novos baixam o instalador pela página do release. Os clientes com atualizador leem `latest.yml`, verificam a versão e baixam pelo GitHub depois do consentimento. O blockmap permite baixar somente as partes alteradas quando a atualização diferencial estiver disponível.

## Verificação real obrigatória

Antes de anunciar o fluxo como validado de ponta a ponta, instale uma versão descartável com o atualizador, publique uma versão de teste posterior em um repositório de teste e confirme: oferta, recusa sem download, aceite, download, reinício, versão resultante e preservação dos dados do usuário. Testes unitários e geração de artefatos não substituem essa verificação.
