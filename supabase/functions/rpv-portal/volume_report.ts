import { PortalError, monthRange, uuid } from './auth.ts';
import { ukraineCities } from './ukraine_cities.ts';

const regions = new Map(ukraineCities.map(([code, city, area]) => [code.slice(0,4), area === 'місто зі спеціальним статусом' ? city : area]));
const regionLabel = (code: string) => regions.get(code) || 'Регіон не вказано';
const networkLabel = (code: string) => code === '_unknown' ? 'Без мережі' : code;

// Must only be called after the office JWT and active role checks.
export async function officeVolumeReport(db: any, body: any) {
  const range = monthRange(body.month);
  if (['network','region','site'].some(k=>body[k]!==undefined&&typeof body[k]!=='string')) throw new PortalError(400,'Некоректні фільтри звіту.');
  const network = typeof body.network === 'string' && body.network ? body.network.trim().toUpperCase() : null;
  const normalizedNetwork = network === '_UNKNOWN' ? '_unknown' : network;
  if (normalizedNetwork && normalizedNetwork !== '_unknown' && !/^[A-Z0-9]{1,30}$/.test(normalizedNetwork)) throw new PortalError(400,'Оберіть мережу зі списку.');
  const region = typeof body.region === 'string' && body.region ? body.region : null;
  if (region && region !== '_unknown' && !regions.has(region)) throw new PortalError(400,'Оберіть регіон зі списку.');
  const group = body.group ?? 'network';
  if (!['network','region','site'].includes(group)) throw new PortalError(400,'Оберіть групування звіту.');
  const page = body.page ?? 0;
  if (!Number.isSafeInteger(page) || page<0 || page>100000) throw new PortalError(400,'Некоректна сторінка звіту.');
  if (body.export !== undefined && typeof body.export !== 'boolean') throw new PortalError(400,'Некоректний формат експорту.');
  const { data, error } = await db.rpc('rpv_office_volume_report', {
    p_month: range.start, p_network: normalizedNetwork, p_region: region,
    p_site: body.site ? uuid(body.site) : null, p_group: group, p_offset: page*50, p_export: body.export === true,
  });
  if (error || !data) throw new PortalError(500,'Не вдалося завантажити лічильник РПВ. Спробуйте ще раз.');
  return { ...data,
    networks: data.networks.map((value: string) => ({ value, label: networkLabel(value) })),
    regions: data.regions.map((value: string) => ({ value, label: regionLabel(value) })).sort((a: any,b: any)=>a.label.localeCompare(b.label,'uk')),
    sites: data.sites.map((s: any) => ({ ...s, network_label: networkLabel(s.network), region_label: regionLabel(s.region) })),
    rows: data.rows.map((r: any) => ({ ...r, title: group === 'network' ? networkLabel(r.key) : group === 'region' ? regionLabel(r.key) : `АЗК ${networkLabel(r.network)} ${r.code || r.label}`,
      region_label: r.region ? regionLabel(r.region) : null })),
  };
}
