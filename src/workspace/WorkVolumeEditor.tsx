import { useCallback, useEffect, useRef, useState } from 'react';
import { Droplets, Loader2 } from 'lucide-react';
import { portal } from '@/portal/api';
import { formatWorkVolume, hasWorkVolume, parseWorkVolume } from './workVolume';

type VolumeState = {volume: number | null; version: string; can_edit: boolean; report_locked: boolean; closed: boolean};
export default function WorkVolumeEditor({applicationId, onVolume, onSaved}: {
  applicationId: string; onVolume?: (volume: number | null) => void; onSaved?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<VolumeState | null>(null), [value, setValue] = useState(''),
    [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), pending = useRef(false), notify = useRef(onVolume);
  notify.current = onVolume;
  const load = useCallback(async () => {
    try {
      const result = await portal<VolumeState>('office.work_volume', {application: applicationId});
      if (!alive.current) return;
      setState(result); setValue(hasWorkVolume(result.volume) ? String(result.volume) : '');
      notify.current?.(result.volume); setError('');
    } catch (e) { if (alive.current) setError((e as Error).message); }
  }, [applicationId]);
  useEffect(() => { alive.current = true; void load(); return () => {alive.current = false;}; }, [load]);
  async function save() {
    if (pending.current || !state) return;
    const volume = parseWorkVolume(value);
    if (volume === null) {setError('Вкажіть число більше 0, до 3 знаків після коми.'); return;}
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await portal<{volume: number; version: string}>('office.work_volume_set', {
        application: applicationId, version: state.version, volume,
      });
      if (!alive.current) return;
      setState({...state, ...result}); setValue(String(result.volume)); notify.current?.(result.volume);
      await onSaved?.();
    } catch (e) {if (alive.current) setError((e as Error).message);}
    finally {pending.current = false; if (alive.current) setBusy(false);}
  }
  return <section aria-label="Обсяг РПВ" className="rounded-2xl border border-sky-400/25 bg-sky-400/10 p-4">
    <div className="flex items-center gap-2 text-sm font-semibold text-sky-200"><Droplets size={19}/><label htmlFor={`volume-${applicationId}`}>Фактично відкачано, м³</label></div>
    {!state ? <p role="status" className="mt-2 text-sm text-slate-400">{error ? 'Обсяг недоступний' : 'Завантажуємо…'}</p> : state.can_edit ? <>
      <div className="mt-3 flex items-center gap-2">
        <input id={`volume-${applicationId}`} inputMode="decimal" autoComplete="off" value={value} disabled={busy} onChange={e => setValue(e.target.value)}
          placeholder="Наприклад, 12,5" className="min-w-0 w-full rounded-xl border border-sky-300/30 bg-[#081c30] px-3 py-3 text-xl font-bold text-sky-100"/>
        <button type="button" onClick={() => void save()} disabled={busy || parseWorkVolume(value) === state.volume}
          className="shrink-0 rounded-xl bg-blue-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? <Loader2 size={19} className="animate-spin"/> : 'Зберегти'}
        </button>
      </div>
      <p className="mt-2 text-xs text-sky-200/70">Для завершення потрібні збережений обсяг та первинний акт.</p>
    </> : <>
      <p className="mt-2 text-2xl font-bold text-sky-100">{formatWorkVolume(state.volume)}</p>
      {state.report_locked && !state.closed && <p className="mt-2 text-xs text-sky-200/70">Обсяг із результату виконавця. Для виправлення поверніть акт на уточнення.</p>}
    </>}
    {error && <div role="alert" className="mt-3 text-sm text-orange-200">{error} <button type="button" disabled={busy} className="underline" onClick={() => void load()}>Оновити</button></div>}
  </section>;
}
