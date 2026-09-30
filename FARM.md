# Farm BM

Módulo separado para sites institucionais: menu **Farm BM → Domínios Farm / Criar Site / Sites**. O Worker público `big-cloack-farm` usa somente tabelas `farm_*`. O redirector, Real/Espera, bot detection e os domínios do Cloak não são alterados.

## Fluxo

1. Cadastre o domínio raiz em Domínios Farm. O backend procura ou cria a zona na conta Cloudflare configurada. Se necessário, o painel mostra os nameservers que devem ser alterados no registrador. Não compra domínios.
2. Ative/verifique o domínio. Deixe o limite vazio para capacidade ilimitada; zero bloqueia novos sites. Todos os sites cadastrados, inclusive rascunhos e erros, reservam capacidade. Desativar suspende a entrega dos sites e bloqueia novas publicações.
3. Informe o CNPJ, busque na BrasilAPI e revise os campos. Se a consulta falhar, preencha manualmente. Escolha um dos 20 estilos do index.html original e o subdomínio.
4. Distribuição automática seleciona o domínio ativo com menos sites, capacidade e subdomínio disponível. A reserva ocorre em uma única instrução SQL. A seleção manual também tem limite imposto por trigger no banco.
5. Publicar cria um Custom Domain Cloudflare por empresa, com DNS e certificado gerenciados pela Cloudflare. O serviço compartilhado identifica a empresa pelo hostname. Não cria um Worker por empresa; o nome da empresa identifica o site no painel.
6. Enquanto DNS/HTTPS propagam, o status fica Aguardando HTTPS. Use Verificar HTTPS. Erros ficam no site e no histórico; Republicar tenta novamente sem duplicar o vínculo.
7. HEAD salva um rascunho e republica. O conteúdo público usa um snapshot publicado: salvar alterações sem publicar não altera o site em produção. A prévia do painel omite o HEAD personalizado e usa um iframe isolado.
8. Trocar domínio ou subdomínio remove o endereço anterior. A remoção pendente fica persistida para recuperação após falhas. Exclusão remove somente o vínculo do site Farm; o histórico de publicações permanece. Domínios com sites não podem ser removidos. Remover um domínio do cadastro **não exclui a zona Cloudflare nem DNS de outros serviços**.

## Publicação

Requer Node 24+ e as dependências do lockfile.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc
pnpm run deploy:farm
pnpm run deploy:api
pnpm run deploy:panel
```

A migration `0006_farm.sql` adiciona somente `farm_domains`, `farm_sites`, `farm_deployments`, índices e triggers próprios. O Worker Farm recebe o binding D1 do mesmo banco, mas não consulta as tabelas do Cloak.

A API mantém a validação de JWT Cloudflare Access, e-mail autorizado e origem das requisições de escrita. Configure o secret `CLOUDFLARE_API_TOKEN` no **big-cloack-api** e `CLOUDFLARE_ACCOUNT_ID`. O token precisa de leitura/criação das zonas autorizadas, leitura de DNS e edição de Workers/Custom Domains na conta. Não enviar o token ao navegador. O mesmo secret já usado pela integração de domínios é reaproveitado; novas zonas podem exigir ampliar o escopo da credencial pelo titular da conta.

O Custom Domain não substitui vínculos com outros Workers nem registros DNS existentes. Nomes do painel e domínios cadastrados no Cloak são rejeitados no Farm.

Documentação oficial: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [API de vínculo](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/), [BrasilAPI](https://brasilapi.com.br/docs).

## Verificação local

`pnpm test` inclui regressões do Cloak e testes Farm para autenticação/origem, 20 estilos, escape dos dados, BrasilAPI, capacidade concorrente, distribuição, snapshots HEAD, falhas, retry, rename e exclusão. Quando subprocessos forem restritos, use `node --test --test-isolation=none tests/*.test.mjs`.

`node scripts/farm-preview.mjs` serve o build em `http://127.0.0.1:4173`, usando os handlers reais, SQLite em memória e serviços externos simulados. Exclusivamente local, sem dados ou mutações de produção. Um site cadastrado nessa prévia pode ser visto em `/site/empresa.dominio/`.

As chamadas Cloudflare nos testes são simuladas. A confirmação de DNS/HTTPS real exige um domínio Farm ativo autorizado e credenciais com as permissões necessárias.
