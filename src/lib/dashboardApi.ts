import {fetchFinanceReport} from './financeApi';
import { supabase } from '@/lib/supabase';
import { normalizeStatus } from '@/utils/helpers';
import type { ApplicationStatus } from '@/types';

export interface DashboardStats {
  total: number;
  newCount: number;
  accepted: number;
  inProgress: number;
  completed: number;
  totalPayout: number;
  pendingPayout: number;
  paidPayout: number;
  pendingActs: number;
  activeContractors: number;
}

export interface RecentApplication {
  id: string;
  number: string;
  date: string;
  title: string;
  address: string;
  contractorName: string;
  status: ApplicationStatus;
  amount: number;
}

interface AppRow {
  id: string;
  application_number: string | null;
  title: string;
  address: string | null;
  status: string;
  payout_amount: number;
  created_at: string;
  contractor_id: string | null;
  contractor: { first_name: string | null; last_name: string | null } | null;
}

function buildName(c: { first_name: string | null; last_name: string | null } | null): string {
  if (!c) return '—';
  const parts = [c.first_name, c.last_name].filter(p => p && p.trim());
  return parts.join(' ') || '—';
}

export async function fetchDashboardStats(): Promise<{ stats: DashboardStats; recent: RecentApplication[] }> {
  const [appResult, actResult, contractorResult,finance] = await Promise.all([
    supabase.from('applications').select(`
      id, application_number, title, address, status, payout_amount, payout_status, created_at,
      contractor_id, contractor:contractors ( first_name, last_name )
    `).order('created_at', { ascending: false }),
    supabase.from('acts').select('status'),
    supabase.from('contractors').select('status'),
    fetchFinanceReport(),
  ]);

  if (appResult.error) throw new Error(`Не вдалося завантажити заявки: ${appResult.error.message}`);

  const rows = (appResult.data ?? []) as unknown as AppRow[];

  const stats: DashboardStats = {
    total: rows.length,
    newCount: 0,
    accepted: 0,
    inProgress: 0,
    completed: 0,
    totalPayout: 0,
    pendingPayout: 0,
    paidPayout: 0,
    pendingActs: 0,
    activeContractors: 0,
  };

  for (const row of rows) {
    const ns = normalizeStatus(row.status);

    if (ns === 'Нова') stats.newCount++;
    if (ns === 'Прийнята') stats.accepted++;
    if (ns === 'В роботі') stats.inProgress++;
    if (ns === 'Виконана') stats.completed++;
  }

  stats.totalPayout=finance.stats.accrued_total;
  stats.pendingPayout=finance.stats.debt_total;
  stats.paidPayout=finance.stats.paid_total;

  const actRows = (actResult.data ?? []) as unknown as { status: string }[];
  stats.pendingActs = actRows.filter(a => a.status === 'pending').length;

  const contractorRows = (contractorResult.data ?? []) as unknown as { status: string }[];
  stats.activeContractors = contractorRows.filter(c => c.status === 'active').length;

  const recent: RecentApplication[] = rows.slice(0, 7).map(row => ({
    id: row.id,
    number: row.application_number ?? '—',
    date: row.created_at,
    title: row.title,
    address: row.address ?? '—',
    contractorName: buildName(row.contractor),
    status: normalizeStatus(row.status),
    amount: Number(row.payout_amount) ?? 0,
  }));

  return { stats, recent };
}
