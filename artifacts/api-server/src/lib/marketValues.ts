/**
 * Hand-entered market values (from Transfermarkt, in euros) and their
 * conversion to dollars.
 *
 * - The admin page saves euros + an "as of" date (+ the player's Transfermarkt
 *   link and bio). See PUT /admin/market-values.
 * - players.market_value_usd is derived: euros × the latest ECB EUR→USD rate.
 *   The eurUsdRate job (scheduledJobs.ts) fetches the rate daily and
 *   re-converts every hand-entered value, so dollars follow the exchange rate
 *   while the euros stay exactly as entered.
 * - The call-up score and the API read market_value_usd as before.
 */
import { db, clubsTable, playersTable, serverConfigTable } from "@workspace/db";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger";

/** server_config key holding the latest rate as JSON { rate, date }. */
export const EUR_USD_KEY = "fx.eurUsd";
/** Frankfurter: free ECB reference rates, no key. Updated each working day around 16:00 CET. */
export const EUR_USD_URL = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";

export type EurUsd = { rate: number; date: string };

/**
 * The EUR→USD rate from a Frankfurter response (v1 `{ date, rates: { USD } }`
 * or v2 `{ date, rate }`) or from our stored `{ rate, date }`. Null when
 * missing or implausible, so a bad response never re-prices every player.
 */
export function parseEurUsd(body: unknown): EurUsd | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { date?: unknown; rate?: unknown; rates?: { USD?: unknown } | null };
  const raw = typeof b.rates?.USD === "number" ? b.rates.USD : b.rate;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0.5 || raw > 2.5) return null;
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date)
    ? b.date
    : new Date().toISOString().slice(0, 10);
  return { rate: raw, date };
}

export async function storedEurUsd(): Promise<EurUsd | null> {
  const [row] = await db
    .select({ value: serverConfigTable.value })
    .from(serverConfigTable)
    .where(eq(serverConfigTable.key, EUR_USD_KEY));
  if (!row) return null;
  try {
    return parseEurUsd(JSON.parse(row.value));
  } catch {
    return null;
  }
}

/** Re-convert every hand-entered euro value at `rate`. Returns how many players were updated. */
export async function convertMarketValues(rate: number): Promise<number> {
  const rows = await db
    .update(playersTable)
    .set({ marketValueUsd: sql`round(${playersTable.marketValueEur} * ${rate}::double precision)` })
    .where(isNotNull(playersTable.marketValueEur))
    .returning({ id: playersTable.id });
  return rows.length;
}

/** Fetch today's rate, store it, and re-convert every value. Throws on a failed or unusable response. */
export async function refreshEurUsd(): Promise<EurUsd & { playersUpdated: number }> {
  const res = await fetch(EUR_USD_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Exchange-rate request failed: HTTP ${res.status}`);
  const fx = parseEurUsd(await res.json());
  if (!fx) throw new Error("Exchange-rate response had no usable EUR→USD rate");
  const value = JSON.stringify(fx);
  await db
    .insert(serverConfigTable)
    .values({ key: EUR_USD_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: serverConfigTable.key, set: { value, updatedAt: new Date() } });
  const playersUpdated = await convertMarketValues(fx.rate);
  logger.info({ ...fx, playersUpdated }, "EUR→USD rate refreshed");
  return { ...fx, playersUpdated };
}

/** The admin page's rows: every tracked player, by name. */
export async function listMarketValues() {
  return db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      position: playersTable.position,
      clubName: clubsTable.name,
      marketValueEur: playersTable.marketValueEur,
      marketValueUsd: playersTable.marketValueUsd,
      marketValueAsOf: playersTable.marketValueAsOf,
      transfermarktUrl: playersTable.transfermarktUrl,
      bio: playersTable.bio,
    })
    .from(playersTable)
    .leftJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
    .orderBy(asc(playersTable.name));
}

/** One player's changes. A field left out is unchanged. */
export type MarketValueEdit = {
  id: number;
  /** Euros in millions, as Transfermarkt shows it (25 = €25m). null clears the value. */
  valueEurM?: number | null;
  transfermarktUrl?: string | null;
  bio?: string;
};

/**
 * Save the admin page's edits in one transaction. A new value gets `asOf` and
 * is converted at `rate`; with no rate yet, its dollars stay empty until the
 * next rate refresh fills them in. Returns how many players were updated.
 */
export async function saveMarketValues(edits: MarketValueEdit[], asOf: string, rate: number | null): Promise<number> {
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const edit of edits) {
      const set: Partial<typeof playersTable.$inferInsert> = {};
      if (edit.valueEurM === null) {
        Object.assign(set, { marketValueEur: null, marketValueAsOf: null, marketValueUsd: null });
      } else if (edit.valueEurM !== undefined) {
        const eur = Math.round(edit.valueEurM * 1_000_000);
        Object.assign(set, {
          marketValueEur: eur,
          marketValueAsOf: asOf,
          marketValueUsd: rate == null ? null : Math.round(eur * rate),
        });
      }
      if (edit.transfermarktUrl !== undefined) set.transfermarktUrl = edit.transfermarktUrl;
      if (edit.bio !== undefined) set.bio = edit.bio;
      if (Object.keys(set).length === 0) continue;
      const rows = await tx
        .update(playersTable)
        .set(set)
        .where(eq(playersTable.id, edit.id))
        .returning({ id: playersTable.id });
      updated += rows.length;
    }
  });
  return updated;
}
