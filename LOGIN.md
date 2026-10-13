# Login administrativo em produção

O código acompanha a autenticação própria já publicada em 12/10/2026: e-mail e
senha em `/login`, com sessões assinadas. A publicação do Turnstile preservou
esse módulo, os hashes existentes e os secrets, sem redefinir senha ou sessões.
Cloudflare Access não autentica o painel e `/access-recovery/api` não permite
redefinir credenciais. Não há cadastro ou recuperação públicos.

| Configuração | Local | Uso |
| --- | --- | --- |
| `ADMIN_EMAIL` | API e Pages, vars | Administrador autorizado |
| `ADMIN_ORIGIN` | API e Pages, vars | `https://aprovabmyksh.com` |
| `AUTH_PASSWORD_PEPPER` | API, secret | Pepper existente do hash da senha; preserve o valor |
| `AUTH_SESSION_SECRET` | API, secret | Assinatura de sessão; 64 caracteres hexadecimais |
| `DB` | API, D1 | Credenciais, sessões e limites existentes |
| `ADMIN_API` | Pages, service binding | `big-cloack-api` |

O cookie `__Host-bigcloak_session` usa HttpOnly, Secure, SameSite=Strict, Path=/,
sem Domain, por sete dias. A API verifica assinatura HMAC-SHA256, hash do token
no D1, expiração e versão da credencial. Logout revoga a sessão. O login mantém
os limites por IP e globais e as mensagens genéricas de erro. Alterações exigem
Origin administrativo exato. Hosts alternativos e falhas de backend não liberam
o painel. Senhas usam PBKDF2-SHA256 com sal e pepper, compatível com a versão
anterior em produção.

Redefinições são operações administrativas controladas fora do painel. O helper
`scripts/admin-credential.mjs` gera SQL de credenciais e revogação, e é usado nos
testes; não é importado pelo Worker público. Não execute redefinições durante
deploys normais. Nenhum secret de login deve ser colocado no frontend ou Git.

`tests/password-auth.test.mjs` cobre login, logout, expiração, adulteração,
rotação da assinatura, revogação, limites, CSRF, headers Access rejeitados,
famílias de APIs e proteção Pages. `pnpm test` executa a suíte completa.
