# Verificação humana por link — Cloak

O editor de links inclui **Verificação humana (Captcha)**, desligada por padrão.
Farm BM não usa este recurso e nenhum arquivo ou tabela Farm foi alterado.
O widget oficial Turnstile é exibido para qualquer visitante do link habilitado,
independentemente da classificação de bots. Em modo Managed, a Cloudflare decide
se precisa mostrar uma caixa interativa; seu texto não é customizável. O botão
da página é **Continuar**, habilitado após a resposta do widget.

## Configuração necessária

Na conta Cloudflare que hospeda `big-cloack-redirect`, crie um widget Turnstile
em modo **Managed** e cadastre todos os hostnames em que os links são usados.
Adicione novos domínios ao widget antes de ativar captcha neles. Não habilite
pre-clearance: a sessão deste módulo é independente do cookie Cloudflare.

No Worker **big-cloack-redirect**, configure:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Variável pública | Site Key do widget; preencha `vars.TURNSTILE_SITE_KEY` em `wrangler.redirect.jsonc` |
| `TURNSTILE_SECRET_KEY` | Secret | Secret Key do mesmo widget, somente no Worker |
| `CAPTCHA_SESSION_SECRET` | Secret | Valor aleatório independente, com pelo menos 32 caracteres (recomendado 32 bytes aleatórios em base64) |

Os valores reais não estão no repositório. Não coloque secrets no painel,
no GitHub, em variáveis Vite ou no chat. Cadastre-os no dashboard Cloudflare
ou usando a entrada interativa do Wrangler:

```sh
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.redirect.jsonc
pnpm exec wrangler secret put CAPTCHA_SESSION_SECRET -c wrangler.redirect.jsonc
```

Sem configuração completa, links com captcha ligado retornam uma página amigável
de indisponibilidade (503), sem liberar o destino. Links desligados continuam
funcionando sem nenhuma chave. Configure as três entradas antes de habilitar.

## Publicação e verificação real

1. Autentique o Wrangler na conta correta; configure o widget, a Site Key e os dois secrets.
2. Aplique as migrations D1 existentes e a nova `0008_link_captcha.sql`:
   `pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc`.
3. Publique API e redirector: `pnpm deploy:api` e `pnpm deploy:redirect`.
4. Compile e publique o painel: `pnpm build` e `pnpm deploy:panel`.
5. Em um link de teste autorizado, desligue captcha e confira Real/Espera e mobile/desktop.
6. Ative captcha, abra uma janela privada, conclua o widget e clique Continuar.
   Confira o destino correto, a sessão de cinco minutos e novo desafio após expirar.
7. Confira falha de token expirado, isolamento por link/hostname, página de Espera
   interna, desativação imediata e manutenção de analytics. Repita em cada hostname
   cadastrado no widget. Confirme também que o Farm continua sem captcha.

Não foi realizado deploy nesta entrega sem autenticação Cloudflare. Os testes
locais usam Siteverify simulado e não substituem essa verificação real.

## Segurança e compatibilidade

- Siteverify é chamado no backend com timeout de dez segundos. Além de `success`,
  são conferidos `hostname`, `action` e `cdata` vinculado ao link/versão/hostname.
- A Cloudflare rejeita tokens expirados ou reutilizados; a página permite tentar
  novamente com um novo token. Ausência de JavaScript tem orientação explícita.
- Cookie `__Host-cloak-human-<id>` assinado com HMAC-SHA256, `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, sem Domain e com validade de 300 segundos. A sessão
  também verifica link, versão e hostname. Edição do link invalida a sessão antiga.
- POST só é aceito para links com captcha e mesma origem. Corpo limitado a 8 KiB,
  token a 2048 caracteres e uma única ocorrência do campo. A resposta nunca inclui
  token ou secret. CSP limita scripts/frames ao Turnstile e ao script com nonce.
- O POST validado serve o resultado normal diretamente, sem GET intermediário.
  As contagens existentes continuam representando GET/HEAD recebidos, inclusive
  os que exibem desafio; não representam apenas visitas que passaram no captcha.
  O POST de validação não acrescenta um clique. O modo registrado é o configurado
  para o dispositivo. Bot detection continua exclusivamente nos analytics.
- Eventos estruturados `captcha_shown`, `captcha_passed`, `captcha_failed` ficam
  nos logs do Worker, com ID do link, hostname e motivo fixo quando necessário.
  Nenhum token, secret ou corpo enviado ao Siteverify é registrado. Os eventos
  não criam novas tabelas nem alteram os totais dos analytics existentes.
- A migration é aditiva, preserva links existentes com captcha desligado e valida
  valores 0/1. Atualizações de clientes antigos sem o campo preservam o valor atual.
- Rollback: desligue os links com captcha antes de reverter os Workers/painel.
  Preserve a coluna aditiva e os dados; não remova a migration do banco.

## Validação local

```sh
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run -c wrangler.redirect.jsonc
pnpm exec wrangler deploy --dry-run -c wrangler.api.jsonc
```

A suíte cobre CRUD, compatibilidade com clientes antigos, caminhos sem captcha,
Siteverify simulado, bindings incorretos, expiração/reutilização, falhas de rede,
sessões adulteradas, isolamento, cache após edição, HEAD, limites de corpo e
preservação de destinos e contagens. Os testes existentes de Farm permanecem ativos.

Referências oficiais: [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/),
[testes](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
