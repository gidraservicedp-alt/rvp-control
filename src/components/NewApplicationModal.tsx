import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Clipboard, Sparkles, Search } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { insertApplication } from '@/lib/applicationsApi';
import { fetchActiveContractors, type ContractorListItem } from '@/lib/contractorsApi';
import type { Site } from '@/portal/api';
import ExistingSitePicker from './ExistingSitePicker';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface FormState {
  siteId: string;
  description: string;
  contractorId: string;
  deadline: string;
  managerComment: string;
  payoutAmount: string;
}

const empty: FormState = {
  siteId: '',
  description: '',
  contractorId: '',
  deadline: '',
  managerComment: '',
  payoutAmount: '',
};

function Field({
  label, required, children, error,
}: {
  label: string; required?: boolean; children: React.ReactNode; error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-400">
        {label}{required && <span className="text-red-400"> *</span>}
      </label>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition';

function parseOrderCard(text: string): Partial<FormState> {
  const result: Partial<FormState> = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return result;

  const dateMatch = text.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (dateMatch) {
    const [, d, m, y] = dateMatch;
    result.deadline = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const descMatch = text.match(/Викачка\s+(.+)/i) || text.match(/Прибиранн[я]\s+(.+)/i);
  if (descMatch) result.description = descMatch[1].trim();
  else {
    const nonMetaLines = lines.filter(l =>
      !l.toLowerCase().includes('заявка на') &&
      !l.toLowerCase().includes('азс') &&
      !l.toLowerCase().includes('азк') &&
      !l.match(/^\d{1,2}[.\/]\d{1,2}[.\/]\d{4}/) &&
      !l.toLowerCase().includes('область') &&
      !l.toLowerCase().includes('р-н')
    );
    if (nonMetaLines.length > 0 && !result.description) result.description = nonMetaLines.join(' ');
  }

  return result;
}

export default function NewApplicationModal({ onClose, onCreated }: Props) {
  const { showToast } = useApp();
  const [contractors, setContractors] = useState<ContractorListItem[]>([]);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [submitError, setSubmitError] = useState('');
  const request = useRef(crypto.randomUUID()), pending = useRef(false);
  const [orderCardText, setOrderCardText] = useState('');
  const [showOrderCard, setShowOrderCard] = useState(false);
  const [contractorSearch, setContractorSearch] = useState('');

  useEffect(() => {
    fetchActiveContractors().then(setContractors).catch(() => setContractors([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  const handleParseOrderCard = () => {
    if (!orderCardText.trim()) {
      showToast('Вставте текст карточки заказа', 'info');
      return;
    }
    const parsed = parseOrderCard(orderCardText);
    setForm(prev => ({
      ...prev,
      description: parsed.description ?? prev.description,
      deadline: parsed.deadline ?? prev.deadline,
    }));
    setErrors(prev => ({...prev,
      description: parsed.description ? undefined : prev.description,
      deadline: parsed.deadline ? undefined : prev.deadline,
    }));
    showToast('Опис і дата заповнені. Оберіть АЗК зі списку.', 'success');
    setShowOrderCard(false);
    setOrderCardText('');
  };

  const filteredContractors = useMemo(() => {
    if (!contractorSearch.trim()) return contractors;
    const q = contractorSearch.toLowerCase().trim();
    const digits = q.replace(/\D/g, '');
    return contractors.filter(c => {
      const name = c.name.toLowerCase();
      const username = (c.username ?? '').toLowerCase();
      const phoneDigits = (c.phone ?? '').replace(/\D/g, '');
      const phoneMatch = digits.length > 0 && phoneDigits.includes(digits);
      return name.includes(q) || username.includes(q) || phoneMatch;
    });
  }, [contractors, contractorSearch]);

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!selectedSite || selectedSite.id !== form.siteId) e.siteId = 'Оберіть мережу та АЗК зі списку';
    if (!form.description.trim()) e.description = 'Опишіть роботу';
    if (!form.contractorId) e.contractorId = 'Оберіть підрядника';
    if (!form.deadline) e.deadline = 'Оберіть дедлайн';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (pending.current || !validate()) return;
    pending.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const payout = parseInt(form.payoutAmount.replace(/\D/g, ''), 10) || 0;
      const result = await insertApplication({
        requestId: request.current,
        customerSiteId: form.siteId,
        description: form.description.trim(),
        deadlineAt: form.deadline,
        managerComment: form.managerComment.trim(),
        contractorId: form.contractorId,
        payoutAmount: payout,
      });
      showToast(`Заявку ${result.application_number} збережено в історії об’єкта`, 'success');
      if (result.notificationSent === false) showToast('Заявку збережено. Сповіщення в Telegram не доставлено — зв’яжіться з виконавцем.', 'error');
      onCreated();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка створення заявки';
      setSubmitError(msg);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!pending.current) onClose(); }} />
      <div role="dialog" aria-modal="true" aria-labelledby="new-application-title" className="relative bg-[#141720] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[#141720] border-b border-white/5 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 id="new-application-title" className="text-base font-semibold text-white">Нова заявка</h2>
            <p className="text-xs text-slate-500 mt-0.5">Оберіть АЗК і вкажіть потрібні роботи</p>
          </div>
          <button onClick={onClose} disabled={submitting} aria-label="Закрити форму" className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <fieldset disabled={submitting} className="p-6 space-y-5 min-w-0">
          <ExistingSitePicker value={selectedSite} error={errors.siteId} onChange={site => {
            setSelectedSite(site); set('siteId', site?.id || '');
          }} />

          {/* Order card auto-parse */}
          {!showOrderCard ? (
            <button
              onClick={() => setShowOrderCard(true)}
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors w-full bg-blue-500/5 border border-blue-500/10 rounded-lg px-4 py-3"
            >
              <Clipboard size={15} /> Вставити опис і дату
            </button>
          ) : (
            <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-blue-400" />
                <span className="text-sm font-medium text-slate-300">Опис і дата з тексту заявки</span>
              </div>
              <textarea
                value={orderCardText}
                onChange={e => setOrderCardText(e.target.value)}
                aria-label="Текст заявки"
                placeholder="Вставте опис робіт і дату. Об’єкт обирається зі списку вище."
                rows={5}
                className={`${inputCls} resize-none`}
              />
              <div className="flex items-center gap-2">
                <button onClick={handleParseOrderCard} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                  <Sparkles size={14} /> Заповнити поля
                </button>
                <button onClick={() => { setShowOrderCard(false); setOrderCardText(''); }} className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors">
                  Скасувати
                </button>
              </div>
            </div>
          )}

          <Field label="Потреба / опис робіт" required error={errors.description}>
            <textarea aria-label="Потреба / опис робіт" maxLength={2000} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Опишіть обсяг та тип робіт..." rows={3} className={`${inputCls} resize-none`} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Підрядник" required error={errors.contractorId}>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-500" />
                <input
                  value={contractorSearch}
                  onChange={e => setContractorSearch(e.target.value)}
                  placeholder="Пошук: ім'я, телефон, username..."
                  className={`${inputCls} pl-9 mb-2`}
                />
                <select aria-label="Підрядник" value={form.contractorId} onChange={e => set('contractorId', e.target.value)} className={inputCls}>
                  <option value="">Оберіть підрядника</option>
                  {filteredContractors.map(c => (
                    <option key={c.id} value={c.id}>{c.name} — {c.phone ?? '—'} — {c.regionName ?? '—'}</option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Дедлайн" required error={errors.deadline}>
              <input aria-label="Дедлайн" type="date" min="2000-01-01" max="2100-12-31" value={form.deadline} onChange={e => set('deadline', e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Коментар менеджера">
            <textarea aria-label="Коментар менеджера" maxLength={2000} value={form.managerComment} onChange={e => set('managerComment', e.target.value)} placeholder="Додаткові примітки..." rows={2} className={`${inputCls} resize-none`} />
          </Field>

          <Field label="Сума виплати">
            <div className="relative">
              <input aria-label="Сума виплати" inputMode="numeric" maxLength={8} value={form.payoutAmount} onChange={e => set('payoutAmount', e.target.value.replace(/[^\d]/g, ''))} placeholder="0" className={`${inputCls} pr-10`} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">₴</span>
            </div>
          </Field>
        </fieldset>
        {submitError && <p role="alert" className="px-6 pb-4 text-sm text-red-300">{submitError}</p>}

        <div className="sticky bottom-0 bg-[#141720] border-t border-white/5 px-6 py-4 flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors">
            Скасувати
          </button>
          <button onClick={handleSubmit} disabled={submitting} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {submitting && <Loader2 size={15} className="animate-spin" />}
            Створити заявку
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
