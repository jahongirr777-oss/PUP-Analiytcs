import assert from 'node:assert/strict';
import test from 'node:test';
import {createMapper} from '../server/import-mapping.mjs';
const headers = ['Трек ID','Статус','Дата доставки','Стоимость доставки','Сумма COD','Агент','Имя клиента'];
const row = ['00123','delivered','01-Nov-2026 12:00:00','12.34','100,50','   ','Invented'];
test('delivery uses its own PVZ and preserves blank agents without retaining names', () => {
  const map = createMapper('delivery', headers);
  const result = map(row);
  assert.equal(result.id, '00123');
  assert.equal(result.pvz, null);
  assert.equal(result.pvzDefaulted, false);
  assert.equal(result.deliveryFeeMinor, 1234);
  assert.equal(result.codMinor, 10050);
  assert.ok(!JSON.stringify(result).includes('Invented'));
  assert.equal(map(row.map((v,i) => i === 5 ? '200 Example' : v)).pvz, '200 Example');
});
test('malformed headers, identifiers, amounts and rows are rejected', () => {
  assert.throws(() => createMapper('delivery', headers.slice(1)), /missing_header/);
  assert.throws(() => createMapper('delivery', [...headers, headers[0]]), /duplicate_header/);
  const map = createMapper('delivery', headers);
  assert.throws(() => map(row.slice(1)), /invalid_column_count/);
  for (const amount of ['', '-1', '1.234', '1e9', '9007199254740992']) {
    assert.throws(() => map(row.map((v,i) => i === 3 ? amount : v)));
  }
  assert.throws(() => map(row.map((v,i) => i === 0 ? '' : v)), /missing_id/);
});
test('dispatch uses first accepting agent and never defaults its PVZ', () => {
  const map = createMapper('dispatch', ['Трек ID','Статус','Дата создания','Стоимость доставки','Первый принявший агент']);
  assert.equal(map(['001','sent','date','0','Example']).pvz, 'Example');
  assert.equal(map(['001','sent','date','0','']).pvz, null);
});
