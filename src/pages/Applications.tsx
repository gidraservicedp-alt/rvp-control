import { formatWorkVolume } from '@/workspace/workVolume';
import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Plus,
  Filter,
  X,
  Phone,
  MapPin,
  Calendar,
  User,
  MessageSquare,
  Receipt,
  ChevronDown,
  Hash,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileText,
  Clock,
  CheckCircle2,
  ExternalLink,
  History,
  Trash2,
} from 'lucide-react';

import StatusBadge from '@/components/StatusBadge';
import PageHeader from '@/components/PageHeader';
import NewApplicationModal from '@/components/NewApplicationModal';
import ApplicationActionDrawer from '@/components/ApplicationActionDrawer';
import { useApp } from '@/context/AppContext';

import {
  fetchApplications,
  fetchLinkedActs,
  fetchWorkHistory,
  assignApplicationContractor,
  deleteSelectedApplications,
  updateApplicationStatus,
  type LinkedAct,
  type WorkHistoryEntry,
} from '@/lib/applicationsApi';

import {
  fetchContractors,
  type ContractorListItem,
} from '@/lib/contractorsApi';

import { telegramFileUrl } from '@/lib/actsApi';
import { supabase } from '@/lib/supabase';
import { tryCreateAuditLog } from '@/lib/auditLogApi';

import type {
  Application,
  ApplicationStatus,
} from '@/types';

import {
  formatCurrency,
  formatDate,
  formatDateTime,
  getApplicationStatusColor,
  getPayoutStatusColor,
  getActStatusColor,
  actStatusLabel,
} from '@/utils/helpers';

const STATUSES: ApplicationStatus[] = [
  'Нова',
  'Прийнята',
  'В роботі',
  'Виконана',
  'Скасована',
];

const MOBILE_STATUS_ACCENT: Record<ApplicationStatus, string> = {
  'Нова': 'bg-blue-500',
  'Прийнята': 'bg-violet-500',
  'В роботі': 'bg-amber-500',
  'Виконана': 'bg-emerald-500',
  'Скасована': 'bg-rose-500',
};


function isStatusOverdue(
  deadlineValue: string | undefined,
  status: ApplicationStatus,
) {
  if (!deadlineValue) return false;

  const deadline = new Date(deadlineValue);
  if (Number.isNaN(deadline.getTime())) return false;

  const finished =
    status === 'Виконана' ||
    status === 'Скасована';

  return !finished && deadline < new Date();
}

function isApplicationOverdue(app: Application) {
  return isStatusOverdue(app.deadline, app.status);
}

function overdueDurationText(deadlineValue?: string) {
  if (!deadlineValue) return '';
  const deadline = new Date(deadlineValue);
  if (Number.isNaN(deadline.getTime())) return '';

  const diffMs = Date.now() - deadline.getTime();
  if (diffMs <= 0) return '';

  const totalHours = Math.max(1, Math.floor(diffMs / 3_600_000));
  if (totalHours < 24) return `Прострочено на ${totalHours} год.`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0
    ? `Прострочено на ${days} дн. ${hours} год.`
    : `Прострочено на ${days} дн.`;
}

function displayApplicationStatus(app: Application) {
  if (isApplicationOverdue(app)) return 'Прострочена';
  return app.status;
}

function applicationStatusColor(app: Application) {
  return isApplicationOverdue(app)
    ? 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
    : getApplicationStatusColor(app.status);
}

type ApplicationDashboardFilter =
  | 'all'
  | 'new'
  | 'accepted'
  | 'work'
  | 'done'
  | 'overdue'
  | 'today'
  | 'tomorrow';

type ApplicationsProps = {
  dashboardFilter?: ApplicationDashboardFilter;
  onOpenApplication?: (id: string) => void;
  onDashboardFilterChange?: (filter: ApplicationDashboardFilter) => void;
};

