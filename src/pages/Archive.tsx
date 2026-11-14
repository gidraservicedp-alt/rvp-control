import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive as ArchiveIcon,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Wallet,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';

import PageHeader from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';
import {
  normalizeStatus,
  getApplicationStatusColor,
  formatDate,
  formatCurrency,
} from '@/utils/helpers';

import type { ApplicationStatus } from '@/types';

interface ArchiveItem {
  id: string;
  number: string;
  title: string;
  address: string;
  status: ApplicationStatus;
  amount: number;
  createdAt: string;
  contractorId: string | null;
  contractorName: string;
}

interface ContractorOption {
  id: string;
  name: string;
}

interface Props {
  onNavigateToApplications?: () => void;
}

type ArchiveTab =
  | 'all'
  | 'completed'
  | 'cancelled';

const PAGE_SIZE = 15;

export default function Archive({
  onNavigateToApplications,
}: Props) {
  const [items, setItems] =
    useState<ArchiveItem[]>([]);

  const [contractors, setContractors] =
    useState<ContractorOption[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [search, setSearch] =
    useState('');

  const [tab, setTab] =
    useState<ArchiveTab>('all');

  const [
    contractorFilter,
    setContractorFilter,
  ] = useState('all');

  const [page, setPage] =
    useState(1);

  // =====================================================
  // LOAD
  // =====================================================

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        appResult,
        contractorResult,
      ] = await Promise.all([
        supabase
          .from('applications')
          .select(`
            id,
            application_number,
            title,
            address,
            status,
            payout_amount,
            created_at,
            contractor_id,
            contractor:contractors (
              id,
              first_name,
              last_name
            )
          `)
          .in('status', [
            'completed',
            'cancelled',
          ])
          .order('created_at', {
            ascending: false,
          })
          .limit(500),

        supabase
          .from('contractors')
          .select(
            'id, first_name, last_name',
          )
          .order('first_name', {
            ascending: true,
          }),
      ]);

      if (appResult.error) {
        throw new Error(
          appResult.error.message,
        );
      }

      if (contractorResult.error) {
        console.error(
          contractorResult.error,
        );
      }

      const rows =
        (appResult.data ??
          []) as unknown as any[];

      setItems(
        rows.map(row => {
          const contractor =
            Array.isArray(
              row.contractor,
            )
              ? row.contractor[0]
              : row.contractor;

          const contractorName =
            [
              contractor?.first_name,
              contractor?.last_name,
            ]
              .filter(Boolean)
              .join(' ') || '—';

          return {
            id: String(row.id),

            number:
              row.application_number ??
              '—',

            title:
              row.title ?? '—',

            address:
              row.address ?? '—',

            status:
              normalizeStatus(
                row.status,
              ),

            amount:
              Number(
                row.payout_amount,
              ) || 0,

            createdAt:
              row.created_at,

            contractorId:
              row.contractor_id
                ? String(
                    row.contractor_id,
                  )
                : contractor?.id
                  ? String(
                      contractor.id,
                    )
                  : null,

            contractorName,
          };
        }),
      );

      setContractors(
        (
          contractorResult.data ??
          []
        ).map((contractor: any) => ({
          id: String(
            contractor.id,
          ),

          name:
            [
              contractor.first_name,
              contractor.last_name,
            ]
              .filter(Boolean)
              .join(' ') || '—',
        })),
      );
    } catch (e) {
      console.error(e);

      setError(
        e instanceof Error
          ? e.message
          : 'Не вдалося завантажити архів',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // =====================================================
  // STATS
  // =====================================================

  const stats = useMemo(() => {
    const completed =
      items.filter(
        item =>
          item.status ===
          'Виконана',
      );

    const cancelled =
      items.filter(
        item =>
          item.status ===
          'Скасована',
      );

    const totalAmount =
      completed.reduce(
        (sum, item) =>
          sum + item.amount,
        0,
      );

    return {
      total: items.length,
      completed:
        completed.length,
      cancelled:
        cancelled.length,
      amount: totalAmount,
    };
  }, [items]);

  // =====================================================
  // FILTERS
  // =====================================================

  const filtered =
    useMemo(() => {
      const q =
        search
          .trim()
          .toLowerCase();

      return items.filter(
        item => {
          if (
            tab === 'completed' &&
            item.status !==
              'Виконана'
          ) {
            return false;
          }

          if (
            tab === 'cancelled' &&
            item.status !==
              'Скасована'
          ) {
            return false;
          }

          if (
            contractorFilter !==
              'all' &&
            item.contractorId !==
              contractorFilter
          ) {
            return false;
          }

          if (q) {
            const haystack = `
              ${item.number}
              ${item.title}
              ${item.address}
              ${item.contractorName}
            `.toLowerCase();

            if (
              !haystack.includes(q)
            ) {
              return false;
            }
          }

          return true;
        },
      );
    }, [
      items,
      search,
      tab,
      contractorFilter,
    ]);

  // =====================================================
  // PAGINATION
  // =====================================================

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filtered.length /
          PAGE_SIZE,
      ),
    );

  useEffect(() => {
    setPage(1);
  }, [
    search,
    tab,
    contractorFilter,
  ]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginated =
    useMemo(() => {
      const start =
        (page - 1) *
        PAGE_SIZE;

      return filtered.slice(
        start,
        start + PAGE_SIZE,
      );
    }, [filtered, page]);

  // =====================================================
  // OPEN APPLICATION
  // =====================================================

  const openApplication = (
    item: ArchiveItem,
  ) => {
    sessionStorage.setItem(
      'rvp-open-application-id',
      item.id,
    );

    onNavigateToApplications?.();
  };

  // =====================================================
  // RESET
  // =====================================================

  const resetFilters = () => {
    setSearch('');
    setTab('all');
    setContractorFilter(
      'all',
    );
    setPage(1);
  };

  const hasFilters =
    search.trim() !== '' ||
    tab !== 'all' ||
    contractorFilter !==
      'all';

  // =====================================================
  // TAB
  // =====================================================

  const tabButton = (
    id: ArchiveTab,
    label: string,
    count: number,
  ) => {
    const active =
      tab === id;

    return (
      <button
        onClick={() =>
          setTab(id)
        }
        className={`
          flex items-center
          gap-2 border-b-2
          px-1 py-3
          text-sm font-medium
          transition
          ${
            active
              ? 'border-blue-500 text-white'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }
        `}
      >
        {label}

        <span
          className={`
            rounded-full
            px-2 py-0.5
            text-[10px]
            ${
              active
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-white/5 text-slate-600'
            }
          `}
        >
          {count}
        </span>
      </button>
    );
  };

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <PageHeader
      pageTitle="Архів"
      pageSubtitle="Виконані та скасовані заявки"
      actions={
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={
              loading
                ? 'animate-spin'
                : ''
            }
          />

          Оновити
        </button>
      }
    >
      {/* =============================================
          KPI
      ============================================= */}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">

        <div className="rounded-xl border border-white/[0.06] bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              В архіві
            </p>

            <ArchiveIcon
              size={16}
              className="text-blue-400"
            />
          </div>

          <p className="mt-2 text-2xl font-semibold text-white">
            {stats.total}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/10 bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Виконані
            </p>

            <CheckCircle2
              size={16}
              className="text-emerald-400"
            />
          </div>

          <p className="mt-2 text-2xl font-semibold text-emerald-400">
            {stats.completed}
          </p>
        </div>

        <div className="rounded-xl border border-red-500/10 bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Скасовані
            </p>

            <XCircle
              size={16}
              className="text-red-400"
            />
          </div>

          <p className="mt-2 text-2xl font-semibold text-red-400">
            {stats.cancelled}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Сума виконаних
            </p>

            <Wallet
              size={16}
              className="text-violet-400"
            />
          </div>

          <p className="mt-2 text-xl font-semibold text-white">
            {formatCurrency(
              stats.amount,
            )}
          </p>
        </div>

      </div>

      {/* =============================================
          CRM TABLE
      ============================================= */}

      <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#121720]">

        {/* TABS */}

        <div className="flex gap-6 overflow-x-auto border-b border-white/[0.06] px-5">
          {tabButton(
            'all',
            'Усі',
            stats.total,
          )}

          {tabButton(
            'completed',
            'Виконані',
            stats.completed,
          )}

          {tabButton(
            'cancelled',
            'Скасовані',
            stats.cancelled,
          )}
        </div>

        {/* FILTERS */}

        <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 xl:flex-row xl:items-center">

          <div className="relative min-w-0 flex-1">

            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
            />

            <input
              value={search}
              onChange={event =>
                setSearch(
                  event.target.value,
                )
              }
              placeholder="Пошук за номером, обʼєктом, адресою або підрядником..."
              className="w-full rounded-lg border border-white/[0.07] bg-white/[0.025] py-2.5 pl-9 pr-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-blue-500/30"
            />

          </div>

          <select
            value={
              contractorFilter
            }
            onChange={event =>
              setContractorFilter(
                event.target.value,
              )
            }
            className="min-w-[220px] rounded-lg border border-white/[0.07] bg-[#0e131b] px-3 py-2.5 text-sm text-slate-300 outline-none"
          >
            <option value="all">
              Всі підрядники
            </option>

            {contractors.map(
              contractor => (
                <option
                  key={
                    contractor.id
                  }
                  value={
                    contractor.id
                  }
                >
                  {
                    contractor.name
                  }
                </option>
              ),
            )}
          </select>

          {hasFilters && (
            <button
              onClick={
                resetFilters
              }
              className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.07] px-3 py-2.5 text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
            >
              <RotateCcw
                size={13}
              />

              Скинути
            </button>
          )}

        </div>

        {/* ERROR */}

        {error && (
          <div className="border-b border-red-500/10 bg-red-500/[0.04] px-5 py-3 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* LOADING */}

        {loading ? (
          <div className="flex min-h-[350px] items-center justify-center">
            <Loader2
              size={21}
              className="animate-spin text-slate-600"
            />
          </div>
        ) : filtered.length ===
          0 ? (
          <div className="flex min-h-[350px] flex-col items-center justify-center px-6 text-center">

            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.035]">
              <ArchiveIcon
                size={21}
                className="text-slate-600"
              />
            </div>

            <p className="mt-3 text-sm font-medium text-slate-400">
              Нічого не знайдено
            </p>

            <p className="mt-1 text-xs text-slate-600">
              Змініть параметри пошуку або фільтри
            </p>

            {hasFilters && (
              <button
                onClick={
                  resetFilters
                }
                className="mt-4 text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                Очистити фільтри
              </button>
            )}

          </div>
        ) : (
          <>
            {/* TABLE */}

            <div className="overflow-x-auto mobile-no-scrollbar">

              <table className="w-full min-w-[1000px] text-sm">

                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.015]">

                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      № заявки
                    </th>

                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Обʼєкт
                    </th>

                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Адреса
                    </th>

                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Підрядник
                    </th>

                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Статус
                    </th>

                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Сума
                    </th>

                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                      Дата
                    </th>

                    <th className="w-12 px-4 py-3" />

                  </tr>
                </thead>

                <tbody>
                  {paginated.map(
                    item => (
                      <tr
                        key={item.id}
                        onClick={() =>
                          openApplication(
                            item,
                          )
                        }
                        className="group cursor-pointer border-b border-white/[0.045] transition last:border-b-0 hover:bg-blue-500/[0.025]"
                      >

                        <td className="px-5 py-3.5">
                          <span className="font-mono text-xs font-semibold text-blue-400">
                            <bdi className="rpv-application-number">{item.number}</bdi>
                          </span>
                        </td>

                        <td className="max-w-[240px] px-4 py-3.5">
                          <p className="truncate font-medium text-slate-200">
                            {item.title}
                          </p>
                        </td>

                        <td className="max-w-[260px] px-4 py-3.5">
                          <p className="truncate text-xs text-slate-500">
                            {item.address}
                          </p>
                        </td>

                        <td className="px-4 py-3.5">
                          <p className="max-w-[180px] truncate text-xs text-slate-400">
                            {
                              item.contractorName
                            }
                          </p>
                        </td>

                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium ${getApplicationStatusColor(
                              item.status,
                            )}`}
                          >
                            {item.status}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <span className="text-xs font-medium text-slate-300">
                            {formatCurrency(
                              item.amount,
                            )}
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                          {formatDate(
                            item.createdAt,
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <ExternalLink
                            size={14}
                            className="text-slate-700 transition group-hover:text-blue-400"
                          />
                        </td>

                      </tr>
                    ),
                  )}
                </tbody>

              </table>

            </div>

            {/* PAGINATION */}

            <div className="flex flex-col gap-3 border-t border-white/[0.06] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">

              <p className="text-xs text-slate-600">
                Показано{' '}
                <span className="text-slate-400">
                  {paginated.length}
                </span>{' '}
                із{' '}
                <span className="text-slate-400">
                  {filtered.length}
                </span>
              </p>

              <div className="flex items-center gap-2">

                <button
                  onClick={() =>
                    setPage(value =>
                      Math.max(
                        1,
                        value - 1,
                      ),
                    )
                  }
                  disabled={
                    page === 1
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] text-slate-500 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft
                    size={15}
                  />
                </button>

                <div className="min-w-[80px] text-center text-xs text-slate-500">
                  <span className="font-medium text-slate-300">
                    {page}
                  </span>
                  {' / '}
                  {totalPages}
                </div>

                <button
                  onClick={() =>
                    setPage(value =>
                      Math.min(
                        totalPages,
                        value + 1,
                      ),
                    )
                  }
                  disabled={
                    page >=
                    totalPages
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] text-slate-500 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight
                    size={15}
                  />
                </button>

              </div>

            </div>
          </>
        )}
      </div>
    </PageHeader>
  );
}