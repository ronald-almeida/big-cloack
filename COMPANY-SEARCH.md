# Busca de CNPJs no Farm BM

## Arquitetura

O painel usa apenas `/api/farm/companies/*` na API existente, com a mesma autenticação e validação de origem. O Worker consulta um serviço HTTPS separado com token exclusivo. O serviço usa Node 24 e SQLite **em disco próprio**, não D1. O frontend não conhece o banco nem recebe a credencial. É possível substituir esse serviço por PostgreSQL ou outro índice mantendo o contrato.

A D1 operacional recebe apenas a migration `0008_farm_companies.sql`: seleções, reservas, uso, última consulta e índice de CNPJ nos sites. Nenhum registro da base nacional é importado na D1. O redirector, o classificador e as tabelas do Cloak não mudam.

## Preparar a fonte oficial

Fontes: [arquivos públicos da Receita](https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/) e [layout oficial](https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf). Não há integração com CNPJ Biz. Baixe os ZIPs da mesma competência diretamente do diretório oficial: `Empresas0.zip` a `Empresas9.zip`, `Estabelecimentos0.zip` a `Estabelecimentos9.zip`, `Cnaes.zip`, `Municipios.zip`. Preserve os nomes e coloque-os numa pasta exclusiva. A importação não extrai caminhos arbitrários dos ZIPs: lê CSV em streaming, em Latin-1, delimitado por ponto e vírgula. Nenhum arquivo de sócios/CPF é necessário para esta busca.

```sh
python services/company-search/import_receita.py --directory /srv/receita/2026-10-zips --snapshot 2026-10 --output /srv/receita/2026-10.sqlite
```

Use a competência realmente disponível. O comando exige todos os fragmentos, registra SHA-256 local de cada ZIP, valida campos e vínculo empresa/estabelecimento, normaliza datas, junta razão social/CNAE/município e cria índices após a carga. Usa tabelas de trabalho em disco e lotes de 10.000 linhas. O marcador `ready` só aparece após a carga; falhas retêm arquivo incompleto para diagnóstico e o serviço recusa iniciá-lo. O hash é inventário local, não assinatura de autenticidade: obtenha os ZIPs no domínio oficial. O comando nunca sobrescreve um banco existente. `--allow-partial` é explícito para recortes/testes e aparece como carga parcial no painel.

Dimensione disco para ZIPs, staging, banco e índices, e para duas versões durante a troca. A carga nacional e o desempenho no volume completo **ainda precisam ser medidos no host de destino**. Não há estimativa de capacidade baseada apenas nos testes pequenos. SQLite é a implementação inicial, adequada para um serviço de leitura de snapshots; não depende dos limites de tamanho da D1. Índices cobrem situação/data, UF, município, CNAE, matriz/filial e contato. Paginação usa `(abertura,cnpj)` em vez de OFFSET.

## Iniciar e conectar

No host separado, configure as variáveis de `services/company-search/.env.example` no gerenciador de processos (o script não lê `.env` automaticamente) e execute:

```sh
node services/company-search/server.mjs
```

O banco principal é aberto somente para leitura; exclusões de uso usam uma tabela temporária. O serviço escuta em loopback por padrão. Exponha-o através de proxy HTTPS com certificado válido; mantenha token Bearer obrigatório e limite de requisições no proxy. Para atualizar, construa outra versão, inicie uma instância nela e troque o proxy; mantenha a anterior para rollback. Cursores de outra competência são rejeitados, solicitando nova busca.

No Worker administrativo configure `COMPANY_SEARCH_URL` (origem HTTPS do serviço) e o secret `COMPANY_SEARCH_TOKEN` (mesmo token do serviço):

```sh
pnpm exec wrangler secret put COMPANY_SEARCH_TOKEN -c wrangler.api.jsonc
pnpm exec wrangler secret put COMPANY_SEARCH_URL -c wrangler.api.jsonc
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.api.jsonc
pnpm run deploy:api
pnpm run build
pnpm run deploy:panel
```

Não execute deploy do redirector para esta função. Sem configuração/carga, a busca informa indisponibilidade (503), sem inventar resultados e sem afetar a criação manual existente. Migre antes da nova API; em rollback reverta os bundles e preserve as tabelas aditivas. Aplicar migrations e publicar em produção não faz parte do teste local.

## Contrato interno

