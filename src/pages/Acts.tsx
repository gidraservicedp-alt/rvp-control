import WorkVolumeEditor from '@/workspace/WorkVolumeEditor';
import { hasWorkVolume } from '@/workspace/workVolume';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, FileText, Image as ImageIcon, Loader2, AlertCircle,
  RefreshCw, User, MapPin, FileCheck, Calendar, Phone,
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, AlertTriangle, Hash,
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import PageHeader from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { fetchActs, updateActStatus, type ActItem, type ActFile, type ActStatus } from '@/lib/actsApi';
import { formatDate, formatDateTime, getActStatusColor, actStatusLabel } from '@/utils/helpers';

function TelegramImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');

  return (
    <>
      {state !== 'loaded' && (
        <div className={`absolute inset-0 flex items-center justify-center bg-white/[0.02] ${className ?? ''}`}>
          {state === 'loading' ? (
            <Loader2 size={24} className="text-slate-600 animate-spin" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-slate-600">
              <ImageIcon size={24} />
              <span className="text-xs">Фото недоступне</span>
            </div>
          )}
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`${className ?? ''} ${state === 'loaded' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
      />
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 break-words">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

function isImageFile(file: ActFile): boolean {
  const type = (file.fileType ?? '').toLowerCase();
  const name = (file.fileName ?? '').toLowerCase();

  return (
    type === 'photo' ||
    type === 'image' ||
    type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name)
  );
}

function FileGallery({ files }: { files: ActFile[] }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const photoFiles = files.filter(isImageFile);
  const otherFiles = files.filter(file => !isImageFile(file));

  useEffect(() => {
    setViewerIndex(null);
  }, [files]);

  useEffect(() => {
    if (viewerIndex === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewerIndex(null);
      }

      if (event.key === 'ArrowLeft' && photoFiles.length > 1) {
        setViewerIndex(index => {
          if (index === null) return null;
          return (index - 1 + photoFiles.length) % photoFiles.length;
        });
      }

      if (event.key === 'ArrowRight' && photoFiles.length > 1) {
        setViewerIndex(index => {
          if (index === null) return null;
          return (index + 1) % photoFiles.length;
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewerIndex, photoFiles.length]);

  if (photoFiles.length === 0 && otherFiles.length === 0) {
    return <p className="text-sm text-slate-500">Файлів немає</p>;
  }

  const activePhoto = viewerIndex === null ? null : photoFiles[viewerIndex];

  return (
    <>
      <div className="space-y-2">
        {photoFiles.map((file, index) => (
          <button
            type="button"
            key={file.id}
            onClick={() => {
              setViewerIndex(index);
            }}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-left transition-colors hover:border-blue-500/30 hover:bg-white/[0.06]"
            title="Відкрити фото"
          >
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
              <TelegramImage
                src={file.url}
                alt={file.fileName ?? `Фото ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-200 group-hover:text-white">
                {file.fileName ?? `Фото ${index + 1}`}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                фото · {formatDate(file.createdAt)}
              </p>
            </div>

            <span className="shrink-0 text-xs font-medium text-blue-400">
              Переглянути
            </span>
          </button>
        ))}

        {otherFiles.map(file => (
          <a
            key={file.id}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 transition-colors hover:border-blue-500/20 hover:bg-white/[0.06]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
              <FileText size={18} className="text-slate-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-200">{file.fileName ?? 'Без назви'}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDate(file.createdAt)}
              </p>
            </div>
          </a>
        ))}
      </div>

      {activePhoto && createPortal(
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Закрити перегляд фото"
            className="absolute inset-0 cursor-default bg-black/85 backdrop-blur-sm"
            onClick={() => setViewerIndex(null)}
          />

          <div className="relative z-10 flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1018] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">
                  {activePhoto.fileName ?? 'Фото акта'}
                </p>
                <p className="text-xs text-slate-500">
                  {viewerIndex! + 1} / {photoFiles.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewerIndex(null)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Закрити"
              >
                <X size={20} />
              </button>
            </div>

            <div className="relative min-h-0 flex-1 bg-black/30">
              <TelegramImage
                src={activePhoto.url}
                alt={activePhoto.fileName ?? 'Фото акта'}
                className="h-full w-full object-contain"
              />

              {photoFiles.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setViewerIndex(index => index === null ? 0 : (index - 1 + photoFiles.length) % photoFiles.length)}
                    className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                    aria-label="Попереднє фото"
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewerIndex(index => index === null ? 0 : (index + 1) % photoFiles.length)}
                    className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                    aria-label="Наступне фото"
                  >
                    <ChevronRight size={24} />
                  </button>
                </>
              )}
            </div>

            <div className="flex justify-end border-t border-white/10 px-4 py-3">
              <button
                type="button"
                onClick={() => setViewerIndex(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/15"
              >
                Закрити
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function ActDetailModal({
  act,
  onClose,
  onStatusChange,
}: {
  act: ActItem;
  onClose: () => void;
  onStatusChange: (actId: string, status: ActStatus, reason?:string) => Promise<void>;
}) {
  const { showToast } = useApp();
  const [currentStatus, setCurrentStatus] = useState<ActStatus>(act.status);
  const [saving, setSaving] = useState<'approved' | 'rejected' | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectReason,setRejectReason]=useState("");
  const [reviewError, setReviewError] = useState('');
  const [actualVolume,setActualVolume]=useState<number|null>(act.actualVolume ?? act.serviceReport?.volume ?? null);

  const handleApprove = async () => {
    if(!hasWorkVolume(actualVolume)) {setReviewError('Вкажіть і збережіть фактичний обсяг у м³.');return;}
    setReviewError('');
    setSaving('approved');
    try {
      await onStatusChange(act.id, 'approved');
      setCurrentStatus('approved');
      showToast('Акт підтверджено', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка оновлення статусу';
      setReviewError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(null);
    }
  };

  const handleReject = async () => {
    setReviewError('');
    if(rejectReason.trim().length<3){showToast("Напишіть причину повернення акта", "error");return;}
    setShowRejectConfirm(false);
    setSaving('rejected');
    try {
      await onStatusChange(act.id, 'rejected',rejectReason.trim());
      setCurrentStatus('rejected');
      showToast('Акт відхилено', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка оновлення статусу';
      setReviewError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(null);
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`Первинний акт ${act.actNumber ?? ''}`} className="relative flex min-w-0 flex-col bg-[#141720] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90dvh] overflow-hidden shadow-2xl">
        <div className="shrink-0 bg-[#141720] border-b border-white/5 px-4 sm:px-6 py-4 flex items-start justify-between gap-3 z-10">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-all text-sm text-blue-400 font-semibold">Первинний акт {act.actNumber ?? '—'}</span>
            <StatusBadge label={actStatusLabel(currentStatus)} className={getActStatusColor(currentStatus)} />
          </div>
          <button onClick={onClose} aria-label="Закрити акт" className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6">
          {act.applicationId && <div className="mb-4"><WorkVolumeEditor key={`${act.applicationId}-${currentStatus}`} applicationId={act.applicationId} onVolume={setActualVolume}/></div>}
          {/* Application */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Заявка</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow label="Номер заявки" value={<bdi className="rpv-application-number">{act.applicationNumber}</bdi>} mono />
              <DetailRow label="Код АЗК" value={
                <span className="flex items-center gap-1"><Hash size={12} className="text-slate-500" />{act.applicationAzkCode ?? '—'}</span>
              } />
              <DetailRow label="Об'єкт" value={act.applicationTitle} />
              <div className="sm:col-span-2">
                <DetailRow label="Адреса" value={
                  <span className="flex items-center gap-1"><MapPin size={12} className="text-slate-500 shrink-0" />{act.applicationAddress ?? '—'}</span>
                } />
              </div>
              <div className="sm:col-span-2">
                <DetailRow label="Опис / потреба" value={act.applicationDescription ?? '—'} />
              </div>
            </div>
          </section>

          <div className="h-px bg-white/5" />

          {/* Contractor */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Підрядник</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow label="ПІБ" value={
                <span className="flex items-center gap-1"><User size={12} className="text-slate-500" />{act.contractorId ? act.contractorName : 'Не призначено'}</span>
              } />
              <DetailRow label="Телефон" value={
                act.contractorPhone ? (
                  <a href={`tel:${act.contractorPhone}`} className="text-blue-400 hover:underline flex items-center gap-1">
                    <Phone size={12} />{act.contractorPhone}
                  </a>
                ) : '—'
              } />
            </div>
          </section>

          <div className="h-px bg-white/5" />

          {/* Dates */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Дата та статус</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow label="Дата акта" value={
                <span className="flex items-center gap-1"><Calendar size={12} className="text-slate-500" />{act.actDate ? formatDateTime(act.actDate) : '—'}</span>
              } />
              <DetailRow label="Завантажено" value={
                <span className="flex items-center gap-1"><Calendar size={12} className="text-slate-500" />{formatDateTime(act.createdAt)}</span>
              } />
              {act.reviewedAt && (
                <DetailRow label="Перевірено" value={formatDateTime(act.reviewedAt)} />
              )}
            </div>
          </section>

          <div className="h-px bg-white/5" />

          {/* Files */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Первинний акт
            </h3>
            {act.serviceReport&&<div className="mb-4 rounded-lg border border-blue-400/20 bg-blue-500/10 p-4"><p className="font-semibold text-blue-300">Фактичний результат підрядника</p><p className="text-slate-200">Дата: {act.serviceReport.work_date} · {act.serviceReport.volume===null?"Обсяг не вказано":`${act.serviceReport.volume} м³`}</p><p className="whitespace-pre-wrap text-slate-400">{act.serviceReport.notes}</p></div>}
            <FileGallery files={act.files} />
          </section>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 bg-[#141720] border-t border-white/5 px-4 sm:px-6 py-4">
          {currentStatus==='pending' && !hasWorkVolume(actualVolume) && <p className="mb-3 text-sm text-orange-200">Підтвердження доступне після збереження фактичного обсягу у м³.</p>}
          {reviewError && <p role="alert" className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200 break-words">{reviewError}</p>}
          <div role="group" aria-label="Дії з актом" className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2">
          <button
            onClick={handleApprove}
            disabled={saving !== null || currentStatus !== 'pending' || !hasWorkVolume(actualVolume)}
            className="flex min-w-0 min-h-11 items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving === 'approved' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Підтвердити
          </button>
          <button
            onClick={() => setShowRejectConfirm(true)}
            disabled={saving !== null || currentStatus !== 'pending'}
            className="flex min-w-0 min-h-11 items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving === 'rejected' ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
            Відхилити
          </button>
          <button
            onClick={onClose}
            className="col-span-2 sm:col-span-1 min-h-11 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
          >
            Закрити
          </button>
          </div>
        </div>
      </div>

      {showRejectConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowRejectConfirm(false)} />
          <div className="relative bg-[#141720] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2">Повернути акт на уточнення?</h3>
              <label className="block text-left text-sm text-slate-300">Причина для підрядника<textarea aria-label="Причина повернення акта" value={rejectReason} maxLength={2000} onChange={e=>setRejectReason(e.target.value)} className="mt-2 mb-4 w-full rounded-lg bg-white/5 p-3" rows={3}/></label>
              <p className="text-sm text-slate-400 mb-6">Акт {act.actNumber ?? '—'} буде відхилено. Підтвердіть дію.</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={handleReject}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-500 transition-colors"
                >
                  Відхилити
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modal, document.body);
}

export default function Acts({ initialId, onRecordClose }: { initialId?: string; onRecordClose?: () => void }) {
  const { showToast } = useApp();
  const [acts, setActs] = useState<ActItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActItem | null>(null);

  useEffect(() => { if (!initialId) setSelected(null); }, [initialId]);
  useEffect(() => {
    if (initialId && acts.length) setSelected(acts.find(a => a.id === initialId) || null);
  }, [initialId, acts]);
  const loadActs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActs();
      setActs(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Помилка завантаження актів';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadActs();
  }, [loadActs]);

  const handleStatusChange = useCallback(async (actId: string, status: ActStatus,reason?:string) => {
    await updateActStatus(actId, status,reason);
    setActs(prev => prev.map(a =>
      a.id === actId
        ? { ...a, status, reviewedAt: new Date().toISOString() }
        : a
    ));
    setSelected(prev =>
      prev && prev.id === actId
        ? { ...prev, status, reviewedAt: new Date().toISOString() }
        : prev
    );
  }, []);

  return (
    <>
      <PageHeader
        pageTitle="Первинні акти"
        pageSubtitle={`${acts.length} актів`}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Завантаження актів…</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <AlertCircle size={24} className="text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
            <button
              onClick={loadActs}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={14} /> Спробувати знову
            </button>
          </div>
        ) : acts.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            Первинних актів ще немає
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {acts.map(act => {
              const firstPhoto = act.files.find(f => f.fileType === 'photo');
              const firstFile = act.files[0];
              return (
                <div
                  key={act.id}
                  className="bg-[#141720] border border-white/5 rounded-xl overflow-hidden hover:border-white/15 transition-all duration-200 group cursor-pointer"
                  onClick={() => setSelected(act)}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-white/[0.02]">
                    {firstPhoto ? (
                      <TelegramImage
                        src={firstPhoto.url}
                        alt={`Первинний акт ${act.actNumber ?? ''}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : firstFile ? (
                      <div className="flex flex-col items-center justify-center gap-2 text-slate-500 h-full">
                        <FileText size={32} className="text-slate-600" />
                        <span className="text-xs text-slate-500">Первинний акт</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-slate-500 h-full">
                        <FileCheck size={32} className="text-slate-600" />
                        <span className="text-xs text-slate-500">Без файлів</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <StatusBadge label={actStatusLabel(act.status)} className={getActStatusColor(act.status)} />
                    </div>
                    {act.files.length > 1 && (
                      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm rounded-md px-2 py-0.5 text-xs text-slate-300">
                        {act.files.length} файлів
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-blue-400 font-semibold">Первинний акт {act.actNumber ?? '—'}</span>
                      <span className="text-xs text-slate-500">{formatDate(act.actDate ?? act.createdAt)}</span>
                    </div>
                    <p className="text-sm text-slate-300 truncate">{act.contractorName}</p>
                    <p className="text-xs text-slate-500 truncate">
                      Заявка <bdi className="rpv-application-number">{act.applicationNumber}</bdi>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageHeader>

      {selected && (
        <ActDetailModal
          act={selected}
          onClose={() => { setSelected(null); onRecordClose?.(); }}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  );
}
