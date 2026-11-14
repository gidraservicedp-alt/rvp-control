import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2, Save, ShieldCheck } from 'lucide-react';
import { portal, statusLabel, type Site } from '@/portal/api';
import ExistingSitePicker from '@/components/ExistingSitePicker';
import { fetchActiveContractors, type ContractorListItem } from '@/lib/contractorsApi';
import { parseWorkVolume } from './workVolume';
import { useApp } from '@/context/AppContext';

type Order = {
  id: string; application_number: string; title: string; status: string; customer_site_id: string | null;
  contractor_id: string | null; description: string | null; manager_comment: string | null;
  actual_volume: number | null; unit_price: number; payout_amount: number; payout_status: string;
  scheduled_at: string | null; deadline_at: string | null;
};
type EditState = {application: Order; version: string; work_date: string | null; has_result: boolean};
const input = 'w-full min-w-0 rounded-xl border border-sky-200/20 bg-[#112d46] px-3 py-3 text-base text-sky-50 focus:border-sky-300 focus:outline-none disabled:opacity-50';
const dateInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const money = (value: string) => {
  const s = value.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) < 1000000000 ? Number(s) : null;
};

function EditForm({state, initialSite, contractors, onClose, onSaved, onReload}: {
  state: EditState; initialSite: Site | null; contractors: ContractorListItem[];
  onClose: () => void; onSaved: () => Promise<void>; onReload: () => void;
}) {
  const a = state.application;
  const [site, setSite] = useState(initialSite), [description, setDescription] = useState(a.description || ''),
    [comment, setComment] = useState(a.manager_comment || ''), [contractor, setContractor] = useState(a.contractor_id || ''),
    [volume, setVolume] = useState(a.actual_volume == null ? '' : String(a.actual_volume)),
    [rate, setRate] = useState(String(a.unit_price)), [payout, setPayout] = useState(String(a.payout_amount)),
    [scheduled, setScheduled] = useState(dateInput(a.scheduled_at)), [deadline, setDeadline] = useState(dateInput(a.deadline_at)),
    [workDate, setWorkDate] = useState(state.work_date || ''), [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), attempt = useRef<{fingerprint: string; request: string} | null>(null);
  const form = useRef<HTMLFormElement>(null), paid = a.payout_status === 'paid';
  useEffect(() => { form.current?.focus(); }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending.current) onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    setError('');
    const fail = (message: string) => { setError(message); };
    if (!site) return fail('Оберіть об’єкт зі списку.');
    if (!description.trim()) return fail('Заповніть опис робіт.');
    if (reason.trim().length < 3) return fail('Вкажіть причину редагування.');
    const patch: Record<string, unknown> = {};
    if (site.id !== a.customer_site_id) patch.customer_site_id = site.id;
    if (description !== (a.description || '')) patch.description = description.trim();
    if (comment !== (a.manager_comment || '')) patch.manager_comment = comment.trim();
    if (contractor !== (a.contractor_id || '')) patch.contractor_id = contractor;
    if (volume !== (a.actual_volume == null ? '' : String(a.actual_volume))) {
      const v = parseWorkVolume(volume);
      if (v === null) return fail('Вкажіть обсяг більше 0 м³, до трьох знаків після коми.');
      patch.actual_volume = v;
    }
    if (rate !== String(a.unit_price)) {
      const n = money(rate); if (n === null) return fail('Перевірте тариф.'); patch.unit_price = n;
    }
    if (payout !== String(a.payout_amount)) {
      const n = money(payout); if (n === null) return fail('Перевірте суму виплати.'); patch.payout_amount = n;
    }
    if (scheduled !== dateInput(a.scheduled_at)) patch.scheduled_at = scheduled ? new Date(scheduled).toISOString() : null;
    if (deadline !== dateInput(a.deadline_at)) patch.deadline_at = deadline ? new Date(deadline).toISOString() : null;
    if (workDate !== (state.work_date || '')) patch.work_date = workDate;
    if (!Object.keys(patch).length) return fail('Змініть хоча б одне поле.');
    const fingerprint = JSON.stringify({patch, reason: reason.trim(), version: state.version});
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = {fingerprint, request: crypto.randomUUID()};
    pending.current = true; setBusy(true);
    try {
      await portal('office.order_edit_save', {application: a.id, version: state.version, patch,
        reason: reason.trim(), request: attempt.current.request});
      await onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <form ref={form} tabIndex={-1} onSubmit={e => void save(e)} className="flex min-h-0 h-full flex-col outline-none"
    onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const controls = form.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === form.current)) {e.preventDefault(); last.focus();}
      else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus();}
    }}>
    <header className="shrink-0 border-b border-sky-200/15 p-4 sm:p-6">
      <button type="button" className="flex items-center gap-2 text-sm text-sky-200 disabled:opacity-40" disabled={busy} onClick={onClose}><ArrowLeft size={18}/>До заявки</button>
      <div className="mt-4 flex items-start gap-3"><ShieldCheck className="shrink-0 text-orange-300 mt-1" size={22}/><div className="min-w-0">
        <h2 className="text-xl font-bold text-sky-50">Редагування заявки</h2>
        <p className="mt-1 text-sm text-sky-200 break-words">{a.application_number} · {statusLabel(a.status)}</p>
        <p className="mt-1 text-xs text-orange-200/90">Лише головний адміністратор</p>
      </div></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
        <ExistingSitePicker value={site} onChange={setSite}/>
        <label className="block text-sm text-sky-200">Опис робіт<textarea className={input+' mt-2'} rows={3} required maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}/></label>
        <div className="rounded-2xl border border-sky-300/30 bg-sky-300/5 p-4">
          <label className="block text-sm font-semibold text-sky-100">Фактично відкачано, м³<input className={input+' mt-2 text-xl font-bold'} inputMode="decimal" value={volume} placeholder="Наприклад, 12,5" onChange={e => setVolume(e.target.value)}/></label>
          <p className="mt-2 text-xs text-sky-200/70">Зміна обсягу оновить дані акта, історію об’єкта та лічильник РПВ.</p>
        </div>
        <label className="block text-sm text-sky-200">Виконавець<select className={input+' mt-2'} value={contractor} disabled={paid} onChange={e => setContractor(e.target.value)}>
          <option value="" disabled>Не призначено</option>
          {a.contractor_id && !contractors.some(c => c.id === a.contractor_id) && <option value={a.contractor_id}>Поточний виконавець (неактивний)</option>}
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-sky-200">Планова дата і час<input type="datetime-local" className={input+' mt-2'} value={scheduled} onChange={e => setScheduled(e.target.value)}/></label>
          <label className="block text-sm text-sky-200">Дедлайн<input type="datetime-local" className={input+' mt-2'} value={deadline} onChange={e => setDeadline(e.target.value)}/></label>
        </div>
        {(state.has_result || state.work_date) && <label className="block text-sm text-sky-200">Фактична дата виконання<input type="date" className={input+' mt-2'} value={workDate} onChange={e => setWorkDate(e.target.value)}/></label>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-sky-200">Тариф, грн/м³<input inputMode="decimal" className={input+' mt-2'} value={rate} disabled={paid} onChange={e => setRate(e.target.value)}/></label>
          <label className="block text-sm text-sky-200">Сума виплати, грн<input inputMode="decimal" className={input+' mt-2'} value={payout} disabled={paid} onChange={e => setPayout(e.target.value)}/></label>
        </div>
        <p className="text-xs text-sky-200/70">{paid ? 'Виплату вже зафіксовано. Сума й отримувач платежу зберігаються.' : 'Якщо суму встановлено, вона має пріоритет над розрахунком за тарифом. За суми 0 — обсяг × тариф.'}</p>
        <label className="block text-sm text-sky-200">Коментар менеджера<textarea rows={2} className={input+' mt-2'} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)}/></label>
        <label className="block text-sm text-orange-200">Причина редагування *<textarea rows={2} required minLength={3} maxLength={500} className={input+' mt-2 border-orange-300/30'} placeholder="Що й чому виправляєте" value={reason} onChange={e => setReason(e.target.value)}/></label>
        <p className="text-xs text-sky-200/70">Попередні значення, автор і причина залишаться в історії. Статус заявки збережеться.</p>
      </fieldset>
    </div>
    <footer className="shrink-0 border-t border-sky-200/15 bg-[#0c2139] p-4 sm:px-6">
      {error && <div role="alert" className="mb-3 text-sm text-orange-200">{error} <button type="button" className="underline" disabled={busy} onClick={onReload}>Оновити дані</button></div>}
      <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 size={19} className="animate-spin"/> : <Save size={19}/>} {busy ? 'Зберігаємо…' : 'Зберегти зміни'}
      </button>
    </footer>
  </form>;
}

