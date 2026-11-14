import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MapPin, RefreshCw, User } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { resolveApplicationProblem } from '@/lib/operationsApi';

type ProblemRow = {
  id: string;
  application_number: string | null;
  title: string | null;
  description: string | null;
  address: string | null;
  deadline_at: string | null;
  manager_comment: string | null;
  contractor_stage: string | null;
  has_problem: boolean | null;
  problem_comment: string | null;
  updated_at: string | null;
  contractor: { first_name: string | null; last_name: string | null; phone: string | null } | null;
};

interface Props {
  onNavigateToApplications?: () => void;
}

export default function Problems({ onNavigateToApplications }: Props) {
  const { showToast } = useApp();
  const [items, setItems] = useState<ProblemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('applications')
      .select(`
        id, application_number, title, description, address, deadline_at,
        manager_comment, contractor_stage, has_problem, problem_comment, updated_at,
        contractor:contractors(first_name,last_name,phone)
      `)
      .or('has_problem.eq.true,contractor_stage.eq.problem')
      .order('updated_at', { ascending: false });

    if (error) showToast(`Не вдалося завантажити проблеми: ${error.message}`, 'error');
    setItems((data ?? []) as unknown as ProblemRow[]);
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('problem-applications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const resolve = async (item: ProblemRow) => {
    setResolving(item.id);
    try {
      await resolveApplicationProblem(item.id);
      setItems((rows) => rows.filter((row) => row.id !== item.id));
      showToast('Проблему позначено як вирішену', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не вдалося закрити проблему', 'error');
    } finally {
      setResolving(null);
    }
  };

  return (
    <PageHeader pageTitle="Проблемні заявки" pageSubtitle={`${items.length} активних проблем`}
      actions={<div className="flex gap-2"><button onClick={load} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"><RefreshCw size={14}/>Оновити</button>{onNavigateToApplications&&<button onClick={onNavigateToApplications} className="hidden rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 sm:block">Усі заявки</button>}</div>}>
      {loading ? (
        <div className="flex justify-center py-20 text-slate-500"><Loader2 className="animate-spin" size={18}/></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.04] py-20 text-center">
          <CheckCircle2 size={30} className="mx-auto text-emerald-400"/>
          <p className="mt-4 text-sm font-medium text-slate-200">Активних проблем немає</p>
          <p className="mt-1 text-xs text-slate-500">Проблеми з Центру дій або від підрядника автоматично зʼявляться тут.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map(item => {
            const contractorName = [item.contractor?.first_name, item.contractor?.last_name].filter(Boolean).join(' ') || '—';
            const problemText = item.problem_comment || item.manager_comment || item.description;
            return (
              <div key={item.id} className="rounded-2xl border border-red-500/10 bg-[#141821] p-5">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                    <AlertTriangle size={19}/>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-red-400"><bdi className="rpv-application-number">{item.application_number || '—'}</bdi></span>
                      <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400">ПРОБЛЕМА</span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-white">{item.title || 'Заявка'}</h3>
                    {problemText && <p className="mt-2 rounded-xl bg-red-500/[0.05] p-3 text-sm text-red-100/80">{problemText}</p>}
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5"><MapPin size={13}/>{item.address || '—'}</span>
                      <span className="flex items-center gap-1.5"><User size={13}/>{contractorName} · {item.contractor?.phone || '—'}</span>
                    </div>
                  </div>
                  <button disabled={resolving === item.id} onClick={() => resolve(item)}
                    className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                    {resolving === item.id ? <Loader2 size={15} className="animate-spin"/> : <CheckCircle2 size={15}/>}
                    Вирішено
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageHeader>
  );
}
