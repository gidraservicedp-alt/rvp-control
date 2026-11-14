import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, RefreshCw, X } from "lucide-react";
import { portal, currentMonth, monthName, statusLabel } from "./api";
import { monthDays, shiftMonth, visitStatus, visitDayLabel, type Visit, type CalendarData } from "./calendar";

export default function CustomerCalendar({ revision, onCreate, canCreate }: { revision: number; onCreate: (date: string) => void; canCreate: boolean }) {
  const [month, setMonth] = useState(currentMonth());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"month" | "list">("month");
  const [data, setData] = useState<CalendarData | null>(null);
  const [page, setPage] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const request = ++generation.current;
    setBusy(true); setError(""); setSelected(null);
    if (!page) setData(null);
    portal<CalendarData>("customer.calendar", { month, query: filter, page })
      .then((r) => {
        if (request !== generation.current) return;
        setData((old) => ({ ...r, events: page && old ? Array.from(new Map([...old.events, ...r.events].map((e) => [e.id, e])).values()) : r.events }));
      })
      .catch((e) => { if (request === generation.current) { setError(e.message); setData(null); } })
      .finally(() => { if (request === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [month, filter, page, revision, reload]);
  // A newly created request must refresh the complete visible calendar, not append to an old page.
  useEffect(() => { setPage(0); }, [revision]);
  const today = data?.today || new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const lastRequestDay = new Date(today + "T12:00:00Z");
  lastRequestDay.setUTCDate(lastRequestDay.getUTCDate() + 366);
  const dateTooFar = !!day && day > lastRequestDay.toISOString().slice(0, 10);
  const events = data?.events || [];
  const visible = events.filter((e) => !day || e.calendar_day === day);
  const next = data?.next;
  function changeMonth(value: string) { if (!value) return; setMonth(value); setPage(0); setDay(null); }
  function openCalendar() { section.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function details(v: Visit) { setSelected(v); }
  return <>
    <div className="rpv-next-visit">
      <CalendarDays size={28} aria-hidden="true" />
      <div><strong>{next ? "Найближчий запланований виїзд" : "Планове обслуговування"}</strong>
        <p>{busy && !data ? "Завантажуємо графік…" : error ? "Не вдалося перевірити графік" : next ? `${visitDayLabel(next.calendar_day)} · ${next.network || "АЗК"} ${next.site_code || next.site_label}` : "Створіть заявку на зручну дату та відстежуйте її в календарі."}</p>
        {next && <small>{visitStatus(next, today).label}</small>}
      </div>
      <button onClick={openCalendar}>Відкрити календар</button>
    </div>
    <section ref={section} className="rpv-card rpv-calendar" aria-labelledby="calendar-heading">
      <div className="rpv-section-title"><div><p className="rpv-eyebrow">ГРАФІК ВАШИХ АЗК</p><h2 id="calendar-heading">Календар обслуговування</h2></div>
        <button aria-label="Оновити календар" disabled={busy} onClick={() => { setPage(0); setReload((v) => v + 1); }}><RefreshCw size={17}/></button>
      </div>
      <p className="rpv-hint">Бажана дата заявки потребує узгодження з офісом. Призначення виконавця не гарантує точний час прибуття.</p>
      <div className="rpv-calendar-toolbar">
        <div className="rpv-calendar-month">
          <button aria-label="Попередній місяць" disabled={month <= "2020-01" || busy} onClick={() => changeMonth(shiftMonth(month, -1))}><ChevronLeft size={18}/></button>
          <label><span className="rpv-sr-only">Місяць календаря</span><input type="month" aria-label="Місяць календаря" min="2020-01" max={`${Number(today.slice(0,4))+2}-${today.slice(5,7)}`} value={month} onChange={(e) => changeMonth(e.target.value)}/></label>
          <button aria-label="Наступний місяць" disabled={month >= `${Number(today.slice(0,4))+2}-${today.slice(5,7)}` || busy} onClick={() => changeMonth(shiftMonth(month, 1))}><ChevronRight size={18}/></button>
        </div>
        <div className="rpv-tabs" aria-label="Вигляд календаря"><button aria-pressed={view === "month"} className={view === "month" ? "active" : ""} onClick={() => setView("month")}><CalendarDays size={16}/>Місяць</button><button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => { setView("list"); setDay(null); }}><List size={16}/>Список</button></div>
      </div>
      <form className="rpv-calendar-search" onSubmit={(e) => { e.preventDefault(); setFilter(query.trim()); setPage(0); setDay(null); }}>
        <input aria-label="Фільтр календаря за мережею або кодом АЗК" placeholder="Мережа або код АЗК" maxLength={40} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button disabled={busy}>Знайти</button>
        {filter && <button type="button" onClick={() => { setQuery(""); setFilter(""); setPage(0); setDay(null); }}>Скинути</button>}
      </form>
      {filter && <p className="rpv-hint">Фільтр: {filter}. Пошук за всіма доступними вам АЗК.</p>}
      {error && <p role="alert" className="rpv-error">{error} <button onClick={() => { setPage(0); setReload((v) => v + 1); }}>Повторити</button></p>}
      {busy && <p role="status">Завантажуємо календар…</p>}
      <div className="rpv-calendar-legend" aria-label="Позначення календаря">{[["planned","Бажана дата"],["assigned","Призначено"],["done","Підтверджено"],["review","На перевірці"],["attention","Потребує уваги"],["muted","Скасовано"]].map(([tone,label]) => <span key={tone}><i className={`rpv-dot ${tone}`}/>{label}</span>)}</div>
      {view === "month" && <div className="rpv-month-grid" aria-label={monthName(month)}>
        {["Пн","Вт","Ср","Чт","Пт","Сб","Нд"].map((d) => <div className="rpv-weekday" key={d}>{d}</div>)}
        {monthDays(month).map((date, i) => {
          if (!date) return <div className="rpv-calendar-blank" key={`blank-${i}`}/>;
          const visits = events.filter((e) => e.calendar_day === date);
          return <button key={date} className={`rpv-calendar-day ${date === today ? "today" : ""} ${date === day ? "chosen" : ""}`} aria-pressed={date === day} aria-label={`${visitDayLabel(date)}${visits.length ? `, завантажено заявок: ${visits.length}` : ""}`} disabled={busy || !!error} onClick={() => { setDay(date); setSelected(null); }}>
            <b>{Number(date.slice(-2))}</b><span className="rpv-calendar-dots">{visits.slice(0,3).map((v) => <i key={v.id} className={`rpv-dot ${visitStatus(v,today).tone}`}/>)}</span>
            {!!visits.length && <small>{visits.length}</small>}
          </button>;
        })}
      </div>}
      <div className="rpv-calendar-list-heading"><h3>{day ? visitDayLabel(day) : `Виїзди · ${monthName(month)}`}</h3>{day && <button onClick={() => setDay(null)}>Увесь місяць</button>}</div>
      {!busy && !error && data && !visible.length && <p className="rpv-empty">{data.more ? "У завантаженій частині заявок на цю дату немає. Завантажте решту нижче." : "На цей період виїздів поки не заплановано."}</p>}
      <div className="rpv-calendar-events">{visible.map((v) => {
        const state = visitStatus(v,today);
        return <button key={v.id} className="rpv-calendar-event" onClick={() => details(v)}>
          <span className={`rpv-event-date ${state.tone}`}><b>{Number(v.calendar_day.slice(-2))}</b><small>{new Intl.DateTimeFormat("uk-UA",{month:"short",timeZone:"UTC"}).format(new Date(v.calendar_day+"T12:00:00Z"))}</small></span>
          <span className="rpv-event-text"><strong>{v.network || "АЗК"} {v.site_code || v.site_label}</strong><span>{v.description || v.title}</span><small>{state.label} · <bdi className="rpv-application-number">{v.application_number}</bdi></small></span><ChevronRight size={18}/>
        </button>;
      })}</div>
      {data?.more && <button className="rpv-calendar-load" disabled={busy} onClick={() => setPage((v) => v + 1)}>Завантажити ще · показано {events.length} заявок</button>}
      <div className="rpv-calendar-bottom"><button onClick={() => changeMonth(currentMonth())}>Поточний місяць</button><button className="primary" disabled={!canCreate || busy || !!error || dateTooFar} onClick={() => onCreate(day && day >= today ? day : today)}><Plus size={17}/>{day && day >= today ? "Заявка на обраний день" : "Запланувати виїзд"}</button></div>
      {dateTooFar && <p className="rpv-hint">Нову заявку можна запланувати не більш ніж на рік уперед.</p>}
      <p className="rpv-hint">Календар показує дати пов’язаних заявок. Зміни офісу з’являються після оновлення. Заявки без дати залишаються в розділі «Заявки».</p>
      {selected && <VisitDetails visit={selected} today={today} onClose={() => setSelected(null)}/>}
    </section>
  </>;
}
function VisitDetails({visit: v, today, onClose}: {visit: Visit; today: string; onClose: () => void}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") { e.preventDefault(); closeButton.current?.focus(); }
    }
    document.addEventListener("keydown",key);
    return () => { document.removeEventListener("keydown",key); previous?.focus(); };
  }, []);
  return <div className="rpv-modal-backdrop"><div ref={dialog} className="rpv-card rpv-visit-details" role="dialog" aria-modal="true" aria-labelledby="visit-title">
    <div className="rpv-section-title"><h2 id="visit-title">Заявка <bdi className="rpv-application-number">{v.application_number}</bdi></h2><button ref={closeButton} aria-label="Закрити заявку" onClick={onClose}><X size={18}/></button></div>
    <p className={`rpv-visit-state ${visitStatus(v,today).tone}`}>{visitStatus(v,today).label}</p>
    <h3>АЗК {v.network} {v.site_code || v.site_label}</h3><p>{v.address}</p>
    <dl className="rpv-passport"><div><dt>{v.date_kind === "deadline" ? "Граничний термін" : "Запланована дата"}</dt><dd>{visitDayLabel(v.calendar_day)}</dd></div><div><dt>Статус заявки</dt><dd>{statusLabel(v.status)}</dd></div><div><dt>Етап виконавця</dt><dd>{statusLabel(v.contractor_stage)}</dd></div></dl>
    <p className="rpv-job-description">{v.description || v.title}</p>
    <p className="rpv-hint">Для перенесення погодженого виїзду зверніться до офісу. Самостійна зміна не скасовує чинне призначення.</p>
  </div></div>;
}
