# Big Cloak

Gerenciador de links nativo Cloudflare: painel React no Pages, API Worker privada via service binding, Worker público de redirects, banco D1 e cache KV. Sem Supabase, Lovable ou serviço externo de QR Code.

## Funcionalidades

- Criar, editar e excluir links; slug manual ou automático.
- Modo Real/Espera. Em Real, somente o dispositivo selecionado recebe uma URL real; os demais recebem Espera. Em Espera, todos recebem Espera.
- Mobile inclui tablets. Classificação por Client Hint e User-Agent; é aproximada, não uma garantia de identidade. Não existem regras especiais para bots/crawlers.
- Até 30 URLs reais com distribuição aleatória uniforme por acesso (não é alternância sequencial).
- Espera pode ser URL externa ou página institucional interna com cinco variações: Azul suave, Verde editorial, Escuro moderno, Areia clássico e Violeta. Cada link salva seu tema e conteúdo: empresa, título, apresentação, serviços, cidade, CNPJ, abertura, WhatsApp e e-mail. Dados opcionais vazios ficam ocultos. Não há importação automática de identidade empresarial do HTML de referência. A URL externa, quando preenchida, tem prioridade.
- **Acessos** mostra o histórico individual com data/hora, dispositivo, Real/Espera, link, domínio e país. Filtros por link, dispositivo, destino e intervalo; paginação de 50 registros sem repetir linhas quando chegam novos acessos. Horários e filtros usam o fuso do navegador (mostrado na tela); timestamps são armazenados em UTC. O final do intervalo é exclusivo. Nome/slug refletem o cadastro atual; excluir um link apaga seu histórico, conforme a confirmação do painel.
- Analytics por período (7/30/90 dias), link, dispositivo, país e domínio; contadores totais por link. Datas em UTC, contagens de requisições GET, sem IPs ou identificação de visitantes únicos. HEAD não conta.
- Conexão de domínios pelo painel: cadastro na Cloudflare quando necessário, vínculo com o redirector, DNS e acompanhamento do HTTPS. Copiar link pelo domínio escolhido; QR Code gerado localmente no navegador e baixável em PNG.
- Cloudflare Access, restrito a `ronald.almeida307@gmail.com`, validado também na API e no Pages (assinatura, emissor, audiência e expiração do JWT).

## Status desta entrega

Workers `big-cloack-api` e `big-cloack-redirect`, Pages `big-cloack-admin`, D1 e KV publicados na conta autorizada em 24/09/2026. As três migrations foram aplicadas e o banco iniciou vazio. Cloudflare Access está configurado para `aprovabmyksh.com`, com política restrita ao e-mail administrativo e One-time PIN habilitado. Os endereços Pages de produção e de deployment e a API retornam 401 sem autenticação. Pages está configurado com `fail_open: false`.

O domínio personalizado foi cadastrado no Pages; sua ativação aguarda o apontamento DNS para `big-cloack-admin.pages.dev`. O teste completo com login real ainda depende dessa ativação. A conexão automática de novos domínios também depende do secret `CLOUDFLARE_API_TOKEN` no Worker administrativo, conforme as instruções abaixo. O login OAuth de publicação não substitui essa credencial persistente do aplicativo.

Os IDs públicos dos recursos estão preenchidos nos arquivos Wrangler; nenhuma credencial é versionada. A conexão do assistente permanece somente leitura, e a publicação foi feita com autorização OAuth local do Wrangler. No Windows restrito, os bundles foram preparados pelo Vite e enviados pela API oficial; o Pages usa um Worker equivalente à função `functions/[[path]].js`, passando arquivos estáticos por `env.ASSETS.fetch`. Em ambiente sem essa restrição, os comandos Wrangler abaixo continuam sendo o fluxo normal de publicação.

## Desenvolvimento e testes

Requer Node.js 24 e pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
node scripts/preview.mjs
```

Preview local em `http://127.0.0.1:4173`, com banco SQLite em memória, adaptador D1 e JWT de teste efêmero. O preview começa vazio, descarta os dados ao parar e escuta somente em loopback. Ele usa os mesmos handlers da API; nunca é incluído no deploy. Não é um substituto do teste em Cloudflare.

