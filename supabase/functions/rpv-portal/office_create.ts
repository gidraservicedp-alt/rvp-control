import { PortalError, uuid } from './auth.ts';

export async function officeCreateApplication(db: any, body: any, admin: {user_id: string}) {
  const site = uuid(body.site), request = uuid(body.request), contractor = uuid(body.contractor);
  if (typeof body.work !== 'string' || !body.work.trim() || body.work.trim().length > 2000 ||
      typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date ||
      typeof body.comment !== 'string' || body.comment.trim().length > 2000 ||
      typeof body.payout !== 'number' || !Number.isFinite(body.payout) || body.payout < 0 || body.payout >= 100000000 ||
      !/^\d+(\.\d{1,2})?$/.test(String(body.payout)))
    throw new PortalError(400, 'Перевірте опис робіт, дату й суму виплати.');
  const r = await db.rpc('rpv_office_create_application', {
    p_actor: admin.user_id, p_site: site, p_request: request, p_work: body.work.trim(),
    p_date: body.date, p_contractor: contractor, p_comment: body.comment.trim(), p_payout: body.payout,
  });
  if (r.error) {
    const code = r.error.code;
    throw new PortalError(code === '42501' ? 403 : code === 'P2002' ? 409 : code === 'P2001' ? 400 : 500,
      ['42501', 'P2001', 'P2002'].includes(code) ? r.error.message : 'Не вдалося створити заявку. Повторіть надсилання.');
  }
  const row = r.data?.[0];
  if (!row?.id) throw new PortalError(500, 'Не вдалося перевірити створення заявки. Повторіть надсилання.');
  return row as {id: string; application_number: string; created: boolean};
}
