# Login administrativo

O painel oferece e-mail e senha em `/login`, com sessão de sete dias e botão Sair. Não há cadastro público. O administrador continua sendo `ADMIN_EMAIL`.

Primeiro acesso, alteração e recuperação: `/access-recovery`. Esse caminho e seus descendentes devem permanecer protegidos por uma aplicação Cloudflare Access com política Allow exclusiva para o e-mail administrativo e One-time PIN. Após confirmar o e-mail, o administrador define uma senha de 12 a 128 caracteres. A operação invalida todas as sessões anteriores. O backend também verifica assinatura, emissor, audiência, expiração e e-mail do JWT: liberar uma página na borda não libera a API.

## Publicação e ativação

1. Aplicar `migrations/0007_password_login.sql` ao D1 existente. Ela só adiciona tabelas de autenticação.
2. Gerar um segredo aleatório de 32 bytes e armazenar **somente** como secret `AUTH_PASSWORD_PEPPER` do Worker da API. Não sobrescrevê-lo em novos deploys; sua troca requer redefinir a senha pelo fluxo de recuperação.
3. Publicar API e Pages. `ADMIN_ORIGIN` deve ser idêntico em ambos. URLs `pages.dev` e previews permanecem bloqueadas.
4. Criar/confirmar a aplicação Access específica para `aprovabmyksh.com/access-recovery`, incluindo descendentes, preservando o login por e-mail. Registrar sua audiência em `RECOVERY_ACCESS_AUD` no Worker da API; publicar novamente antes de ativar a política.
5. Somente após validar a API e as páginas protegidas, substituir a exigência de Access no restante do domínio por uma política Bypass dessa aplicação geral. O login por senha passa a ser validado no Pages e na API. A aplicação específica de recuperação deve continuar exigindo Access. Não alterar apps/domínios do Farm ou do redirector.
6. Confirmar que `/login` abre sem Access, `/` redireciona ao login, `/api/links` e `/api/farm/sites` retornam 401 sem sessão, previews retornam 401 e `/access-recovery` solicita o e-mail autorizado. Concluir o primeiro acesso pelo próprio administrador.

Enquanto a etapa 5 não for concluída, Cloudflare continua solicitando o código de e-mail antes de mostrar o login por senha. A publicação do código não altera automaticamente as políticas de Access.

## Segurança e limites

- Hash PBKDF2-SHA256, 100.000 iterações (compatível com Workers), sal aleatório individual e HMAC prévio com segredo exclusivo do servidor. A senha não é armazenada nem registrada em logs.
- Sessões aleatórias de 256 bits, armazenadas apenas pelo hash no D1; cookie `__Host-`, Secure, HttpOnly, SameSite=Strict e sem Domain. A API valida também a versão atual da credencial e a validade da sessão.
- Login: até dez tentativas por IP por janela de 15 minutos e sessenta tentativas globais por janela. IPs são armazenados como hash temporário. As contagens são atômicas e falhas retornam a mesma mensagem para e-mail/senha incorretos.
- POST exige a origem administrativa exata. Nenhuma credencial fica no frontend ou no armazenamento local do navegador.
- Logout remove a sessão no banco; recuperação invalida todas as sessões. JWTs Access válidos continuam aceitos como identidade administrativa, para compatibilidade e recuperação.

## Verificação local

Executar `node --test --test-isolation=none tests/*.test.mjs` e `pnpm build`. Para verificar os formulários: `node scripts/login-preview.mjs`, abrir `http://localhost:4175/login`. O preview usa banco descartável e simula a confirmação Access somente no caminho de recuperação. Não acessa produção.