- `GET /api/farm/companies/search`: `quantity` (1–100, padrão 10), `age` (meses ou `any`, padrão 12), `opened_from`/`opened_to` (ISO, inclusivas), `uf`, `municipio` (nome exato ou código **Receita**, não IBGE), `cnae` (principal), `matriz_filial` (1/2), `has_phone`, `has_email`, `cursor`. Retorna `results`, `requested`, `returned`, `snapshot`, `partial`, `next_cursor`, `exhausted`. Empresas ativas no snapshot; não representa garantia de situação em tempo real.
- `GET /api/farm/companies/count`: mesmos filtros, contagem exata naquela consulta, excluindo usados, reservas válidas e empresas com última consulta não ativa.
- `GET /api/farm/companies/company/:cnpj`: dados oficiais disponíveis, incluindo campos originais de Empresa e Estabelecimento, sem sair da lista.
- `POST .../company/:cnpj/reserve`: consulta BrasilAPI sem reutilizar snapshot, exige situação 2, retorna dados e token de reserva de 30 minutos. Não usa fallback manual para validar. Resposta sem situação, falha, timeout, divergência de CNPJ ou HTTP 429 bloqueiam a seleção. CNPJ inativo recebe 409 e pode ser substituído na lista.
- `POST .../company/:cnpj/verify`: reconsulta online e registra `verified_at`, status, abertura e demais dados. O horário é da **consulta ao provedor**, não garantia de atualização instantânea da Receita. A BrasilAPI pode manter cache próprio.
- `POST .../company/:cnpj/release`: recebe `reservation_token`; só libera aquela reserva.
- `GET .../selections?state=used|reserved&after=...&quantity=25`: histórico paginado.

O serviço separado recebe POST `/search`, `/count` com `{filters,limit,cursor,exclude}` e POST `/company/:cnpj`. O Worker envia somente CNPJs excluídos do pequeno registro operacional. Limite inicial: 100.000 exclusões e 2 MB por requisição. Ultrapassar o limite gera erro explícito; antes desse patamar, evolua a sincronização de disponibilidade no serviço para evitar transferir o histórico em cada busca. Contagens amplas são mais custosas que páginas; a UI não dispara contagem automaticamente. Todas as chamadas ao motor têm timeout de 15 segundos. Teste combinações seletivas e amplas com a base carregada antes de abrir a função em produção.

## Estados e consistência

O Farm valida CNPJs numéricos e alfanuméricos pelo [cálculo oficial do DV](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). O uso continua condicionado ao provedor online conseguir confirmar o cadastro; não há fallback para aprovar um número que o provedor não reconheça. O validador antigo do Cloak permanece inalterado.

`unused` é implícito para empresas nunca selecionadas. Reconsultas ou reservas criam metadados na D1. Reserva expirada/cancelada volta a `unused`. O UPDATE condicional permite apenas uma seleção simultânea. Ao salvar um site, um trigger valida token/CNPJ/prazo/status e marca `used` na **mesma transação**. Um rascunho já consome o CNPJ; falha de publicação não o libera. Exclusão de site preserva histórico `used`. Sites antigos são marcados `used` pela migration; criação manual e alteração de CNPJ também registram uso, preservando os fluxos existentes. A regra de reserva protege o novo fluxo; a criação manual preexistente continua disponível.

Reservas não salvas expiram em 30 minutos. Cancelar ou “Liberar reserva” as libera antes. “Criar Site” retoma o formulário reservado enquanto o painel permanece aberto. Recarregar perde o formulário local, mas a reserva expira normalmente. Reconsulta que indicar situação não ativa bloqueia salvar uma reserva ainda não consumida. Empresa rejeitada fica fora da busca até uma reconsulta online confirmar que voltou a estar ativa.

## Verificação

```sh
node --test --test-isolation=none tests/*.test.mjs
python -m unittest discover -s services/company-search -p 'test_*.py'
pnpm build
node scripts/farm-preview.mjs
```

O preview local contém 35 empresas **sintéticas**, engine real em SQLite separado, API autenticada real e simulações de BrasilAPI/Cloudflare. Teste: Farm BM → Buscar CNPJs → 10 → Verificar dados → Usar CNPJ → formulário preenchido → Verificar CNPJ → Publicar → Utilizados. “Buscar mais 10” acumula resultados com cursor. Os testes cobrem inativo, provedor indisponível, falta de status, quantidade insuficiente, filtros, concorrência, expiração, replay, alteração de status e exclusão. Dados reais, ingestão nacional, HTTPS remoto e limites da BrasilAPI exigem validação após configurar o ambiente.
