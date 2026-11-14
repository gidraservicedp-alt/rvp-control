import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  Clock3,
  CalendarClock,
  TriangleAlert,
  Plus,
  MapPinned,
} from 'lucide-react';

import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';

import {
  fetchDashboardStats,
  type DashboardStats,
  type RecentApplication,
} from '@/lib/dashboardApi';

import {
  formatCurrency,
  formatDate,
  getApplicationStatusColor,
} from '@/utils/helpers';

export type DashboardNavigateTarget =
  | 'applications'
  | 'contractors'
  | 'acts'
  | 'payouts'
  | 'statistics'
  | 'audit-log'
  | 'problems'
  | 'object-map';

type ApplicationDashboardFilter =
  | 'all'
  | 'new'
  | 'accepted'
  | 'work'
  | 'done'
  | 'overdue'
  | 'today'
  | 'tomorrow';

type Props = {
  onNavigate: (page: DashboardNavigateTarget, filter?: ApplicationDashboardFilter) => void;
};

type Accent =
  | 'blue'
  | 'amber'
  | 'green'
  | 'violet'
  | 'slate';

const accentClasses: Record<
  Accent,
  {
    iconBg: string;
    iconText: string;
    border: string;
    glow: string;
  }
> = {
  blue: {
    iconBg: 'bg-blue-500/15',
    iconText: 'text-blue-400',
    border: 'border-blue-500/10',
    glow: 'from-blue-500/10',
  },
  amber: {
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-400',
    border: 'border-amber-500/10',
    glow: 'from-amber-500/10',
  },
  green: {
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-400',
    border: 'border-emerald-500/10',
    glow: 'from-emerald-500/10',
  },
  violet: {
    iconBg: 'bg-violet-500/15',
    iconText: 'text-violet-400',
    border: 'border-violet-500/10',
    glow: 'from-violet-500/10',
  },
  slate: {
    iconBg: 'bg-slate-500/15',
    iconText: 'text-slate-300',
    border: 'border-white/5',
    glow: 'from-slate-400/5',
  },
};

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  accent,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
  accent: Accent;
  onClick: () => void;
}) {
  const styles =
    accentClasses[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-2xl border ${styles.border} bg-[#141821] p-5 text-left shadow-[0_12px_35px_rgba(0,0,0,0.18)] transition duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:bg-[#171c26] hover:shadow-[0_18px_50px_rgba(0,0,0,0.28)] focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${styles.glow} via-transparent to-transparent opacity-80 transition group-hover:opacity-100`}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            {title}
          </p>

          <p className="mt-3 text-2xl font-semibold tracking-tight text-white">
            {value}
          </p>

          <p className="mt-2 text-xs text-slate-500">
            {subtitle}
          </p>
        </div>

        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${styles.iconBg} ${styles.iconText} transition group-hover:scale-105`}
        >
          {icon}
        </div>
      </div>

      <div className="relative mt-4 text-[11px] font-medium text-slate-600 transition group-hover:text-blue-400">
        Відкрити →
      </div>
    </button>
  );
}

function ProgressRow({
  label,
  count,
  total,
  barClass,
  onClick,
}: {
  label: string;
  count: number;
  total: number;
  barClass: string;
  onClick: () => void;
}) {
  const percent =
    total > 0
      ? Math.min(
          100,
          Math.round(
            (count / total) *
              100
          )
        )
      : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full rounded-lg p-1.5 text-left transition hover:bg-white/[0.025]"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-400 transition group-hover:text-slate-200">
          {label}
        </span>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {percent}%
          </span>

          <span className="min-w-7 text-right text-sm font-medium text-slate-200">
            {count}
          </span>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full ${barClass}`}
          style={{
            width: `${percent}%`,
          }}
        />
      </div>
    </button>
  );
}

function AttentionCard({
  icon,
  title,
  subtitle,
  value,
  valueClass,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  value: ReactNode;
  valueClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] p-3.5 text-left transition hover:border-white/10 hover:bg-white/[0.045]"
    >
      {icon}

      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200">
          {title}
        </p>

        <p className="text-xs text-slate-500">
          {subtitle}
        </p>
      </div>

      <span
        className={`text-base font-semibold ${
          valueClass ||
          'text-white'
        }`}
      >
        {value}
      </span>
    </button>
  );
}


