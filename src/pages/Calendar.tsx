import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';

import PageHeader from '@/components/PageHeader';
import { fetchCalendarEvents } from '@/lib/calendarApi';
import { getApplicationStatusColor } from '@/utils/helpers';

import type {
  CalendarEvent,
  ApplicationStatus,
} from '@/types';

type ViewMode = 'month' | 'week' | 'day';

const monthNames = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

const dayNames = [
  'Пн',
  'Вт',
  'Ср',
  'Чт',
  'Пт',
  'Сб',
  'Нд',
];

interface Props {
  onNavigateToApplications?: () => void;
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseEventDate(value: string | Date) {
  return value instanceof Date
    ? value
    : new Date(value);
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const weekday = (result.getDay() + 6) % 7;

  result.setDate(result.getDate() - weekday);
  result.setHours(0, 0, 0, 0);

  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function eventStatusLabel(event: CalendarEvent) {
  if (event.deadline) {
    return 'Дедлайн';
  }

  return event.status || 'Нова';
}

export default function Calendar({
  onNavigateToApplications,
}: Props) {
  const [view, setView] =
    useState<ViewMode>('month');

  const [cursor, setCursor] =
    useState(new Date());

  const [events, setEvents] =
    useState<CalendarEvent[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // =====================================================
  // LOAD
  // =====================================================

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data =
        await fetchCalendarEvents(
          year,
          month,
        );

      setEvents(data);
    } catch (e) {
      console.error(e);

      setError(
        e instanceof Error
          ? e.message
          : 'Не вдалося завантажити календар',
      );
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  // =====================================================
  // EVENTS MAP
  // =====================================================

  const eventsByDay = useMemo(() => {
    const map =
      new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const date =
        parseEventDate(event.date);

      if (
        Number.isNaN(date.getTime())
      ) {
        continue;
      }

      const key = dateKey(date);

      const list =
        map.get(key) ?? [];

      list.push(event);

      map.set(key, list);
    }

    return map;
  }, [events]);

  // =====================================================
  // STATS
  // =====================================================

  const stats = useMemo(() => {
    const today = new Date();

    const todayCount =
      events.filter(event => {
        const date =
          parseEventDate(event.date);

        return (
          !Number.isNaN(
            date.getTime(),
          ) &&
          isSameDay(date, today)
        );
      }).length;

    const deadlines =
      events.filter(
        event => event.deadline,
      ).length;

    return {
      total: events.length,
      today: todayCount,
      deadlines,
    };
  }, [events]);

  // =====================================================
  // OPEN EXACT APPLICATION
  // =====================================================

  const openApplication = (
    event: CalendarEvent,
  ) => {
    const applicationId =
      (event as CalendarEvent & {
        applicationId?: string;
        application_id?: string;
      }).applicationId ??
      (event as CalendarEvent & {
        applicationId?: string;
        application_id?: string;
      }).application_id ??
      event.id;

    if (applicationId) {
      sessionStorage.setItem(
        'rvp-open-application-id',
        String(applicationId),
      );
    }

    onNavigateToApplications?.();
  };

  // =====================================================
  // NAVIGATION
  // =====================================================

  const navigate = (direction: number) => {
    if (view === 'month') {
      setCursor(
        new Date(
          year,
          month + direction,
          1,
        ),
      );

      return;
    }

    const next =
      new Date(cursor);

    next.setDate(
      next.getDate() +
        direction *
          (view === 'week'
            ? 7
            : 1),
    );

    setCursor(next);
  };

  const goToday = () => {
    setCursor(new Date());
  };

  // =====================================================
  // HEADER
  // =====================================================

  const headerLabel =
    view === 'month'
      ? `${monthNames[month]} ${year}`
      : view === 'day'
        ? cursor.toLocaleDateString(
            'uk-UA',
            {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            },
          )
        : `${startOfWeek(
            cursor,
          ).toLocaleDateString(
            'uk-UA',
            {
              day: '2-digit',
              month: 'short',
            },
          )} — ${addDays(
            startOfWeek(cursor),
            6,
          ).toLocaleDateString(
            'uk-UA',
            {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            },
          )}`;

  // =====================================================
  // MONTH DATA
  // =====================================================

  const daysInMonth =
    new Date(
      year,
      month + 1,
      0,
    ).getDate();

  const firstDay =
    new Date(year, month, 1);

  const firstDayWeekday =
    (firstDay.getDay() + 6) % 7;

  const monthCells = useMemo(() => {
    const cells:
      Array<Date | null> = [];

    for (
      let i = 0;
      i < firstDayWeekday;
      i++
    ) {
      cells.push(null);
    }

    for (
      let day = 1;
      day <= daysInMonth;
      day++
    ) {
      cells.push(
        new Date(
          year,
          month,
          day,
        ),
      );
    }

    while (
      cells.length % 7 !== 0
    ) {
      cells.push(null);
    }

    return cells;
  }, [
    year,
    month,
    daysInMonth,
    firstDayWeekday,
  ]);

  // =====================================================
  // WEEK DATA
  // =====================================================

  const weekDays = useMemo(() => {
    const start =
      startOfWeek(cursor);

    return Array.from(
      { length: 7 },
      (_, index) =>
        addDays(start, index),
    );
  }, [cursor]);

  // =====================================================
  // DAY EVENTS
  // =====================================================

  const currentDayEvents =
    eventsByDay.get(
      dateKey(cursor),
    ) ?? [];

  // =====================================================
  // EVENT COMPONENT
  // =====================================================

  const EventRow = ({
    event,
    compact = false,
  }: {
    event: CalendarEvent;
    compact?: boolean;
  }) => {
    return (
      <button
        onClick={() =>
          openApplication(event)
        }
        className={`
          group w-full text-left
          transition
          ${
            compact
              ? 'rounded-md px-1.5 py-1'
              : 'rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 hover:border-blue-500/20 hover:bg-blue-500/[0.035]'
          }
        `}
      >
        {compact ? (
          <div
            className={`
              truncate rounded-md border
              px-2 py-1 text-[10px]
              font-medium
              ${
                event.deadline
                  ? 'border-red-500/15 bg-red-500/10 text-red-400'
                  : getApplicationStatusColor(
                      event.status as ApplicationStatus,
                    )
              }
            `}
          >
            <bdi className="rpv-application-number">{event.number}</bdi>
          </div>
        ) : (
          <div className="flex items-center gap-3">

            <div className="min-w-0 flex-1">

              <div className="flex flex-wrap items-center gap-2">

                <span className="font-mono text-xs font-semibold text-blue-400">
                  <bdi className="rpv-application-number">{event.number}</bdi>
                </span>

                <span
                  className={`
                    rounded-full border
                    px-2 py-0.5
                    text-[10px]
                    ${
                      event.deadline
                        ? 'border-red-500/15 bg-red-500/10 text-red-400'
                        : getApplicationStatusColor(
                            event.status as ApplicationStatus,
                          )
                    }
                  `}
                >
                  {eventStatusLabel(
                    event,
                  )}
                </span>

              </div>

              <p className="mt-1.5 truncate text-sm font-medium text-slate-200">
                {event.title ||
                  'Заявка'}
              </p>

            </div>

            {event.deadline && (
              <TriangleAlert
                size={15}
                className="shrink-0 text-red-400"
              />
            )}

            <ChevronRight
              size={15}
              className="shrink-0 text-slate-700 transition group-hover:text-blue-400"
            />

          </div>
        )}
      </button>
    );
  };

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <PageHeader
      pageTitle="Календар"
      pageSubtitle="Планування заявок та контроль дедлайнів"
      actions={
        <div className="flex flex-wrap items-center gap-2">

          <div className="flex rounded-lg border border-white/[0.07] bg-[#0f1219] p-0.5">
            {(
              [
                'month',
                'week',
                'day',
              ] as ViewMode[]
            ).map(mode => (
              <button
                key={mode}
                onClick={() =>
                  setView(mode)
                }
                className={`
                  rounded-md px-3
                  py-1.5 text-xs
                  transition
                  ${
                    view === mode
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:text-slate-200'
                  }
                `}
              >
                {mode === 'month'
                  ? 'Місяць'
                  : mode ===
                      'week'
                    ? 'Тиждень'
                    : 'День'}
              </button>
            ))}
          </div>

          <button
            onClick={goToday}
            className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.06]"
          >
            Сьогодні
          </button>

          <button
            onClick={load}
            disabled={loading}
            title="Оновити"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025] text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={
                loading
                  ? 'animate-spin'
                  : ''
              }
            />
          </button>

        </div>
      }
    >
      {/* =============================================
          STATS
      ============================================= */}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">

