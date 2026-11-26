// Pure mapping only. No upload, logging, database access or client names.
export const mappingVersion = 'dispatch-details-v3';
const fields = {
  dispatch: ['Трек ID', 'Дата создания', 'Стоимость доставки', 'Первый принявший агент'],
  delivery: ['Трек ID', 'Статус', 'Дата доставки', 'Стоимость доставки', 'Сумма COD', 'Агент'],
};

function money(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error('invalid_amount');
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount_out_of_range');
  return Number(minor);
}

export function createMapper(kind, headers) {
  if (!Object.hasOwn(fields, kind)) throw new Error('invalid_source_kind');
  const names = headers.map(x => x.replace(/^\uFEFF/, '').trim());
  if (new Set(names).size !== names.length) throw new Error('duplicate_header');
  if (fields[kind].some(name => !names.includes(name))) throw new Error('missing_header');
  const index = Object.fromEntries(names.map((name, i) => [name, i]));
  return row => {
    if (row.length !== names.length) throw new Error('invalid_column_count');
    const get = name => String(row[index[name]] ?? '').trim();
    const id = get('Трек ID');
    if (!id) throw new Error('missing_id');
    const rawDate = get(kind === 'dispatch' ? 'Дата создания' : 'Дата доставки');
    // Preserve source time until its timezone is confirmed. Never guess UTC.
    if (!rawDate) throw new Error('missing_date');
    const rawPvz = get(kind === 'dispatch' ? 'Первый принявший агент' : 'Агент');
    return {
      id, sourceKind: kind, status: get('Статус'), sourceDate: rawDate,
      deliveryFeeMinor: money(get('Стоимость доставки')),
      codMinor: kind === 'delivery' ? money(get('Сумма COD')) : null,
      pvz: rawPvz || null,
      pvzDefaulted: false,
      ...(kind==='dispatch'?{
        clientType: get('Тип клиента')==='Мерчант'?'legal':get('Тип клиента')==='Клиент'?'individual':'unknown',
        paymentType: ({'Корпоративная оплата':'corporate','Наличные от получателя':'recipient_cash','Наличные от отправителя':'sender_cash','Не оплачено':'unpaid'})[get('Статус оплаты')]||'unknown',
        recipientDistrict: get('Регион получателя'),
      }:{}),
      mappingVersion,
    };
  };
}
