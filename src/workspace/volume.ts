export type VolumeFilters = { month: string; network: string; region: string; site: string; group: 'network' | 'region' | 'site' };
export type VolumeRow = { key: string; title: string; volume: number; acts: number; sites: number; site_id: string | null; region_label: string | null };
export type VolumeReport = {
  month: string; period_start: string; period_end: string; total: number;
  act_count: number; site_count: number; rows: VolumeRow[]; row_count: number; more: boolean;
  networks: { value: string; label: string }[];
  regions: { value: string; label: string }[];
  sites: { id: string; code: string; network: string; network_label: string; region_label: string; label: string }[];
};
export function volumeCsv(report: VolumeReport, filters: VolumeFilters): string {
  const site = report.sites.find(s=>s.id===filters.site);
  const rows: (string | number)[][] = [
    ['Звіт РПВ', report.month], ['Період',report.period_start,report.period_end],
    ['Мережа',report.networks.find(n=>n.value===filters.network)?.label || (filters.network ? filters.network : 'Усі мережі')],
    ['Регіон',report.regions.find(r=>r.value===filters.region)?.label || (filters.region ? filters.region : 'Усі регіони')],
    ['АЗК',site ? `${site.network_label} ${site.code}` : filters.site || 'Усі АЗК'],
    ['Відкачано, м³',report.total],['Підтверджені опубліковані акти',report.act_count],[],
    [filters.group==='network'?'Мережа':filters.group==='region'?'Регіон':'АЗК','Регіон','Відкачано, м³','Акти','АЗК з актами'],
    ...report.rows.map(r=>[r.title,r.region_label||'',r.volume,r.acts,r.sites]),
  ];
  return '\ufeff'+rows.map(row=>row.map(value=>{
    const text=String(value);
    const safe=typeof value==='string' && /^[\s]*[=+\-@]/.test(text) ? "'"+text : text;
    return '"'+safe.replace(/"/g,'""')+'"';
  }).join(';')).join('\r\n');
}
