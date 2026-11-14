import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Download, Droplets, RefreshCw } from 'lucide-react';
import { portal, currentMonth, monthName, fmt } from '@/portal/api';
import { Pager } from '@/portal/Portal';
import { volumeCsv, type VolumeFilters, type VolumeReport } from './volume';
import './volume.css';

export default function RPVCounter({ compact=false, fixedSite }: { compact?: boolean; fixedSite?: string }) {
  const titleId=useId();
  const initial=new URLSearchParams(location.search);
  const [clock,setClock]=useState(currentMonth);
  const [chosenMonth,setChosenMonth]=useState(()=>{
    const value=!compact ? initial.get('month')||'' : '';
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&value>='2020-01'&&value<clock ? value : '';
  });
  const [network,setNetwork]=useState(()=>!compact ? initial.get('network')||'' : '');
  const [region,setRegion]=useState(()=>!compact ? initial.get('region')||'' : '');
  const [site,setSite]=useState(()=>fixedSite || (!compact ? initial.get('site')||'' : ''));
  const [group,setGroup]=useState<VolumeFilters['group']>('network');
  const [page,setPage]=useState(0),[revision,setRevision]=useState(0);
  const [data,setData]=useState<VolumeReport|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false);
  const serial=useRef(0);
  const month=chosenMonth||clock;
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible'){setClock(currentMonth());setRevision(v=>v+1);}};
    const timer=window.setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  useEffect(()=>{if(fixedSite){setSite(fixedSite);setPage(0);}},[fixedSite]);
  useEffect(()=>{
    const request=++serial.current;
    setLoading(true);setError('');setExportError('');
    portal<VolumeReport>('office.volume',{month,network,region,site:fixedSite||site,group,page})
      .then(result=>{if(request===serial.current)setData(result);})
      .catch(e=>{if(request===serial.current){setError(e.message);setData(null);}})
      .finally(()=>{if(request===serial.current)setLoading(false);});
    return()=>{serial.current++;};
  },[month,network,region,site,fixedSite,group,page,revision]);
  const filters: VolumeFilters={month,network,region,site:fixedSite||site,group};
  const reportLink=new URLSearchParams({page:'rpv-reports',month,network,region,site:filters.site});
  async function download() {
    setExporting(true);setExportError('');
    try {
      const report=await portal<VolumeReport>('office.volume',{...filters,export:true});
      const url=URL.createObjectURL(new Blob([volumeCsv(report,filters)],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`RPV-${report.month}-${group}.csv`;
      document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e){setExportError((e as Error).message);} finally{setExporting(false);}
  }
  return <section className="ws-rpv" aria-labelledby={titleId}>
    <div className="ws-rpv-heading"><h2 id={titleId}><Droplets size={23}/> Лічильник РПВ{fixedSite?' · цей об’єкт':''}</h2>
      <button className="ws-button" disabled={loading} onClick={()=>setRevision(v=>v+1)} aria-label="Оновити лічильник РПВ"><RefreshCw size={16}/></button>
    </div>
    <fieldset className="ws-rpv-filters" disabled={exporting||loading}>
      <legend className="sr-only">Фільтри лічильника РПВ</legend>
      <label>Місяць<input aria-label="Місяць РПВ" type="month" min="2020-01" max={clock} value={month} onChange={e=>{if(e.target.value){setChosenMonth(e.target.value===clock?'':e.target.value);setPage(0);}}}/></label>
      {!fixedSite && <>
        <label>Мережа<select aria-label="Мережа РПВ" value={network} onChange={e=>{setNetwork(e.target.value);setRegion('');setSite('');setPage(0);}}><option value="">Усі мережі</option>{data?.networks.map(n=><option value={n.value} key={n.value}>{n.label}</option>)}</select></label>
        <label>Регіон<select aria-label="Регіон РПВ" value={region} onChange={e=>{setRegion(e.target.value);setSite('');setPage(0);}}><option value="">Усі регіони</option>{data?.regions.map(r=><option value={r.value} key={r.value}>{r.label}</option>)}</select></label>
        <label>АЗК<select aria-label="АЗК РПВ" value={site} onChange={e=>{setSite(e.target.value);setPage(0);}}><option value="">Усі АЗК</option>{data?.sites.map(s=><option value={s.id} key={s.id}>{s.network_label} {s.code||s.label} · {s.region_label}</option>)}</select></label>
      </>}
    </fieldset>
    <div className="ws-rpv-period"><span>{monthName(month)}</span>{chosenMonth && <button onClick={()=>{setChosenMonth('');setPage(0);}}>Поточний місяць</button>}</div>
    {error && <div className="ws-error" role="alert">{error}<button onClick={()=>setRevision(v=>v+1)}>Повторити</button></div>}
    <div className="ws-rpv-numbers" aria-busy={loading}>
      <div className="ws-rpv-total"><span>Відкачано</span><strong>{loading||!data?'—':fmt(data.total)} <small>м³</small></strong></div>
      <div><span>Опубліковані акти</span><strong>{loading||!data?'—':data.act_count}</strong></div>
      <div><span>АЗК з актами</span><strong>{loading||!data?'—':data.site_count}</strong></div>
    </div>
    <p className="ws-rpv-note">За датою робіт із підтверджених опублікованих актів. {loading?'Оновлюємо…':data?`${data.period_start} — ${data.period_end}`:''}</p>
    {compact ? <a className="ws-rpv-report-link" href={`?${reportLink}`}>Звіт за цими фільтрами <ArrowRight size={16}/></a> : <>
      <div className="ws-rpv-report-tools">
        <label>Групування<select aria-label="Групування звіту РПВ" value={group} disabled={exporting} onChange={e=>{setGroup(e.target.value as VolumeFilters['group']);setPage(0);}}><option value="network">За мережею</option><option value="region">За регіоном</option><option value="site">За АЗК</option></select></label>
        <button className="ws-button" disabled={loading||exporting||!data} onClick={()=>void download()}><Download size={16}/>{exporting?'Готуємо…':'Завантажити CSV'}</button>
      </div>
      {exportError && <p className="ws-error" role="alert">{exportError}</p>}
      {!loading && data && <>
        {data.rows.length ? <div className="ws-rpv-table-wrap"><table className="ws-rpv-table"><caption className="sr-only">Обсяги РПВ за вибраними фільтрами</caption><thead><tr><th>{group==='network'?'Мережа':group==='region'?'Регіон':'АЗК'}</th><th>м³</th><th>Акти</th><th>АЗК</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.key}><td>{row.site_id?<a href={`?page=objects&site=${encodeURIComponent(row.site_id)}`}>{row.title}</a>:row.title}{group==='site'&&<small>{row.region_label}</small>}</td><td>{fmt(row.volume)}</td><td>{row.acts}</td><td>{row.sites}</td></tr>)}</tbody></table></div>:<p className="ws-empty">За цими фільтрами об’єктів немає.</p>}
        {data.act_count===0 && data.rows.length>0 && <p className="ws-rpv-note">За цей період підтверджених опублікованих актів ще немає.</p>}
        <Pager page={page} more={data.more} change={setPage}/>
      </>}
    </>}
  </section>;
}