export default function Applications({
  dashboardFilter = 'all',
  onOpenApplication,
  onDashboardFilterChange,
}: ApplicationsProps) {
  const { showToast } = useApp();

  const [applications, setApplications] =
    useState<Application[]>([]);

  const [contractors, setContractors] =
    useState<ContractorListItem[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const [error, setError] =
    useState<string | null>(null);

  const [search, setSearch] =
    useState('');

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<ApplicationStatus | ''>('');

  const [
    contractorFilter,
    setContractorFilter,
  ] = useState('');

  const [dateFrom, setDateFrom] =
    useState('');

  const [dateTo, setDateTo] =
    useState('');

  const setDashboardFilter = (filter: ApplicationDashboardFilter) => {
    onDashboardFilterChange?.(filter);
  };

  const [selected, setSelected] =
    useState<Application | null>(null);

  const [showFilters, setShowFilters] =
    useState(false);

  const [
    showNewModal,
    setShowNewModal,
  ] = useState(false);

  const loadApplications =
    useCallback(async () => {
      setLoading(true);
      setError(null);

      try {
        const [
          appData,
          contractorData,
        ] = await Promise.all([
          fetchApplications(),
          fetchContractors().catch(
            () =>
              [] as ContractorListItem[]
          ),
        ]);

        setApplications(appData);
        setContractors(
          contractorData
        );
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Помилка завантаження заявок';

        setError(msg);
        showToast(msg, 'error');
      } finally {
        setLoading(false);
      }
    }, [showToast]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  // Live sync: new/updated/deleted applications appear without reloading the app.
  useEffect(() => {
    const channel = supabase
      .channel('applications-page-live-sync')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'applications' },
        () => loadApplications(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'applications' },
        () => loadApplications(),
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'applications' },
        () => loadApplications(),
      )
      .subscribe();

    // Fallback for iPhone/PWA: refresh every 15 seconds in case Realtime reconnects late.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadApplications();
      }
    }, 15000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadApplications();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [loadApplications]);

  const filtered = useMemo(() => {
    return applications.filter(
      (app) => {
        if (search) {
          const q =
            search
              .toLowerCase()
              .trim();

          const num =
            (
              app.number || ''
            ).toLowerCase();

          const cust =
            (
              app.customer || ''
            ).toLowerCase();

          const addr =
            (
              app.address || ''
            ).toLowerCase();

          const con =
            (
              app.contractorName ||
              ''
            ).toLowerCase();

          const azk =
            (
              app.azkCode || ''
            ).toLowerCase();

          const phoneDigits =
            (
              app.contractorPhone ||
              ''
            ).replace(/\D/g, '');

          const searchDigits =
            q.replace(/\D/g, '');

          const phoneMatch =
            searchDigits.length >
              0 &&
            phoneDigits.includes(
              searchDigits
            );

          if (
            !num.includes(q) &&
            !cust.includes(q) &&
            !addr.includes(q) &&
            !con.includes(q) &&
            !azk.includes(q) &&
            !phoneMatch
          ) {
            return false;
          }
        }

        if (
          statusFilter &&
          app.status !==
            statusFilter
        ) {
          return false;
        }

        if (
          contractorFilter &&
          app.contractorId !==
            contractorFilter
        ) {
          return false;
        }

        if (
          dateFrom &&
          (app.date || '') <
            dateFrom
        ) {
          return false;
        }

        if (
          dateTo &&
          (app.date || '') >
            dateTo
        ) {
          return false;
        }

        if (dashboardFilter !== 'all') {
          const statusByDashboardFilter: Partial<Record<ApplicationDashboardFilter, ApplicationStatus>> = {
            new: 'Нова',
            accepted: 'Прийнята',
            work: 'В роботі',
            done: 'Виконана',
          };

          const requiredStatus = statusByDashboardFilter[dashboardFilter];
          if (requiredStatus && app.status !== requiredStatus) {
            return false;
          }

          if (dashboardFilter === 'overdue' || dashboardFilter === 'today' || dashboardFilter === 'tomorrow') {
            if (!app.deadline) return false;

            const deadline = new Date(app.deadline);
            if (Number.isNaN(deadline.getTime())) return false;

            const now = new Date();
            const startToday = new Date(now);
            startToday.setHours(0, 0, 0, 0);

            const startTomorrow = new Date(startToday);
            startTomorrow.setDate(startTomorrow.getDate() + 1);

            const startAfterTomorrow = new Date(startTomorrow);
            startAfterTomorrow.setDate(startAfterTomorrow.getDate() + 1);

            const isDone = app.status === 'Виконана' || app.status === 'Скасована';
            if (isDone) return false;

            if (dashboardFilter === 'overdue' && !(deadline < now)) return false;
            if (dashboardFilter === 'today' && !(deadline >= startToday && deadline < startTomorrow)) return false;
            if (dashboardFilter === 'tomorrow' && !(deadline >= startTomorrow && deadline < startAfterTomorrow)) return false;
          }
        }

        return true;
      }
    );
  }, [
    applications,
    search,
    statusFilter,
    contractorFilter,
    dateFrom,
    dateTo,
    dashboardFilter,
  ]);

  const hasFilters =
    statusFilter ||
    contractorFilter ||
    dateFrom ||
    dateTo;

  const filteredIds = useMemo(
    () => filtered.map((app) => app.id),
    [filtered],
  );

  const allFilteredSelected =
    filteredIds.length > 0 &&
    filteredIds.every((id) => selectedIds.has(id));

  const toggleSelected = (applicationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(applicationId)) {
        next.delete(applicationId);
      } else {
        next.add(applicationId);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (allFilteredSelected) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }

      return next;
    });
  };

  const handleDeleteSelectedApplications = async () => {
    const ids = [...selectedIds];

    if (ids.length === 0 || deletingSelected) return;

    const confirmed = window.confirm(
      `Видалити вибрані заявки (${ids.length})?\n\n` +
        'Вони одразу зникнуть з RVP Control. Також буде виконано очищення ' +
        'збережених карток у Telegram-боті та повʼязаних повідомлень актів у групі.'
    );

    if (!confirmed) return;

    const previousApplications = applications;

    // Optimistic UI: selected applications disappear immediately.
    setApplications((current) =>
      current.filter((app) => !selectedIds.has(app.id))
    );
    setSelectedIds(new Set());

    if (selected && ids.includes(selected.id)) {
      setSelected(null);
    }

    setDeletingSelected(true);

    try {
      const result = await deleteSelectedApplications(ids);

      if (result.failed === 0) {
        showToast(`Видалено ${result.deleted} заявок`, 'success');
      } else {
        showToast(
          `Видалено ${result.deleted} з ${result.total}. Не вдалося: ${result.failed}`,
          'error'
        );

        // Reload only when the backend reported partial failure.
        await loadApplications();
      }
    } catch (error) {
      // Restore immediately if the server request itself failed.
      setApplications(previousApplications);
      showToast(
        error instanceof Error ? error.message : 'Не вдалося видалити вибрані заявки',
        'error'
      );
      await loadApplications().catch(() => undefined);
    } finally {
      setDeletingSelected(false);
    }
  };

  return (
    <>
      <PageHeader
        pageTitle="Заявки"
        pageSubtitle={`${filtered.length} з ${applications.length} заявок`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              disabled={filtered.length === 0 || deletingSelected}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              title="Вибрати всі заявки, які зараз показані"
            >
              <CheckCircle2 size={16} />
              <span className="hidden sm:inline">
                {allFilteredSelected ? 'Зняти вибір' : 'Вибрати всі'}
              </span>
            </button>

            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleDeleteSelectedApplications}
                disabled={deletingSelected}
                className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                title="Видалити вибрані заявки з RVP Control і Telegram"
              >
                {deletingSelected ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                <span>Видалити ({selectedIds.size})</span>
              </button>
            )}

            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              Нова заявка
            </button>
          </div>
        }
      >
        <div className="bg-[#141720] border border-white/5 rounded-2xl p-3 sm:p-4 mb-4 sm:mb-5 space-y-3">
          {dashboardFilter !== 'all' && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-500/15 bg-blue-500/[0.07] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-blue-400/70">
                  Фільтр з головної
                </p>
                <p className="truncate text-sm font-medium text-blue-300">
                  {dashboardFilter === 'new'
                    ? 'Нова'
                    : dashboardFilter === 'accepted'
                    ? 'Прийнята'
                    : dashboardFilter === 'work'
                    ? 'В роботі'
                    : dashboardFilter === 'done'
                    ? 'Виконана'
                    : dashboardFilter === 'overdue'
                    ? 'Прострочені'
                    : dashboardFilter === 'today'
                    ? 'Дедлайн сьогодні'
                    : 'Дедлайн на завтра'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDashboardFilter('all')}
                className="shrink-0 rounded-lg bg-white/5 p-2 text-slate-400 hover:text-white"
                aria-label="Скинути фільтр"
              >
                <X size={15} />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="w-full sm:flex-1 sm:min-w-[200px] relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="text"
                placeholder="Пошук за номером, АЗК, адресою, телефоном..."
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                className="w-full bg-white/5 border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition"
              />
            </div>

            <button
              onClick={() =>
                setShowFilters(
                  !showFilters
                )
              }
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                hasFilters
                  ? 'bg-blue-600/15 text-blue-400 border-blue-500/20'
                  : 'bg-white/5 text-slate-400 border-white/5 hover:text-slate-200'
              }`}
            >
              <Filter size={15} />
              Фільтри

              {hasFilters && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              )}

              <ChevronDown
                size={14}
                className={`transition-transform ${
                  showFilters
                    ? 'rotate-180'
                    : ''
                }`}
              />
            </button>

            {hasFilters && (
              <button
                onClick={() => {
                  setStatusFilter('');
                  setContractorFilter('');
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-sm text-slate-500 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <X size={14} />
                Скинути
              </button>
            )}
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-3 pt-2 border-t border-white/5">
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target
                      .value as
                      | ApplicationStatus
                      | ''
                  )
                }
                className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500/50 transition"
              >
                <option value="">
                  Усі статуси
                </option>

                {STATUSES.map(
                  (status) => (
                    <option
                      key={status}
                      value={status}
                    >
                      {status}
                    </option>
                  )
                )}
              </select>

              <select
                value={
                  contractorFilter
                }
                onChange={(event) =>
                  setContractorFilter(
                    event.target.value
                  )
                }
                className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500/50 transition"
              >
                <option value="">
                  Усі підрядники
                </option>

                {contractors.map(
                  (contractor) => (
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
                  )
                )}
              </select>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) =>
                    setDateFrom(
                      event.target.value
                    )
                  }
                  className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500/50 transition"
                />

                <span className="text-slate-600 text-sm">
                  —
                </span>

                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) =>
                    setDateTo(
                      event.target.value
                    )
                  }
                  className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500/50 transition"
                />
              </div>
            </div>
          )}
        </div>

        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-white/5 bg-[#141720] px-4 py-10">
              <div className="flex items-center justify-center gap-2 text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Завантаження заявок…</span>
              </div>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/10 bg-[#141720] px-4 py-8">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle size={24} className="text-red-400" />
                <span className="text-sm text-red-400">{error}</span>
                <button
                  onClick={loadApplications}
                  className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300"
                >
                  <RefreshCw size={14} />
                  Спробувати знову
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-[#141720] px-4 py-10 text-center text-sm text-slate-500">
              Заявки не знайдено
            </div>
          ) : (
            filtered.map((app) => {
              const callPhone = (app.contractorPhone || app.phone || '').replace(/[^+\d]/g, '');

              return (
                <div
                  key={app.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenApplication ? onOpenApplication(app.id) : setSelected(app)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenApplication ? onOpenApplication(app.id) : setSelected(app);
                    }
                  }}
                  className={`relative w-full overflow-hidden rounded-2xl border bg-[#141720] p-3.5 pl-4.5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.15)] transition active:scale-[0.99] ${
                    isApplicationOverdue(app)
                      ? 'border-rose-500/50 bg-rose-500/[0.035] ring-1 ring-rose-500/15'
                      : selectedIds.has(app.id)
                        ? 'border-red-500/40 ring-1 ring-red-500/20'
                        : 'border-white/5'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={selectedIds.has(app.id) ? 'Зняти вибір' : 'Вибрати заявку'}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSelected(app.id);
                    }}
                    className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                      selectedIds.has(app.id)
                        ? 'border-red-500/40 bg-red-500/15 text-red-300'
                        : 'border-white/10 bg-[#0d1118]/90 text-slate-500'
                    }`}
                  >
                    {selectedIds.has(app.id) ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <span className="h-4 w-4 rounded border border-current" />
                    )}
                  </button>
                  <span
                    className={`absolute inset-y-0 left-0 w-1 ${MOBILE_STATUS_ACCENT[app.status]}`}
                  />

                  <div className="mb-3 flex items-start justify-between gap-3 pr-10">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-lg font-bold tracking-tight text-blue-400">
                          {app.number}
                        </span>
                        <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-500">
                          {formatDate(app.date)}
                        </span>
                      </div>

                      <div className="mt-1.5 truncate text-base font-semibold text-white">
                        {app.customer || 'Без замовника'}
                      </div>
                      <div className="mt-2 text-xl font-bold text-sky-300">{formatWorkVolume(app.actualVolume)}</div>
                    </div>

                    <StatusBadge
                      label={displayApplicationStatus(app)}
                      className={applicationStatusColor(app)}
                    />
                  </div>

                  {isApplicationOverdue(app) && (
                    <div className="mb-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-300">
                      ⚠️ {overdueDurationText(app.deadline)}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-sm text-slate-400">
                      <MapPin size={16} className="mt-0.5 shrink-0 text-slate-600" />
                      <span className="line-clamp-2 leading-5">
                        {app.address || 'Адреса не вказана'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <User size={16} className="shrink-0 text-slate-600" />
                      <span className="truncate">
                        {app.contractorName && app.contractorName !== '—' ? app.contractorName : 'Виконавця не призначено'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                    <span className="text-xs text-slate-500">
                      Виплата виконавцю
                    </span>
                    <span className="text-base font-semibold text-white">
                      {(app.amount ?? 0).toLocaleString('uk-UA')} ₴
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {callPhone ? (
                      <a
                        href={`tel:${callPhone}`}
                        onClick={(event) => event.stopPropagation()}
                        className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.035] px-2 text-xs font-medium text-slate-300 active:bg-white/[0.08]"
                      >
                        <Phone size={15} />
                        Подзвонити
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        onClick={(event) => event.stopPropagation()}
                        className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-2 text-xs font-medium text-slate-600"
                      >
                        <Phone size={15} />
                        Подзвонити
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenApplication ? onOpenApplication(app.id) : setSelected(app);
                      }}
                      className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-blue-500/15 bg-blue-500/[0.07] px-2 text-xs font-medium text-blue-400 active:bg-blue-500/[0.13]"
                    >
                      <ExternalLink size={15} />
                      Відкрити
                    </button>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenApplication ? onOpenApplication(app.id) : setSelected(app);
                      }}
                      className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-violet-500/15 bg-violet-500/[0.07] px-2 text-xs font-medium text-violet-400 active:bg-violet-500/[0.13]"
                    >
                      <User size={15} />
                      Призначити
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block bg-[#141720] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto mobile-no-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  <th className="w-12 px-4 py-3">
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        allFilteredSelected
                          ? 'border-red-500/50 bg-red-500/15 text-red-300'
                          : 'border-white/15 text-slate-500'
                      }`}
                      aria-label={allFilteredSelected ? 'Зняти вибір' : 'Вибрати всі'}
                    >
                      {allFilteredSelected && <CheckCircle2 size={14} />}
                    </button>
                  </th>
                  {[
                    '№ заявки',
                    'Дата',
                    'Замовник',
                    'Адреса',
                    'Підрядник',
                    'Тел. підрядника',
                    'Статус',
                    'Виплата',
                    'Дії',
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="text-left text-xs text-slate-500 font-medium px-4 py-3 whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-center py-12"
                    >
                      <div className="flex items-center justify-center gap-2 text-slate-500">
                        <Loader2
                          size={18}
                          className="animate-spin"
                        />

                        <span className="text-sm">
                          Завантаження заявок…
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-center py-12"
                    >
                      <div className="flex flex-col items-center gap-3 text-slate-500">
                        <AlertCircle
                          size={24}
                          className="text-red-400"
                        />

                        <span className="text-sm text-red-400">
                          {error}
                        </span>

                        <button
                          onClick={
                            loadApplications
                          }
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
                        >
                          <RefreshCw
                            size={14}
                          />
                          Спробувати знову
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length ===
                  0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-center py-12 text-slate-500"
                    >
                      Заявки не знайдено
                    </td>
                  </tr>
                ) : (
                  filtered.map(
                    (app, index) => (
                      <tr
                        key={app.id}
                        className={`border-b hover:bg-white/[0.02] transition-colors cursor-pointer ${
                          selectedIds.has(app.id)
                            ? 'border-red-500/20 bg-red-500/[0.04]'
                            : 'border-white/5'
                        } ${
                          index ===
                          filtered.length -
                            1
                            ? 'border-0'
                            : ''
                        }`}
                        onClick={() =>
                          onOpenApplication ? onOpenApplication(app.id) : setSelected(app)
                        }
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSelected(app.id);
                            }}
                            className={`flex h-5 w-5 items-center justify-center rounded border ${
                              selectedIds.has(app.id)
                                ? 'border-red-500/50 bg-red-500/15 text-red-300'
                                : 'border-white/15 text-slate-500'
                            }`}
                            aria-label={selectedIds.has(app.id) ? 'Зняти вибір' : 'Вибрати заявку'}
                          >
                            {selectedIds.has(app.id) && <CheckCircle2 size={14} />}
                          </button>
                        </td>

                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-blue-400">
                            {app.number}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                          {formatDate(
                            app.date
                          )}
                        </td>

                        <td className="px-4 py-3 text-slate-200 font-medium max-w-[160px] truncate">
                          {app.customer}<div className="mt-1 text-sm font-semibold text-sky-300">{formatWorkVolume(app.actualVolume)}</div>
                        </td>

                        <td className="px-4 py-3 text-slate-400 max-w-[180px] truncate">
                          {app.address}
                        </td>

                        <td className="px-4 py-3 text-slate-400 max-w-[160px] truncate">
                          {
                            app.contractorName
                          }
                        </td>

                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                          {
                            app.contractorPhone
                          }
                        </td>

                        <td className="px-4 py-3">
                          <StatusBadge
                            label={displayApplicationStatus(app)}
                            className={applicationStatusColor(app)}
                          />
                        </td>

                        <td className="px-4 py-3 text-slate-200 font-medium whitespace-nowrap">
                          {(
                            app.amount ?? 0
                          ).toLocaleString(
                            'uk-UA'
                          )}{' '}
                          ₴
                        </td>

                        <td className="px-4 py-3">
                          <button
                            onClick={(
                              event
                            ) => {
                              event.stopPropagation();
                              onOpenApplication ? onOpenApplication(app.id) : setSelected(app);
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                          >
                            Деталі
                          </button>
                        </td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </PageHeader>

      {selected && <ApplicationActionDrawer application={selected} onClose={() => setSelected(null)} onChanged={loadApplications} />}

      {showNewModal && (
        <NewApplicationModal
          onClose={() =>
            setShowNewModal(false)
          }
          onCreated={
            loadApplications
          }
        />
      )}
    </>
  );
}
