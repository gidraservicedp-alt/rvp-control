import { hasWorkVolume, parseWorkVolume } from '@/workspace/workVolume';
import { useEffect, useRef, useState } from 'react';
import { portal, uploadResult, type Application } from './api';
export default function ServiceResult({app,onClose,onDone}:{app:Application;onClose:()=>void;onDone:()=>void}) {
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [volume,setVolume]=useState(hasWorkVolume(app.actual_volume)?String(app.actual_volume):''),[date,setDate]=useState(today),[notes,setNotes]=useState(''),[file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 const key=useRef(crypto.randomUUID()),pending=useRef(false),dialog=useRef<HTMLDivElement>(null),first=useRef<HTMLInputElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;first.current?.focus();function onKey(e:KeyboardEvent){if(e.key==='Escape'&&!pending.current)onClose();if(e.key==='Tab'){const c=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')||[]);if(e.shiftKey&&document.activeElement===c[0]){e.preventDefault();c[c.length-1]?.focus();}else if(!e.shiftKey&&document.activeElement===c[c.length-1]){e.preventDefault();c[0]?.focus();}}}document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('keydown',onKey);previous?.focus();};},[]);
 async function submit(e:React.FormEvent){e.preventDefault();if(pending.current||!file)return;pending.current=true;setBusy(true);setError('');try{
  if(file.size>5*1024*1024)throw new Error('Оберіть файл до 5 МБ.');
  if(parseWorkVolume(volume)===null)throw new Error('Введіть фактичний обсяг, до 3 знаків після коми.');
  if(!saved){await portal('contractor.report',{application:app.id,version:app.updated_at,date,volume:parseWorkVolume(volume),notes});setSaved(true);}
  await uploadResult(app.id,key.current,file);onDone();
 }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
 return <div className="rpv-modal-backdrop"><div ref={dialog} className="rpv-card rpv-create" role="dialog" aria-modal="true" aria-labelledby="service-result-title"><div className="rpv-section-title"><h2 id="service-result-title">Первинний акт · <bdi className="rpv-application-number">{app.application_number}</bdi></h2><button type="button" disabled={busy} onClick={onClose} aria-label="Закрити результат">✕</button></div>
 <form onSubmit={submit}>
 <label htmlFor="service-volume">Фактично відкачано, м³</label><input id="service-volume" ref={first} inputMode="decimal" value={volume} disabled={busy||saved} onChange={e=>setVolume(e.target.value)} required/>
 <p className="rpv-hint">Обсяг обов’язковий. Вкажіть фактично відкачані куби за первинним актом.</p>
 <label htmlFor="service-date">Дата виконання</label><input id="service-date" type="date" required min="2020-01-01" max={today} value={date} disabled={busy||saved} onChange={e=>setDate(e.target.value)}/>
 <label htmlFor="service-notes">Примітка / кількість рейсів</label><textarea id="service-notes" maxLength={2000} rows={3} value={notes} disabled={busy||saved} onChange={e=>setNotes(e.target.value)}/>
 <label htmlFor="service-file">Первинний акт</label><input id="service-file" type="file" accept="application/pdf,image/jpeg,image/png" required disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/>
 {error&&<p role="alert" className="rpv-error">{error}</p>}{saved&&error&&<p className="rpv-hint">Дані збережено. Повторіть завантаження акта.</p>}
 <div className="rpv-create-actions"><button type="button" disabled={busy} onClick={onClose}>Скасувати</button><button className="primary" disabled={busy||!file}>{busy?'Передаємо…':'Передати на перевірку'}</button></div>
 </form></div></div>;
}
