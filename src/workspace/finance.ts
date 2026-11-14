export type FinanceEntry = {
  id: string;
  application_number: string;
  title: string;
  address: string | null;
  status: string;
  contractor_id: string | null;
  contractor_name: string;
  contractor_phone: string | null;
  amount: number | null;
  debt: number;
  pending: boolean;
  needs_amount: boolean;
  needs_contractor: boolean;
  payout_status: string;
  payout_accrued_at: string;
  paid_at: string | null;
  payout_version: number;
  network: string | null;
  payout_receipt_file_id: string | null;
  payout_receipt_type: string | null;
  payout_receipt_name: string | null;
};
export type FinanceEvent = {
  id: string;
  application_id: string;
  application_number: string;
  contractor_name: string;
  kind: string;
  amount: number | null;
  previous_amount: number | null;
  payout_status: string;
  occurred_at: string;
  source: string;
};
export type FinanceReport = {
  month: string;
  as_of: string;
  can_manage: boolean;
  filter_contractor?: string | null;
  filter_application?: string | null;
  filter_state?: string;
  monthly: { month: string; paid: number; debt: number }[];
  daily: { date: string; amount: number }[];
  stats: {
    accrued_today: number;
    accrued_month: number;
    paid_month: number;
    accrued_total: number;
    paid_total: number;
    debt_total: number;
    pending_count: number;
    missing_amount_count: number;
    missing_contractor_count: number;
  };
  rows: FinanceEntry[];
  row_count: number;
  more: boolean;
  contractors: {
    contractor_id: string | null;
    contractor_name: string;
    debt: number;
    paid: number;
    pending_count: number;
    missing_amount_count: number;
    paid_count: number;
  }[];
  contractor_options: { id: string; name: string }[];
};
export const settlementStatus = (r: FinanceEntry) =>
  r.payout_status === "paid"
    ? "Виплачено"
    : r.needs_amount
      ? "Вказати суму"
      : r.needs_contractor
        ? "Вказати підрядника"
        : "До виплати";
export const eventTitle = (kind: string) =>
  ({
    opening: "Початковий запис",
    accrued: "Нарахування",
    amount_changed: "Суму змінено",
    contractor_changed: "Підрядника уточнено",
    paid: "Оплату зафіксовано",
    status_changed: "Стан розрахунку змінено",
  })[kind] || "Зміна розрахунку";
export function financeCsv(report: FinanceReport) {
  const text = (v: unknown) => {
    let s = String(v ?? "");
    if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows: unknown[][] = [
    ["Розрахунки з підрядниками", report.month],
    ["Стан боргу на", report.as_of],
    [
      "Підрядник",
      report.contractor_options.find((c) => c.id === report.filter_contractor)
        ?.name ||
        report.contractors.find(
          (c) => c.contractor_id === report.filter_contractor,
        )?.contractor_name ||
        "Усі",
    ],
    [
      "Фільтр",
      (
        {
          all: "Усі",
          pending: "Не оплачені",
          paid: "Оплачені",
          missing: "Уточнити дані",
        } as Record<string, string>
      )[report.filter_state || "all"],
    ],
    ["Нараховано за місяць, грн", report.stats.accrued_month],
    ["Виплачено за місяць, грн", report.stats.paid_month],
    ["Підтверджений борг, грн", report.stats.debt_total],
    ["Неоплачені заявки без суми", report.stats.missing_amount_count],
    [],
    [
      "Заявка",
      "Мережа",
      "Підрядник",
      "Нараховано",
      "Сума, грн",
      "Статус",
      "Дата оплати",
      "Залишок боргу, грн",
    ],
  ];
  for (const r of report.rows)
    rows.push([
      r.application_number,
      r.network,
      r.contractor_name,
      r.payout_accrued_at,
      r.amount ?? "Не вказано",
      settlementStatus(r),
      r.paid_at,
      r.needs_amount ? "Не вказано" : r.debt,
    ]);
  return "\ufeff" + rows.map((r) => r.map(text).join(";")).join("\r\n");
}
