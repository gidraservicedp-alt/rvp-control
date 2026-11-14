import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, MapPin, RefreshCw, Search } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';

type Row = {
  id: string;
  application_number: string | null;
  title: string | null;
  address: string | null;
  status: string | null;
  contractor_stage: string | null;
  deadline_at: string | null;
};

const statusStyle = (row: Row) => {
  if (row.contractor_stage === 'problem') return 'bg-red-500/10 text-red-400 border-red-500/15';
  if (row.status === 'completed') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/15';
  if (row.status === 'in_progress') return 'bg-amber-500/10 text-amber-400 border-amber-500/15';
  return 'bg-blue-500/10 text-blue-400 border-blue-500/15';
};

export default function ObjectMap() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('applications')
      .select('id,application_number,title,address,status,contractor_stage,deadline_at')
      .not('address', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return !q ? rows : rows.filter(r => `${r.application_number} ${r.title} ${r.address}`.toLowerCase().includes(q));
  }, [rows, search]);

  const openMap = (address: string | null) => {
    if (!address) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <PageHeader pageTitle="Карта обʼєктів" pageSubtitle={`${rows.length} адрес у системі`}
      actions={<button onClick={load} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"><RefreshCw size={14}/>Оновити</button>}>
      <div className="mb-4 rounded-2xl border border-white/5 bg-[#141821] p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук обʼєкта або адреси..."
            className="w-full rounded-xl border border-white/5 bg-white/[0.025] py-2.5 pl-9 pr-3 text-sm text-slate-200 outline-none focus:border-blue-500/30"/>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-blue-500/10 bg-blue-500/[0.035] p-4 text-sm text-slate-400">
        Адреси беруться прямо із заявок. Натисни на обʼєкт — він відкриється на карті. Для карти з точними маркерами всередині RVP потрібні координати latitude/longitude або сервіс геокодування.
      </div>

      {loading ? <div className="flex justify-center py-20 text-slate-500"><Loader2 className="animate-spin" size={18}/></div> : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {filtered.map(row => (
            <button key={row.id} onClick={() => openMap(row.address)}
              className="group flex items-start gap-4 rounded-2xl border border-white/5 bg-[#141821] p-4 text-left transition hover:border-white/10 hover:bg-[#171c26]">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400"><MapPin size={17}/></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-blue-400"><bdi className="rpv-application-number">{row.application_number || '—'}</bdi></span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusStyle(row)}`}>{row.contractor_stage === 'problem' ? 'Проблема' : row.status || 'new'}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-200">{row.title || 'Обʼєкт'}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{row.address}</p>
              </div>
              <ExternalLink size={15} className="mt-1 text-slate-600 transition group-hover:text-blue-400"/>
            </button>
          ))}
        </div>
      )}
    </PageHeader>
  );
}
