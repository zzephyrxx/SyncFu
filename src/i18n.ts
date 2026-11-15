// Chinese source messages are stable keys. Additional locale catalogues can be
// added here without changing the UI or the transport contract.
const catalogues: Record<string, Record<string, string>> = { 'zh-CN': {} };
export const locale = 'zh-CN';
export function t(source: string, values: Record<string, string | number> = {}): string {
  return (catalogues[locale][source] ?? source).replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
export function count(value: number) { return value.toLocaleString(locale); }
export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = value / 1024; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[i]}`;
}
export function date(value: number) {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value * 1000));
}
