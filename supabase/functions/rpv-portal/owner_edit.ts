import { PortalError, uuid } from './auth.ts';
import { validWorkVolume } from './work_volume.ts';

export const EDIT_ANY_STAGE = 'applications.edit_any_stage';
const fields = new Set(['customer_site_id', 'contractor_id', 'description', 'manager_comment',
  'scheduled_at', 'deadline_at', 'actual_volume', 'unit_price', 'payout_amount', 'work_date']);

function checked(result: any) {
  if (!result.error) return result.data;
  const {code, message} = result.error;
  const status = code === '42501' ? 403 : ['PT409','40001'].includes(code) ? 409 : code === 'P0002' ? 404 :
    ['P2001', 'P2002', '23514', '22023', '22007', '22008', '22P02'].includes(code) ? 400 : 500;
  throw new PortalError(status, status === 500 ? 'Не вдалося зберегти зміни. Повторіть спробу.' :
    code?.startsWith('22') ? 'Перевірте формат даних заявки.' : message);
}

export async function officeOwnerEdit(db: any, body: any, admin: {user_id: string; role: string}) {
  // Capabilities come from the current database role, never from submitted actor,
  // role, JWT user_metadata or the UI. The write RPC checks and locks it again.
  const allowed = checked(await db.rpc('rpv_office_has_permission', {
    p_actor: admin.user_id, p_permission: EDIT_ANY_STAGE,
  })) === true;
  if (body.action === 'office.permissions') return {permissions: allowed ? [EDIT_ANY_STAGE] : []};
  if (!allowed) throw new PortalError(403, 'Редагування на будь-якій стадії доступне лише головному адміністратору.');
  const application = uuid(body.application);
  if (body.action === 'office.order_edit') {
    return checked(await db.rpc('rpv_owner_order_read', {p_actor: admin.user_id, p_application: application}));
  }
  const patch = body.patch;
  if (typeof body.version !== 'string' || !/^[a-f0-9]{32}$/.test(body.version) ||
      typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 500 ||
      !patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length ||
      Object.keys(patch).some(key => !fields.has(key)))
    throw new PortalError(400, 'Вкажіть зміни та причину редагування (3–500 символів).');
  for (const [key, value] of Object.entries(patch)) {
    if (['customer_site_id', 'contractor_id'].includes(key)) uuid(value);
    if (key === 'actual_volume' && !validWorkVolume(value)) throw new PortalError(400, 'Вкажіть фактичний обсяг більше 0 м³.');
    if (['unit_price', 'payout_amount'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) ||
        value < 0 || value >= 1000000000 || !/^\d+(\.\d{1,2})?$/.test(String(value))))
      throw new PortalError(400, 'Перевірте суму виплати.');
    if (['description', 'manager_comment'].includes(key) && (typeof value !== 'string' || value.length > 2000 || key === 'description' && !value.trim()))
      throw new PortalError(400, 'Перевірте опис робіт і коментар.');
    if (['scheduled_at', 'deadline_at'].includes(key) && value !== null && (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))))
      throw new PortalError(400, 'Перевірте дату та час.');
    if (key === 'work_date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
      throw new PortalError(400, 'Перевірте фактичну дату виконання.');
  }
  return checked(await db.rpc('rpv_owner_order_edit', {
    p_actor: admin.user_id, p_application: application, p_version: body.version,
    p_request: uuid(body.request), p_reason: body.reason.trim(), p_patch: patch,
  }));
}