No ambiente desktop com restrições de subprocessos, os comandos equivalentes usados foram `node --test --test-isolation=none tests/*.test.mjs` e `node node_modules/vite/bin/vite.js build --configLoader native`.

Para testar com dados descartáveis: `node scripts/preview.mjs --fixtures`. O link local `/r/teste-local` passa pelo redirector real com os bindings simulados e registra acessos; configure Espera no editor para exibir a página. `/preview/waiting/sky` (ou forest, midnight, sand, violet) mostra uma variação com textos de exemplo, sem contar acessos. Nada disso adiciona dados ao banco de produção.

As migrations `0002_waiting_pages_and_logs.sql` e `0003_domain_connections.sql` adicionam as configurações de Espera, o índice do histórico e o estado de conexão dos domínios sem apagar os dados existentes. Aplique todas as migrations antes de publicar esta versão da API e do redirector.

## Publicação

1. Autorize a conta Cloudflare correta com escrita em Workers, D1, KV e Pages, além da configuração de Access e DNS para o domínio administrativo. Não grave tokens no repositório.
2. Adicione `aprovabmyksh.com` à conta e conclua a delegação DNS. Ative o Zero Trust / Access. Crie uma aplicação Self-hosted para `aprovabmyksh.com`, incluindo todos os caminhos, com política Allow exclusivamente para `ronald.almeida307@gmail.com`. Use o login por código de e-mail (One-time PIN), se não houver provedor de identidade configurado. Não crie política Bypass.
3. Crie os recursos:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create big-cloack
pnpm exec wrangler kv namespace create CACHE
pnpm exec wrangler pages project create big-cloack-admin --production-branch main
```

4. Configure as variáveis de ambiente `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `KV_NAMESPACE_ID`, `ACCESS_TEAM_DOMAIN` (ex.: sua-equipe.cloudflareaccess.com, sem https) e `ACCESS_AUD` (Audience da aplicação Access). Execute:

```sh
node scripts/configure.mjs
node scripts/preflight.mjs
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc
pnpm deploy:api
pnpm deploy:redirect
pnpm build
pnpm deploy:panel
```

5. No projeto Pages, adicione `aprovabmyksh.com` em Custom domains e conclua o DNS. Confirme o login com o e-mail autorizado. A política Access deve estar ativa antes de divulgar o endereço.
6. Verifique que URLs `pages.dev`, previews e requisições sem JWT não entregam o painel; `workers.dev` e previews dos Workers permanecem desabilitados. Teste criar/editar/excluir, URLs reais, Espera, mobile/desktop, domínio, QR Code e analytics em produção.

## Adicionar domínios de redirect

Configure a integração uma única vez no servidor. Crie um token Cloudflare restrito à conta escolhida, com Workers Scripts Edit, Workers Routes Edit, Zone Read e DNS Read para as zonas desejadas. Para permitir criar novas zonas pelo painel, inclua Zone Edit e acesso às novas zonas. O `scripts/configure.mjs` preenche `CLOUDFLARE_ACCOUNT_ID` na API. Grave o token apenas como secret do Worker:

```sh
pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN -c wrangler.api.jsonc
```

A conexão Cloudflare do assistente não fornece automaticamente essa credencial ao aplicativo publicado. Nunca coloque o token no frontend, no GitHub ou em mensagens. O painel recebe apenas o estado configurado/pendente.

Em **Domínios**, informe o hostname e clique **Adicionar e conectar**. Para uma zona ativa da conta autorizada, a API vincula o endereço ao Worker `big-cloack-redirect`; a Cloudflare prepara o DNS e o certificado. O painel verifica a resposta HTTPS do redirector antes de marcar o domínio como Ativo. Enquanto a tela estiver aberta, acompanha a ativação a cada 20 segundos. Também é possível retomar com **Conectar**, **Continuar conexão** ou **Verificar conexão**.

