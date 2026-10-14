import csv
import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from import_receita import build

class ImportTests(unittest.TestCase):
    def zip(self, folder, name, rows):
        s = io.StringIO(newline='')
        csv.writer(s, delimiter=';', quoting=csv.QUOTE_ALL).writerows(rows)
        with zipfile.ZipFile(folder / name, 'w') as z:
            z.writestr('data.csv', s.getvalue().encode('latin-1'))

    def fixtures(self, folder, parent='10000001'):
        self.zip(folder,'Empresas0.zip',[[parent,'EMPRESA; COM ACENTO Á','2062','49','1000,00','01','']])
        self.zip(folder,'Cnaes.zip',[['6201501','Desenvolvimento de programas']])
        self.zip(folder,'Municipios.zip',[['3849','SALVADOR']])
        row=['10000001','0001','07','1','NOME FANTASIA','02','20260101','00','','','20260101','6201501','','RUA','TESTE','10','','CENTRO','40000000','BA','3849','71','999999999','','','','','teste@example.com','','']
        self.zip(folder,'Estabelecimentos0.zip',[row])

    def test_import_official_layout_and_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp); self.fixtures(folder); out=folder/'snapshot.sqlite'
            build(folder,out,'2026-01',True)
            with closing(sqlite3.connect(out)) as db:
                row=db.execute('SELECT razao,abertura,cidade,telefone,details FROM companies').fetchone()
                self.assertEqual(row[:4],('EMPRESA; COM ACENTO Á','2026-01-01','SALVADOR','71999999999'))
                self.assertEqual(json.loads(row[4])['empresa']['porte'],'01')
                meta=dict(db.execute('SELECT * FROM metadata'))
                self.assertEqual(meta['ready'],'1'); self.assertEqual(meta['partial'],'1')
                self.assertEqual(len(json.loads(meta['manifest'])),4)
                plan=db.execute("EXPLAIN QUERY PLAN SELECT cnpj FROM companies WHERE status_code=2 AND uf='BA' AND abertura>='2025-01-01' ORDER BY abertura DESC,cnpj DESC LIMIT 10").fetchall()
                self.assertTrue(any('INDEX' in str(x) for x in plan))
            with self.assertRaises(ValueError): build(folder,out,'2026-01',True)

    def test_incomplete_national_and_broken_join_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp); self.fixtures(folder,'99999999')
            with self.assertRaisesRegex(ValueError,'Missing official'): build(folder,folder/'full.sqlite','2026-01')
            out=folder/'broken.sqlite'
            with self.assertRaisesRegex(ValueError,'without parent'): build(folder,out,'2026-01',True)
            with closing(sqlite3.connect(out)) as db:
                self.assertIsNone(db.execute("SELECT value FROM metadata WHERE key='ready'").fetchone())

if __name__=='__main__': unittest.main()
