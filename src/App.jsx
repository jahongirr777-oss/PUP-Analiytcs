import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, CircleAlert,
  Database, FileUp, LayoutDashboard, Menu, Package, Search, ShieldCheck, Truck, Users, X,
} from 'lucide-react';

const locations = [
  { name: 'Бек Барака', sent: 3200, delivered: 2850, sendAmount: 24500000, deliveryAmount: 18900000 },
  { name: 'Юнусобод', sent: 2300, delivered: 2100, sendAmount: 17300000, deliveryAmount: 14200000 },
  { name: 'Мирзо Улуғбек', sent: 1850, delivered: 1700, sendAmount: 12500000, deliveryAmount: 11700000 },
  { name: 'Яккасарой', sent: 1440, delivered: 1360, sendAmount: 9800000, deliveryAmount: 9200000 },
];
const items = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Отправка', icon: Package },
  { label: 'Доставка', icon: Truck },
  { label: 'Клиентлар', icon: Users },
  { label: 'Статуслар', icon: BarChart3 },
  { label: 'Файллар', icon: FileUp },
];
const format = value => new Intl.NumberFormat('ru-RU').format(value);
const money = value => format(value) + ' сўм';

function Sidebar({ page, setPage, open, setOpen }) {
  return <>
    {open && <button className="fixed inset-0 z-20 bg-black/65 md:hidden" aria-label="Менюни ёпиш" onClick={() => setOpen(false)} />}
    <aside className={`fixed left-0 top-0 z-30 flex h-screen w-64 flex-col border-r border-slate-800 bg-[#0d1729] p-5 transition-transform md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-500/20 p-2.5 text-blue-300"><Activity size={23}/></span><div><div className="font-semibold tracking-wide">PUP Analytics</div><div className="text-xs text-slate-400">Operations Dashboard</div></div></div>
        <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Ёпиш"><X size={20}/></button>
      </div>
      <nav className="space-y-1" aria-label="Асосий меню">{items.map(item => {
        const Icon = item.icon;
        return <button key={item.label} onClick={() => {setPage(item.label); setOpen(false);}} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${page === item.label ? 'bg-blue-500/15 font-semibold text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon size={19}/>{item.label}</button>;
      })}</nav>
      <div className="mt-auto rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">Демо режим. Ҳақиқий CSV ва база ҳали уланмаган.</div>
    </aside>
  </>;
}
function Panel({ title, children, aside }) {
  return <section className="rounded-2xl border border-slate-800 bg-[#121f33] p-5 shadow-lg shadow-black/10"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{title}</h2>{aside}</div>{children}</section>;
}
function LoadingScreen({ progress, status }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#0b1220] p-6"><div className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#121f33] p-8 text-center shadow-2xl">
    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300"><Activity size={34}/></div>
    <h1 className="mb-2 text-2xl font-bold">PUP Analytics</h1><p className="mb-8 text-sm text-slate-400">{status}</p>
    <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} className="h-2.5 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-blue-400 transition-all duration-300" style={{width: progress + '%'}} /></div>
    <div className="mt-3 text-right text-xs text-blue-300">{progress}%</div><p className="mt-7 text-xs text-slate-500">База улангунча фақат демо маълумот кўрсатилади.</p>
  </div></div>;
}
export default function App() {
  const [page, setPage] = useState('Dashboard');
  const [period, setPeriod] = useState('Ой');
  const [pvz, setPvz] = useState('Ҳаммаси');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Сервер билан алоқа текширилмоқда...');
  const [health, setHealth] = useState({ ok: false, mode: 'demo' });

  useEffect(() => {
    let alive = true;
    async function initialize() {
      setProgress(20);
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (!response.ok) throw new Error('Server unavailable');
        const data = await response.json();
        if (!alive) return;
        setHealth(data); setProgress(65); setStatus('Маълумот версияси текширилди...');
      } catch {
        if (!alive) return;
        setHealth({ ok: false, mode: 'demo' }); setProgress(65); setStatus('Демо режими тайёрланмоқда...');
      }
      if (!alive) return;
      setProgress(100); setLoading(false);
    }
    initialize();
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => locations.filter(x => pvz === 'Ҳаммаси' || x.name === pvz), [pvz]);
  const total = field => rows.reduce((sum, row) => sum + row[field], 0);
  const cards = [
    { label: 'Отправка сони', value: format(total('sent')), foot: 'Жўнатмалар', icon: Package, color: 'text-blue-300' },
    { label: 'Отправка суммаси', value: money(total('sendAmount')), foot: 'Шартли сумма', icon: ArrowUpRight, color: 'text-sky-300' },
    { label: 'Доставка сони', value: format(total('delivered')), foot: 'Етказилганлар', icon: Truck, color: 'text-emerald-300' },
    { label: 'Доставка суммаси', value: money(total('deliveryAmount')), foot: 'Шартли сумма', icon: ArrowDownToLine, color: 'text-teal-300' },
  ];
  if (loading) return <LoadingScreen progress={progress} status={status}/>;
  return <div className="min-h-screen bg-[#0b1220]">
    <Sidebar page={page} setPage={setPage} open={open} setOpen={setOpen}/>
    <main className="mx-auto max-w-[1600px] px-4 py-6 md:ml-64 md:px-8 md:py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><button className="rounded-lg border border-slate-700 p-2 md:hidden" aria-label="Меню" onClick={() => setOpen(true)}><Menu size={20}/></button><div><h1 className="text-2xl font-bold tracking-tight">{page}</h1><p className="text-sm text-slate-400">ПВЗ операциялари таҳлили</p></div></div>
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"><CircleAlert size={15}/> Демо · база уланмаган</div>
      </header>
      {page === 'Dashboard' || page === 'Отправка' || page === 'Доставка' ? <>
        <div className="mb-6 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-[#121f33] px-3 py-2 text-sm text-slate-300"><CalendarDays size={17}/><span>Давр</span><select value={period} onChange={e => setPeriod(e.target.value)} className="bg-transparent text-white outline-none"><option className="bg-[#121f33]">Кун</option><option className="bg-[#121f33]">Ҳафта</option><option className="bg-[#121f33]">Ой</option><option className="bg-[#121f33]">Йил</option></select></label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-[#121f33] px-3 py-2 text-sm text-slate-300"><Search size={16}/><span>ПВЗ</span><select value={pvz} onChange={e => setPvz(e.target.value)} className="max-w-44 bg-transparent text-white outline-none">{['Ҳаммаси', ...locations.map(x => x.name)].map(x => <option key={x} className="bg-[#121f33]">{x}</option>)}</select></label>
          <span className="self-center text-xs text-slate-500">Сана фильтри база улангач ишлайди.</span>
        </div>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.filter(card => page === 'Dashboard' || (page === 'Отправка' ? card.label.startsWith('Отправка') : card.label.startsWith('Доставка'))).map(card => {
          const Icon = card.icon;
          return <div key={card.label} className="rounded-2xl border border-slate-800 bg-[#121f33] p-5"><div className="mb-4 flex items-center justify-between"><span className="text-sm text-slate-400">{card.label}</span><Icon size={20} className={card.color}/></div><div className="break-words text-2xl font-bold">{card.value}</div><div className="mt-2 text-xs text-slate-500">{card.foot}</div></div>;
        })}</div>
        <Panel title="ПВЗлар бўйича ҳисобот" aside={<span className="text-xs text-slate-500">Намуна маълумотлар</span>}>
          <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead><tr className="border-b border-slate-700 text-xs text-slate-400"><th className="pb-3">ПВЗ</th><th className="pb-3 text-right">Отправка</th><th className="pb-3 text-right">Отправка суммаси</th><th className="pb-3 text-right">Доставка</th><th className="pb-3 text-right">Доставка суммаси</th></tr></thead><tbody>{rows.map(row => <tr key={row.name} className="border-b border-slate-800 last:border-0"><td className="py-4 font-medium">{row.name}</td><td className="py-4 text-right">{format(row.sent)}</td><td className="py-4 text-right">{money(row.sendAmount)}</td><td className="py-4 text-right">{format(row.delivered)}</td><td className="py-4 text-right">{money(row.deliveryAmount)}</td></tr>)}</tbody></table></div>
        </Panel>
      </> : <Panel title={page}>{page === 'Файллар' ? <div className="space-y-3 text-sm text-slate-400"><FileUp size={32} className="text-blue-300"/><p>CSV импорт кейинги босқичда хавфсиз API ва база билан уланади.</p><p>Ҳозир файл юклаш очиқ эмас: маълумотлар тасодифан йўқолишини олдини оламиз.</p></div> : <div className="space-y-3 text-sm text-slate-400"><Database size={32} className="text-blue-300"/><p>Бу бўлим ҳақиқий CSV маълумотларини улагандан кейин ишга тушади.</p></div>}</Panel>}
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>PUP Analytics v0.1 · Demo</span><span className="flex items-center gap-2">{health.ok ? <CheckCircle2 size={14} className="text-green-400"/> : <CircleAlert size={14}/>} {health.ok ? 'API ишлаяпти, база уланмаган' : 'API ҳали уланмаган'} · Ҳақиқий синхронизация мавжуд эмас</span></footer>
    </main>
  </div>;
}
