import { cronJobs } from "convex/server";
import { v } from "convex/values";

import { CACHE_TTL_MS, EVICTION_BATCH, isCurrent } from "./cache";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const TABLES = ["packages", "deepReports"] as const;

type Table = (typeof TABLES)[number];

export const evictStale = internalMutation({
  args: { table: v.optional(v.union(v.literal("packages"), v.literal("deepReports"))) },
  returns: v.number(),
  handler: async (ctx, { table }) => {
    const cutoff = Date.now() - CACHE_TTL_MS;
    const targets: readonly Table[] = table ? [table] : TABLES;
    let deleted = 0;

    for (const name of targets) {
      const batch = await ctx.db.query(name).withIndex("by_fetchedAt").take(EVICTION_BATCH);

      for (const row of batch) {
        if (row.fetchedAt < cutoff || !isCurrent(row.key)) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }

      if (batch.length === EVICTION_BATCH && deleted > 0) {
        await ctx.scheduler.runAfter(0, internal.crons.evictStale, { table: name });
      }
    }

    return deleted;
  },
});

const crons = cronJobs();

crons.interval("evict stale cache entries", { hours: 1 }, internal.crons.evictStale, {});

export default crons;
