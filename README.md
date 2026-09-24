# Big Cloak

Gerenciador de links nativo Cloudflare: painel React no Pages, API Worker privada via service binding, Worker público de redirects, banco D1 e cache KV. Sem Supabase, Lovable ou serviço externo de QR Code.

## Funcionalidades

- Criar, editar e excluir links; slug manual ou automático.
- Modo Real/Espera. Em Real, somente o dispositivo selecionado recebe uma URL real; os demais recebem Espera. Em Espera, todos recebem Espera.
- Mobile inclui tablets. Classificação por Client Hint e User-Agent; é aproximada, não uma garantia de identidade. Não existem regras especiais para bots/crawlers.
- Até 30 URLs reais com distribuição aleatória uniforme por acesso (não é alternância sequencial).
- Espera pode ser URL externa ou página interna “Em breve”.
- Analytics por período (7/30/90 dias), link, dispositivo, país e domínio; contadores totais por link. Datas em UTC, contagens de requisições GET, sem IPs ou identificação de visitantes únicos. HEAD não conta.
- Cadastro e verificação de domínios; copiar link pelo domínio escolhido; QR Code gerado localmente no navegador e baixável em PNG.
- Cloudflare Access, restrito a `ronald.almeida307@gmail.com`, validado também na API e no Pages (assinatura, emissor, audiência e expiração do JWT).

## Status desta entrega

Código e testes locais implementados. **Ainda não publicado.** A conexão disponível da Cloudflare respondeu `Authentication error` ao criar D1; o domínio `aprovabmyksh.com` não aparece na conta conectada e o Access está desativado. Os IDs em Wrangler são placeholders e a publicação exige preenchê-los. Nenhum link ou dado antigo foi importado.

## Desenvolvimento e testes

Requer Node.js 24 e pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
node scripts/preview.mjs
```

Preview local em `http://127.0.0.1:4173`, com banco SQLite em memória, adaptador D1 e JWT de teste efêmero. O preview começa vazio, descarta os dados ao parar e escuta somente em loopback. Ele usa os mesmos handlers da API; nunca é incluído no deploy. Não é um substituto do teste em Cloudflare.

No ambiente desktop com restrições de subprocessos, os comandos equivalentes usados foram `node --test --test-isolation=none tests/system.test.mjs` e `node node_modules/vite/bin/vite.js build --configLoader native`.

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

No painel, abra **Domínios**, cadastre o hostname, e depois conecte esse hostname em **Cloudflare → Workers & Pages → big-cloack-redirect → Settings → Domains & Routes → Add → Custom Domain**. Aguarde DNS/certificado e clique **Verificar conexão** no painel. O domínio precisa estar em uma zona Cloudflare acessível na conta. O painel não armazena token de administração da Cloudflare; por isso o vínculo de infraestrutura é feito no dashboard Cloudflare. Excluir um domínio do painel interrompe seu uso, mas não remove o vínculo externo na Cloudflare.

## Arquitetura e consistência

```text
aprovabmyksh.com → Access → Pages (React + validação JWT)
                                └─ /api/* → service binding → API Worker → D1
domínio de redirect → Redirect Worker → D1 (domínio + versão atual)
                                      └─ KV (conteúdo da versão)
                                      └─ D1 (analytics via waitUntil)
```

D1 é a fonte de verdade para existência e versão dos links. O cache usa chaves imutáveis com versão e expiração de uma hora; uma edição ou exclusão não depende da propagação de invalidações KV. Não há cache HTTP dos redirects.

Os registros de analytics são assíncronos via `waitUntil`; falhas são registradas em logs e podem causar subcontagem. Não são métricas de faturamento. Excluir um link também exclui seus eventos. A listagem inicial mostra até 1.000 links; volumes maiores exigem paginação. O histórico permanece no D1 até exclusão do link; avaliar retenção conforme o uso. URLs de destino aceitam apenas HTTP/HTTPS sem credenciais. Parâmetros recebidos não são copiados automaticamente ao destino.

## Estrutura

- `src/`: painel React responsivo.
- `workers/`: API, autenticação, regras e redirector.
- `functions/`: proteção Pages e proxy para a API.
- `migrations/`: schema D1, sem dados iniciais.
- `tests/`: matriz de regras e integração CRUD/autenticação/cache/analytics com SQLite.
- `wrangler*.jsonc`: recursos e bindings; `scripts/configure.mjs` preenche IDs.
- `.github/workflows/verify.yml`: build, testes e dry-run dos bundles em Linux.

Após alterar os bindings, gere os tipos com `pnpm exec wrangler types -c wrangler.api.jsonc` e o equivalente para o redirector. A validação do runtime Cloudflare e o teste de login real continuam pendentes enquanto a conta não permitir publicar.
