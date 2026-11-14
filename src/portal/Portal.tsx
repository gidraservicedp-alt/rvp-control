import { formatWorkVolume } from '@/workspace/workVolume';
import { useEffect, useRef, useState } from "react";
import {
  Droplets,
  Building2,
  FileCheck2,
  ArrowLeft,
  RefreshCw,
  Search,
  Send,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";
import {
  portal,
  downloadAct,
  openBot,
  currentMonth,
  monthName,
  fmt,
  statusLabel,
  type Site,
  type Dashboard,
  type Application,
  type Act,
} from "./api";
import "./portal.css";
import CreateApplication from "./CreateApplication";
import CustomerCalendar from "./CustomerCalendar";
import ServiceResult from "./ServiceResult";
import ProEntry from "./ProEntry";
export default function Portal() {
  const requested = new URLSearchParams(location.search).get("cabinet");
  const [role, setRole] = useState(
    requested === "contractor" ? "contractor" : "customer",
  );
  const [roles, setRoles] = useState<string[]>([]),
    [identityLoaded, setIdentityLoaded] = useState(false);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!window.Telegram?.WebApp?.initData) {
      setError(
        "Відкрийте цей кабінет кнопкою «Відкрити вебкабінет» у нашому Telegram-боті.",
      );
      setLoading(false);
      return;
    }
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    portal<{ roles: string[] }>("identity")
      .then((r) => {
        setRoles(r.roles);
        if (!r.roles.includes(role) && r.roles[0]) setRole(r.roles[0]);
        if (!r.roles.length)
          setError(
            "Офіс ще не підтвердив доступ. Продовжіть реєстрацію в боті.",
          );
        setIdentityLoaded(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="rpv-portal">
      <header className="rpv-header">
        <a href="./" className="rpv-brand">
          <span>
            <Droplets size={24} />
          </span>
          <div>
            RPV CONTROL<small>ГІДРА СЕРВІС</small>
          </div>
        </a>
        <div className="rpv-role">
          {role === "customer" ? "Кабінет замовника" : "Кабінет підрядника"}
        </div>
        <button onClick={openBot}>
          <Send size={16} /> Telegram
        </button>
      </header>
      <main className="rpv-main">
        {roles.length > 1 && (
          <nav className="rpv-tabs">
            {roles.map((r) => (
              <button
                key={r}
                className={role === r ? "active" : ""}
                onClick={() => {
                  setRole(r);
                  setError("");
                }}
              >
                {r === "customer" ? "Замовник" : "Підрядник"}
              </button>
            ))}
          </nav>
        )}
        {loading ? (
          <div className="rpv-card">Підтверджуємо вхід…</div>
        ) : error ? (
          <div className="rpv-card rpv-welcome">
            <Droplets size={38} />
            <h1>Ваш кабінет RPV Control</h1>
            <p role="alert">{error}</p>
            <button className="primary" onClick={openBot}>
              Відкрити Telegram-бота <ArrowUpRight size={18} />
            </button>
            <a href="./">Вхід для офісу</a>
          </div>
        ) : identityLoaded && roles.includes(role) ? (
          role === "customer" ? (
            <CustomerPortal />
          ) : (
            <ContractorPortal />
          )
        ) : null}
      </main>
      <footer className="rpv-footer">
        Гідра Сервіс · Контроль кожного кубометра
      </footer>
    </div>
  );
}
function CustomerPortal() {
  const [data, setData] = useState<Dashboard | null>(null),
    [month, setMonth] = useState(currentMonth()),
    [site, setSite] = useState<Site | null>(null),
    [tab, setTab] = useState("passport"),
    [search, setSearch] = useState("");
  const [page, setPage] = useState(0),
    [sitePage, setSitePage] = useState(0),
    [archivePage, setArchivePage] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [orders, setOrders] = useState<Application[]>([]),
    [orderPage, setOrderPage] = useState(0),
    [ordersMore, setOrdersMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState("");
  const [createDate, setCreateDate] = useState<string>();
  const [orderRevision, setOrderRevision] = useState(0);
  const dashboardRequest=useRef(0);
  const refresh = () => {
    const request=++dashboardRequest.current;
    setBusy(true);
    setError("");
    return portal<Dashboard>("customer.dashboard", {
      month,
      site: site?.id,
      page,
      sitePage,
      archivePage,
    })
      .then((r)=>{if(request===dashboardRequest.current){setData(r);setOrderRevision(v=>v+1);}})
      .catch((e) => {if(request===dashboardRequest.current){setError(e.message);setData(null);setOrders([]);}})
      .finally(() => {if(request===dashboardRequest.current)setBusy(false);});
  };
  useEffect(() => {
    void refresh();
  }, [month, site?.id, page, sitePage, archivePage]);
  useEffect(()=>{const update=()=>{if(document.visibilityState==="visible")void refresh();};const timer=window.setInterval(update,15000);window.addEventListener("focus",update);return()=>{window.clearInterval(timer);window.removeEventListener("focus",update);};},[month,site?.id,page,sitePage,archivePage]);
  useEffect(() => {
    setOrders([]);
    if (!site || tab !== "orders") return;
    let active=true;
    setBusy(true);
    portal<{ applications: Application[]; more: boolean }>(
      "customer.applications",
      { site: site.id, page: orderPage },
    )
      .then((r) => {
        if(active){setOrders(r.applications);setOrdersMore(r.more);}
      })
      .catch((e) => {if(active){setError(e.message);setOrders([]);}})
      .finally(() => {if(active)setBusy(false);});
    return()=>{active=false;};
  }, [site?.id, tab, orderPage, orderRevision]);
  async function download(a: Act) {
    setBusy(true);
    setError("");
    try {
      await downloadAct(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="rpv-heading">
        <div>
          <p className="rpv-eyebrow">ВАШІ ОБ’ЄКТИ ПІД КОНТРОЛЕМ</p>
          <h1>Вітаємо{data?.name ? `, ${data.name}` : ""}</h1>
          <p>Паспорти АЗК, підтверджені акти та обсяги відкачки.</p>
        </div>
        <div className="rpv-heading-actions">
          <ProEntry />
          <button onClick={refresh} disabled={busy}>
            <RefreshCw size={17} /> Оновити
          </button>
        </div>
      </div>
      <div className="rpv-create-launch">
        <button
          className="primary"
          disabled={!data?.sites.length && !site}
          onClick={() => {
            setCreated("");
            setCreateDate(undefined);
            setCreating(true);
          }}
        >
          + Створити заявку
        </button>
        {created && (
          <p role="status">
            Заявку {created} створено. Офіс отримає її для опрацювання.
          </p>
        )}
      </div>
      {creating && (
        <CreateApplication
          sites={data?.sites || []}
          selected={site}
          initialDate={createDate}
          sitesMore={!!data?.sitesMore}
          onClose={() => setCreating(false)}
          onDone={(chosen, number) => {
            setCreating(false);
            setCreated(number);
            setSite(chosen);
            setTab("orders");
            setOrderPage(0);
            setOrderRevision((v) => v + 1);
            void refresh();
          }}
        />
      )}
      {error && (
        <p className="rpv-error" role="alert">
          {error}
        </p>
      )}
      <div className="rpv-stats">
        <div className="rpv-stat main">
          <Droplets />
          <span>Відкачано · {monthName(month)}</span>
          <strong>
            {data ? fmt(data.total) : "—"} <small>м³</small>
          </strong>
          <small>За всіма доступними АЗК</small>
        </div>
        <div className="rpv-stat">
          <Building2 />
          <span>Мої АЗК</span>
          <strong>
            {data?.sites.length ?? "—"}
            {data?.sitesMore ? " +" : ""}
          </strong>
          <small>На поточній сторінці</small>
        </div>
        <div className="rpv-stat">
          <FileCheck2 />
          <span>Первинні акти за місяць</span>
          <strong>
            {data?.acts.length ?? "—"}
            {data?.more ? " +" : ""}
          </strong>
          <small>{site ? `АЗК ${site.code}` : "На поточній сторінці"}</small>
        </div>
      </div>
      <div className="rpv-workspace">
        <aside className={`rpv-card rpv-sites ${site ? "selected" : ""}`}>
          <div className="rpv-section-title">
            <h2>Мої АЗК</h2>
            <Building2 size={19} />
          </div>
          <label className="rpv-search">
            <Search size={17} />
            <input
              aria-label="Мережа або код АЗК"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Мережа або код АЗК"
            />
          </label>
          <div className="rpv-site-list">
            {data?.sites
              .filter((s) =>
                `${s.code} ${s.passport_network || ""}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((s) => (
                <button
                  key={s.id}
                  className={site?.id === s.id ? "active" : ""}
                  onClick={() => {
                    setSite(s);
                    setPage(0);
                    setOrderPage(0);
                    setTab("passport");
                  }}
                >
                  {s.code}
                </button>
              ))}
            {data && !data.sites.length && (
              <p className="rpv-empty">
                Об’єктів поки немає. Додайте паспорт у боті.
              </p>
            )}
          </div>
          <Pager
            page={sitePage}
            more={!!data?.sitesMore}
            change={setSitePage}
          />
          <button className="rpv-add" onClick={openBot}>
            + Додати об’єкт у боті
          </button>
        </aside>
        <CustomerCalendar
          revision={orderRevision}
          onCreate={(date) => { setCreateDate(date); setCreated(""); setCreating(true); }}
          canCreate={!!data?.sites.length || !!site}
        />
        <section className="rpv-card rpv-details">
          {site ? (
            <>
              <button
                className="rpv-back"
                onClick={() => {
                  setSite(null);
                  setTab("acts");
                  setPage(0);
                }}
              >
                <ArrowLeft size={16} /> Мої АЗК
              </button>
              <p className="rpv-eyebrow">ПАСПОРТ ОБ’ЄКТА</p>
              <h2>
                АЗК {site.passport_network} {site.code}
              </h2>
              <p className="rpv-subtitle">{site.address}</p>
              <nav className="rpv-tabs">
                {[
                  ["passport", "Паспорт"],
                  ["orders", "Заявки"],
                  ["acts", "Первинні акти"],
                ].map(([id, label]) => (
                  <button
                    className={tab === id ? "active" : ""}
                    key={id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {tab === "passport" ? (
                <dl className="rpv-passport">
                  <div>
                    <dt>Мережа</dt>
                    <dd>{site.passport_network || "—"}</dd>
                  </div>
                  <div>
                    <dt>Регіон</dt>
                    <dd>{site.region || "—"}</dd>
                  </div>
                  <div>
                    <dt>Код АЗК</dt>
                    <dd>{site.code}</dd>
                  </div>
                  <div>
                    <dt>Повна адреса</dt>
                    <dd>{site.address}</dd>
                  </div>
                  <div>
                    <dt>Об’єм септика</dt>
                    <dd>
                      {site.capacity_m3 == null
                        ? "—"
                        : `${fmt(site.capacity_m3)} м³`}
                    </dd>
                  </div>
                </dl>
              ) : tab === "orders" ? (
                <>
                  <p className="rpv-hint">
                    Тут відображаються заявки, які офіс прив’язав до цього
                    об’єкта.
                  </p>
                  {orders.map((a) => (
                    <ApplicationCard key={a.id} app={a} />
                  ))}
                  {!orders.length && !busy && (
                    <p className="rpv-empty">Прив’язаних заявок поки немає.</p>
                  )}
                  <Pager
                    page={orderPage}
                    more={ordersMore}
                    change={setOrderPage}
                  />
                </>
              ) : (
                <ActList
                  acts={data?.acts || []}
                  busy={busy}
                  onDownload={download}
                />
              )}
            </>
          ) : (
            <>
              <p className="rpv-eyebrow">ПІДТВЕРДЖЕНО ОФІСОМ</p>
              <h2>Первинні акти</h2>
              <p className="rpv-subtitle">
                Оберіть АЗК зі списку, щоб відкрити повну картку.
              </p>
              <ActList
                acts={data?.acts || []}
                busy={busy}
                onDownload={download}
              />
            </>
          )}
          {(!site || tab === "acts") && (
            <Pager page={page} more={!!data?.more} change={setPage} />
          )}
        </section>
      </div>
      <section className="rpv-card rpv-archive">
        <div>
          <h2>Лічильник РПВ та архів</h2>
          <p>
            Обсяг рахується за датою виконання робіт із підтверджених
            опублікованих актів.
          </p>
        </div>
        <label>
          Місяць
          <input
            type="month"
            aria-label="Місяць лічильника"
            value={month}
            min="2020-01"
            max={currentMonth()}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setPage(0);
              }
            }}
          />
        </label>
        <div className="rpv-months">
          <button
            onClick={() => {
              setMonth(currentMonth());
              setPage(0);
            }}
          >
            Поточний місяць
          </button>
          {data?.months.map((m) => (
            <button
              key={m.month_start}
              onClick={() => {
                setMonth(m.month_start.slice(0, 7));
                setPage(0);
              }}
            >
              {monthName(m.month_start)}
            </button>
          ))}
        </div>
        <Pager
          page={archivePage}
          more={!!data?.monthsMore}
          change={setArchivePage}
        />
      </section>
      {busy && <p aria-live="polite">Оновлюємо дані…</p>}
    </>
  );
}
function ActList({
  acts,
  busy,
  onDownload,
}: {
  acts: Act[];
  busy: boolean;
  onDownload: (a: Act) => void;
}) {
  return (
    <div className="rpv-records">
      {acts.map((a) => (
        <article key={a.act_id}>
          <span className="rpv-act-icon">
            <FileCheck2 size={22} />
          </span>
          <div>
            <strong>Первинний акт {a.act_number || "без номера"}</strong>
            <p>
              {a.site_label} · {a.work_date.split("-").reverse().join(".")}
            </p>
            <small>Заявка {a.application_number || "—"}</small>
          </div>
          <div className="rpv-record-end">
            <b>
              {a.pumped_m3 == null ? "Без відкачки" : `${fmt(a.pumped_m3)} м³`}
            </b>
            <button disabled={busy} onClick={() => onDownload(a)}>
              Завантажити
            </button>
          </div>
        </article>
      ))}
      {!acts.length && !busy && (
        <p className="rpv-empty">
          Первинних актів за цей місяць немає.
        </p>
      )}
    </div>
  );
}
function ApplicationCard({
  app,
  children,
}: {
  app: Application;
  children?: React.ReactNode;
}) {
  return (
    <article className="rpv-job">
      <div className="rpv-job-top">
        <strong>{app.application_number}</strong>
        <span>{app.awaiting_act ? "Результат на перевірці" : app.has_problem ? "Потребує уваги" : app.arrived_at && app.status!=="completed" ? "На об’єкті" : statusLabel(app.status)}</span>
      </div>
      <h3>{app.title}</h3>
      <p className="rpv-job-volume">{formatWorkVolume(app.actual_volume)}</p>
      <p>{app.address}</p>
      <p className="rpv-job-description">{app.description}</p>
      {app.deadline_at && (
        <small>
          Термін:{" "}
          {new Date(app.deadline_at).toLocaleString("uk-UA", {
            timeZone: "Europe/Kyiv",
          })}
        </small>
      )}
      {children}
    </article>
  );
}
function ContractorPortal() {
  const [apps, setApps] = useState<Application[]>([]),
    [more, setMore] = useState(false),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [resultApp,setResultApp]=useState<Application|null>(null);
  const [view,setView]=useState("active");
  const [sent,setSent]=useState(false);
  const refresh = () => {
    setBusy(true);
    setError("");
    return portal<{ applications: Application[]; more: boolean }>(
      "contractor.dashboard",
      { page,view },
    )
      .then((r) => {
        setApps(r.applications);
        setMore(r.more);
      })
      .catch((e) => {
        setError(e.message);
        setApps([]);
      })
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    void refresh();
  }, [page,view]);
  useEffect(()=>{if(resultApp)return;const update=()=>{if(document.visibilityState==="visible")void refresh();};const timer=window.setInterval(update,15000);window.addEventListener("focus",update);return()=>{window.clearInterval(timer);window.removeEventListener("focus",update);};},[page,view,resultApp]);
  async function transition(a: Application, t: string) {
    let note="";
    if(t==="decline"||t==="problem") {
      const value=window.prompt(t==="decline"?"Причина відмови (від 3 символів)":"Що сталося? (від 3 символів)");
      if(value===null)return;note=value.trim();if(note.length<3||note.length>2000){setError("Вкажіть причину від 3 до 2000 символів.");return;}
    }
    setBusy(true);
    setError("");
    try {
      await portal("contractor.transition", {
        application: a.id,
        transition: t,
        note,
        version: a.updated_at,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="rpv-heading">
        <div>
          <p className="rpv-eyebrow">ГІДРА СЕРВІС · ПІДРЯДНИК</p>
          <h1>Мої заявки</h1>
          <p>Ваші призначення, етапи роботи та здача актів.</p>
        </div>
        <button disabled={busy} onClick={refresh}>
          <RefreshCw size={17} />
          Оновити
        </button>
      </div>
      {error && (
        <p className="rpv-error" role="alert">
          {error}
        </p>
      )}
      <nav className="rpv-tabs">{[["active","Мої заявки"],["history","Історія робіт"],["payments","Мої виплати"]].map(([id,label])=><button key={id} className={view===id?"active":""} onClick={()=>{setView(id);setPage(0);}}>{label}</button>)}</nav>
      {sent&&<p role="status">Результат передано офісу на перевірку.</p>}
      {resultApp&&<ServiceResult app={resultApp} onClose={()=>setResultApp(null)} onDone={()=>{setResultApp(null);setSent(true);void refresh();}}/>}
      <div className="rpv-job-grid">
        {apps.map((a) => (
          <ApplicationCard key={a.id} app={a}>
            <p className="rpv-hint">Етап: {a.awaiting_act?"Акт на перевірці":a.arrived_at?"На об’єкті":statusLabel(a.contractor_stage)}</p>
            {a.review_reason&&<p className="rpv-error">Повернуто на уточнення: {a.review_reason}</p>}
            {a.has_problem&&<p className="rpv-error">{a.problem_comment}</p>}
            {a.payout_amount!==undefined&&<p>Сума: {Number(a.payout_amount)>0?`${fmt(a.payout_amount)} грн`:"Уточнюйте в офісі"} · {a.payout_status==="paid"?"Виплачено":a.status==="completed"?"До виплати":"Очікує прийняття роботи"}</p>}
            {a.customer_contact&&<p><a href={`tel:${a.customer_contact.phone}`}>📞 {a.customer_contact.name||"Контакт на об’єкті"}</a>{" · "}<a href={a.customer_contact.username&&/^[a-zA-Z0-9_]{5,32}$/.test(a.customer_contact.username)?`https://t.me/${a.customer_contact.username}`:`https://t.me/+${a.customer_contact.phone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer">Telegram ↗</a></p>}
            <div className="rpv-job-actions">
              {a.contractor_stage === "offered" &&
                !["completed", "cancelled"].includes(a.status) && !a.awaiting_act && (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => transition(a, "accept")}
                    >
                      <CheckCircle2 size={16} />
                      Прийняти
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => transition(a, "decline")}
                    >
                      Відмовитися
                    </button>
                  </>
                )}
              {a.contractor_stage === "accepted" &&
                !["completed", "cancelled"].includes(a.status) && !a.awaiting_act && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => transition(a, "depart")}
                  >
                    Виїхав на об’єкт
                  </button>
                )}
              {!a.awaiting_act && !["completed","cancelled"].includes(a.status) && <>
                {a.contractor_stage==="departed"&&!a.arrived_at&&<button className="primary" disabled={busy} onClick={()=>transition(a,"arrive")}>На об’єкті</button>}
                {a.arrived_at&&<button className="primary" disabled={busy} onClick={()=>{setSent(false);setResultApp(a);}}>Додати первинний акт</button>}
                {a.contractor_stage!=="offered"&&<button disabled={busy} onClick={()=>transition(a,"problem")}>Повідомити про проблему</button>}
              </>}
              <button onClick={openBot}><Send size={16}/>Відкрити бот</button>
            </div>
          </ApplicationCard>
        ))}
      </div>
      {!apps.length && !busy && (
        <div className="rpv-card rpv-empty">Призначених заявок поки немає.</div>
      )}
      <Pager page={page} more={more} change={setPage} />
    </>
  );
}
export function Pager({
  page,
  more,
  change,
}: {
  page: number;
  more: boolean;
  change: (v: number) => void;
}) {
  return page > 0 || more ? (
    <div className="rpv-pager">
      <button disabled={!page} onClick={() => change(page - 1)}>
        ← Назад
      </button>
      <span>{page + 1}</span>
      <button disabled={!more} onClick={() => change(page + 1)}>
        Далі →
      </button>
    </div>
  ) : null;
}
