import type { Site } from '../portal/api';

export async function loadNetworkSites(
  network: string,
  fetchPage: (network: string, page: number) => Promise<{sites: Site[]; more: boolean}>,
  current: () => boolean = () => true,
): Promise<Site[] | null> {
  const sites = new Map<string, Site>();
  for (let page = 0; current(); page++) {
    const result = await fetchPage(network, page);
    if (!current()) return null;
    for (const site of result.sites) sites.set(site.id, site);
    if (!result.more) return [...sites.values()].sort((a, b) =>
      a.code.localeCompare(b.code, 'uk', {numeric: true}) || a.region.localeCompare(b.region, 'uk') || a.id.localeCompare(b.id));
    if (!result.sites.length) throw new Error('Не вдалося завантажити повний список АЗК. Оновіть список.');
  }
  return null;
}
