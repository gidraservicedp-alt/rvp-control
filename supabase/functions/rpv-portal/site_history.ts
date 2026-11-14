import { PortalError } from './auth.ts';

export const historyPageSize = 50;
export const historySiteFields = 'id,site_key,label,address,capacity_m3,passport_network,passport_city_code,passport_azk_code,merged_into';
export type HistoryApplication = {
  id: string; application_number: string | null; title: string; description: string | null;
  status: string; created_at: string; scheduled_at: string | null; actual_volume: number | null;
  customer_site_id: string; contractor: { first_name: string | null; last_name: string | null } | null;
  acts: { id: string; act_number: string | null; status: string; created_at: string }[];
  payout_amount: number|null; unit_price: number|null; payout_status: string; paid_at: string|null;
  work_history: { completed_at: string }[];
};

function checked<T>(reply: { data: T; error: unknown }): T {
  if (reply.error) throw new PortalError(500, 'Не вдалося завантажити історію заявок. Спробуйте ще раз.');
  return reply.data;
}

// Old office URLs resolve to the retained passport. History uses only its ID.
// Call only after office authentication/role checks.
export async function resolveOfficeSite(db: any, id: string) {
  let selected = checked<any>(await db.from('rpv_customer_sites')
    .select(historySiteFields).eq('id', id).maybeSingle());
  if (selected?.merged_into) selected = checked<any>(await db.from('rpv_customer_sites')
    .select(historySiteFields).eq('id', selected.merged_into).maybeSingle());
  if (!selected) throw new PortalError(404, 'Об’єкт недоступний.');
  if (selected.merged_into) throw new PortalError(409, 'Паспорт змінився. Оновіть список об’єктів.');
  // Registration creates a direct grant. Do not pick a contact from another
  // station in the same network, or expose revoked registrations.
  const contacts = [];
  for (let offset = 0; ; offset += 1000) {
    const reply = await db.from('rpv_customer_access')
      .select('telegram_id,customers(first_name,last_name,username,phone,status)')
      .eq('scope_kind', 'site').eq('scope_key', selected.site_key)
      .order('telegram_id').range(offset, offset + 999);
    if (reply.error) throw new PortalError(500, 'Не вдалося завантажити контакти об’єкта. Спробуйте ще раз.');
    const grants = reply.data || [];
    for (const grant of grants) {
      const contact = grant.customers;
      if (contact?.status !== 'active') continue;
      contacts.push({ telegram_id: grant.telegram_id, first_name: contact.first_name,
        last_name: contact.last_name, username: contact.username, phone: contact.phone });
    }
    if (grants.length < 1000) break;
  }
  const { site_key: _key, merged_into: _alias, ...passport } = selected;
  return { ...passport, contacts };
}
export async function officeSiteHistory(db: any, id: string, page: number) {
  const selected = await resolveOfficeSite(db, id);
  const reply = await db.from('applications').select(`
    id,application_number,title,description,status,created_at,scheduled_at,actual_volume,customer_site_id,payout_amount,unit_price,payout_status,paid_at,
    contractor:contractors(first_name,last_name),acts(id,act_number,status,created_at),work_history(completed_at)
  `, { count: 'exact' }).eq('customer_site_id', selected.id)
    .order('created_at', { ascending: false }).order('id')
    .range(page * historyPageSize, (page + 1) * historyPageSize - 1);
  const applications = checked<HistoryApplication[]>(reply);
  if (typeof reply.count !== 'number') throw new PortalError(500, 'Не вдалося визначити кількість заявок.');
  return { site: selected, applications, total: reply.count,
    more: (page + 1) * historyPageSize < reply.count };
}
