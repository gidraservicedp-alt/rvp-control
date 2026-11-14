import { useEffect, useState } from 'react';
import { Building2, Loader2, RefreshCw } from 'lucide-react';
import { portal, type Site } from '@/portal/api';
import { loadNetworkSites } from './siteOptions';

const selectCls = 'w-full min-w-0 bg-[#182332] border border-blue-300/20 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-400 disabled:opacity-50';

export default function ExistingSitePicker({value, onChange, error}: {
  value: Site | null; onChange: (site: Site | null) => void; error?: string;
}) {
  const [networks, setNetworks] = useState<string[]>([]), [network, setNetwork] = useState(value?.passport_network || '');
  const [sites, setSites] = useState<Site[]>([]);
  const [loadingNetworks, setLoadingNetworks] = useState(true), [loadingSites, setLoadingSites] = useState(false);
  const [networkError, setNetworkError] = useState(''), [siteError, setSiteError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadingNetworks(true); setNetworkError('');
    portal<{networks: string[]}>('office.networks').then(r => { if (active) setNetworks(r.networks); })
      .catch(e => { if (active) setNetworkError(e.message); })
      .finally(() => { if (active) setLoadingNetworks(false); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setSites([]); setSiteError(''); setLoadingSites(!!network);
    if (network) loadNetworkSites(network, (selected, page) => portal('office.sites', {network: selected, page}), () => active)
      .then(rows => { if (active && rows) setSites(rows); })
      .catch(e => { if (active) setSiteError(e.message); })
      .finally(() => { if (active) setLoadingSites(false); });
    return () => { active = false; };
  }, [network, revision]);

  return <section className="space-y-3" aria-label="Вибір паспорта об’єкта">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <label htmlFor="new-application-network" className="block text-xs text-slate-400">Мережа <span className="text-orange-300">*</span></label>
        <select id="new-application-network" className={selectCls} value={network} disabled={loadingNetworks || !!networkError}
          onChange={e => { setNetwork(e.target.value); setSites([]); onChange(null); }}>
          <option value="">{loadingNetworks ? 'Завантажуємо мережі…' : 'Оберіть мережу'}</option>
          {networks.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <label htmlFor="new-application-site" className="block text-xs text-slate-400">Об’єкт / код АЗК <span className="text-orange-300">*</span></label>
        <select id="new-application-site" className={selectCls} value={value?.id || ''} aria-invalid={!!error} aria-describedby={error ? 'new-site-error' : undefined}
          disabled={!network || loadingSites || !!siteError} onChange={e => onChange(sites.find(s => s.id === e.target.value) || null)}>
          <option value="">{!network ? 'Спочатку оберіть мережу' : loadingSites ? 'Завантажуємо АЗК…' : 'Оберіть АЗК зі списку'}</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.code} · {s.region} · {s.address}</option>)}
        </select>
      </div>
    </div>
    {(loadingSites || loadingNetworks) && <p role="status" className="flex gap-2 items-center text-xs text-sky-300"><Loader2 size={14} className="animate-spin" />Завантажуємо паспорти…</p>}
    {(networkError || siteError) && <p role="alert" className="text-sm text-red-300">{networkError || siteError}</p>}
    {!loadingNetworks && !networkError && !networks.length && <p className="text-sm text-slate-400">Спочатку додайте паспорт у розділі «Об’єкти».</p>}
    {network && !loadingSites && !siteError && !sites.length && <p className="text-sm text-slate-400">У цій мережі ще немає АЗК. Додайте паспорт у розділі «Об’єкти».</p>}
    {value && <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-4 space-y-2" aria-label="Вибраний паспорт">
      <div className="flex items-start gap-2 text-sky-200"><Building2 size={18} className="shrink-0 mt-0.5" /><strong className="text-sm break-words">{value.label}</strong></div>
      <p className="text-sm text-slate-200 break-words">{value.address}</p>
      <p className="text-xs text-slate-400">{value.region}</p>
    </div>}
    <div className="flex flex-wrap justify-between gap-2 items-center">
      <p className="text-xs text-slate-400">Адреса й назва — з паспорта об’єкта.</p>
      <button type="button" onClick={() => { onChange(null); setSites([]); setRevision(r => r + 1); }}
        disabled={loadingNetworks || loadingSites} className="inline-flex items-center gap-1.5 text-xs text-sky-300 disabled:opacity-50">
        <RefreshCw size={13} /> Оновити список
      </button>
    </div>
    {error && <p id="new-site-error" role="alert" className="text-xs text-red-300">{error}</p>}
  </section>;
}
