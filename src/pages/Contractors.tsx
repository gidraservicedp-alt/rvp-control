import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Phone, Send, BarChart2, CheckCircle, X,
  Trash2, Power, Loader2, AlertCircle, RefreshCw, Pencil, Hash, MapPin, Calendar, ShieldCheck,
} from 'lucide-react';
import FinanceWorkspace from '@/workspace/FinanceWorkspace';
import StatusBadge from '@/components/StatusBadge';
import PageHeader from '@/components/PageHeader';
import NewContractorModal from '@/components/NewContractorModal';
import EditContractorModal from '@/components/EditContractorModal';
import DeleteContractorModal from '@/components/DeleteContractorModal';
import { useApp } from '@/context/AppContext';
import {
  fetchContractors, fetchContractorApplications,
  setContractorStatus, setContractorAdmin, type ContractorListItem, type ContractorApplication,
} from '@/lib/contractorsApi';
import {
  formatCurrency, formatDate, getContractorStatusColor, getApplicationStatusColor,
  normalizeStatus, contractorStatusLabel,
} from '@/utils/helpers';

function ContractorProfileModal({
  contractor,
  onClose,
  onEdit,
  onToggle,
  onToggleAdmin,
  adminUpdating,
  onDelete,
}: {
  contractor: ContractorListItem;
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onToggleAdmin: () => void;
  adminUpdating: boolean;
  onDelete: () => void;
}) {
  const [apps, setApps] = useState<ContractorApplication[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [appsError,setAppsError]=useState('');
  const [financeVersion,setFinanceVersion]=useState(0);
  useEffect(()=>{const update=()=>setFinanceVersion(v=>v+1);window.addEventListener('rpv-finance-updated',update);return()=>window.removeEventListener('rpv-finance-updated',update);},[]);

  useEffect(() => {
    setLoadingApps(true);setAppsError('');
    fetchContractorApplications(contractor.id)
      .then(setApps)
      .catch(e => setAppsError(e.message))
      .finally(() => setLoadingApps(false));
  }, [contractor.id,financeVersion]);

  const activeApps = apps.filter(a => {
    const s = normalizeStatus(a.status);
    return s !== 'Виконана' && s !== 'Скасована';
  }).length;
  const completedApps = apps.filter(a => normalizeStatus(a.status) === 'Виконана').length;

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-h-[92dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#141720] shadow-2xl sm:max-w-2xl sm:rounded-2xl sm:max-h-[90vh]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-[#141720] px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 font-semibold text-sm">
              {contractor.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{contractor.name}</p>
              <StatusBadge label={contractorStatusLabel(contractor.status)} className={getContractorStatusColor(contractor.status)} />
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:space-y-6 sm:p-6">
          {/* Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white/[0.03] rounded-xl p-4 flex items-center gap-3">
              <Phone size={16} className="text-slate-500" />
              <div>
                <p className="text-xs text-slate-500">Телефон</p>
                <a href={`tel:${contractor.phone ?? ''}`} className="text-sm text-blue-400 hover:underline">{contractor.phone ?? '—'}</a>
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-4 flex items-center gap-3">
              <Send size={16} className="text-slate-500" />
              <div>
                <p className="text-xs text-slate-500">Telegram</p>
                <span className="text-sm text-slate-200">{contractor.username ?? '—'}</span>
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-4 flex items-center gap-3">
              <Hash size={16} className="text-slate-500" />
              <div>
                <p className="text-xs text-slate-500">Telegram ID</p>
                <span className="text-sm text-slate-200 font-mono">{contractor.telegramId ?? '—'}</span>
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-4 flex items-center gap-3">
              <MapPin size={16} className="text-slate-500" />
              <div>
                <p className="text-xs text-slate-500">Регіон</p>
                <span className="text-sm text-slate-200">{contractor.regionName ?? '—'}</span>
              </div>
            </div>
            <div className="col-span-2 bg-white/[0.03] rounded-xl p-4 flex items-center gap-3">
              <Calendar size={16} className="text-slate-500" />
              <div>
                <p className="text-xs text-slate-500">Дата додання</p>
                <span className="text-sm text-slate-200">{contractor.createdAt ? formatDate(contractor.createdAt) : '—'}</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-4 text-center">
              <BarChart2 size={18} className="text-blue-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{apps.length}</p>
              <p className="text-xs text-slate-500">Всього заявок</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-4 text-center">
              <AlertCircle size={18} className="text-amber-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{activeApps}</p>
              <p className="text-xs text-slate-500">Активні</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-4 text-center">
              <CheckCircle size={18} className="text-emerald-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{completedApps}</p>
              <p className="text-xs text-slate-500">Виконано</p>
            </div>
          </div>
          <FinanceWorkspace contractor={contractor.id} compact />

          {/* Telegram admin access */}
          <div className="bg-white/[0.03] rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                contractor.isAdmin
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'bg-white/5 text-slate-500'
              }`}>
                <ShieldCheck size={19} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">Адмін-панель Telegram</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {contractor.isAdmin
                    ? 'Підрядник має доступ до адмін-панелі бота'
                    : 'Підрядник працює тільки у звичайному режимі'}
                </p>
              </div>
            </div>

            <button
              onClick={onToggleAdmin}
              disabled={adminUpdating}
              className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                contractor.isAdmin
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-violet-500/10 text-violet-400 hover:bg-violet-500/20'
              }`}
            >
              {adminUpdating
                ? 'Збереження…'
                : contractor.isAdmin
                  ? 'Забрати доступ'
                  : 'Надати доступ'}
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={onEdit}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              <Pencil size={15} /> Редагувати
            </button>
            <button
              onClick={onToggle}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                contractor.status === 'active'
                  ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              }`}
            >
              <Power size={15} />
              {contractor.status === 'active' ? 'Деактивувати' : 'Активувати'}
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-600/10 text-red-400 hover:bg-red-600/20 transition-colors"
            >
              <Trash2 size={15} /> Видалити
            </button>
          </div>

          {/* Applications */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Заявки підрядника</h3>
            {loadingApps ? (
              <div className="flex items-center justify-center gap-2 text-slate-500 py-6">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Завантаження заявок…</span>
              </div>
            ) : appsError ? (<p role="alert" className="text-red-400">{appsError}</p>) : apps.length === 0 ? (
              <p className="text-sm text-slate-500">Заявок немає</p>
            ) : (
              <div className="space-y-2">
                {apps.map(app => (
                  <div key={app.id} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-4 py-3">
                    <div>
                      <span className="font-mono text-xs text-blue-400">{app.number}</span>
                      <p className="text-sm text-slate-300 mt-0.5 truncate max-w-[250px]">{app.customer}</p>
                      <p className="text-xs text-slate-500">{formatDate(app.date)}</p>{app.status==='completed'&&<a className="text-xs text-sky-300" href={`?page=payouts&record=${app.id}`}>{app.payoutStatus==='paid'?'Виплачено · історія':'Не оплачено · розрахунок'}</a>}
                    </div>
                    <div className="text-right">
                      <StatusBadge label={normalizeStatus(app.status)} className={getApplicationStatusColor(normalizeStatus(app.status))} />
                      <p className="text-sm font-medium text-slate-200 mt-1">{app.amountKnown?formatCurrency(app.amount):'Суму не вказано'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function Contractors({ initialId, onRecordClose }: { initialId?: string; onRecordClose?: () => void }) {
  const { showToast } = useApp();
  const [contractors, setContractors] = useState<ContractorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContractorListItem | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [toDelete, setToDelete] = useState<ContractorListItem | null>(null);
  const [toEdit, setToEdit] = useState<ContractorListItem | null>(null);
  const [adminUpdating, setAdminUpdating] = useState(false);

  useEffect(() => { if (!initialId) setSelected(null); }, [initialId]);
  useEffect(() => {
    if (initialId && contractors.length) setSelected(contractors.find(c => c.id === initialId) || null);
  }, [initialId, contractors]);
  const loadContractors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContractors();
      setContractors(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка завантаження підрядників';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadContractors();
  }, [loadContractors]);

  useEffect(()=>{const update=()=>void loadContractors();window.addEventListener('rpv-finance-updated',update);return()=>window.removeEventListener('rpv-finance-updated',update);},[loadContractors]);

  const handleToggleFromRow = async (e: React.MouseEvent, c: ContractorListItem) => {
    e.stopPropagation();
    const newStatus = c.status === 'active' ? 'inactive' : 'active';
    try {
      await setContractorStatus(c.id, newStatus);
      showToast(newStatus === 'active' ? 'Підрядника активовано' : 'Підрядника деактивовано', 'success');
      loadContractors();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка зміни статусу';
      showToast(msg, 'error');
    }
  };

  const handleToggleFromProfile = async () => {
    if (!selected) return;
    const newStatus = selected.status === 'active' ? 'inactive' : 'active';
    try {
      await setContractorStatus(selected.id, newStatus);
      showToast(newStatus === 'active' ? 'Підрядника активовано' : 'Підрядника деактивовано', 'success');
      await loadContractors();
      const updated = contractors.find(c => c.id === selected.id);
      if (updated) setSelected({ ...updated, status: newStatus });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка зміни статусу';
      showToast(msg, 'error');
    }
  };

  const handleToggleAdmin = async () => {
    if (!selected || adminUpdating) return;

    const newValue = !selected.isAdmin;
    setAdminUpdating(true);

    try {
      await setContractorAdmin(selected.id, newValue);

      setSelected(current =>
        current
          ? { ...current, isAdmin: newValue }
          : current,
      );

      setContractors(current =>
        current.map(c =>
          c.id === selected.id
            ? { ...c, isAdmin: newValue }
            : c,
        ),
      );

      showToast(
        newValue
          ? 'Адмін-доступ у Telegram надано'
          : 'Адмін-доступ у Telegram забрано',
        'success',
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Помилка зміни адмін-доступу';

      showToast(msg, 'error');
    } finally {
      setAdminUpdating(false);
    }
  };

  return (
    <>
      <PageHeader
        pageTitle="Виконавці"
        pageSubtitle={`${contractors.length} підрядників`}
        actions={
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Додати підрядника
          </button>
        }
      >
        <div className="md:hidden space-y-3" data-mobile-contractors>
          {loading ? (
            <div className="rounded-2xl border border-white/5 bg-[#141720] py-10 text-center">
              <Loader2 size={20} className="mx-auto animate-spin text-slate-500" />
              <p className="mt-2 text-sm text-slate-500">Завантаження підрядників…</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/10 bg-[#141720] p-5 text-center">
              <AlertCircle size={22} className="mx-auto text-red-400" />
              <p className="mt-2 text-sm text-red-400">{error}</p>
              <button
                onClick={loadContractors}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300"
              >
                <RefreshCw size={14} />
                Оновити
              </button>
            </div>
          ) : contractors.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-[#141720] py-10 text-center text-sm text-slate-500">
              Підрядників поки немає
            </div>
          ) : (
            contractors.map((c) => {
              const percent =
                c.totalApplications > 0
                  ? Math.round((c.completedApplications / c.totalApplications) * 100)
                  : 0;

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className="w-full rounded-2xl border border-white/5 bg-[#141720] p-4 text-left shadow-[0_10px_30px_rgba(0,0,0,0.16)] active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600/15 text-sm font-bold text-blue-400">
                      {c.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-white">{c.name}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {c.regionName || 'Регіон не вказано'}
                          </p>
                        </div>
                        <StatusBadge
                          label={contractorStatusLabel(c.status)}
                          className={getContractorStatusColor(c.status)}
                        />
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/[0.025] p-2.5">
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Заявок</p>
                          <p className="mt-1 text-sm font-semibold text-slate-200">{c.totalApplications}</p>
                        </div>
                        <div className="rounded-xl bg-white/[0.025] p-2.5">
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Виконано</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-400">{percent}%</p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-sky-800 p-3"><p className="text-xs text-sky-200">Борг до виплати</p><b>{formatCurrency(c.debt)}</b><p className="text-xs text-orange-300">{c.pendingPayoutCount} не оплачені · {c.missingAmountCount} без суми</p></div>
                      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-slate-500">{c.phone || 'Телефон не вказано'}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-600">{c.username || 'Telegram не вказано'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Виплати</p>
                          <p className="mt-0.5 text-sm font-semibold text-white">
                            {(c.totalPayout ?? 0).toLocaleString('uk-UA')} ₴
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="hidden md:block bg-[#141720] border border-white/5 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto mobile-no-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  {['ПІБ', 'Телефон', 'Telegram', 'Статус', 'Регіон', 'Заявок', 'Виконано', 'Виплачено / борг', 'Дії'].map(h => (
                    <th key={h} className="text-left text-xs text-slate-500 font-medium px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <div className="flex items-center justify-center gap-2 text-slate-500">
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-sm">Завантаження підрядників…</span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-500">
                        <AlertCircle size={24} className="text-red-400" />
                        <span className="text-sm text-red-400">{error}</span>
                        <button
                          onClick={loadContractors}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
                        >
                          <RefreshCw size={14} /> Спробувати знову
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : contractors.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-500">
                      Підрядників не знайдено
                    </td>
                  </tr>
                ) : contractors.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer ${
                      i === contractors.length - 1 ? 'border-0' : ''
                    }`}
                    onClick={() => setSelected(c)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 text-xs font-semibold shrink-0">
                          {c.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
                        </div>
                        <span className="font-medium text-slate-200">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-400 whitespace-nowrap">{c.phone ?? '—'}</td>
                    <td className="px-5 py-4 text-slate-400">{c.username ?? '—'}</td>
                    <td className="px-5 py-4">
                      <StatusBadge label={contractorStatusLabel(c.status)} className={getContractorStatusColor(c.status)} />
                    </td>
                    <td className="px-5 py-4 text-slate-400">{c.regionName ?? '—'}</td>
                    <td className="px-5 py-4 text-center text-slate-200 font-medium">{c.totalApplications}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-200 font-medium">{c.completedApplications}</span>
                        <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${c.totalApplications > 0 ? (c.completedApplications / c.totalApplications) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {c.totalApplications > 0 ? Math.round((c.completedApplications / c.totalApplications) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-200 font-medium whitespace-nowrap">
                      {formatCurrency(c.totalPayout)}<p className="text-sky-300">Борг: {formatCurrency(c.debt)}</p>{c.missingAmountCount>0&&<small className="text-orange-300">{c.missingAmountCount} без суми</small>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); setSelected(c); }}
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors px-2 py-1"
                        >
                          Профіль
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setToEdit(c); }}
                          className="p-1.5 rounded-md text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                          title="Редагувати"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={e => handleToggleFromRow(e, c)}
                          className={`p-1.5 rounded-md transition-colors ${
                            c.status === 'active'
                              ? 'text-amber-400 hover:bg-amber-400/10'
                              : 'text-emerald-400 hover:bg-emerald-400/10'
                          }`}
                          title={c.status === 'active' ? 'Деактивувати' : 'Активувати'}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setToDelete(c); }}
                          className="p-1.5 rounded-md text-red-400 hover:bg-red-400/10 transition-colors"
                          title="Видалити"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageHeader>

      {selected && (
        <ContractorProfileModal
          contractor={selected}
          onClose={() => { setSelected(null); onRecordClose?.(); }}
          onEdit={() => { setToEdit(selected); }}
          onToggle={handleToggleFromProfile}
          onToggleAdmin={handleToggleAdmin}
          adminUpdating={adminUpdating}
          onDelete={() => { setToDelete(selected); }}
        />
      )}

      {showNewModal && (
        <NewContractorModal
          onClose={() => setShowNewModal(false)}
          onCreated={loadContractors}
        />
      )}

      {toEdit && (
        <EditContractorModal
          contractor={toEdit}
          onClose={() => setToEdit(null)}
          onSaved={loadContractors}
        />
      )}

      {toDelete && (
        <DeleteContractorModal
          contractor={toDelete}
          onCancel={() => setToDelete(null)}
          onDone={loadContractors}
        />
      )}
    </>
  );
}
