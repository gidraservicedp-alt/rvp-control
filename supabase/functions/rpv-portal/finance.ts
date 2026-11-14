import { PortalError, monthRange, uuid } from "./auth.ts";
const managers = ["owner", "admin", "accountant"];
export async function officeFinance(
  db: any,
  body: any,
  admin: { user_id: string; role: string },
) {
  const canManage = managers.includes(admin.role);
  if (["office.finance_set", "office.finance_confirm"].includes(body.action)) {
    if (!canManage) throw new PortalError(403, "Недостатньо прав для виплат.");
    if (!Number.isSafeInteger(body.version) || body.version < 0)
      throw new PortalError(400, "Оновіть виплату перед зміною.");
    const isAmount = body.action === "office.finance_set";
    if (
      isAmount &&
      (typeof body.amount !== "number" ||
        !Number.isFinite(body.amount) ||
        body.amount <= 0 ||
        body.amount > 1e9 ||
        Math.abs(body.amount * 100 - Math.round(body.amount * 100)) > 1e-5)
    )
      throw new PortalError(
        400,
        "Вкажіть суму більше 0, до двох знаків після коми.",
      );
    const reply = await db.rpc("rpv_finance_change", {
      p_actor: admin.user_id,
      p_application: uuid(body.application),
      p_version: body.version,
      p_action: isAmount ? "set_amount" : "confirm",
      p_amount: isAmount ? body.amount : null,
      p_contractor: body.contractor ? uuid(body.contractor) : null,
    });
    if (reply.error) {
      const e = reply.error;
      throw new PortalError(
        e.code === "42501"
          ? 403
          : e.code === "40001"
            ? 409
            : e.code === "P0002"
              ? 404
              : ["23514", "22023"].includes(e.code)
                ? 400
                : 500,
        ["42501", "40001", "P0002", "23514", "22023"].includes(e.code)
          ? e.message
          : "Не вдалося зберегти виплату.",
      );
    }
    return reply.data;
  }
  const contractor = body.contractor ? uuid(body.contractor) : null,
    application = body.application ? uuid(body.application) : null;
  const page = body.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
    throw new PortalError(400, "Некоректна сторінка.");
  if (body.action === "office.finance_history") {
    if (!application && !contractor)
      throw new PortalError(400, "Оберіть заявку або підрядника.");
    let q = db
      .from("rpv_payout_events")
      .select(
        "id,application_id,application_number,contractor_id,contractor_name,kind,amount,previous_amount,payout_status,accrued_at,paid_at,occurred_at,source",
      );
    if (application) q = q.eq("application_id", application);
    if (contractor) q = q.eq("contractor_id", contractor);
    const r = await q
      .order("occurred_at", { ascending: false })
      .order("id")
      .range(page * 50, page * 50 + 50);
    if (r.error)
      throw new PortalError(500, "Не вдалося завантажити історію виплат.");
    return {
      events: (r.data || []).slice(0, 50),
      more: (r.data || []).length > 50,
    };
  }
  const range = monthRange(body.month),
    state = body.state ?? "all";
  if (
    !["all", "pending", "paid", "missing"].includes(state) ||
    (body.export !== undefined && typeof body.export !== "boolean")
  )
    throw new PortalError(400, "Некоректні фільтри.");
  const r = await db.rpc("rpv_finance_report", {
    p_month: range.start,
    p_contractor: contractor,
    p_application: application,
    p_state: state,
    p_offset: page * 50,
    p_export: body.export === true,
  });
  if (r.error || !r.data)
    throw new PortalError(
      500,
      "Не вдалося завантажити розрахунки. Спробуйте ще раз.",
    );
  const choices = [];
  for (let offset = 0; ; offset += 1000) {
    const reply = await db
      .from("contractors")
      .select("id,first_name,last_name")
      .order("id")
      .range(offset, offset + 999);
    if (reply.error)
      throw new PortalError(500, "Не вдалося завантажити підрядників.");
    choices.push(
      ...(reply.data || []).map((c: any) => ({
        id: c.id,
        name:
          [c.first_name, c.last_name].filter(Boolean).join(" ") || "Виконавець",
      })),
    );
    if ((reply.data || []).length < 1000) break;
  }
  return { ...r.data, can_manage: canManage, contractor_options: choices };
}