function openApplicationsFilter(
  onNavigate: (page: DashboardNavigateTarget) => void,
  filter: 'all' | 'overdue' | 'today' | 'tomorrow'
) {
  sessionStorage.setItem('rvp-applications-dashboard-filter', filter);
  onNavigate('applications');
}

export default function Dashboard({
  onNavigate,
}: Props) {
  const { showToast } =
    useApp();

  const [stats, setStats] =
    useState<DashboardStats | null>(
      null
    );

  const [recent, setRecent] =
    useState<
      RecentApplication[]
    >([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(
      null
    );

  const [search, setSearch] =
    useState('');

  const [deadlineStats, setDeadlineStats] = useState({
    overdue: 0,
    today: 0,
    tomorrow: 0,
    problems: 0,
  });

  useEffect(() => {
    const loadControlStats = async () => {
      const { data } = await supabase
        .from('applications')
        .select('deadline_at,status,contractor_stage');

      const rows = data ?? [];
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startTomorrow = new Date(startToday);
      startTomorrow.setDate(startTomorrow.getDate() + 1);
      const startAfterTomorrow = new Date(startTomorrow);
      startAfterTomorrow.setDate(startAfterTomorrow.getDate() + 1);

      let overdue = 0;
      let todayCount = 0;
      let tomorrowCount = 0;
      let problems = 0;

      for (const row of rows as any[]) {
        const done = ['completed', 'cancelled', 'Виконана', 'Скасована'].includes(String(row.status));
        if (String(row.contractor_stage) === 'problem') problems += 1;
        if (!row.deadline_at || done) continue;

        const deadline = new Date(row.deadline_at);
        if (Number.isNaN(deadline.getTime())) continue;

        if (deadline < now) overdue += 1;
        else if (deadline >= startToday && deadline < startTomorrow) todayCount += 1;
        else if (deadline >= startTomorrow && deadline < startAfterTomorrow) tomorrowCount += 1;
      }

      setDeadlineStats({
        overdue,
        today: todayCount,
        tomorrow: tomorrowCount,
        problems,
      });
    };

    loadControlStats();

    const channel = supabase
      .channel('dashboard-control-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, loadControlStats)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const load =
    useCallback(async () => {
      setLoading(true);
      setError(null);

      try {
        const result =
          await fetchDashboardStats();

        setStats(result.stats);
        setRecent(
          result.recent
        );
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Помилка завантаження даних';

        setError(msg);
        showToast(
          msg,
          'error'
        );
      } finally {
        setLoading(false);
      }
    }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const today = useMemo(
    () =>
      new Date().toLocaleDateString(
        'uk-UA',
        {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }
      ),
    []
  );

  const filteredRecent =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return recent;
      }

      return recent.filter(
        (app) =>
          [
            app.number,
            app.title,
            app.address,
            app.contractorName,
            app.status,
          ]
            .filter(Boolean)
            .some(
              (value) =>
                String(value)
                  .toLowerCase()
                  .includes(
                    query
                  )
            )
      );
    }, [recent, search]);

  if (loading) {
    return (
      <PageHeader
        pageTitle="Панель керування"
        pageSubtitle={
          today
            .charAt(0)
            .toUpperCase() +
          today.slice(1)
        }
      >
        <div className="flex items-center justify-center py-24">
          <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] px-5 py-3 text-slate-500">
            <RefreshCw
              size={16}
              className="animate-spin"
            />
            <span className="text-sm">
              Завантаження даних…
            </span>
          </div>
        </div>
      </PageHeader>
    );
  }

  if (error || !stats) {
    return (
      <PageHeader
        pageTitle="Панель керування"
        pageSubtitle={
          today
            .charAt(0)
            .toUpperCase() +
          today.slice(1)
        }
      >
        <div className="flex flex-col items-center gap-3 py-24">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <AlertCircle
              size={22}
              className="text-red-400"
            />
          </div>

          <span className="text-sm text-red-400">
            {error ??
              'Помилка'}
          </span>

          <button
            onClick={load}
            className="mt-2 flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            <RefreshCw
              size={14}
            />
            Спробувати знову
          </button>
        </div>
      </PageHeader>
    );
  }

  const activeWork =
    stats.inProgress +
    stats.accepted;

  const completionRate =
    stats.total > 0
      ? Math.round(
          (stats.completed /
            stats.total) *
            100
        )
      : 0;

  const payoutRate =
    stats.totalPayout > 0
      ? Math.round(
          (stats.paidPayout /
            stats.totalPayout) *
            100
        )
      : 0;

  const attentionCount =
    stats.newCount +
    stats.pendingActs +
    (stats.pendingPayout >
    0
      ? 1
      : 0);

  return (
    <PageHeader
      pageTitle="Панель керування"
      pageSubtitle={
        today
          .charAt(0)
          .toUpperCase() +
        today.slice(1)
      }
      actions={
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200"
        >
          <RefreshCw
            size={14}
          />
          Оновити
        </button>
      }
    >
      <div className="mb-5 rounded-2xl border border-white/5 bg-gradient-to-r from-[#141821] via-[#131720] to-[#11151d] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.2)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">
              RVP Control
            </p>

            <h2 className="mt-2 text-xl font-semibold text-white">
              Оперативна картина
              на сьогодні
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Заявки,
              підрядники, акти
              та виплати в одному
              місці
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() =>
                onNavigate(
                  'statistics'
                )
              }
              className="rounded-xl border border-white/5 bg-black/10 px-4 py-3 text-left transition hover:bg-white/[0.04]"
            >
              <p className="text-xs text-slate-500">
                Виконання
              </p>
              <p className="mt-1 text-lg font-semibold text-emerald-400">
                {completionRate}%
              </p>
            </button>

            <button
              onClick={() =>
                onNavigate(
                  'applications'
                )
              }
              className="rounded-xl border border-white/5 bg-black/10 px-4 py-3 text-left transition hover:bg-white/[0.04]"
            >
              <p className="text-xs text-slate-500">
                Потребує уваги
              </p>
              <p className="mt-1 text-lg font-semibold text-amber-400">
                {attentionCount}
              </p>
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/5 bg-[#141821] p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Контроль термінів</h3>
              <p className="mt-1 text-xs text-slate-500">Дедлайни активних заявок</p>
            </div>
            <CalendarClock size={17} className="text-blue-400" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <button onClick={() => openApplicationsFilter(onNavigate, 'overdue')} className="rounded-xl border border-red-500/10 bg-red-500/[0.06] p-4 text-left transition hover:bg-red-500/10">
              <TriangleAlert size={17} className="text-red-400" />
              <p className="mt-3 text-2xl font-semibold text-red-400">{deadlineStats.overdue}</p>
              <p className="mt-1 text-xs text-slate-500">Прострочені</p>
            </button>
            <button onClick={() => openApplicationsFilter(onNavigate, 'today')} className="rounded-xl border border-amber-500/10 bg-amber-500/[0.06] p-4 text-left transition hover:bg-amber-500/10">
              <Clock3 size={17} className="text-amber-400" />
              <p className="mt-3 text-2xl font-semibold text-amber-400">{deadlineStats.today}</p>
              <p className="mt-1 text-xs text-slate-500">Дедлайн сьогодні</p>
            </button>
            <button onClick={() => openApplicationsFilter(onNavigate, 'tomorrow')} className="rounded-xl border border-blue-500/10 bg-blue-500/[0.06] p-4 text-left transition hover:bg-blue-500/10">
              <CalendarClock size={17} className="text-blue-400" />
              <p className="mt-3 text-2xl font-semibold text-blue-400">{deadlineStats.tomorrow}</p>
              <p className="mt-1 text-xs text-slate-500">На завтра</p>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#141821] p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">Швидкі дії</h3>
            <p className="mt-1 text-xs text-slate-500">Основні робочі розділи</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={() => onNavigate('applications')} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left text-sm text-slate-300 transition hover:bg-white/[0.05]">
              <Plus size={16} className="text-blue-400" /> Заявки
            </button>
            <button onClick={() => onNavigate('problems')} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left text-sm text-slate-300 transition hover:bg-white/[0.05]">
              <TriangleAlert size={16} className="text-red-400" /> Проблеми
              {deadlineStats.problems > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">{deadlineStats.problems}</span>}
            </button>
            <button onClick={() => onNavigate('acts')} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left text-sm text-slate-300 transition hover:bg-white/[0.05]">
              <ClipboardCheck size={16} className="text-amber-400" /> Перевірити акти
            </button>
            <button onClick={() => onNavigate('object-map')} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left text-sm text-slate-300 transition hover:bg-white/[0.05]">
              <MapPinned size={16} className="text-emerald-400" /> Карта обʼєктів
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          title="Всього заявок"
          value={stats.total}
          subtitle="За весь період"
          icon={
            <FileText
              size={18}
            />
          }
          accent="slate"
          onClick={() =>
            onNavigate(
              'applications'
            )
          }
        />

        <MetricCard
          title="Нові заявки"
          value={
            stats.newCount
          }
          subtitle="Очікують обробки"
          icon={
            <ClipboardCheck
              size={18}
            />
          }
          accent="blue"
          onClick={() =>
            onNavigate(
              'applications'
            )
          }
        />

        <MetricCard
          title="В роботі"
          value={activeWork}
          subtitle={`${stats.inProgress} активних`}
          icon={
            <Wrench
              size={18}
            />
          }
          accent="amber"
          onClick={() =>
            onNavigate(
              'applications'
            )
          }
        />

        <MetricCard
          title="Виконані"
          value={
            stats.completed
          }
          subtitle={`${completionRate}% від усіх`}
          icon={
            <CheckCircle2
              size={18}
            />
          }
          accent="green"
          onClick={() =>
            onNavigate(
              'applications'
            )
          }
        />

        <MetricCard
          title="Сума виплат"
          value={formatCurrency(
            stats.paidPayout
          )}
          subtitle={`${payoutRate}% виплачено`}
          icon={
            <Wallet
              size={18}
            />
          }
          accent="violet"
          onClick={() =>
            onNavigate(
              'payouts'
            )
          }
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/5 bg-[#141821] p-5 shadow-[0_12px_35px_rgba(0,0,0,0.16)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Статус заявок
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Поточний розподіл
                по системі
              </p>
            </div>

            <button
              onClick={() =>
                onNavigate(
                  'statistics'
                )
              }
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 transition hover:bg-blue-500/20"
              title="Відкрити статистику"
            >
              <Activity
                size={16}
              />
            </button>
          </div>

          <div className="space-y-2">
            <ProgressRow
              label="Нова"
              count={
                stats.newCount
              }
              total={stats.total}
              barClass="bg-blue-500"
              onClick={() =>
                onNavigate(
                  'applications',
                  'new'
                )
              }
            />

            <ProgressRow
              label="Прийнята"
              count={
                stats.accepted
              }
              total={stats.total}
              barClass="bg-violet-500"
              onClick={() =>
                onNavigate(
                  'applications',
                  'accepted'
                )
              }
            />

            <ProgressRow
              label="В роботі"
              count={
                stats.inProgress
              }
              total={stats.total}
              barClass="bg-amber-500"
              onClick={() =>
                onNavigate(
                  'applications',
                  'work'
                )
              }
            />

            <ProgressRow
              label="Виконана"
              count={
                stats.completed
              }
              total={stats.total}
              barClass="bg-emerald-500"
              onClick={() =>
                onNavigate(
                  'applications',
                  'done'
                )
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#141821] p-5 shadow-[0_12px_35px_rgba(0,0,0,0.16)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Потребує уваги
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                Найважливіші
                показники на зараз
              </p>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
              <AlertCircle
                size={16}
              />
            </div>
          </div>

          <div className="space-y-3">
            <AttentionCard
              title="Нові заявки"
              subtitle="Очікують розподілу"
              value={
                stats.newCount
              }
              onClick={() =>
                onNavigate(
                  'applications'
                )
              }
              icon={
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <FileText
                    size={15}
                  />
                </div>
              }
            />

            <AttentionCard
              title="Акти на перевірці"
              subtitle="Потребують рішення"
              value={
                stats.pendingActs
              }
              onClick={() =>
                onNavigate('acts')
              }
              icon={
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                  <ClipboardCheck
                    size={15}
                  />
                </div>
              }
            />

            <AttentionCard
              title="Очікує виплати"
              subtitle="Нараховано, але не виплачено"
              value={formatCurrency(
                stats.pendingPayout
              )}
              valueClass="text-amber-400 text-sm"
              onClick={() =>
                onNavigate(
                  'payouts'
                )
              }
              icon={
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                  <Wallet
                    size={15}
                  />
                </div>
              }
            />
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-white/5 bg-[#141821] shadow-[0_12px_35px_rgba(0,0,0,0.16)]">
        <div className="flex flex-col gap-3 border-b border-white/5 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  'applications'
                )
              }
              className="text-left"
            >
              <h2 className="text-sm font-semibold text-white transition hover:text-blue-400">
                Останні заявки
              </h2>
            </button>

            <p className="mt-1 text-xs text-slate-500">
              {stats.total}{' '}
              заявок у системі
            </p>
          </div>

          <div className="relative w-full lg:w-[320px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
            />

            <input
              value={search}
              onChange={(
                event
              ) =>
                setSearch(
                  event.target
                    .value
                )
              }
              placeholder="Пошук по останніх заявках..."
              className="w-full rounded-lg border border-white/5 bg-white/[0.025] py-2 pl-9 pr-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-blue-500/30"
            />
          </div>
        </div>

        <div className="overflow-x-auto mobile-no-scrollbar">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.012]">
                {[
                  '№ заявки',
                  'Дата',
                  'Обʼєкт',
                  'Адреса',
                  'Підрядник',
                  'Статус',
                  'Сума',
                ].map(
                  (heading) => (
                    <th
                      key={
                        heading
                      }
                      className="px-5 py-3 text-left text-xs font-medium text-slate-600"
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {filteredRecent.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-14 text-center text-slate-500"
                  >
                    Заявок не
                    знайдено
                  </td>
                </tr>
              ) : (
                filteredRecent.map(
                  (
                    app,
                    index
                  ) => (
                    <tr
                      key={app.id}
                      onClick={() =>
                        onNavigate(
                          'applications'
                        )
                      }
                      className={`cursor-pointer transition hover:bg-white/[0.035] ${
                        index ===
                        filteredRecent.length -
                          1
                          ? ''
                          : 'border-b border-white/5'
                      }`}
                    >
                      <td className="px-5 py-4">
                        <span className="font-mono text-xs font-medium text-blue-400">
                          <bdi className="rpv-application-number">{app.number}</bdi>
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                        {formatDate(
                          app.date
                        )}
                      </td>

                      <td className="max-w-[180px] truncate px-5 py-4 font-medium text-slate-200">
                        {app.title}
                      </td>

                      <td className="max-w-[220px] truncate px-5 py-4 text-slate-500">
                        {app.address}
                      </td>

                      <td className="max-w-[180px] truncate px-5 py-4 text-slate-400">
                        {
                          app.contractorName
                        }
                      </td>

                      <td className="px-5 py-4">
                        <StatusBadge
                          label={
                            app.status
                          }
                          className={getApplicationStatusColor(
                            app.status
                          )}
                        />
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-right font-medium text-slate-200">
                        {app.amount.toLocaleString(
                          'uk-UA'
                        )}{' '}
                        ₴
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() =>
            onNavigate(
              'contractors'
            )
          }
          className="rounded-2xl border border-white/5 bg-[#141821] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/10 hover:bg-[#171c26]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <Users
                size={16}
              />
            </div>

            <div>
              <p className="text-xs text-slate-500">
                Активні
                підрядники
              </p>

              <p className="mt-1 text-xl font-semibold text-white">
                {
                  stats.activeContractors
                }
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(
              'applications'
            )
          }
          className="rounded-2xl border border-white/5 bg-[#141821] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/10 hover:bg-[#171c26]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
              <TrendingUp
                size={16}
              />
            </div>

            <div>
              <p className="text-xs text-slate-500">
                Активних заявок
              </p>

              <p className="mt-1 text-xl font-semibold text-white">
                {activeWork}
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(
              'payouts'
            )
          }
          className="rounded-2xl border border-white/5 bg-[#141821] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/10 hover:bg-[#171c26]"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">
                Прогрес виплат
              </p>

              <p className="mt-1 text-xl font-semibold text-white">
                {payoutRate}%
              </p>
            </div>

            <Wallet
              size={18}
              className="text-violet-400"
            />
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-violet-500"
              style={{
                width: `${payoutRate}%`,
              }}
            />
          </div>
        </button>
      </div>
    </PageHeader>
  );
}
