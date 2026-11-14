import type { Application } from "@/types";
export type WorkflowAct = {
  id: string;
  application_id: string | null;
  status: string;
  created_at: string;
};
export type Queue =
  | "attention"
  | "dispatch"
  | "execution"
  | "review"
  | "payout"
  | "all";
export type WorkItem = {
  app: Application;
  queue: Exclude<Queue, "attention" | "all">;
  reason: string;
  action: string;
  urgent: boolean;
  overdue: boolean;
  priority: number;
  actId?: string;
};
export function kyivDay(value: Date | string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function buildWorkItems(
  applications: Application[],
  acts: WorkflowAct[],
  now = new Date(),
): WorkItem[] {
  const latest = new Map<string, WorkflowAct>();
  for (const act of acts) {
    if (!act.application_id) continue;
    const previous = latest.get(act.application_id);
    if (!previous || new Date(act.created_at) > new Date(previous.created_at))
      latest.set(act.application_id, act);
  }
  return applications
    .flatMap((app): WorkItem[] => {
      if (app.status === "Скасована") return [];
      const completed = app.status === "Виконана";
      const act = latest.get(app.id);
      const overdue =
        !completed &&
        !!app.deadline &&
        new Date(app.deadline).getTime() < now.getTime();
      const problem =
        !completed && (app.hasProblem || app.contractorStage === "problem");
      const base = { app, urgent: !!problem || overdue, overdue };
      if (completed)
        return app.payoutStatus === "Очікує"
          ? [
              {
                ...base,
                queue: "payout",
                reason: app.payoutAmount > 0 ? "Роботу прийнято · не оплачено" : "Закрито · суму ще не вказано",
                action: app.payoutAmount > 0 ? "Перевірити виплату" : "Уточнити розрахунок",
                priority: 6,
              },
            ]
          : [];
      if (problem)
        return [
          {
            ...base,
            queue: "execution",
            reason: "Проблема на об’єкті",
            action: "Розв’язати проблему",
            priority: 0,
          },
        ];
      if (act && ["pending", "review", "on_review"].includes(act.status))
        return [
          {
            ...base,
            queue: "review",
            reason: "Результат на перевірці",
            action: "Перевірити акт",
            priority: 2,
            actId: act.id,
          },
        ];
      if (!app.contractorId)
        return [
          {
            ...base,
            queue: "dispatch",
            reason: overdue
              ? "Строк минув · без виконавця"
              : "Виконавця ще немає",
            action: "Призначити виконавця",
            priority: overdue ? 1 : 3,
          },
        ];
      if (app.awaitingAct || act?.status === "rejected")
        return [
          {
            ...base,
            queue: "review",
            reason:
              act?.status === "rejected"
                ? "Акт повернуто на виправлення"
                : "Очікуємо акт від виконавця",
            action: "Відкрити виконання",
            priority: overdue ? 1 : 4,
          },
        ];
      const awaiting = ["offered", "assigned"].includes(
        app.contractorStage || "",
      );
      return [
        {
          ...base,
          queue: "execution",
          reason: overdue
            ? "Строк виконання минув"
            : awaiting
              ? "Очікуємо підтвердження виконавця"
              : app.contractorStage === "departed"
                ? "Виконавець у дорозі"
                : "Робота у виконанні",
          action: "Відкрити заявку",
          priority: overdue ? 1 : 5,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        new Date(a.app.deadline || "9999-01-01").getTime() -
          new Date(b.app.deadline || "9999-01-01").getTime() ||
        a.app.id.localeCompare(b.app.id),
    );
}
export const isAttentionItem = (item: WorkItem) =>
  item.urgent ||
  item.queue !== "execution" ||
  item.app.contractorStage === "offered";
