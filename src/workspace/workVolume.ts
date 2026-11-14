export function parseWorkVolume(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 && number < 1000000 ? number : null;
}
export function hasWorkVolume(value: unknown): value is number {
  return typeof value === 'number' && parseWorkVolume(String(value)) !== null;
}
export const formatWorkVolume = (value: unknown): string => hasWorkVolume(value)
  ? `${value.toLocaleString('uk-UA', { maximumFractionDigits: 3 })} м³` : 'Обсяг не вказано';
