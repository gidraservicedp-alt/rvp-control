import {fetchFinanceReport} from './financeApi';
import { supabase } from '@/lib/supabase';

export type ContractorStatus = 'active' | 'inactive';

export interface ContractorListItem {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  phone: string | null;
  username: string | null;
  telegramId: number | null;
  status: ContractorStatus;
  regionCode: string | null;
  regionName: string | null;
  rating: number;
  createdAt: string;
  totalApplications: number;
  completedApplications: number;
  totalPayout: number;
  debt: number;
  pendingPayoutCount: number;
  missingAmountCount: number;
  isAdmin: boolean;
}

export interface ContractorApplication {
  id: string;
  number: string;
  date: string;
  customer: string;
  address: string;
  status: string;
  amount: number;
  payoutAmount: number;
  payoutStatus: string;
  amountKnown: boolean;
}

interface ContractorRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  username: string | null;
  telegram_id: number | null;
  status: string;
  region_code: string | null;
  region_name: string | null;
  rating: number;
  created_at: string;
  is_admin: boolean | null;
}

interface ApplicationRow {
  id: string;
  application_number: string | null;
  title: string;
  address: string | null;
  status: string;
  payout_amount: number;
  unit_price: number;
  actual_volume: number | null;
  payout_status: string;
  created_at: string;
}

function buildName(firstName: string | null, lastName: string | null): string {
  const parts = [firstName, lastName].filter(p => p && p.trim());
  return parts.join(' ') || '—';
}

const CONTRACTOR_SELECT = `
  id,
  first_name,
  last_name,
  phone,
  username,
  telegram_id,
  status,
  region_code,
  region_name,
  rating,
  created_at,
  is_admin
`;

interface AppStatRow {
  contractor_id: string;
  status: string;
  payout_amount: number;
  payout_status: string;
}

async function fetchContractorStats(): Promise<Map<string, { total: number; completed: number; payout: number }>> {
  const data: AppStatRow[] = [];
  for(let offset=0;;offset+=1000){
    const r=await supabase.from('applications').select('contractor_id,status,payout_amount,payout_status').order('id').range(offset,offset+999);
    if(r.error)throw new Error('Не вдалося завантажити статистику підрядників.');
    data.push(...r.data);if(r.data.length<1000)break;
  }

  const stats = new Map<string, { total: number; completed: number; payout: number }>();

  for (const row of (data ?? []) as unknown as AppStatRow[]) {
    if (!row.contractor_id) continue;

    const s = stats.get(row.contractor_id) ?? {
      total: 0,
      completed: 0,
      payout: 0,
    };

    s.total += 1;

    if (row.status === 'completed') {
      s.completed += 1;
    }

    if (row.payout_status === 'paid') {
      s.payout += Number(row.payout_amount) || 0;
    }

    stats.set(row.contractor_id, s);
  }

  return stats;
}

export async function fetchContractors(): Promise<ContractorListItem[]> {
  const [contractorResult, statsMap, finance] = await Promise.all([
    supabase
      .from('contractors')
      .select(CONTRACTOR_SELECT)
      .order('created_at', { ascending: true }),
    fetchContractorStats(),
    fetchFinanceReport(),
  ]);

  if (contractorResult.error) {
    throw new Error(`Не вдалося завантажити підрядників: ${contractorResult.error.message}`);
  }

  const rows = (contractorResult.data ?? []) as unknown as ContractorRow[];

  return rows.map(row => {
    const stats = statsMap.get(row.id);
    const settlement=finance.contractors.find(c=>c.contractor_id===row.id);

    return {
      id: row.id,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      name: buildName(row.first_name, row.last_name),
      phone: row.phone ?? null,
      username: row.username ?? null,
      telegramId: row.telegram_id ?? null,
      status: (row.status as ContractorStatus) ?? 'active',
      regionCode: row.region_code ?? null,
      regionName: row.region_name ?? null,
      rating: row.rating ?? 0,
      createdAt: row.created_at,
      totalApplications: stats?.total ?? 0,
      completedApplications: stats?.completed ?? 0,
      totalPayout: settlement?.paid ?? 0,
      debt: settlement?.debt ?? 0,
      pendingPayoutCount: settlement?.pending_count ?? 0,
      missingAmountCount: settlement?.missing_amount_count ?? 0,
      isAdmin: row.is_admin === true,
    };
  });
}

