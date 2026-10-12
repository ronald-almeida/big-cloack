# Login administrativo próprio

O painel usa exclusivamente e-mail (`ADMIN_EMAIL`) e senha em `/login`. O login, cookie, tabelas D1 e limitador existentes foram reaproveitados. Não há cadastro, bootstrap ou recuperação públicos, nem autenticação por headers/tokens Cloudflare Access. O antigo `/access-recovery/api` não redefine credenciais.

## Variáveis e secrets exatos

| Nome | Onde | Uso |
| --- | --- | --- |
| `ADMIN_EMAIL` | `vars` da API e Pages | Usuário administrativo; e-mail em minúsculas. Não é uma senha. |
| `ADMIN_ORIGIN` | `vars` da API e Pages | Origem HTTPS exata, sem barra final; atualmente `https://aprovabmyksh.com`. |
| `AUTH_PASSWORD_PEPPER` | **Secret somente na API** | Segredo aleatório de pelo menos 32 bytes, usado antes do PBKDF2. Preserve o valor existente para manter a senha atual. Guarde cópia em um gerenciador de senhas para redefinições pelo terminal. |
| `AUTH_SESSION_SECRET` | **Secret somente na API** | 32 bytes aleatórios representados por 64 caracteres hexadecimais minúsculos; assinatura HMAC-SHA256 dos cookies. |
| `DB` | Binding D1 da API | Banco existente, com `0007_password_login.sql` aplicada. |
| `ADMIN_API` | Service binding do Pages | Worker `big-cloack-api`. |

`CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN` da integração de domínios permanecem como antes. O token de integração não é credencial de login. Não alterar secrets, bindings, Turnstile ou configuração do redirector/Farm.

`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `RECOVERY_ACCESS_AUD`, certificados e JWTs do Access não são mais usados. Não definir secrets no frontend, em variáveis `VITE_*`, no GitHub ou em arquivos versionados.

## Configuração inicial e implantação

Requer Node.js 24, pnpm 11 e acesso autorizado à conta Cloudflare.

1. `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`.
2. Aplicar migrations existentes: `pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc`. Não apagar tabelas.
3. Se já houver senha e pepper configurados, preservá-los. Para instalação nova, gerar o pepper em um gerenciador de senhas e cadastrar com `pnpm exec wrangler secret put AUTH_PASSWORD_PEPPER -c wrangler.api.jsonc`. Guardar cópia segura para o comando de redefinição.
4. Gerar `AUTH_SESSION_SECRET` e cadastrá-lo com `pnpm exec wrangler secret put AUTH_SESSION_SECRET -c wrangler.api.jsonc`. Exemplo de geração local: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Executar no seu terminal privado; não colar o resultado em conversas ou commits.
5. Se for o primeiro acesso, definir a senha usando o comando abaixo. Senhas existentes são compatíveis; sessões antigas sem assinatura serão encerradas.
6. Publicar somente a API e o painel: `pnpm deploy:api` e `pnpm deploy:panel`. Manter `fail_open: false` no Pages e Workers sem `workers.dev`/previews públicos. O redirector não precisa de republicação.
7. Enquanto o Access ainda existir, mantê-lo durante os testes. Confirmar login correto/incorreto, navegação, APIs, expiração, logout e bloqueio de sessão inválida. As únicas respostas públicas do painel são `/login`, arquivos estáticos sem dados privados e a operação de login; `/api/auth/session` e logout exigem sessão.
8. **Somente depois da validação funcional**, remover aplicações/regras Access destinadas exclusivamente ao domínio administrativo e à antiga recuperação. Não alterar aplicações compartilhadas, domínios Farm, DNS, WAF, bot detection ou Turnstile. Conferir também configurações Access em nível de zona, se existirem. Se não houver aplicações, não há regra a excluir.
9. Remover variáveis obsoletas `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `RECOVERY_ACCESS_AUD` dos ambientes produção e preview do Pages/API. Conferir que `/login` abre diretamente, `/` redireciona ao login, APIs administrativas retornam 401 sem sessão e hosts alternativos continuam bloqueados.

## Definir ou trocar a senha/usuário

```sh
pnpm admin:password --remote
```

O comando mostra o `ADMIN_EMAIL` de `wrangler.api.jsonc` e solicita, com entrada oculta, o **mesmo pepper atualmente configurado na API**, a nova senha e a confirmação. Use de 12 a 128 caracteres. A senha e o pepper ficam apenas na memória do processo: não são argumentos de shell, logs ou arquivos. O comando calcula o hash localmente, envia apenas hash, sal e versão ao D1 pelo Wrangler e revoga as sessões existentes. Um SQL temporário contendo somente esses dados derivados é removido ao terminar e está excluído do Git.

Para trocar também o usuário, ajustar `ADMIN_EMAIL` nos dois arquivos Wrangler, executar o comando para esse e-mail e republicar API/Pages. O comando remove credenciais de usuários anteriores; este sistema possui um único administrador. Mudanças de e-mail podem exigir uma breve janela de manutenção.

Para banco descartável local, aplicar migrations locais e executar `pnpm admin:password --local`. É obrigatório escolher explicitamente `--remote` ou `--local`.

Se o pepper foi perdido, gere e cadastre outro, depois redefina a senha com esse novo valor. A troca do pepper invalida a verificação da senha anterior; a redefinição revoga as sessões. Se houver falha entre essas etapas, o login fica indisponível até a redefinição terminar. Não tente recuperar hashes ou senhas pelo navegador.

Para revogar imediatamente todos os cookies, rotacione `AUTH_SESSION_SECRET`. A senha permanece válida e será necessário entrar novamente.

## Proteções e validação

- PBKDF2-SHA256 com 100.000 iterações, sal individual aleatório e HMAC prévio com pepper separado do banco, mantendo compatibilidade com os hashes existentes e com o limite do runtime. Referências: [Web Crypto do Workers](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) e [limite de PBKDF2 no workerd](https://github.com/cloudflare/workerd/issues/1346).
- Cookie `__Host-bigcloak_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sem `Domain`, expiração de sete dias. Identificador aleatório de 256 bits mais assinatura HMAC-SHA256; somente o hash do cookie é armazenado no D1. A API consulta expiração e versão da credencial em cada acesso.
- Logout exige sessão, apaga seu registro e expira o cookie. Trocar a senha altera a versão e revoga sessões, incluindo cópias de cookies antigos.
- POST e demais alterações administrativas exigem a origem exata. O login mantém limites atômicos por IP e globais, além de mensagens genéricas para usuário/senha errados.
- Hosts Pages alternativos/previews são bloqueados. Falhas do banco ou do service binding nunca liberam conteúdo privado.
- Testes: `pnpm test`. Cobrem senha correta/incorreta, usuário incorreto, hash, flags do cookie, expiração, adulteração, rotação da assinatura, logout, revogação por redefinição, rate limit, CSRF, headers Access sem sessão, páginas diretas, famílias de APIs administrativas, hosts alternativos e falha de backend. A suíte também cobre Cloak, Farm, analytics e detecção de bots.
- `node scripts/login-preview.mjs` usa credenciais descartáveis exibidas **apenas nesse preview local**, banco em memória e nenhum dado de produção. Não publicar scripts de preview.
