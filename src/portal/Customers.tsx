import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { portal, type Customer, type Site, type Application } from "./api";
import { Pager } from "./Portal";
import CustomerDetails, { SitePassport } from "./CustomerDetails";
import "./portal.css";
export default function Customers({ mode = "managers", initialNetwork = "", onNetworkChange, onOpenSite }: { mode?: "managers" | "objects"; initialNetwork?: string; onNetworkChange?: (network: string) => void; onOpenSite?: (site: Site) => void }) {
  const [tab, setTab] = useState(mode === "objects" ? "sites" : "active"),
    [customers, setCustomers] = useState<Customer[]>([]),
    [sites, setSites] = useState<Site[]>([]),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false),
    [query, setQuery] = useState(""),
    [searched, setSearched] = useState(""),
    [network, setNetwork] = useState(initialNetwork),
    [networks, setNetworks] = useState<string[]>([]),
    [networksLoading, setNetworksLoading] = useState(false),
    [networksError, setNetworksError] = useState(""),
    [networkRevision, setNetworkRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [canManage, setCanManage] = useState(false),
    [openedCustomer, setOpenedCustomer] = useState<Customer | null>(null),
    [passport, setPassport] = useState<Site | null>(null),
    [selected, setSelected] = useState<Site | null>(null),
    [apps, setApps] = useState<Application[]>([]),
    [appPage, setAppPage] = useState(0),
    [appsMore, setAppsMore] = useState(false);
  useEffect(() => {
    if (mode === "objects") { setNetwork(initialNetwork); setPage(0); }
  }, [initialNetwork, mode]);
  const listRequest = useRef(0);
  const refresh = () => {
    const request = ++listRequest.current;
    setBusy(true);
    setError("");
    return (
      tab === "sites"
        ? searched || network
          ? portal<{ sites: Site[]; more: boolean }>("office.sites", {
              query: searched,
              network,
              page,
            }).then((r) => {
              if (request !== listRequest.current) return;
              setSites(r.sites);
              setMore(r.more);
            })
          : Promise.resolve().then(() => { setSites([]); setMore(false); })
        : portal<{ customers: Customer[]; more: boolean; canManage: boolean }>(
            "office.list",
            { status: tab, page },
          ).then((r) => {
            if (request !== listRequest.current) return;
            setCustomers(r.customers);
            setMore(r.more);
            setCanManage(r.canManage);
          })
    )
      .catch((e) => { if (request === listRequest.current) { setError(e.message); setSites([]); setMore(false); } })
      .finally(() => { if (request === listRequest.current) setBusy(false); });
  };
  useEffect(() => {
    void refresh();
  }, [tab, page, searched, network]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "visible" || busy || openedCustomer || passport) return;
      void refresh();
      if (tab === "sites") setNetworkRevision((v) => v + 1);
    };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [tab, page, searched, network, busy, openedCustomer, passport]);
  useEffect(() => {
    if (tab !== "sites") return;
    let active = true;
    setNetworksLoading(true);
    setNetworksError("");
    portal<{ networks: string[] }>("office.networks")
      .then((r) => { if (active) setNetworks(r.networks); })
      .catch((e) => { if (active) { setNetworksError(e.message); setNetworks([]); } })
      .finally(() => { if (active) setNetworksLoading(false); });
    return () => { active = false; };
  }, [tab, networkRevision]);
  useEffect(() => {
    setApps([]);
    if (!selected) return;
    portal<{ applications: Application[]; more: boolean }>(
      "office.applications",
      { page: appPage },
    )
      .then((r) => {
        setApps(r.applications);
        setAppsMore(r.more);
      })
      .catch((e) => setError(e.message));
  }, [selected?.id, appPage]);
  async function decide(c: Customer, decision: string) {
    if (
      decision === "reset" &&
      !confirm(
        `Скинути реєстрацію ${c.first_name || c.phone}? Доступ буде відкликано. Паспорти та акти збережуться.`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await portal<{ notificationSent: boolean }>(
        "office.decide",
        { user: c.telegram_id, version: c.updated_at, decision },
      );
      await refresh();
      if (!result.notificationSent)
        setError("Контакт оновлено. Сповіщення в Telegram не доставлено.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function link(a: Application) {
    if (
      !selected ||
      !confirm(
        `Прив’язати заявку ${a.application_number} (${a.title}, ${a.address}) до ${selected.label} (${selected.address})? Користувачі з доступом до АЗК побачать цю заявку.`,
      )
    )
      return;
    setBusy(true);
    try {
      await portal("office.link", {
        application: a.id,
        site: selected.id,
        version: a.updated_at,
      });
      setSelected(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (openedCustomer) return <CustomerDetails key={openedCustomer.telegram_id} customer={openedCustomer} onBack={() => setOpenedCustomer(null)} onOpenSite={onOpenSite} />;
  if (passport) return <div className="rpv-office"><SitePassport site={passport} onBack={() => setPassport(null)} /></div>;
  return (
    <div className="rpv-office">
      <p className="ws-eyebrow">{mode === "objects" ? "МЕРЕЖІ ТА ОБ’ЄКТИ" : "КОНТАКТИ МЕРЕЖІ"}</p>
      <h1>{mode === "objects" ? "Об’єкти" : "Менеджери АЗК"}</h1>
      <p>{mode === "objects" ? "Оберіть мережу, відкрийте АЗК — паспорт і заявки завжди поруч." : "Зареєстровані менеджери, їхні об’єкти та паспорти АЗК."}</p>
      {mode === "managers" && <nav className="rpv-tabs">
        {[
          ["active", "Зареєстровані"],
          ["pending", "Запити"],
          ["rejected", "Відхилені"],
          ["sites", "Пошук АЗК"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setPage(0);
              setSelected(null);
              setMore(false);
            }}
          >
            {label}
          </button>
        ))}
      </nav>}
      {error && (
        <p className="rpv-error" role="alert">
          {error}
        </p>
      )}
      {tab === "sites" ? (
        <>
          <label className="rpv-network-filter">
            Мережа АЗК
            <select aria-label="Мережа АЗК" value={network} disabled={networksLoading} onChange={(e) => {
              setNetwork(e.target.value); onNetworkChange?.(e.target.value); setQuery(""); setSearched(""); setPage(0); setSites([]); setMore(false); setSelected(null);
            }}>
              <option value="">{networksLoading ? "Завантажуємо мережі…" : "Оберіть мережу"}</option>
              {networks.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {networksError && <p className="rpv-error" role="alert">{networksError}</p>}
          <div className="ws-network-cards" aria-label="Мережі">{networks.map(name => <button key={name} className={network === name ? "active" : ""} aria-pressed={network === name} onClick={() => { setNetwork(name); onNetworkChange?.(name); setQuery(""); setSearched(""); setPage(0); setSites([]); setSelected(null); setMore(false); }}>{name}<ArrowRight size={16} /></button>)}</div>
          {!network && !searched && <p>Оберіть мережу — відкриється список її АЗК.</p>}
          <form
            className="rpv-office-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSearched(query.trim());
              setPage(0);
              setSelected(null);
            }}
          >
            <input
              aria-label="Пошук мережі або АЗК"
              placeholder={network ? "Код АЗК у вибраній мережі" : "Мережа латиницею або код АЗК"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button disabled={busy}>Знайти</button>
          </form>
          {network && <h2 className="rpv-customer-sites-title">АЗК мережі {network}</h2>}
          {busy && <p role="status">Завантажуємо АЗК…</p>}
          {!busy && !error && (network || searched) && !sites.length && <p>АЗК за цим фільтром не знайдено.</p>}
          {sites.map((s) => (
            <article key={s.id}>
              <h2><button className="rpv-card-open" onClick={() => onOpenSite ? onOpenSite(s) : setPassport(s)}>
                <span>{s.label}<small>Відкрити паспорт об’єкта</small></span>
                <ArrowRight size={20} aria-hidden="true" />
              </button></h2>
              <p>{s.region}</p>
              <p>{s.address}</p>
              <p>Септик: {s.capacity_m3 ?? "—"} м³</p>
              <details className="rpv-office-actions"><summary>Додаткові дії</summary>
                <button
                  disabled={busy}
                  onClick={() => {
                    setSelected(s);
                    setAppPage(0);
                  }}
                >
                  Прив’язати заявку
                </button>
              </details>
            </article>
          ))}
          {selected && (
            <article>
              <h2>Прив’язка до {selected.label}</h2>
              <p>
                Перевірте мережу, код та адресу. Автоматичного перенесення
                історії немає.
              </p>
              {apps.map((a) => (
                <div key={a.id} className="rpv-publish">
                  <p>
                    <b>
                      <bdi className="rpv-application-number">{a.application_number}</bdi> · {a.title}
                    </b>
                  </p>
                  <p>{a.address}</p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{a.description}</p>
                  <button
                    disabled={busy || !!a.customer_site_id}
                    onClick={() => link(a)}
                  >
                    {a.customer_site_id
                      ? "Уже прив’язано"
                      : "Підтвердити прив’язку"}
                  </button>
                </div>
              ))}
              <Pager page={appPage} more={appsMore} change={setAppPage} />
              <Publish site={selected} report={setError} />
            </article>
          )}
        </>
      ) : (
        customers.map((c) => (
          <article key={c.telegram_id}>
            <h2>
              <button className="rpv-card-open" onClick={() => setOpenedCustomer(c)}>
                <span>{[c.first_name, c.last_name].filter(Boolean).join(" ") || "Без імені"}<small>Об’єкти та паспорти АЗК</small></span>
                <ArrowRight size={20} aria-hidden="true" />
              </button>
            </h2>
            <p>
              <a href={`tel:${c.phone}`}>{c.phone}</a>
            </p>
            <p>
              <a
                href={
                  c.username && /^[a-zA-Z0-9_]{5,32}$/.test(c.username)
                    ? `https://t.me/${c.username}`
                    : `https://t.me/+${c.phone.replace(/\D/g, "")}`
                }
                target="_blank"
                rel="noreferrer"
              >
                Написати в Telegram ↗
              </a>
            </p>
            {canManage && (
              <div className="rpv-office-actions">
                {tab === "pending" && (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => decide(c, "approve")}
                    >
                      Підтвердити контакт
                    </button>
                    <button disabled={busy} onClick={() => decide(c, "reject")}>
                      Відхилити
                    </button>
                  </>
                )}
                <details><summary>Керування доступом</summary><button disabled={busy} onClick={() => decide(c, "reset")}>Скинути реєстрацію</button></details>
              </div>
            )}
          </article>
        ))
      )}
      {!busy && tab !== "sites" && !customers.length && (
        <p>Записів поки немає.</p>
      )}
      <Pager page={page} more={more} change={setPage} />
      <button disabled={busy} onClick={() => { void refresh(); setNetworkRevision((v) => v + 1); }}>
        Оновити
      </button>
    </div>
  );
}
function Publish({
  site,
  report,
}: {
  site: Site;
  report: (message: string) => void;
}) {
  const [act, setAct] = useState(""),
    [date, setDate] = useState(""),
    [volume, setVolume] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    setBusy(true);
    try {
      const r = await portal<{ notifications: { failed: number } | null }>(
        "office.publish",
        { site: site.id, act, date, volume: volume ? Number(volume) : null },
      );
      setDone(true);
      if (r.notifications?.failed)
        report("Акт опубліковано. Частину сповіщень не доставлено.");
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="rpv-publish" onSubmit={submit}>
      <h3>Опублікувати підтверджений акт замовнику</h3>
      <p>
        Адреса заявки має збігатися з паспортом. Повторна публікація не збільшує
        лічильник двічі.
      </p>
      <div className="rpv-office-form">
        <label>
          Номер акта
          <input
            required
            value={act}
            onChange={(e) => setAct(e.target.value)}
          />
        </label>
        <label>
          Дата виконання
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Обсяг, м³
          <input
            type="number"
            min="0.001"
            max="999999"
            step="0.001"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="Без відкачки — порожньо"
          />
        </label>
      </div>
      <button disabled={busy}>Опублікувати акт</button>
      {done && <p role="status">Акт опубліковано.</p>}
    </form>
  );
}