export async function fetchActiveContractors(): Promise<ContractorListItem[]> {
  const all = await fetchContractors();
  return all.filter(c => c.status === 'active');
}

export async function fetchContractorApplications(contractorId: string): Promise<ContractorApplication[]> {
  const { data, error } = await supabase
    .from('applications')
    .select(`
      id,
      application_number,
      title,
      address,
      status,
      payout_amount,unit_price,actual_volume,
      payout_status,
      created_at
    `)
    .eq('contractor_id', contractorId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Не вдалося завантажити заявки підрядника: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  return (data as unknown as ApplicationRow[]).map(row => ({
    id: row.id,
    number: row.application_number ?? '—',
    date: row.created_at,
    customer: row.title ?? '—',
    address: row.address ?? '—',
    status: row.status,
    amount: Number(row.payout_amount)|| (row.payout_status!=='paid'?Number(row.unit_price)*Number(row.actual_volume):0)||0,
    payoutAmount: Number(row.payout_amount)|| (row.payout_status!=='paid'?Number(row.unit_price)*Number(row.actual_volume):0)||0,
    amountKnown: Number(row.payout_amount)>0||(row.payout_status!=='paid'&&Number(row.unit_price)>0&&Number(row.actual_volume)>0),
    payoutStatus: row.payout_status,
  }));
}

export async function countContractorApplications(contractorId: string): Promise<number> {
  const { count, error } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('contractor_id', contractorId);

  if (error) {
    throw new Error(`Не вдалося перевірити заявки підрядника: ${error.message}`);
  }

  return count ?? 0;
}

export interface NewContractorInput {
  firstName: string;
  lastName: string;
  phone: string;
  username: string;
  regionCode: string;
  regionName: string;
  status: ContractorStatus;
}

export async function insertContractor(input: NewContractorInput): Promise<void> {
  const { error } = await supabase
    .from('contractors')
    .insert({
      first_name: input.firstName.trim() || null,
      last_name: input.lastName.trim() || null,
      phone: input.phone.trim() || null,
      username: input.username.trim() || null,
      region_code: input.regionCode || null,
      region_name: input.regionName || null,
      status: input.status,
      is_admin: false,
    });

  if (error) throw new Error(error.message);
}

export interface UpdateContractorInput {
  firstName: string;
  lastName: string;
  phone: string;
  username: string;
  regionCode: string;
  regionName: string;
  status: ContractorStatus;
}

export async function updateContractor(id: string, input: UpdateContractorInput): Promise<void> {
  const { error } = await supabase
    .from('contractors')
    .update({
      first_name: input.firstName.trim() || null,
      last_name: input.lastName.trim() || null,
      phone: input.phone.trim() || null,
      username: input.username.trim() || null,
      region_code: input.regionCode || null,
      region_name: input.regionName || null,
      status: input.status,
    })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function setContractorStatus(id: string, status: ContractorStatus): Promise<void> {
  const { error } = await supabase
    .from('contractors')
    .update({ status })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function setContractorAdmin(id: string, isAdmin: boolean): Promise<void> {
  const { data: contractor, error: readError } = await supabase
    .from('contractors')
    .select('id, telegram_id')
    .eq('id', id)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  if (!contractor) {
    throw new Error('Підрядника не знайдено');
  }

  if (isAdmin && !contractor.telegram_id) {
    throw new Error('Спочатку підрядник повинен відкрити Telegram-бот, щоб зберігся Telegram ID.');
  }

  const { error } = await supabase
    .from('contractors')
    .update({ is_admin: isAdmin })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function deleteContractor(id: string): Promise<void> {
  const { error } = await supabase
    .from('contractors')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export interface RegionOption {
  id: string;
  code: string;
  name: string;
}

export async function fetchRegions(): Promise<RegionOption[]> {
  const { data, error } = await supabase
    .from('region_topics')
    .select('id, code, name')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Не вдалося завантажити регіони: ${error.message}`);
  }

  return (data ?? []) as unknown as RegionOption[];
}
