import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  X,
} from 'lucide-react';

import PageHeader from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';

type AuditLogRow = {
  id: string;
  admin_user_id: string | null;
  admin_name: string | null;
  admin_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  contractor_assigned: 'Призначення підрядника',
  contractor_reassigned: 'Перепризначення підрядника',
  administrator_created: 'Створення адміністратора',
  administrator_updated: 'Зміна адміністратора',
  administrator_disabled: 'Вимкнення адміністратора',
  administrator_enabled: 'Увімкнення адміністратора',
  administrator_deleted: 'Видалення адміністратора',
  password_changed: 'Зміна пароля',
  role_changed: 'Зміна ролі',
};

const ENTITY_LABELS: Record<string, string> = {
  application: 'Заявка',
  contractor: 'Підрядник',
  act: 'Акт',
  payout: 'Виплата',
  administrator: 'Адміністратор',
  system: 'Система',
};

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getActionStyle(action: string) {
  if (action.includes('reassigned')) {
    return 'border-violet-500/20 bg-violet-500/10 text-violet-400';
  }

  if (
    action.includes('deleted') ||
    action.includes('disabled')
  ) {
    return 'border-red-500/20 bg-red-500/10 text-red-400';
  }

  if (
    action.includes('created') ||
    action.includes('enabled') ||
    action.includes('assigned')
  ) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400';
  }

  return 'border-blue-500/20 bg-blue-500/10 text-blue-400';
}

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select(`
          id,
          admin_user_id,
          admin_name,
          admin_email,
          action,
          entity_type,
          entity_id,
          title,
          description,
          metadata,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      setLogs((data || []) as AuditLogRow[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не вдалося завантажити журнал дій'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-audit-logs-page')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'admin_audit_logs',
        },
        (payload) => {
          const row = payload.new as AuditLogRow;

          setLogs((current) => [
            row,
            ...current.filter((item) => item.id !== row.id),
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const admins = useMemo(() => {
    const map = new Map<string, string>();

    logs.forEach((log) => {
      const key =
        log.admin_user_id ||
        log.admin_email ||
        log.admin_name;

      if (!key) return;

      map.set(
        key,
        log.admin_name ||
          log.admin_email ||
          'Невідомий адміністратор'
      );
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'uk')
      );
  }, [logs]);

  const actions = useMemo(() => {
    return Array.from(
      new Set(logs.map((log) => log.action))
    ).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return logs.filter((log) => {
      if (query) {
        const metadata = JSON.stringify(
          log.metadata || {}
        ).toLowerCase();

        const searchable = [
          log.admin_name,
          log.admin_email,
          log.action,
          log.title,
          log.description,
          log.entity_type,
          log.entity_id,
          metadata,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!searchable.includes(query)) {
          return false;
        }
      }

      if (adminFilter) {
        const key =
          log.admin_user_id ||
          log.admin_email ||
          log.admin_name ||
          '';

        if (key !== adminFilter) {
          return false;
        }
      }

      if (
        actionFilter &&
        log.action !== actionFilter
      ) {
        return false;
      }

      const createdDate =
        log.created_at.slice(0, 10);

      if (
        dateFrom &&
        createdDate < dateFrom
      ) {
        return false;
      }

      if (
        dateTo &&
        createdDate > dateTo
      ) {
        return false;
      }

      return true;
    });
  }, [
    logs,
    search,
    adminFilter,
    actionFilter,
    dateFrom,
    dateTo,
  ]);

  const todayCount = useMemo(() => {
    const today = new Date()
      .toISOString()
      .slice(0, 10);

    return logs.filter((log) =>
      log.created_at.startsWith(today)
    ).length;
  }, [logs]);

  const uniqueAdminCount = admins.length;

  const assignmentCount = useMemo(() => {
    return logs.filter((log) =>
      [
        'contractor_assigned',
        'contractor_reassigned',
      ].includes(log.action)
    ).length;
  }, [logs]);

  const hasFilters =
    Boolean(adminFilter) ||
    Boolean(actionFilter) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const resetFilters = () => {
    setSearch('');
    setAdminFilter('');
    setActionFilter('');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <PageHeader
      pageTitle="Журнал дій"
      pageSubtitle="Історія дій адміністраторів RVP Control"
    >
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-[#141720] p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Activity size={14} />
            Всього подій
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {logs.length}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#141720] p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <CalendarDays size={14} />
            Сьогодні
          </div>
          <div className="mt-2 text-2xl font-semibold text-blue-400">
            {todayCount}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#141720] p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <UserCog size={14} />
            Адміністраторів у журналі
          </div>
          <div className="mt-2 text-2xl font-semibold text-violet-400">
            {uniqueAdminCount}
          </div>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-white/5 bg-[#141720] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />

            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Пошук за заявкою, адміністратором, дією..."
              className="w-full rounded-lg border border-white/5 bg-white/5 py-2 pl-9 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-blue-500/50"
            />
          </div>

          <button
            onClick={() =>
              setShowFilters((value) => !value)
            }
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
              hasFilters
                ? 'border-blue-500/20 bg-blue-500/10 text-blue-400'
                : 'border-white/5 bg-white/5 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Filter size={15} />
            Фільтри
          </button>

          <button
            onClick={loadLogs}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-slate-400 transition hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw
              size={15}
              className={loading ? 'animate-spin' : ''}
            />
            Оновити
          </button>

          {(hasFilters || search) && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 text-sm text-slate-500 transition hover:text-red-400"
            >
              <X size={14} />
              Скинути
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-white/5 pt-3">
            <select
              value={adminFilter}
              onChange={(event) =>
                setAdminFilter(event.target.value)
              }
              className="rounded-lg border border-white/5 bg-[#0f1219] px-3 py-2 text-sm text-slate-300 outline-none focus:border-blue-500/50"
            >
              <option value="">
                Усі адміністратори
              </option>

              {admins.map((admin) => (
                <option
                  key={admin.id}
                  value={admin.id}
                >
                  {admin.name}
                </option>
              ))}
            </select>

            <select
              value={actionFilter}
              onChange={(event) =>
                setActionFilter(event.target.value)
              }
              className="rounded-lg border border-white/5 bg-[#0f1219] px-3 py-2 text-sm text-slate-300 outline-none focus:border-blue-500/50"
            >
              <option value="">
                Усі дії
              </option>

              {actions.map((action) => (
                <option
                  key={action}
                  value={action}
                >
                  {ACTION_LABELS[action] || action}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(event) =>
                setDateFrom(event.target.value)
              }
              className="rounded-lg border border-white/5 bg-[#0f1219] px-3 py-2 text-sm text-slate-300 outline-none focus:border-blue-500/50"
            />

            <input
              type="date"
              value={dateTo}
              onChange={(event) =>
                setDateTo(event.target.value)
              }
              className="rounded-lg border border-white/5 bg-[#0f1219] px-3 py-2 text-sm text-slate-300 outline-none focus:border-blue-500/50"
            />
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Показано {filteredLogs.length} з {logs.length}
        </p>

        {assignmentCount > 0 && (
          <p className="text-xs text-slate-600">
            Призначень / перепризначень: {assignmentCount}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-[#141720] py-20 text-slate-500">
          <Loader2
            size={18}
            className="animate-spin"
          />
          Завантаження журналу...
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/10 bg-red-500/[0.03] py-16 text-center">
          <AlertCircle
            size={26}
            className="mb-3 text-red-400"
          />

          <p className="text-sm text-red-400">
            {error}
          </p>

          <button
            onClick={loadLogs}
            className="mt-4 rounded-lg bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
          >
            Спробувати знову
          </button>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/5 bg-[#141720] py-20 text-center">
          <FileText
            size={26}
            className="mb-3 text-slate-600"
          />
          <p className="text-sm text-slate-400">
            Записів не знайдено
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Спробуйте змінити фільтри
          </p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute bottom-6 left-[23px] top-6 w-px bg-white/[0.07]" />

          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const applicationNumber =
                typeof log.metadata?.application_number ===
                'string'
                  ? String(
                      log.metadata.application_number
                    )
                  : null;

              return (
                <div
                  key={log.id}
                  className="relative flex gap-4"
                >
                  <div className="relative z-10 mt-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-blue-500/20 bg-[#11141c]">
                    <ShieldCheck
                      size={18}
                      className="text-blue-400"
                    />
                  </div>

                  <div className="flex-1 rounded-xl border border-white/5 bg-[#141720] p-5 transition hover:border-white/10">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-[10px] font-medium ${getActionStyle(
                              log.action
                            )}`}
                          >
                            {ACTION_LABELS[log.action] ||
                              log.action}
                          </span>

                          <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-1 text-[10px] text-slate-500">
                            {ENTITY_LABELS[
                              log.entity_type
                            ] || log.entity_type}
                          </span>

                          {applicationNumber && (
                            <span className="font-mono text-xs text-blue-400">
                              <bdi className="rpv-application-number">{applicationNumber}</bdi>
                            </span>
                          )}
                        </div>

                        <h3 className="mt-3 text-sm font-semibold text-slate-100">
                          {log.title}
                        </h3>

                        {log.description && (
                          <p className="mt-1.5 text-sm leading-6 text-slate-400">
                            {log.description}
                          </p>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
                          <span>
                            👤{' '}
                            {log.admin_name ||
                              'Невідомий адміністратор'}
                          </span>

                          {log.admin_email && (
                            <span>
                              {log.admin_email}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-xs text-slate-500">
                        {formatDateTime(log.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PageHeader>
  );
}
