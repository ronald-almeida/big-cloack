# Verificação humana no Cloak

O editor de links oferece **Verificação humana / Captcha**, desativada por padrão.
Com a opção desativada, GET/HEAD mantêm os destinos e analytics existentes. Com
a opção ativada, o visitante confirma o widget oficial, envia o formulário ao
mesmo caminho e o Worker valida o token no Siteverify. O POST aprovado responde
303 para o mesmo link; o GET seguinte executa as regras Real/Espera/dispositivo.
O captcha nunca escolhe um destino com base na classificação de bots.

## Configuração

Somente o Worker **big-cloack-redirect** precisa dos três valores:

| Nome | Onde definir | Tipo |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | `wrangler.redirect.jsonc`, `vars` | Chave pública do widget |
| `TURNSTILE_SECRET_KEY` | Secret do Worker de redirect | Secret Key do mesmo widget |
| `CAPTCHA_SESSION_SECRET` | Secret do Worker de redirect | Aleatório independente, mínimo 32 caracteres |

```sh
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.redirect.jsonc
pnpm exec wrangler secret put CAPTCHA_SESSION_SECRET -c wrangler.redirect.jsonc
```

Gere o segundo secret com um gerador criptográfico (por exemplo, 32 bytes
aleatórios em base64). Não o coloque no Git, no frontend, em `.env` versionado ou
em mensagens. Nenhum secret deve usar prefixo `VITE_`. A chave pública é servida
pelo redirector; o painel administrativo não recebe as duas chaves privadas.

No Cloudflare → Turnstile, configure um widget **Managed** com todos os hostnames
de redirect. Não é necessário habilitar pre-clearance. Novos domínios devem ser
adicionados ao widget antes de ativar captcha nos links acessados por eles.
O provisionamento via API requer `Turnstile Sites Write`.

Em 13/10/2026, o widget existente `big-cloack-human-verification`, site key
`0x4AAAAAAFLke7cUWk_KnJfk`, foi configurado para `agendasilva.com` e
`rediconta1.com`. A Secret Key foi sincronizada no Worker, a chave pública
conferida e o `CAPTCHA_SESSION_SECRET` já existente preservado. Nenhuma chave
está faltando. API, redirector e painel foram publicados em 13/10/2026.

## Banco e publicação

A migration `0008_link_captcha.sql` adiciona `links.captcha_enabled INTEGER NOT
NULL DEFAULT 0`, sem alterar as escolhas dos links existentes. Ela corresponde
à migration já registrada em produção desde 02/10/2026. A migration
`0009_captcha_events.sql` cria a tabela separada `captcha_events` e seus índices.
Em 13/10/2026, apenas a 0009 estava pendente e foi aplicada pelo Wrangler.

```sh
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc
pnpm deploy:api
pnpm deploy:redirect
pnpm build
pnpm deploy:panel
```

O código foi reconciliado com a autenticação própria já publicada em 12/10/2026:
cookie administrativo assinado, sem login por Access nem recuperação pública.
O módulo de senha e todos os módulos Farm do bundle foram comparados com a
produção e permaneceram idênticos. Os secrets de login não foram trocados e as
credenciais/sessões existentes foram preservadas. Os scripts de configuração e
preflight agora correspondem a essa configuração de produção.

Publicação: API `446b4147-83f9-4727-a49c-1a3bf960c65d`, redirector
`dd5c2745-add4-4d1c-b127-ed299475c474`, Pages `f404df4f`.

## Sessão, erros e registros

- Cookie com prefixo `__Host-`, `Path=/`, sem Domain, `HttpOnly`, `Secure`,
  `SameSite=Lax` e validade de 300 segundos. HTTPS obrigatório.
- HMAC-SHA256 com secret independente; verifica assinatura e expiração no
  servidor. Vinculado ao hostname, slug completo, id e versão do link. Edição do
  link invalida a sessão anterior. Slugs com `/` são preservados; o callback usa
  o mesmo caminho, sem rota reservada que colida com slugs.
- O Siteverify valida `success`, `hostname`, `action` e `cdata`. Tokens são
  limitados a 2048 caracteres, o corpo a 8192 bytes e a chamada a 10 segundos.
  Falhas/expiração exibem nova tentativa; falta de configuração retorna 503.
- O POST exige Origin do próprio domínio. Respostas usam `no-store`, CSP e
  `no-referrer`; tokens e cookies não entram nos eventos.
- Eventos `captcha_shown`, `captcha_passed` e `captcha_failed` são gravados em D1,
  via `waitUntil`, com hostname, slug, link, data e motivo genérico. Não são
  contados como cliques. `captcha_shown` significa página devolvida pelo servidor,
  não confirmação de que o navegador conseguiu carregar o widget. HEAD não gera
  evento de exibição. Ao prosseguir, os cliques seguem a classificação original.
- `GET /api/captcha-events` exige a autenticação administrativa existente, aceita
  período, `link`, `hostname` e `cursor`, e retorna até 50 eventos e totais por
  tipo. O painel Analytics mostra totais e os últimos 50 eventos. Filtros de bot
  não se aplicam aos eventos de captcha. Falhas de escrita são registradas como
  `captcha_event_write_failed` sem impedir o destino. Retenção segue a política
  atual do banco, sem expiração automática.

## Validação

```sh
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run -c wrangler.api.jsonc
pnpm exec wrangler deploy --dry-run -c wrangler.redirect.jsonc
```

`tests/captcha.test.mjs` exercita os handlers reais com SQLite/D1 e Siteverify
simulado: off, on, sucesso, falha/expiração/replay, indisponibilidade, cookies
válidos/inválidos/expirados, isolamento por host/slug/versão, segredo incorreto,
origem inválida, limites, eventos e regras por dispositivo. A suíte existente
continua cobrindo Farm BM, login, domínios, analytics e bot detection.
O formulário foi verificado no navegador local: criar e reabrir um link com
slug `teste/captcha` mantém a opção ativada.

40 testes automatizados passaram após a reconciliação, além do build e dos
bundles. Em produção foram verificados em ambos os domínios: captcha off →
redirect, captcha on → página/widget, token inválido → retry, cookie inválido →
challenge, eventos D1 e preservação dos três bindings. O painel publicado foi
conferido pelo conteúdo exato do asset, login 200, painel protegido por redirect,
APIs administrativas/Farm protegidas por 401 e hostname Pages alternativo negado.
O link temporário e seus eventos de teste foram removidos; os três links reais
mantiveram id, versão e opção de captcha sem alterações.

Esses testes não comprovam uma resolução humana real em produção. Para essa
validação manual em HTTPS em ambos os domínios: off → destino;
on → widget → aprovação → destino; falha → nova tentativa; mesma sessão → sem
repetição; após cinco minutos/remoção do cookie → novo desafio. Usar link de
teste, sem alterar as opções de links reais durante a verificação. Chaves de
teste da Cloudflare só devem ser usadas em ambientes isolados.

Referências oficiais: [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/),
[gestão por API](https://developers.cloudflare.com/turnstile/get-started/widget-management/api/).
