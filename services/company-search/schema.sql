-- Standalone disk-backed SQLite, NEVER a migration for the operational D1.
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE companies (
 cnpj TEXT PRIMARY KEY, razao TEXT NOT NULL, fantasia TEXT NOT NULL,
 status_code INTEGER NOT NULL, abertura TEXT NOT NULL,
 uf TEXT NOT NULL, municipio TEXT NOT NULL, cidade TEXT NOT NULL,
 cnae TEXT NOT NULL, atividade TEXT NOT NULL, matriz_filial TEXT NOT NULL,
 telefone TEXT NOT NULL, email TEXT NOT NULL, details TEXT NOT NULL
);
CREATE INDEX companies_status_date ON companies(status_code,abertura DESC,cnpj DESC);
CREATE INDEX companies_uf_date ON companies(uf,abertura DESC,cnpj DESC) WHERE status_code=2;
CREATE INDEX companies_city_date ON companies(cidade,abertura DESC,cnpj DESC) WHERE status_code=2;
CREATE INDEX companies_municipio_date ON companies(municipio,abertura DESC,cnpj DESC) WHERE status_code=2;
CREATE INDEX companies_cnae_date ON companies(cnae,abertura DESC,cnpj DESC) WHERE status_code=2;
CREATE INDEX companies_branch_date ON companies(matriz_filial,abertura DESC,cnpj DESC) WHERE status_code=2;
CREATE INDEX companies_phone_date ON companies(abertura DESC,cnpj DESC) WHERE status_code=2 AND telefone<>'';
CREATE INDEX companies_email_date ON companies(abertura DESC,cnpj DESC) WHERE status_code=2 AND email<>'';
