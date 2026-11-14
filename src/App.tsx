import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Bell, LogOut, Search, Droplets, Volume2, ChevronRight } from 'lucide-react';

import { AppProvider } from '@/context/AppContext';
import ToastContainer from '@/components/ToastContainer';
import Sidebar from '@/components/Sidebar';
import GlobalSearchOverlay from '@/components/GlobalSearchOverlay';
import MobileNav from '@/components/MobileNav';
import NewApplicationModal from '@/components/NewApplicationModal';
import ApplicationWorkspace from '@/workspace/ApplicationWorkspace';
import ObjectProfile from '@/workspace/ObjectProfile';
import RPVCounter from '@/workspace/RPVCounter';
import { readRoute, routeSearch, pageLabel, type WorkspaceRoute } from '@/workspace/navigation';

import Today from '@/pages/Today';
import Dashboard from '@/pages/Dashboard';
import Applications from '@/pages/Applications';
import Contractors from '@/pages/Contractors';
import Customers from '@/portal/Customers';
import Acts from '@/pages/Acts';
import Payouts from '@/pages/Payouts';
import Statistics from '@/pages/Statistics';
import Administrators from '@/pages/Administrators';
import AuditLog from '@/pages/AuditLog';
import Notifications from '@/pages/Notifications';
import Settings from '@/pages/Settings';
import Problems from '@/pages/Problems';
import ObjectMap from '@/pages/ObjectMap';
import ControlCenter from '@/pages/ControlCenter';
import ContractorRating from '@/pages/ContractorRating';
import Calendar from '@/pages/Calendar';
import Finance from '@/pages/Finance';
import AutomationRules from '@/pages/AutomationRules';
import Archive from '@/pages/Archive';
import Login from '@/pages/Login';

import { supabase } from '@/lib/supabase';
import type { PageId } from '@/lib/permissions';

type ApplicationDashboardFilter =
  | 'all'
  | 'new'
  | 'accepted'
  | 'work'
  | 'done'
  | 'overdue'
  | 'today'
  | 'tomorrow';

