"""Build an immutable, indexed SQLite snapshot from official Receita ZIP files.
Python 3.11+, standard library only. Never connects to operational D1.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sqlite3
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

EMPRESA_FIELDS = ['cnpj_basico', 'razao_social', 'natureza_juridica', 'qualificacao_responsavel', 'capital_social', 'porte', 'ente_federativo']
EST_FIELDS = ['cnpj_basico', 'cnpj_ordem', 'cnpj_dv', 'matriz_filial', 'nome_fantasia', 'situacao_cadastral', 'data_situacao', 'motivo_situacao', 'cidade_exterior', 'pais', 'data_inicio_atividade', 'cnae_principal', 'cnaes_secundarios', 'tipo_logradouro', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'uf', 'municipio', 'ddd_1', 'telefone_1', 'ddd_2', 'telefone_2', 'ddd_fax', 'fax', 'email', 'situacao_especial', 'data_situacao_especial']

def rows(path, expected):
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.endswith('/'):
                continue
            with z.open(name) as raw:
                for n, row in enumerate(csv.reader(io.TextIOWrapper(raw, encoding='latin-1', newline=''), delimiter=';'), 1):
                    if len(row) != expected:
                        raise ValueError(f'{path.name}/{name}:{n}: expected {expected} fields, got {len(row)}')
                    yield [v.strip() for v in row]

def iso(value):
    if not value or value == '00000000':
        return ''
    if not re.fullmatch(r'\d{8}', value):
        raise ValueError('Invalid opening date: ' + value)
    return date(int(value[:4]), int(value[4:6]), int(value[6:])).isoformat()

def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def batched(db, sql, values):
    batch = []
    for row in values:
        batch.append(row)
        if len(batch) == 10000:
            db.executemany(sql, batch)
            db.commit()
            batch.clear()
    if batch:
        db.executemany(sql, batch)
        db.commit()

def build(directory, output, snapshot, partial=False):
    directory, output = Path(directory), Path(output)
    if output.exists():
        raise ValueError('Output already exists. Build a new snapshot; never overwrite the live database.')
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', snapshot):
        raise ValueError('Snapshot must be YYYY-MM')
    files = {p.name.lower(): p for p in directory.glob('*.zip')}
    required = ['cnaes.zip', 'municipios.zip'] + [f'{kind}{i}.zip' for kind in ('empresas', 'estabelecimentos') for i in range(10)]
    if not partial and any(n not in files for n in required):
        raise ValueError('Missing official ZIPs: ' + ', '.join(n for n in required if n not in files))
    empresas = sorted(p for n, p in files.items() if re.fullmatch(r'empresas\d+\.zip', n))
    estabelecimentos = sorted(p for n, p in files.items() if re.fullmatch(r'estabelecimentos\d+\.zip', n))
    if not empresas or not estabelecimentos or any(n not in files for n in ['cnaes.zip', 'municipios.zip']):
        raise ValueError('Empresas, Estabelecimentos, CNAEs and Municípios are required.')
    manifest = []
    for path in [files['cnaes.zip'], files['municipios.zip'], *empresas, *estabelecimentos]:
        with path.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        manifest.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest})
    db = sqlite3.connect(output)
    try:
        db.execute('PRAGMA temp_store=FILE')
        db.execute('PRAGMA cache_size=-65536')
        schema = Path(__file__).with_name('schema.sql').read_text(encoding='utf-8')
        # Build indexes only after bulk insertion.
        tables, indexes = schema.split('CREATE INDEX', 1)
        db.executescript(tables)
        db.executescript('CREATE TABLE source_empresas(base TEXT PRIMARY KEY,razao TEXT,details TEXT); CREATE TABLE cnaes(code TEXT PRIMARY KEY,name TEXT); CREATE TABLE municipios(code TEXT PRIMARY KEY,name TEXT); CREATE TABLE source_est(cnpj TEXT PRIMARY KEY,base TEXT,fantasia TEXT,status_code INTEGER,abertura TEXT,uf TEXT,municipio TEXT,cnae TEXT,matriz_filial TEXT,telefone TEXT,email TEXT,details TEXT);')
        for table, filename in [('cnaes','cnaes.zip'), ('municipios','municipios.zip')]:
            batched(db, f'INSERT INTO {table} VALUES(?,?)', rows(files[filename], 2))
        for path in empresas:
            print('Importing', path.name, flush=True)
            batched(db, 'INSERT INTO source_empresas VALUES(?,?,?)', ((r[0], r[1], dumps(dict(zip(EMPRESA_FIELDS, r)))) for r in rows(path, 7)))
        def establishments(path):
            for r in rows(path, 30):
                cnpj = ''.join(r[:3]).upper()
                if not re.fullmatch(r'[0-9A-Z]{12}\d{2}', cnpj):
                    raise ValueError('Invalid CNPJ in official input: ' + cnpj)
                yield (cnpj, r[0], r[4], int(r[5]), iso(r[10]), r[19].upper(), r[20], r[11], r[3], re.sub(r'\D','',r[21]+r[22]), r[27], dumps(dict(zip(EST_FIELDS, r))))
        for path in estabelecimentos:
            print('Importing', path.name, flush=True)
            batched(db, 'INSERT INTO source_est VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', establishments(path))
        missing = db.execute('SELECT COUNT(*) FROM source_est s LEFT JOIN source_empresas e ON e.base=s.base WHERE e.base IS NULL').fetchone()[0]
        if missing:
            raise ValueError(f'{missing} establishments without parent company; incomplete snapshot.')
        db.execute("""INSERT INTO companies SELECT s.cnpj,e.razao,s.fantasia,s.status_code,s.abertura,s.uf,s.municipio,UPPER(COALESCE(m.name,'')),s.cnae,s.cnae||' - '||COALESCE(c.name,''),s.matriz_filial,s.telefone,s.email,json_object('empresa',json(e.details),'estabelecimento',json(s.details)) FROM source_est s JOIN source_empresas e ON e.base=s.base LEFT JOIN municipios m ON m.code=s.municipio LEFT JOIN cnaes c ON c.code=s.cnae""")
        count = db.execute('SELECT COUNT(*) FROM companies').fetchone()[0]
        if count == 0:
            raise ValueError('Empty import')
        db.commit()
        db.executescript('CREATE INDEX' + indexes)
        db.executescript('DROP TABLE source_est; DROP TABLE source_empresas; DROP TABLE municipios; DROP TABLE cnaes; ANALYZE;')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        db.executemany('INSERT INTO metadata VALUES(?,?)', [('snapshot',snapshot),('ready','1'),('partial',str(int(partial))),('source','https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/'),('manifest',dumps(manifest)),('imported_at',datetime.now(timezone.utc).isoformat()),('count',str(count))])
        db.commit()
        print(f'Ready: {count} establishments in {output}', flush=True)
    except Exception:
        # Retain the incomplete file for diagnosis, without a usable ready marker.
        db.rollback()
        try:
            db.execute("DELETE FROM metadata WHERE key='ready'")
            db.commit()
        except sqlite3.Error:
            pass
        raise
    finally:
        db.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--allow-partial', action='store_true', help='Explicit subset/test import; recorded in metadata')
    args = parser.parse_args()
    build(args.directory, args.output, args.snapshot, args.allow_partial)
