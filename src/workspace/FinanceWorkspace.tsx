import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, RefreshCw, Wallet, X, History } from "lucide-react";
import { portal, currentMonth } from "@/portal/api";
import { Pager } from "@/portal/Portal";
import { formatCurrency, formatDateTime } from "@/utils/helpers";
import { telegramFileUrl } from "@/lib/actsApi";
import {
  financeCsv,
  settlementStatus,
  eventTitle,
  type FinanceEntry,
  type FinanceEvent,
  type FinanceReport,
} from "./finance";
import "./finance.css";

function FinancialHistory({
  application,
  contractor,
  onClose,
}: {
  application?: string;
  contractor?: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<FinanceEvent[]>([]),
    [page, setPage] = useState(0),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    portal<{ events: FinanceEvent[]; more: boolean }>(
      "office.finance_history",
      { application, contractor, page },
    )
      .then((r) => {
        if (alive) {
          setEvents(r.events);
          setMore(r.more);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [application, contractor, page]);
  return createPortal(
    <div
      className="ws-fin-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Історія розрахунків"
    >
      <div className="ws-fin-dialog">
        <header>
          <h2>Історія розрахунків</h2>
          <button aria-label="Закрити історію" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="ws-fin-body">
          {loading ? (
            <p role="status">Завантажуємо…</p>
          ) : error ? (
            <p role="alert" className="ws-error">
              {error}
            </p>
          ) : (
            <>
              {events.length === 0 && <p>Записів поки немає.</p>}
              {events.map((e) => (
                <article className="ws-fin-event" key={e.id}>
                  <strong>{eventTitle(e.kind)}</strong>
                  <time>{formatDateTime(e.occurred_at)}</time>
                  <a href={`?page=payouts&record=${e.application_id}`}>
                    {e.application_number}
                  </a>
                  <p>
                    {e.contractor_name} ·{" "}
                    {e.amount == null
                      ? "Суму не вказано"
                      : formatCurrency(e.amount)}{" "}
                    · {e.payout_status === "paid" ? "Виплачено" : "Не оплачено"}
                  </p>
                  {e.previous_amount != null &&
                    e.previous_amount !== e.amount && (
                      <small>
                        Попередня сума: {formatCurrency(e.previous_amount)}
                      </small>
                    )}
                  {e.source === "migration" && (
                    <small>Збережено з наявних даних</small>
                  )}
                </article>
              ))}
              <Pager page={page} more={more} change={setPage} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
function SettlementDialog({
  row,
  action,
  choices,
  onClose,
  onSaved,
}: {
  row: FinanceEntry;
  action: "set" | "confirm";
  choices: FinanceReport["contractor_options"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(
      row.amount == null ? "" : String(row.amount),
    ),
    [contractor, setContractor] = useState(row.contractor_id || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const n = Number(amount.replace(",", "."));
      if (action === "set" && (!Number.isFinite(n) || n <= 0))
        throw Error("Вкажіть суму більше 0.");
      await portal(
        action === "set" ? "office.finance_set" : "office.finance_confirm",
        {
          application: row.id,
          version: row.payout_version,
          ...(action === "set" ? { amount: n, contractor } : {}),
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div
      className="ws-fin-modal"
      role="dialog"
      aria-modal="true"
      aria-label={action === "set" ? "Сума виплати" : "Підтвердження виплати"}
    >
      <form className="ws-fin-dialog" onSubmit={submit}>
        <header>
          <h2>
            {action === "set"
              ? "Сума до виплати"
              : "Підтвердити проведену оплату"}
          </h2>
          <button
            type="button"
            aria-label="Закрити розрахунок"
            onClick={onClose}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        <div className="ws-fin-body">
          <p>
            <b>{row.application_number}</b> · {row.contractor_name}
          </p>
          {action === "set" ? (
            <>
              <label>
                Сума, грн
                <input
                  aria-label="Сума виплати, грн"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              {!row.contractor_id && (
                <label>
                  Підрядник
                  <select
                    aria-label="Підрядник для виплати"
                    value={contractor}
                    onChange={(e) => setContractor(e.target.value)}
                    required
                  >
                    <option value="">Оберіть підрядника</option>
                    {choices.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <strong className="ws-fin-confirm-amount">
                {formatCurrency(row.amount || 0)}
              </strong>
              <p>
                Підтверджуйте після фактичної оплати. Запис залишиться в
                історії.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="ws-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button
            type="button"
            className="ws-button"
            disabled={busy}
            onClick={onClose}
          >
            Скасувати
          </button>
          <button className="ws-button ws-primary" disabled={busy}>
            {busy
              ? "Зберігаємо…"
              : action === "set"
                ? "Зберегти суму"
                : "Оплату проведено"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
export default function FinanceWorkspace({
  contractor,
  fixedApplication,
  compact = false,
  onClearFocus,
}: {
  contractor?: string;
  fixedApplication?: string;
  compact?: boolean;
  onClearFocus?: () => void;
}) {
  const [month, setMonth] = useState(currentMonth),
    [selectedContractor, setSelectedContractor] = useState(contractor || ""),
    [state, setState] = useState("all"),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<FinanceReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const [edit, setEdit] = useState<{
      row: FinanceEntry;
      action: "set" | "confirm";
    } | null>(null),
    [history, setHistory] = useState<{
      application?: string;
      contractor?: string;
    } | null>(null);
  const serial = useRef(0);
  const filters = {
    month,
    contractor: contractor || selectedContractor || undefined,
    application: fixedApplication,
    state,
    page,
  };
  const load = useCallback(async () => {
    const n = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const r = await portal<FinanceReport>("office.finance", {
        month,
        contractor: contractor || selectedContractor || undefined,
        application: fixedApplication,
        state,
        page,
      });
      if (n === serial.current) setData(r);
    } catch (e) {
      if (n === serial.current) {
        setError((e as Error).message);
        setData(null);
      }
    } finally {
      if (n === serial.current) setLoading(false);
    }
  }, [
    month,
    contractor,
    selectedContractor,
    fixedApplication,
    state,
    page,
    revision,
  ]);
  useEffect(() => {
    void load();
    return () => {
      serial.current++;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !edit)
        setRevision((x) => x + 1);
    };
    window.addEventListener("focus", refresh);
    const t = setInterval(refresh, 60000);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refresh);
    };
  }, [edit]);
  async function download() {
    setExporting(true);
    setExportError("");
    try {
      const r = await portal<FinanceReport>("office.finance", {
        ...filters,
        export: true,
      });
      const url = URL.createObjectURL(
        new Blob([financeCsv(r)], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `RPV-rozrakhunky-${month}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const stats = data?.stats;
  const show = (n: number | undefined) =>
    loading || !data ? "—" : formatCurrency(n || 0);
  return (
    <section className="ws-fin" aria-label="Розрахунки з підрядниками">
      <div className="ws-fin-title">
        <h2>
          <Wallet size={22} /> Розрахунки з підрядниками
        </h2>
        <button
          className="ws-button"
          aria-label="Оновити розрахунки"
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {fixedApplication && (
        <button className="ws-button" onClick={onClearFocus}>
          Усі виплати
        </button>
      )}
      <fieldset disabled={loading || exporting} className="ws-fin-filters">
        <legend className="sr-only">Фільтри розрахунків</legend>
        <label>
          Місяць
          <input
            type="month"
            aria-label="Місяць розрахунків"
            min="2020-01"
            max={currentMonth()}
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setPage(0);
              }
            }}
          />
        </label>
        {!contractor && !fixedApplication && (
          <label>
            Підрядник
            <select
              aria-label="Фільтр підрядника"
              value={selectedContractor}
              onChange={(e) => {
                setSelectedContractor(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Усі підрядники</option>
              {data?.contractor_options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Стан
          <select
            aria-label="Стан розрахунку"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">Усі розрахунки</option>
            <option value="pending">Не оплачені</option>
            <option value="missing">Уточнити дані</option>
            <option value="paid">Оплачені</option>
          </select>
        </label>
      </fieldset>
      <div className="ws-fin-stats">
        <article>
          <span>{compact ? "Нараховано всього" : "Нараховано за місяць"}</span>
          <strong>
            {show(compact ? stats?.accrued_total : stats?.accrued_month)}
          </strong>
        </article>
        <article>
          <span>{compact ? "Виплачено всього" : "Виплачено за місяць"}</span>
          <strong>
            {show(compact ? stats?.paid_total : stats?.paid_month)}
          </strong>
        </article>
        <article className="ws-fin-debt">
          <span>Заборгованість до виплати</span>
          <strong>{show(stats?.debt_total)}</strong>
          {!loading && !!stats?.missing_amount_count && (
            <small>Без суми: {stats.missing_amount_count}</small>
          )}
        </article>
        <article>
          <span>Закриті, не оплачені</span>
          <strong>{loading || !data ? "—" : stats?.pending_count}</strong>
        </article>
      </div>
      <p className="ws-fin-note">
        Борг — за всі місяці до поточного моменту. Оплата зменшує його та
        залишається в історії.
      </p>
      {!loading &&
        stats &&
        (stats.missing_amount_count > 0 ||
          stats.missing_contractor_count > 0) && (
          <div className="ws-fin-warning">
            <strong>Потрібно уточнити</strong>
            <p>
              Без суми: {stats.missing_amount_count} · Без підрядника:{" "}
              {stats.missing_contractor_count}. Вкажіть дані в заявках нижче,
              щоб доповнити суму боргу.
            </p>
          </div>
        )}
      {error && (
        <div role="alert" className="ws-error">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>Повторити</button>
        </div>
      )}
      <div className="ws-fin-tools">
        <button
          className="ws-button"
          disabled={!data || loading || exporting}
          onClick={() => void download()}
        >
          <Download size={16} />
          {exporting ? "Готуємо…" : "Завантажити CSV"}
        </button>
        {contractor && (
          <button
            className="ws-button"
            onClick={() => setHistory({ contractor })}
          >
            <History size={16} />
            Історія розрахунків
          </button>
        )}
      </div>
      {exportError && (
        <p role="alert" className="ws-error">
          {exportError}
        </p>
      )}
      {!loading && data && (
        <>
          {!compact &&
            !fixedApplication &&
            !selectedContractor &&
            data.contractors.length > 0 && (
              <div className="ws-fin-contractors">
                <h3>Заборгованість за підрядниками</h3>
                {data.contractors
                  .filter((c) => c.pending_count > 0)
                  .map((c) => (
                    <div key={c.contractor_id || "missing"}>
                      <span>
                        {c.contractor_id ? (
                          <a
                            href={`?page=contractors&record=${c.contractor_id}`}
                          >
                            {c.contractor_name}
                          </a>
                        ) : (
                          c.contractor_name
                        )}
                        <small>
                          Не оплачені: {c.pending_count} · Без суми:{" "}
                          {c.missing_amount_count}
                        </small>
                      </span>
                      <b>{formatCurrency(c.debt)}</b>
                    </div>
                  ))}
              </div>
            )}
          <h3 className="ws-fin-list-title">
            Заявки та виплати · {data.row_count}
          </h3>
          <p className="ws-fin-note">
            Нарахування й оплати за місяць, а також непогашені заявки минулих
            місяців.
          </p>
          {data.rows.length === 0 ? (
            <p className="ws-empty">За цими фільтрами записів немає.</p>
          ) : (
            data.rows.map((r) => (
              <article className="ws-fin-entry" key={r.id}>
                <div className="ws-fin-entry-head">
                  <a href={`?page=applications&application=${r.id}`}>
                    {r.application_number}
                  </a>
                  <span
                    className={`ws-tag ${r.payout_status === "paid" ? "ws-tag-completed" : ""}`}
                  >
                    {settlementStatus(r)}
                  </span>
                </div>
                <h4>{r.contractor_name}</h4>
                <p>{r.title}</p>
                <dl>
                  <div>
                    <dt>Сума роботи</dt>
                    <dd>
                      {r.amount == null
                        ? "Не вказано"
                        : formatCurrency(r.amount)}
                    </dd>
                  </div>
                  <div>
                    <dt>Залишок боргу</dt>
                    <dd>
                      {r.needs_amount ? "Уточнюється" : formatCurrency(r.debt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Нараховано</dt>
                    <dd>{formatDateTime(r.payout_accrued_at)}</dd>
                  </div>
                  <div>
                    <dt>Оплачено</dt>
                    <dd>
                      {r.paid_at ? formatDateTime(r.paid_at) : "Ще не оплачено"}
                    </dd>
                  </div>
                </dl>
                <div className="ws-fin-entry-actions">
                  <button
                    className="ws-button"
                    onClick={() => setHistory({ application: r.id })}
                  >
                    Історія
                  </button>
                  {r.payout_receipt_file_id && (
                    <a
                      className="ws-button"
                      href={telegramFileUrl(r.payout_receipt_file_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Квитанція
                    </a>
                  )}
                  {data.can_manage && r.pending && (
                    <>
                      <button
                        className="ws-button"
                        onClick={() => setEdit({ row: r, action: "set" })}
                      >
                        {r.needs_amount
                          ? "Вказати суму"
                          : r.needs_contractor
                            ? "Вказати підрядника"
                            : "Змінити суму"}
                      </button>
                      {!r.needs_amount && !r.needs_contractor && (
                        <button
                          className="ws-button ws-primary"
                          onClick={() => setEdit({ row: r, action: "confirm" })}
                        >
                          Підтвердити оплату
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))
          )}
          <Pager page={page} more={data.more} change={setPage} />
        </>
      )}
      {edit && (
        <SettlementDialog
          row={edit.row}
          action={edit.action}
          choices={data?.contractor_options || []}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            setRevision((v) => v + 1);
            window.dispatchEvent(new Event("rpv-finance-updated"));
          }}
        />
      )}
      {history && (
        <FinancialHistory {...history} onClose={() => setHistory(null)} />
      )}
    </section>
  );
}