Se a zona não existir na conta, o painel solicita o domínio raiz e permite **Adicionar à Cloudflare**. Em seguida mostra os nameservers. A troca desses servidores precisa ser feita no registrador onde o domínio foi comprado; o aplicativo não tem acesso ao registrador. Preserve os registros de site e e-mail na Cloudflare antes dessa troca. Após a zona ficar ativa, o painel continua o vínculo automaticamente enquanto estiver aberto.

A API não substitui registros A/AAAA/CNAME existentes nem domínios vinculados a outro Worker. Nesses casos mostra o conflito para correção ou escolha de um subdomínio livre. Tentativas repetidas reutilizam um vínculo já criado. Excluir um domínio do painel interrompe seu uso, mas não remove o vínculo externo na Cloudflare.

Testes automatizados cobrem vínculo, repetição, conflito DNS, criação de zona, nameservers e erros de permissão com a API Cloudflare simulada. A conexão real de domínio permanece pendente da credencial e do deploy. Referências: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) e [permissões de Workers](https://developers.cloudflare.com/workers/authorization/workers/).

## Arquitetura e consistência

```text
aprovabmyksh.com → Access → Pages (React + validação JWT)
                                └─ /api/* → service binding → API Worker → D1
domínio de redirect → Redirect Worker → D1 (domínio + versão atual)
                                      └─ KV (conteúdo da versão)
                                      └─ D1 (analytics via waitUntil)
```

D1 é a fonte de verdade para existência e versão dos links. O cache usa chaves imutáveis com versão e expiração de uma hora; uma edição ou exclusão não depende da propagação de invalidações KV. Não há cache HTTP dos redirects.

Os registros de analytics são assíncronos via `waitUntil`; falhas são registradas em logs e podem causar subcontagem. Não são métricas de faturamento. Excluir um link preserva seus acessos e registra a exclusão. A listagem inicial mostra até 1.000 links; volumes maiores exigem paginação. O histórico permanece no D1; avaliar retenção conforme o uso. URLs de destino aceitam apenas HTTP/HTTPS sem credenciais. Parâmetros recebidos não são copiados automaticamente ao destino.

## Estrutura

- `src/`: painel React responsivo.
- `workers/`: API, autenticação, regras e redirector.
- `functions/`: proteção Pages e proxy para a API.
- `migrations/`: schema D1, sem dados iniciais.
- `tests/`: matriz de regras e integração CRUD/autenticação/cache/analytics com SQLite.
- `wrangler*.jsonc`: recursos e bindings; `scripts/configure.mjs` preenche IDs.
- `.github/workflows/verify.yml`: build, testes e dry-run dos bundles em Linux.

Após alterar os bindings, gere os tipos com `pnpm exec wrangler types -c wrangler.api.jsonc` e o equivalente para o redirector. Antes de divulgar o painel, conclua a ativação DNS e valide o login real e as operações autenticadas em produção.

## Saúde dos domínios e períodos

Hoje, Últimos 7 dias, Últimos 30 dias e Personalizado usam o fuso do navegador, incluindo o dia final. Os agrupamentos diários usam UTC.

Tempo desde o primeiro acesso e dias com acessos não representam disponibilidade contínua. Criações e exclusões usam o domínio de cadastro escolhido ao criar o link; acessos usam o hostname visitado. Links continuam disponíveis nos demais domínios ativos.

A migration 0004 preserva acessos existentes e passa a registrar criações e exclusões. Links antigos ficam sem domínio de cadastro. Exclusões anteriores não são recuperadas. Excluir um link mantém registros com nome e slug históricos.

## Classificação de tráfego (analytics)

A migration `0005_bot_analytics.sql` adiciona uma avaliação auditável a cada
requisição GET ou HEAD para um link existente em domínio verificado. Requisições
rejeitadas antes da resolução do link (405, domínio/link inexistente e healthcheck)
não entram nos cliques. HEAD passa a contar como acesso; o filtro `request_method=GET`
permite comparar com a métrica antiga. Não são visitantes únicos.

- `human`: sinais de navegação consistentes, sem evidência relevante de automação;
  estimativa, não prova de humanidade.
- `confirmed_bot`: somente `request.cf.botManagement.verifiedBot` ou `signedAgent`
  verdadeiros, fornecidos pela Cloudflare. Confirma automação, não a identidade do provider.
- `probable_bot`: índice de automação >=60, sem verificação Cloudflare.
- `unknown`: evidência insuficiente. Registros históricos não são reclassificados.

`is_bot` é `true` para bots confirmados/prováveis, `false` para humano e `null`
para indeterminado. `bot_confidence` é um índice heurístico de automação de 0–100,
**não uma probabilidade calibrada**; histórico tem `null`. Apenas automação
verificada recebe 100. `bot_reason` é uma lista de motivos, `bot_provider` sempre
é atribuição provável. WhatsApp é exibido como **WhatsApp/Meta preview (provável)**,
inclusive se a automação em si for verificada pela Cloudflare.

O classificador combina assinaturas de crawlers/preview/clientes HTTP, ASN da
origem como corroboração, headers de navegação/prefetch, organização cloud como
sinal fraco e até 100 acessos anteriores por IP/domínio nos últimos 60 segundos.
A consulta de frequência é indexada e limitada, aproximada sob concorrência,
e não usa contadores globais do isolate. IP compartilhado/NAT, datacenter/proxy,
falha de JS ou ausência de um header não confirmam bot. Não há lista de proxies
externa nem fingerprinting ativo. User-Agent pode ser falsificado.

Os dados de Cloudflare vêm de `request.cf`, nunca de headers que declaram score
ou verificação. Os campos opcionais disponíveis (score, verifiedBot, signedAgent,
JS detection, corporateProxy, JA3/JA4, detectionIds, categoria, ASN/organização,
colo, HTTP/TLS) são armazenados em `traffic_signals`, com `null` quando ausentes.
Nenhum plano pago é obrigatório. Consulte as [variáveis de Bot Management](https://developers.cloudflare.com/bots/reference/bot-management-variables/)
para disponibilidade; campos do Ruleset Engine não são automaticamente campos Workers.
O IP vem somente de `CF-Connecting-IP`, assumindo entrada pelo edge Cloudflare;
`X-Forwarded-For` não é confiável para essa finalidade. Requests de outros Workers
podem representar subrequests; ASN/IP não verificam identidade sozinhos.

`created_at` registra o instante UTC de recebimento. Os campos solicitados de
UA, IP, país, ASN, método, referer e CF-Ray ficam no registro. Strings e listas
são limitadas em tamanho; cookies, Authorization e demais headers não são gravados.
As APIs continuam protegidas pelo Cloudflare Access. Os novos dados pessoais
seguem a retenção já existente dos cliques (não há expiração automática).

`GET /api/analytics` e `GET /api/logs` aceitam `classification`, `bot_provider` e
`request_method`, além de período/link/domínio. Logs devolvem `bot_reason` como
array, `traffic_signals` como objeto e `is_bot` como boolean/null. Analytics inclui
`classifications`, `providers`, `summary.automated` e `summary.automated_percent`:
confirmados + prováveis divididos por **todos os acessos do recorte**, incluindo
indeterminados. Os contratos estão em `shared/traffic.d.ts`.

A gravação ocorre em `ctx.waitUntil`; falhas de classificação/SQL não alteram a
resposta. A decisão Real/Espera permanece exclusivamente em `destinationMode`,
por configuração do link/dispositivo. Nenhum sinal de bot bloqueia, redireciona
ou troca conteúdo. Eventos bloqueados no edge antes do Worker não são observáveis
por este classificador. Heurísticas não garantem capturar todos os bots.

### Atualização e validação

Com Node 24+ e dependências instaladas: `npm test` e `npm run build`.
A suíte aplica todas as migrations em SQLite e verifica falsos positivos, campos
opcionais, filtros/paginação, métricas, frequência e independência do roteamento.

Na publicação, aplicar primeiro as migrations D1, depois API e redirect Worker,
e por último o painel. Exemplo de migration: `npx wrangler d1 migrations apply DB
--remote -c wrangler.api.jsonc` (uma linha). Em rollback, reverter os bundles e
preservar as colunas aditivas; não apagar dados. Sem a migration, a nova API não
consegue consultar os campos e a gravação registra `analytics_write_failed`.
