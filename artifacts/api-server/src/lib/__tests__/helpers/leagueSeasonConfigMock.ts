/** Keep calendar diagnostics outside legacy stats tests' insert/select queues.
 * The real diagnostic upsert is exercised in leagueSeasonsSync.test.ts. */
export const serverConfigTable = { key: "key" };

export function withLeagueSeasonConfig<T extends { insert: (table: unknown) => unknown }>(database: T): T {
  return new Proxy(database, {
    get(target, property) {
      if (property === "insert") return (table: unknown) => table === serverConfigTable
        ? { values: () => ({ onConflictDoUpdate: async () => undefined }) }
        : target.insert(table);
      return Reflect.get(target, property);
    },
  });
}
