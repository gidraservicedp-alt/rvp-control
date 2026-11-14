import { PortalError, uuid } from './auth.ts';

export const validWorkVolume = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1000000 &&
  /^\d+(\.\d{1,3})?$/.test(String(value));

export async function officeWorkVolume(db: any, body: any, admin: {user_id: string; role: string}) {
  const application = uuid(body.application);
  const canEdit = ['owner', 'admin', 'dispatcher'].includes(admin.role);
  if (body.action === 'office.work_volume_set') {
    if (!canEdit) throw new PortalError(403, 'Недостатньо прав для зміни обсягу.');
    if (!validWorkVolume(body.volume)) throw new PortalError(400, 'Вкажіть фактичний обсяг більше 0 м³, до 3 знаків після коми.');
    if (typeof body.version !== 'string' || !Number.isFinite(Date.parse(body.version)))
      throw new PortalError(400, 'Оновіть заявку перед зміною обсягу.');
    const r = await db.rpc('rpv_office_work_volume', {
      p_actor: admin.user_id, p_application: application, p_version: body.version, p_volume: body.volume,
    });
    if (r.error) {
      const code = r.error.code;
      throw new PortalError(code === '42501' ? 403 : ['40001','P2002'].includes(code) ? 409 : code === 'P2001' ? 400 : 500,
        ['42501','40001','P2001','P2002'].includes(code) ? r.error.message : 'Не вдалося зберегти обсяг.');
    }
    return r.data;
  }
  const a = await db.from('applications').select('actual_volume,updated_at,status').eq('id', application).maybeSingle();
  if (a.error) throw new PortalError(500, 'Не вдалося завантажити обсяг.');
  if (!a.data) throw new PortalError(404, 'Заявку не знайдено.');
  const acts = await db.from('acts').select('service_report').eq('application_id', application).in('status', ['pending','approved']);
  if (acts.error) throw new PortalError(500, 'Не вдалося перевірити обсяг акта.');
  const reported = (acts.data || []).find((x: any) => x.service_report?.volume != null)?.service_report?.volume;
  const closed = ['completed','cancelled'].includes(a.data.status);
  return { volume: closed ? a.data.actual_volume : reported ?? a.data.actual_volume,
    version: a.data.updated_at, can_edit: canEdit && !closed && reported == null,
    report_locked: reported != null, closed };
}
