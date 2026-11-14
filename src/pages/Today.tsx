import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Plus,
  RefreshCw,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import type { Application } from "@/types";
import type { PageId } from "@/lib/permissions";
import { formatCurrency, formatDateTime } from "@/utils/helpers";
import { fetchOperations } from "@/workspace/operationsApi";
import RPVCounter from "@/workspace/RPVCounter";
import {
  buildWorkItems,
  isAttentionItem,
  kyivDay,
  type Queue,
  type WorkflowAct,
} from "@/workspace/workflow";

interface Props {
  onNavigateToApplications?: () => void;
  onNavigate?: (page: PageId) => void;
  onOpenApplication?: (id: string) => void;
  onOpenAct?: (id: string) => void;
  onCreate?: () => void;
  onOpenPayout?: (id: string) => void;
}
const stages = [
  {
    id: "dispatch",
    label: "Призначити",
    hint: "Знайти виконавця",
    icon: Truck,
  },
  { id: "execution", label: "Виконати", hint: "Виїзд і робота", icon: Clock3 },
  {
    id: "review",
    label: "Перевірити",
    hint: "Результат та акт",
    icon: ClipboardCheck,
  },
  {
    id: "payout",
    label: "Розрахуватися",
    hint: "Прийняті роботи",
    icon: Wallet,
  },
] as const;
export default function Today({
  onNavigateToApplications,
  onNavigate,
  onOpenApplication,
  onOpenAct,
  onCreate,
  onOpenPayout,
}: Props) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [acts, setActs] = useState<WorkflowAct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [queue, setQueue] = useState<Queue>("attention");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(20);
  const alive = useRef(true),
    inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const data = await fetchOperations();
      if (alive.current) {
        setApplications(data.applications);
        setActs(data.acts);
        setUpdated(new Date());
        setError("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    setShown(20);
  }, [queue, query]);
  const items = useMemo(
    () => buildWorkItems(applications, acts, updated || new Date()),
    [applications, acts, updated],
  );
  const attention = items.filter(isAttentionItem);
  const active = applications.filter(
    (a) => !["Виконана", "Скасована"].includes(a.status),
  );
  const dueToday = active.filter(
    (a) => kyivDay(a.scheduledDate || a.deadline || "") === kyivDay(new Date()),
  );
  const overdue = items.filter((i) => i.overdue).length;
  const payout = items
    .filter((i) => i.queue === "payout")
    .reduce((sum, i) => sum + i.app.payoutAmount, 0);
  const visible = items.filter(
    (i) =>
      (queue === "all" ||
        (queue === "attention" ? isAttentionItem(i) : i.queue === queue)) &&
      `${i.app.number} ${i.app.customer} ${i.app.address} ${i.app.azkCode || ""} ${i.app.contractorName}`
        .toLocaleLowerCase("uk")
        .includes(query.trim().toLocaleLowerCase("uk")),
  );
  const initial = loading && !updated;
  return (
    <div className="ws-page">
      <div className="ws-heading">
        <div>
          <p className="ws-eyebrow">ОПЕРАЦІЙНИЙ ОГЛЯД</p>
          <h1>Уся робота. Один екран.</h1>
          <p>Від заявки на відкачку до прийнятого акта та виплати.</p>
        </div>
        <button className="ws-button ws-primary" onClick={onCreate}>
          <Plus size={18} /> Нова заявка
        </button>
      </div>
      <section className="ws-overview" aria-label="Поточний стан">
        <div className="ws-overview-main">
          <span className="ws-status-dot" /> <span>Зараз у роботі</span>
          <strong>{!updated ? "—" : active.length}</strong>
          <p>активних заявок у всій системі</p>
          <button onClick={onNavigateToApplications}>
            Відкрити всі заявки <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="ws-overview-stat">
          <span>Заплановано сьогодні</span>
          <strong>{!updated ? "—" : dueToday.length}</strong>
          <button onClick={() => onNavigate?.("calendar")}>
            Переглянути календар <ArrowRight size={15} />
          </button>
        </div>
        <div className="ws-overview-stat">
          <span>Прострочено</span>
          <strong className={overdue ? "ws-orange" : ""}>
            {!updated ? "—" : overdue}
          </strong>
          <p>Показані першими у черзі уваги</p>
        </div>
        <div className="ws-overview-stat">
          <span>До виплати за прийняті роботи</span>
          <strong className="ws-money">
            {!updated ? "—" : formatCurrency(payout)}
          </strong>
          <button onClick={() => onNavigate?.("payouts")}>
            Переглянути виплати <ArrowRight size={15} />
          </button>
        </div>
      </section>
      <RPVCounter compact />
      <div className="ws-section-label">
        <h2>Робочий цикл</h2>
        <span>Оберіть крок, щоб побачити заявки</span>
      </div>
      <div className="ws-stages">
        {stages.map(({ id, label, hint, icon: Icon }, index) => (
          <button
            key={id}
            className={`ws-stage ${queue === id ? "is-active" : ""}`}
            aria-pressed={queue === id}
            onClick={() => setQueue(queue === id ? "attention" : id)}
          >
            <div>
              <span className="ws-step">0{index + 1}</span>
              <Icon size={19} />
            </div>
            <strong>
              {!updated ? "—" : items.filter((i) => i.queue === id).length}
            </strong>
            <h3>{label}</h3>
            <p>{hint}</p>
          </button>
        ))}
      </div>
      <div className="ws-work-grid">
        <section className="ws-panel ws-queue">
          <div className="ws-panel-title">
            <div>
              <h2>
                {queue === "attention"
                  ? "Потребують вашої уваги"
                  : queue === "all"
                    ? "Усі незакриті завдання"
                    : stages.find((s) => s.id === queue)?.label}
              </h2>
              <p>Одна заявка — одна наступна дія</p>
            </div>
            <span className="ws-count">{initial ? "…" : visible.length}</span>
          </div>
          <div className="ws-queue-toolbar">
            <div className="ws-segment">
              <button
                className={queue === "attention" ? "active" : ""}
                onClick={() => setQueue("attention")}
              >
                Увага {attention.length}
              </button>
              <button
                className={queue === "all" ? "active" : ""}
                onClick={() => setQueue("all")}
              >
                Усі завдання
              </button>
            </div>
            <label className="ws-search">
              <Search size={16} />
              <input
                aria-label="Пошук у робочій черзі"
                placeholder="Номер, АЗК, адреса…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div role="alert" className="ws-error">
              {error}
              {updated && " Показано попередні дані."}
              <button onClick={() => void load()}>Повторити</button>
            </div>
          )}
          {initial ? (
            <div className="ws-empty" role="status">
              Завантажуємо робочу чергу…
            </div>
          ) : !error && !visible.length ? (
            <div className="ws-empty">
              <CheckCircle2 size={32} />
              <h3>
                {query
                  ? "За цим запитом нічого немає"
                  : "У цій черзі все опрацьовано"}
              </h3>
              <p>
                {query
                  ? "Спробуйте номер заявки, код АЗК або адресу."
                  : "Нові завдання з’являться автоматично."}
              </p>
            </div>
          ) : (
            <div className="ws-work-list">
              {visible.slice(0, shown).map((item) => (
                <article
                  className={`ws-work-row ${item.urgent ? "is-urgent" : ""}`}
                  key={item.app.id}
                >
                  <div className="ws-work-copy">
                    <div className="ws-work-meta">
                      <span>{item.app.number}</span>
                      <span
                        className={
                          item.urgent ? "ws-tag ws-tag-orange" : "ws-tag"
                        }
                      >
                        {item.reason}
                      </span>
                    </div>
                    <button
                      className="ws-record-title"
                      onClick={() => onOpenApplication?.(item.app.id)}
                    >
                      {item.app.customer}
                    </button>
                    <p>{item.app.address}</p>
                    <small>
                      {item.app.contractorName &&
                      item.app.contractorName !== "—"
                        ? item.app.contractorName
                        : "Виконавця не призначено"}
                      {item.app.deadline &&
                        ` · до ${formatDateTime(item.app.deadline)}`}
                    </small>
                  </div>
                  <button
                    className="ws-next-action"
                    onClick={() =>
                      item.actId
                        ? onOpenAct?.(item.actId)
                        : item.queue === "payout"
                          ? onOpenPayout?.(item.app.id)
                          : onOpenApplication?.(item.app.id)
                    }
                  >
                    {item.action}
                    <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          )}
          {visible.length > shown && (
            <button
              className="ws-button ws-load-more"
              onClick={() => setShown((v) => v + 20)}
            >
              Показати ще 20
            </button>
          )}
          <div className="ws-sync">
            <span>
              {updated
                ? `Оновлено ${updated.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" })} · Київ`
                : "Очікуємо дані"}
            </span>
            <button onClick={() => void load()} disabled={loading}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />{" "}
              Оновити
            </button>
          </div>
        </section>
        <aside className="ws-aside">
          <div className="ws-panel ws-object-shortcut">
            <Building2 size={26} />
            <p className="ws-eyebrow">ОБ’ЄКТИ МЕРЕЖІ</p>
            <h2>Усе починається з АЗК</h2>
            <p>
              Оберіть мережу та об’єкт. У паспорті — адреса, септик і пов’язані
              заявки.
            </p>
            <button
              className="ws-button"
              onClick={() => onNavigate?.("objects")}
            >
              Відкрити об’єкти <ArrowRight size={16} />
            </button>
          </div>
          <div className="ws-panel ws-compact-panel">
            <h3>Під рукою</h3>
            {[
              { id: "customers", label: "Менеджери АЗК" },
              { id: "acts", label: "Первинні акти" },
              { id: "contractors", label: "Виконавці" },
            ].map((i) => (
              <button key={i.id} onClick={() => onNavigate?.(i.id as PageId)}>
                {i.label}
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