export default function OwnerOrderEditor({id, onClose, onSaved}: {id: string; onClose: () => void; onSaved: () => Promise<void>}) {
  const {showToast} = useApp();
  const [data, setData] = useState<{state: EditState; site: Site | null; contractors: ContractorListItem[]} | null>(null),
    [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError('');
    void (async () => {
      const [state, contractors] = await Promise.all([portal<EditState>('office.order_edit', {application: id}), fetchActiveContractors()]);
      const site = state.application.customer_site_id ? (await portal<{site: Site}>('office.site', {site: state.application.customer_site_id})).site : null;
      if (active) setData({state, contractors, site});
    })().catch(e => {if (active) setError(e.message);});
    return () => { active = false; };
  }, [id, revision]);
  const saved = useCallback(async () => { await onSaved(); showToast('Зміни збережено в історії заявки', 'success'); }, [onSaved, showToast]);
  return <div className="fixed inset-0 z-[125] bg-[#071526]/90" role="dialog" aria-modal="true" aria-label="Редагування заявки головним адміністратором">
    <div className="absolute inset-y-0 right-0 w-full max-w-2xl border-l border-sky-200/15 bg-[#0c2139]">
      {data ? <EditForm key={revision} state={data.state} initialSite={data.site} contractors={data.contractors} onClose={onClose} onSaved={saved} onReload={() => setRevision(v => v + 1)}/> :
        <div className="p-6"><button onClick={onClose} className="ws-button">До заявки</button><p className="mt-6" role={error ? 'alert' : 'status'}>{error || 'Завантажуємо дані…'}</p>
          {error && <button className="ws-button mt-4" onClick={() => setRevision(v => v + 1)}>Повторити</button>}</div>}
    </div>
  </div>;
}
