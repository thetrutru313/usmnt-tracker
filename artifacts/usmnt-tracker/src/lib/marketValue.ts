const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 25_000_000 → "€25.0M"; 800_000 → "€800K". */
export function compactMoney(value: number, symbol: "€" | "$"): string {
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  return `${symbol}${Math.round(value / 1_000)}K`;
}

/** "2026-11-09" → "Nov 2026", read from the string so no time zone can shift the month. */
export function monthYear(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  return month && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${year}` : isoDate;
}

/** Transfermarkt's search, for players whose profile link isn't saved yet. */
export function transfermarktSearchUrl(name: string): string {
  return `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}`;
}
