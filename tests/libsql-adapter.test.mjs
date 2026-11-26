import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibsqlAdapter,validateTursoConfig} from '../server/libsql-adapter.mjs';
import {getDatabase} from '../server/database.mjs';
const response={columns:['count'],rows:[{count:12n}],rowsAffected:0};
test('adapter preserves bindings, converts safe integers and chooses atomic batch mode',async()=>{
 const calls=[];const client={execute:async q=>(calls.push(q),response),batch:async(q,mode)=>(calls.push({q,mode}),q.map(()=>response))};
 const db=createLibsqlAdapter(client);const base=db.prepare('SELECT ? AS count');const bound=base.bind(12);
 assert.equal(await bound.first('count'),12);assert.deepEqual(base.statement.args,[]);
 await db.batch([bound]);assert.equal(calls.at(-1).mode,'read');
 await db.batch([db.prepare('UPDATE records SET count=?').bind(1)]);assert.equal(calls.at(-1).mode,'write');
 await assert.rejects(db.batch([createLibsqlAdapter(client).prepare('SELECT 1')]),/invalid_batch/);
 assert.throws(()=>base.bind(undefined),/undefined_sql_parameter/);
});
test('unsafe integers and invalid destinations are rejected',async()=>{
 const db=createLibsqlAdapter({execute:async()=>({...response,rows:[{count:9007199254740992n}]})});
 await assert.rejects(db.prepare('SELECT 1').all(),/out_of_range/);
 for(const url of ['https://example.com','libsql://db.turso.io/?token=x','http://db.turso.io','https://user:pass@db.turso.io'])assert.throws(()=>validateTursoConfig({TURSO_DATABASE_URL:url,TURSO_AUTH_TOKEN:'test'}),/invalid_turso_url/);
 assert.equal(validateTursoConfig({TURSO_DATABASE_URL:'libsql://db.turso.io',TURSO_AUTH_TOKEN:'test'}).intMode,'bigint');
});
test('default remains D1; incomplete migration cannot silently use old database',async()=>{
 const old={};assert.equal(await getDatabase({DB:old}),old);
 await assert.rejects(getDatabase({DB:old,DATABASE_PROVIDER:'turso'}),/turso_not_configured/);
 await assert.rejects(getDatabase({DB:old,DATABASE_PROVIDER:'other'}),/unknown_database_provider/);
});