        <div className="rounded-xl border border-white/[0.06] bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Подій у місяці
            </p>

            <CalendarDays
              size={16}
              className="text-blue-400"
            />
          </div>

          <p className="mt-2 text-2xl font-semibold text-white">
            {stats.total}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Сьогодні
            </p>

            <Clock3
              size={16}
              className="text-emerald-400"
            />
          </div>

          <p className="mt-2 text-2xl font-semibold text-white">
            {stats.today}
          </p>
        </div>

        <div className="rounded-xl border border-red-500/10 bg-[#141821] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Дедлайни
            </p>

            <TriangleAlert
              size={16}
              className="text-red-400"
            />
          </div>

          <p className="mt-2 text-2xl font-semibold text-red-400">
            {stats.deadlines}
          </p>
        </div>

      </div>

      {/* =============================================
          CALENDAR
      ============================================= */}

      <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#121720]">

        {/* CALENDAR HEADER */}

        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-5">

          <button
            onClick={() =>
              navigate(-1)
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="text-center">
            <p className="text-sm font-semibold capitalize text-white">
              {headerLabel}
            </p>

            <p className="mt-0.5 text-[10px] text-slate-600">
              {events.length}{' '}
              {events.length === 1
                ? 'подія'
                : 'подій'}
            </p>
          </div>

          <button
            onClick={() =>
              navigate(1)
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronRight size={18} />
          </button>

        </div>

        {/* LOADING */}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <Loader2
              size={22}
              className="animate-spin text-slate-600"
            />
          </div>
        ) : error ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">

            <TriangleAlert
              size={26}
              className="text-red-400"
            />

            <p className="mt-3 text-sm text-red-400">
              {error}
            </p>

            <button
              onClick={load}
              className="mt-4 rounded-lg bg-white/5 px-4 py-2 text-xs text-slate-300 hover:bg-white/10"
            >
              Спробувати знову
            </button>

          </div>
        ) : (
          <>
            {/* =========================================
                MONTH
            ========================================= */}

            {view === 'month' && (
              <div>

                <div className="grid grid-cols-7 border-b border-white/[0.05] bg-white/[0.015]">
                  {dayNames.map(
                    day => (
                      <div
                        key={day}
                        className="border-r border-white/[0.04] py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-600 last:border-r-0"
                      >
                        {day}
                      </div>
                    ),
                  )}
                </div>

                <div className="grid grid-cols-7">

                  {monthCells.map(
                    (date, index) => {
                      if (!date) {
                        return (
                          <div
                            key={`empty-${index}`}
                            className="min-h-[120px] border-b border-r border-white/[0.04] bg-black/[0.06]"
                          />
                        );
                      }

                      const key =
                        dateKey(date);

                      const dayEvents =
                        eventsByDay.get(
                          key,
                        ) ?? [];

                      const today =
                        isSameDay(
                          date,
                          new Date(),
                        );

                      return (
                        <div
                          key={key}
                          onDoubleClick={() => {
                            setCursor(
                              date,
                            );

                            setView(
                              'day',
                            );
                          }}
                          className={`
                            min-h-[120px]
                            border-b border-r
                            border-white/[0.04]
                            p-1.5
                            transition
                            hover:bg-white/[0.015]
                            ${
                              today
                                ? 'bg-blue-500/[0.035]'
                                : ''
                            }
                          `}
                        >
                          <div className="mb-1 flex items-center justify-between px-1">

                            <button
                              onClick={() => {
                                setCursor(
                                  date,
                                );

                                setView(
                                  'day',
                                );
                              }}
                              className={`
                                flex h-6 w-6
                                items-center
                                justify-center
                                rounded-full
                                text-[11px]
                                ${
                                  today
                                    ? 'bg-blue-600 font-bold text-white'
                                    : 'text-slate-500 hover:bg-white/5 hover:text-white'
                                }
                              `}
                            >
                              {date.getDate()}
                            </button>

                            {dayEvents.length >
                              0 && (
                              <span className="text-[9px] text-slate-700">
                                {
                                  dayEvents.length
                                }
                              </span>
                            )}

                          </div>

                          <div className="space-y-0.5">

                            {dayEvents
                              .slice(0, 3)
                              .map(event => (
                                <EventRow
                                  key={
                                    event.id
                                  }
                                  event={
                                    event
                                  }
                                  compact
                                />
                              ))}

                            {dayEvents.length >
                              3 && (
                              <button
                                onClick={() => {
                                  setCursor(
                                    date,
                                  );

                                  setView(
                                    'day',
                                  );
                                }}
                                className="w-full px-2 py-1 text-left text-[10px] font-medium text-blue-400 hover:text-blue-300"
                              >
                                +
                                {dayEvents.length -
                                  3}{' '}
                                ще
                              </button>
                            )}

                          </div>
                        </div>
                      );
                    },
                  )}

                </div>
              </div>
            )}

            {/* =========================================
                WEEK
            ========================================= */}

            {view === 'week' && (
              <div className="grid min-h-[520px] grid-cols-1 divide-y divide-white/[0.05] md:grid-cols-7 md:divide-x md:divide-y-0">

                {weekDays.map(date => {
                  const key =
                    dateKey(date);

                  const dayEvents =
                    eventsByDay.get(
                      key,
                    ) ?? [];

                  const today =
                    isSameDay(
                      date,
                      new Date(),
                    );

                  return (
                    <div
                      key={key}
                      className={
                        today
                          ? 'bg-blue-500/[0.025]'
                          : ''
                      }
                    >
                      <button
                        onClick={() => {
                          setCursor(date);
                          setView('day');
                        }}
                        className="w-full border-b border-white/[0.05] px-3 py-3 text-center transition hover:bg-white/[0.02]"
                      >
                        <p className="text-[10px] uppercase text-slate-600">
                          {
                            dayNames[
                              (date.getDay() +
                                6) %
                                7
                            ]
                          }
                        </p>

                        <div
                          className={`
                            mx-auto mt-1
                            flex h-8 w-8
                            items-center
                            justify-center
                            rounded-full
                            text-sm
                            ${
                              today
                                ? 'bg-blue-600 font-semibold text-white'
                                : 'text-slate-300'
                            }
                          `}
                        >
                          {date.getDate()}
                        </div>
                      </button>

                      <div className="space-y-1 p-2">

                        {dayEvents.map(
                          event => (
                            <EventRow
                              key={event.id}
                              event={event}
                              compact
                            />
                          ),
                        )}

                        {dayEvents.length ===
                          0 && (
                          <p className="py-6 text-center text-[10px] text-slate-700">
                            —
                          </p>
                        )}

                      </div>
                    </div>
                  );
                })}

              </div>
            )}

            {/* =========================================
                DAY
            ========================================= */}

            {view === 'day' && (
              <div className="min-h-[420px] p-4 sm:p-5">

                {currentDayEvents.length >
                0 ? (
                  <div className="mx-auto max-w-4xl space-y-2">

                    {currentDayEvents.map(
                      event => (
                        <EventRow
                          key={event.id}
                          event={event}
                        />
                      ),
                    )}

                  </div>
                ) : (
                  <div className="flex min-h-[360px] flex-col items-center justify-center">

                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.035]">
                      <CalendarDays
                        size={21}
                        className="text-slate-600"
                      />
                    </div>

                    <p className="mt-3 text-sm font-medium text-slate-400">
                      Подій немає
                    </p>

                    <p className="mt-1 text-xs text-slate-600">
                      На цей день заявки не заплановані
                    </p>

                  </div>
                )}

              </div>
            )}
          </>
        )}
      </div>
    </PageHeader>
  );
}