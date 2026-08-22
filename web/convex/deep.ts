import { v } from "convex/values";

import { isFresh } from "./cache";
import { mutation, query } from "./_generated/server";
import { deepReport, ecosystem } from "./validators";

export const get = query({
  args: { key: v.string() },
  returns: v.union(v.object({ report: deepReport, fetchedAt: v.number() }), v.null()),
  handler: async (ctx, { key }) => {
    const cached = await ctx.db
      .query("deepReports")
      .withIndex("by_key", (entry) => entry.eq("key", key))
      .unique();

    if (!cached || !isFresh(cached.fetchedAt, Date.now())) {
      return null;
    }

    return { report: cached.report, fetchedAt: cached.fetchedAt };
  },
});

export const put = mutation({
  args: {
    key: v.string(),
    ecosystem,
    name: v.string(),
    version: v.string(),
    depth: v.number(),
    dependencyCount: v.number(),
    vulnerabilityCount: v.number(),
    report: deepReport,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("deepReports")
      .withIndex("by_key", (entry) => entry.eq("key", args.key))
      .unique();

    const entry = { ...args, fetchedAt: Date.now() };

    if (existing) {
      await ctx.db.replace(existing._id, entry);
    } else {
      await ctx.db.insert("deepReports", entry);
    }

    return null;
  },
});
