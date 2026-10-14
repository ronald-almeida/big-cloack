import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

test("root migration preserves populated Farm rows, snapshots, history and constraints", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f < "0010")
      .sort()) {
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    }
    db.exec(`INSERT INTO farm_domains(id,hostname,active,zone_status,site_limit) VALUES('domain','example.com',1,'active',2);
      INSERT INTO farm_sites(id,domain_id,subdomain,company,cnpj,data,theme,head,status,published_data,published_head,published_theme,published_version,cloudflare_domain_id,pending_address)
      VALUES('legacy','domain','empresa','Empresa','123','{}','id01','custom','published','{}','custom','id01',1,'binding','{"hostname":"old.example"}');
      INSERT INTO farm_deployments(id,site_id,company,hostname,action,status) VALUES('history','legacy','Empresa','empresa.example.com','publish','published');`);
    const before = db.prepare("SELECT * FROM farm_sites").get();
    db.exec(readFileSync(new URL("0010_farm_root.sql", dir), "utf8"));
    const { publish_mode, ...after } = db
      .prepare("SELECT * FROM farm_sites")
      .get();
    assert.equal(publish_mode, "subdomain");
    assert.deepEqual({ ...before }, after);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM farm_deployments").get().n,
      1,
    );
    db.exec(
      `INSERT INTO farm_sites(id,domain_id,publish_mode,subdomain,company,cnpj,data,theme) VALUES('root','domain','root',NULL,'Raiz','123','{}','id01')`,
    );
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO farm_sites(id,domain_id,subdomain,company,cnpj,data,theme) VALUES('excess','domain','extra','Extra','123','{}','id01')`,
        ),
      /FARM_CAPACITY/,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

