import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('migration protects activation, duplicate jobs and nonnegative counters', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../migrations/0001_import_metadata.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO datasets(id,state) VALUES ('v1','staging')");
    assert.throws(() => db.exec("INSERT INTO active_dataset VALUES (1,'v1')"));
    db.exec("UPDATE datasets SET state='ready' WHERE id='v1'; INSERT INTO active_dataset VALUES (1,'v1')");
    assert.throws(() => db.exec("UPDATE datasets SET state='failed' WHERE id='v1'"));
    db.exec("INSERT INTO datasets(id,state) VALUES ('v2','staging')");
    assert.throws(() => db.exec("UPDATE active_dataset SET dataset_id='v2'"));
    const insert = db.prepare("INSERT INTO import_jobs(id,dataset_id,source_kind,file_sha256,mapping_version,state) VALUES (?, 'v1','dispatch',?,'1','pending')");
    insert.run('j1', 'a'.repeat(64));
    assert.throws(() => insert.run('j2', 'a'.repeat(64)));
    assert.throws(() => db.exec('UPDATE import_jobs SET processed_rows=-1'));
  } finally { db.close(); }
});
