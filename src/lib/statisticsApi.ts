import {fetchFinanceReport} from './financeApi';
import { supabase } from '@/lib/supabase';
import { normalizeStatus } from '@/utils/helpers';

export interface StatusDistribution {
  name: string;
  value: number;
}

export interface DailyPoint {
  date: string;
  заявки: number;
  виконані: number;
}

export interface MonthlyPayout {
  month: string;
  виплачено: number;
  очікує: number;
}

export interface ContractorRanking {
  name: string;
  виконано: number;
  виплачено: number;
}

export interface RegionStat {
  name: string;
  count: number;
}

interface ContractorData {
  first_name: string | null;
  last_name: string | null;
  region_name: string | null;
  region_code: string | null;
}

interface AppRow {
  id: string;
  status: string;
  payout_amount: number | null;
  payout_status: string | null;
  created_at: string;
  paid_at: string | null;
  contractor_id: string | null;

  contractor: ContractorData | null;
}

function buildName(
  c: ContractorData | null,
): string {
  if (!c) return '—';

  const parts = [
    c.first_name,
    c.last_name,
  ].filter(
    (p) => p && p.trim(),
  );

  return parts.join(' ') || '—';
}

export async function fetchStatistics(): Promise<{
  statusDist: StatusDistribution[];
  daily: DailyPoint[];
  monthlyPayouts: MonthlyPayout[];
  topContractors: ContractorRanking[];
  regionStats: RegionStat[];
}> {
  const {
    data,
    error,
  } = await supabase
    .from('applications')
    .select(`
      id,
      status,
      payout_amount,
      payout_status,
      created_at,
      paid_at,
      contractor_id,
      contractor:contractors (
        first_name,
        last_name,
        region_name,
        region_code
      )
    `)
    .order(
      'created_at',
      {
        ascending: true,
      },
    );

  if (error) {
    throw new Error(
      `Не вдалося завантажити статистику: ${error.message}`,
    );
  }

  const rows =
    (data ?? []) as unknown as AppRow[];

  // =====================================================
  // STATUS DISTRIBUTION
  // =====================================================

  const statusMap =
    new Map<string, number>();

  for (const row of rows) {
    const ns =
      normalizeStatus(
        row.status,
      );

    statusMap.set(
      ns,
      (statusMap.get(ns) ?? 0) + 1,
    );
  }

  const statusDist:
    StatusDistribution[] =
    Array.from(
      statusMap.entries(),
    ).map(
      ([name, value]) => ({
        name,
        value,
      }),
    );

  // =====================================================
  // DAILY - LAST 30 DAYS
  // =====================================================

  const dailyMap =
    new Map<
      string,
      {
        заявки: number;
        виконані: number;
      }
    >();

  for (const row of rows) {
    const day =
      row.created_at?.slice(
        0,
        10,
      );

    if (!day) {
      continue;
    }

    const entry =
      dailyMap.get(day) ?? {
        заявки: 0,
        виконані: 0,
      };

    entry.заявки++;

    if (
      normalizeStatus(
        row.status,
      ) === 'Виконана'
    ) {
      entry.виконані++;
    }

    dailyMap.set(
      day,
      entry,
    );
  }

  const daily:
    DailyPoint[] =
    Array.from(
      dailyMap.entries(),
    )
      .map(
        ([date, value]) => ({
          date,
          ...value,
        }),
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date,
          ),
      )
      .slice(-30);

  // =====================================================
  // MONTHLY PAYOUTS
  // =====================================================

  const finance=await fetchFinanceReport();
  const monthlyPayouts: MonthlyPayout[]=finance.monthly.map(m=>({month:m.month,виплачено:m.paid,очікує:m.debt}));

  // =====================================================
  // TOP CONTRACTORS
  // =====================================================

  const contractorMap =
    new Map<
      string,
      {
        name: string;
        виконано: number;
        виплачено: number;
      }
    >();

  for (const row of rows) {
    if (
      !row.contractor_id
    ) {
      continue;
    }

    const entry =
      contractorMap.get(
        row.contractor_id,
      ) ?? {
        name:
          buildName(
            row.contractor,
          ),
        виконано: 0,
        виплачено: 0,
      };

    if (
      normalizeStatus(
        row.status,
      ) === 'Виконана'
    ) {
      entry.виконано++;
    }

    entry.виплачено=finance.contractors.find(c=>c.contractor_id===row.contractor_id)?.paid||0;

    contractorMap.set(
      row.contractor_id,
      entry,
    );
  }

  const topContractors:
    ContractorRanking[] =
    Array.from(
      contractorMap.values(),
    )
      .sort(
        (a, b) =>
          b.виконано -
          a.виконано,
      )
      .slice(
        0,
        10,
      );

  // =====================================================
  // REGIONS
  // =====================================================

  const regionMap =
    new Map<
      string,
      number
    >();

  for (const row of rows) {
    const region =
      row.contractor
        ?.region_name ||
      row.contractor
        ?.region_code ||
      'Без регіону';

    regionMap.set(
      region,
      (
        regionMap.get(
          region,
        ) ?? 0
      ) + 1,
    );
  }

  const regionStats:
    RegionStat[] =
    Array.from(
      regionMap.entries(),
    )
      .map(
        ([name, count]) => ({
          name,
          count,
        }),
      )
      .sort(
        (a, b) =>
          b.count -
          a.count,
      );

  return {
    statusDist,
    daily,
    monthlyPayouts,
    topContractors,
    regionStats,
  };
}