type NewApplicationNotification = {
  id: string;
  number: string;
  object: string;
  address: string;
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState(() => readRoute(window.location.search));
  const currentPage = route.page;
  const [creating, setCreating] = useState(false);
  const changeRoute = useCallback((next: WorkspaceRoute, replace = false) => {
    const url = `${window.location.pathname}${routeSearch(next)}`;
    if (`${window.location.pathname}${window.location.search}` !== url) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
    }
    setRoute(next);
  }, []);
  const closeApplication = useCallback(() => {
    const current = readRoute(window.location.search);
    changeRoute({ ...current, application: undefined }, true);
  }, [changeRoute]);
  const closeRecord = () => changeRoute({ ...route, record: undefined }, true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [applicationFilter, setApplicationFilter] = useState<ApplicationDashboardFilter>('all');
  const [newApplication, setNewApplication] = useState<NewApplicationNotification | null>(null);
  const [unreadApplications, setUnreadApplications] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('rvp-audio-enabled') === '1');
  const notificationTimer = useRef<number | null>(null);
  const lastSeenApplicationId = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const openApplicationCenter = (applicationId: string) => {
    const id = String(applicationId || '').trim();
    if (!id) return;
    changeRoute({ ...readRoute(window.location.search), application: id });
    setUnreadApplications(0);
  };
  useEffect(() => {
    const onPopState = () => setRoute(readRoute(window.location.search));
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'RVP_PUSH_OPEN') return;
      const id = String(event.data?.application_id || '').trim();
      if (id) openApplicationCenter(id);
      else changeRoute({ page: 'notifications' });
    };
    window.addEventListener('popstate', onPopState);
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    return () => {
      window.removeEventListener('popstate', onPopState);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    };
  }, [changeRoute]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(value => !value);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const playNotificationSound = () => {
    if (localStorage.getItem('rvp-audio-enabled') !== '1') return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(740, ctx.currentTime);
      oscillator.frequency.setValueAtTime(940, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.4);
    } catch (error) {
      console.log('Sound error:', error);
    }
  };

  const showBrowserNotification = (application: NewApplicationNotification) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const notification = new Notification(`Нова заявка ${application.number}`, {
        body: application.object + (application.address ? `\n${application.address}` : ''),
      });
      notification.onclick = () => {
        window.focus();
        openApplicationCenter(application.id);
        notification.close();
      };
    } catch (error) {
      console.log('Notifications unavailable:', error);
    }
  };

  useEffect(() => {
    if (!session) return;

    const showApplicationAlert = (row: Record<string, any>) => {
      const id = String(row.id ?? '');
      if (!id || lastSeenApplicationId.current === id) return;

      lastSeenApplicationId.current = id;

      const application: NewApplicationNotification = {
        id,
        number: String(row.application_number || row.number || row.code || 'Нова'),
        object: String(row.title || row.object_name || row.object || row.station_name || 'Новий обʼєкт'),
        address: String(row.address || row.object_address || row.location || ''),
      };

      setNewApplication(application);
      setUnreadApplications(prev => prev + 1);
      playNotificationSound();
      showBrowserNotification(application);

      if (notificationTimer.current) {
        window.clearTimeout(notificationTimer.current);
      }
      notificationTimer.current = window.setTimeout(
        () => setNewApplication(null),
        15000,
      );
    };

    supabase
      .from('applications')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.id) lastSeenApplicationId.current = String(data.id);
      });

    const channel = supabase
      .channel('applications-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'applications' },
        payload => showApplicationAlert(payload.new as Record<string, any>),
      )
      .subscribe();

    const interval = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;

      const { data } = await supabase
        .from('applications')
        .select('id, application_number, title, address, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.id && lastSeenApplicationId.current && String(data.id) !== lastSeenApplicationId.current) {
        showApplicationAlert(data as Record<string, any>);
      } else if (data?.id && !lastSeenApplicationId.current) {
        lastSeenApplicationId.current = String(data.id);
      }
    }, 15000);

    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase
        .from('applications')
        .select('id, application_number, title, address, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.id && lastSeenApplicationId.current && String(data.id) !== lastSeenApplicationId.current) {
        showApplicationAlert(data as Record<string, any>);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (notificationTimer.current) window.clearTimeout(notificationTimer.current);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [session]);

  const enableSound = async () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') await ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
      }
      localStorage.setItem('rvp-audio-enabled', '1');
      setSoundEnabled(true);

      if ('Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch {}
      }
    } catch (error) {
      console.log('Enable sound error:', error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const navigateTo = (page: PageId, filter: ApplicationDashboardFilter = 'all') => {
    if (page === 'applications') {
      setApplicationFilter(filter);
      setUnreadApplications(0);
    }
    changeRoute({ page });
    if (window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openNewApplication = () => {
    if (newApplication?.id) openApplicationCenter(newApplication.id);
    else navigateTo('applications', 'all');
    setNewApplication(null);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'today': return <Today onNavigate={navigateTo} onNavigateToApplications={() => navigateTo('applications')} onOpenApplication={openApplicationCenter} onOpenAct={id => changeRoute({ page: 'acts', record: id })} onCreate={() => setCreating(true)} onOpenPayout={record => changeRoute({ page: 'payouts', record })} />;
      case 'dashboard': return <Dashboard onNavigate={navigateTo} />;
      case 'applications': return <Applications onOpenApplication={openApplicationCenter} dashboardFilter={applicationFilter} onDashboardFilterChange={setApplicationFilter} />;
      case 'contractors': return <Contractors initialId={route.record} onRecordClose={closeRecord} />;
      case 'customers': return <Customers key="managers" onOpenSite={site => changeRoute({ page: 'objects', site: site.id, network: site.passport_network || undefined })} />;
      case 'objects': return route.site ? <ObjectProfile key={route.site} id={route.site} onBack={() => changeRoute({ page: 'objects', network: route.network })} onOpenApplication={openApplicationCenter} onOpenAct={record => changeRoute({ page: 'acts', record })} /> : <Customers key="objects" mode="objects" initialNetwork={route.network} onNetworkChange={network => changeRoute({ page: 'objects', network: network || undefined }, true)} onOpenSite={site => changeRoute({ page: 'objects', network: site.passport_network || undefined, site: site.id })} />;
      case 'acts': return <Acts initialId={route.record} onRecordClose={closeRecord} />;
      case 'payouts': return <Payouts focusedApplication={route.record} onClearFocus={closeRecord} />;
      case 'statistics': return <Statistics />;
      case 'rpv-reports': return <div className="ws-page"><div className="ws-heading"><div><p className="ws-eyebrow">ОБСЯГИ ТА ІСТОРІЯ</p><h1>РПВ та звіти</h1><p>За мережею, регіоном або окремою АЗК.</p></div></div><RPVCounter /></div>;
      case 'administrators': return <Administrators />;
      case 'audit-log': return <AuditLog />;
      case 'notifications': return <Notifications onNavigateToApplications={() => navigateTo('applications')} onNavigateToActs={() => navigateTo('acts')} onNavigateToPayouts={() => navigateTo('payouts')} />;
      case 'settings': return <Settings />;
      case 'problems': return <Problems onNavigateToApplications={() => navigateTo('applications')} />;
      case 'object-map': return <ObjectMap />;
      case 'control-center': return <ControlCenter onNavigateToApplication={() => navigateTo('applications')} />;
      case 'contractor-rating': return <ContractorRating />;
      case 'calendar': return <Calendar onNavigateToApplications={() => navigateTo('applications')} />;
      case 'finance': return <Finance onNavigateToPayouts={() => navigateTo('payouts')} />;
      case 'automation': return <AutomationRules />;
      case 'archive': return <Archive onNavigateToApplications={() => navigateTo('applications')} />;
      default: return <Today onNavigateToApplications={() => navigateTo('applications')} />;
    }
  };

  if (authLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-[#071526]"><div className="text-sm text-slate-400">Завантаження...</div></div>;
  }

  if (!session) return <Login />;

  return (
    <AppProvider>
      <div className="min-h-[100dvh] ws-shell text-slate-100 lg:flex">
        <div className="hidden lg:block">
          <Sidebar
            currentPage={currentPage}
            onNavigate={navigateTo}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </div>

        <div className="min-w-0 w-full flex-1">
          <header className="ws-topbar">
            <div className="flex min-w-0 items-center gap-2.5 lg:hidden"><span className="ws-logo" style={{ width: 34, height: 34, borderRadius: 10 }}><Droplets size={20} /></span><div><b className="text-sm tracking-tight">RPV Control<span className="ws-brand-dot">.</span></b><p className="text-[9px] tracking-[1.5px] text-sky-300/70">CONTROL SYSTEM</p></div></div>
            <div className="ws-topbar-path hidden lg:flex"><span>Робочий простір</span><ChevronRight size={13} /><b>{pageLabel(currentPage)}</b></div>
            <div className="ws-topbar-actions"><button onClick={() => setSearchOpen(true)} aria-label="Пошук"><Search size={17} /><span className="hidden sm:inline">Знайти заявку, виконавця…</span></button>{!soundEnabled && <button onClick={enableSound} title="Увімкнути звук сповіщень" aria-label="Увімкнути звук сповіщень"><Volume2 size={17} /></button>}<button className="relative" onClick={() => navigateTo('notifications')} aria-label="Сповіщення"><Bell size={17} />{unreadApplications > 0 && <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-orange-400" />}</button><span className="ws-avatar hidden md:grid" title={session.user.email}>{(session.user.email || 'RP').slice(0, 2).toUpperCase()}</span></div>
          </header>

          <main className="min-w-0 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0">{renderPage()}</main>
        </div>

        <MobileNav currentPage={currentPage} onNavigate={navigateTo} onOpenMore={() => navigateTo('settings')} />

        {searchOpen && <GlobalSearchOverlay onClose={() => setSearchOpen(false)} onNavigate={(page, id) => { setSearchOpen(false); if (page === 'applications' && id) openApplicationCenter(id); else changeRoute({ page, record: id }); }} />}
        {route.application && <ApplicationWorkspace key={route.application} id={route.application} onClose={closeApplication} onOpenSite={site => changeRoute({ page: 'objects', site })} onOpenAct={record => changeRoute({ page: 'acts', record })} onPayouts={() => changeRoute({ page: 'payouts', record: route.application })} />}
        {creating && <NewApplicationModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); navigateTo('applications'); }} />}

        {newApplication && (
          <div className="fixed left-3 right-3 top-[74px] z-[9999] overflow-hidden rounded-[22px] border border-cyan-400/20 bg-[#0b1622]/95 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:left-auto sm:right-6 sm:w-[390px]">
            <div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400" />
            <div className="p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-xl">🔔</div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">Нова заявка</p>
                  <p className="mt-1 text-lg font-bold text-cyan-400">{newApplication.number}</p>
                  <p className="mt-1 truncate text-white">{newApplication.object}</p>
                  {newApplication.address && <p className="mt-1 line-clamp-2 text-sm text-slate-400">📍 {newApplication.address}</p>}
                </div>
                <button onClick={() => setNewApplication(null)} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white">✕</button>
              </div>
              <button onClick={openNewApplication} className="mt-4 w-full rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-[#061018] transition hover:bg-cyan-400">Відкрити центр дій</button>
            </div>
          </div>
        )}
      </div>

      <ToastContainer />
    </AppProvider>
  );
}

export default App;
