const labels: Record<string, string> = {
  customer_site_id: 'Об’єкт', contractor_id: 'Виконавець', description: 'Опис робіт', manager_comment: 'Коментар',
  actual_volume: 'Обсяг, м³', unit_price: 'Тариф, грн/м³', payout_amount: 'Сума, грн',
  scheduled_at: 'Планова дата', deadline_at: 'Дедлайн', work_date: 'Дата виконання',
};
export default function OrderEditChanges({metadata}: {metadata: Record<string, unknown>}) {
  const changes = metadata.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  const value = (key: string, side: string, raw: unknown) => {
    if (key === 'customer_site_id') return String(metadata[`${side}_title`] || raw || '—');
    if (key === 'contractor_id') return String(metadata[`${side}_contractor`] || raw || 'Не призначено');
    if (raw == null || raw === '') return '—';
    if (typeof raw === 'number') return raw.toLocaleString('uk-UA', {maximumFractionDigits: 3});
    if (['scheduled_at', 'deadline_at', 'work_date'].includes(key)) {
      const d = new Date(String(raw));
      if (Number.isFinite(d.getTime())) return d.toLocaleString('uk-UA', key === 'work_date'
        ? {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Kyiv'}
        : {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv'});
    }
    return String(raw);
  };
  return <dl className="mt-3 space-y-2 rounded-lg bg-sky-400/5 p-3 text-xs">
    {Object.entries(changes).filter(([key, change]) => labels[key] && change && typeof change === 'object').map(([key, change]) => {
      const c = change as {before: unknown; after: unknown};
      return <div key={key}><dt className="text-sky-200 font-medium">{labels[key]}</dt>
        <dd className="mt-1 break-words text-slate-400"><span>{value(key, 'before', c.before)}</span><span className="mx-2 text-orange-300">→</span><span className="text-sky-100">{value(key, 'after', c.after)}</span></dd>
      </div>;
    })}
  </dl>;
}
