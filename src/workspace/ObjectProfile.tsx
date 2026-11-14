import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, RefreshCw } from "lucide-react";
import { portal, fmt, statusLabel, type Site } from "@/portal/api";
import { SitePassport } from "@/portal/CustomerDetails";
import { Pager } from "@/portal/Portal";
import { formatDate, formatCurrency, actStatusLabel } from "@/utils/helpers";
import type { HistoryApplication } from "../../supabase/functions/rpv-portal/site_history";
import RPVCounter from './RPVCounter';

type ObjectHistory = { site: Site; applications: HistoryApplication[]; total: number; more: boolean };
export default function ObjectProfile({ id, onBack, onOpenApplication, onOpenAct }: {
  id: string; onBack: () => void; onOpenApplication: (id: string) => void; onOpenAct: (id: string) => void;
}) {
  const [history, setHistory] = useState<ObjectHistory | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [page, setPage] = useState(0);
  const serial = useRef(0);
  const load = useCallback(async () => {
    const request = ++serial.current;
    setLoading(true); setError("");
    try {
      const data = await portal<ObjectHistory>("office.site_history", { site: id, page });
      if (request === serial.current) setHistory(data);
    } catch (e) {
      if (request === serial.current) setError((e as Error).message);
    } finally {
      if (request === serial.current) setLoading(false);
    }
  }, [id, page]);
  useEffect(() => { void load(); return () => { serial.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);
  return <div className="rpv-office">
    {error && <div className="ws-error" role="alert">{error}<button onClick={() => void load()}>Повторити</button></div>}
    {!history && <><button className="rpv-back" onClick={onBack}>До списку об’єктів</button>{loading && <p role="status">Завантажуємо паспорт…</p>}</>}
    {history && <>
      <SitePassport site={history.site} onBack={onBack} />
      <RPVCounter key={history.site.id} fixedSite={history.site.id} compact />
      <section className="ws-passport-apps" aria-labelledby="object-history-title">
        <div className="ws-section-label">
          <h2 id="object-history-title">Історія заявок · {history.total}</h2>
          <button disabled={loading} onClick={() => void load()}><RefreshCw size={15} /> Оновити</button>
        </div>
        {loading && <p role="status">Оновлюємо історію…</p>}
        {!loading && !error && history.total === 0 && <div className="ws-empty">Заявок цього об’єкта поки немає.</div>}
        {!loading && !error && history.applications.map(app => {
          const completed = [...app.work_history].sort((a,b) => b.completed_at.localeCompare(a.completed_at))[0]?.completed_at;
          const acts = [...app.acts].sort((a,b) => b.created_at.localeCompare(a.created_at));
          const contractor = [app.contractor?.first_name, app.contractor?.last_name].filter(Boolean).join(' ');
          const amount=Number(app.payout_amount)||(app.payout_status!=='paid'?Number(app.unit_price)*Number(app.actual_volume):0);
          return <article className="ws-history-card" key={app.id}>
            <div className="ws-history-heading"><button className="ws-record-title" onClick={() => onOpenApplication(app.id)}>{app.application_number || 'Заявка'}</button><span className={`ws-tag ${app.status === 'completed' ? 'ws-tag-completed' : ''}`}>{statusLabel(app.status)}</span></div>
            <p>{app.description || app.title}</p>
            <dl className="ws-history-facts">
              <div><dt>Створено</dt><dd>{formatDate(app.created_at)}</dd></div>
              {completed && <div><dt>Завершено</dt><dd>{formatDate(completed)}</dd></div>}
              <div><dt>Виконавець</dt><dd>{contractor || 'Не призначено'}</dd></div>
              <div><dt>Обсяг</dt><dd>{app.actual_volume == null ? 'Не вказано' : `${fmt(app.actual_volume)} м³`}</dd></div>
              {app.status==='completed'&&<div><dt>Розрахунок із підрядником</dt><dd>{app.payout_status==='paid'?'Виплачено':'Не оплачено'} · {amount>0?formatCurrency(amount):'Суму не вказано'}{app.paid_at&&<small> · {formatDate(app.paid_at)}</small>}</dd></div>}
            </dl>
            <div className="ws-history-actions">
              <button onClick={() => onOpenApplication(app.id)}>Заявка <ArrowRight size={16} /></button>
              {acts.map(act => <button key={act.id} onClick={() => onOpenAct(act.id)} aria-label={`Первинний акт ${act.act_number || ''} — ${actStatusLabel(act.status)}`}><ClipboardCheck size={16} /><span>Первинний акт<small>{actStatusLabel(act.status)}</small></span></button>)}
              {app.status==='completed'&&<a className="ws-button" href={`?page=payouts&record=${app.id}`}>Розрахунок та історія</a>}
              {!acts.length && <span className="ws-history-no-act">Первинний акт ще не додано</span>}
            </div>
          </article>;
        })}
        {!loading && !error && <Pager page={page} more={history.more} change={setPage} />}
      </section>
    </>}
  </div>;
}
