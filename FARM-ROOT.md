# Publicação no domínio raiz — Farm BM

Em Criar Site / Editar site, escolha **Domínio raiz** ou **Subdomínio**.

- Domínio raiz exige escolher um domínio Farm, mas não pede subdomínio. URL: `https://dominio.com/`.
- Subdomínio mantém a URL `https://empresa.dominio.com/`. A distribuição automática continua exclusivamente neste modo.
- Domínios Farm mostra raiz Livre / Em uso por empresa, total de sites e quantidade de sites em subdomínios.
- Todos os sites cadastrados contam no limite, inclusive rascunhos, pendências e sites raiz. Cada site raiz conta como **1 site**. Criar um segundo rascunho para substituir o primeiro exige uma vaga; editar e republicar o próprio site não exige vaga adicional.

Uma raiz ocupada bloqueia a publicação com HTTP 409 e o nome da empresa. O painel oferece confirmação explícita antes de enviar `replace_root_site_id` e `replace_root_version`. A API confere ambos novamente sob bloqueio do domínio. A troca mantém o site anterior como rascunho, preserva seus dados, tema e HEAD e registra histórico. O rascunho anterior não remove a conexão Cloudflare do novo ocupante ao ser excluído ou movido. Republicar esse rascunho exige uma nova confirmação.

A conexão Cloudflare é preparada antes da troca. Os snapshots publicados são substituídos em uma única transação D1, protegida também por índice único. Falha na preparação não retira o site anterior do ar. A verificação HTTPS continua identificando site e versão publicados.

## Atualização

1. Aplique `0010_farm_root.sql` no D1 antes de publicar a API: `pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc`.
2. Publique a API e o painel pelos comandos habituais do projeto.

A migration preserva os sites existentes como `publish_mode='subdomain'`, torna `subdomain` opcional (`NULL` no modo raiz), mantém os limites e acrescenta exclusividade para a raiz publicada. Nenhuma tabela, domínio ou lógica do Cloak é alterada. O Worker de redirecionamento não precisa ser publicado por esta alteração.

Os testes usam SQLite com todas as migrations e simulação da API Cloudflare. Eles cobrem raiz livre/ocupada, confirmação incorreta, falha externa, substituição, exclusão do rascunho anterior, concorrência, limites, distribuição automática, mudanças de modo, URLs, HEAD e preservação dos dados existentes. DNS e HTTPS reais dependem da publicação no ambiente Cloudflare.

