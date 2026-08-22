import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const cached = await ctx.db
      .query("packages")
      .withIndex("by_key", (entry) => entry.eq("key", key))
      .unique();

    if (!cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
      return null;
    }

    return { report: cached.report, fetchedAt: cached.fetchedAt };
  },
});

export const put = mutation({
  args: {
    key: v.string(),
    ecosystem: v.string(),
    name: v.string(),
    version: v.string(),
    vulnerabilityCount: v.number(),
    report: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("packages")
      .withIndex("by_key", (entry) => entry.eq("key", args.key))
      .unique();

    const entry = { ...args, fetchedAt: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, entry);
      return existing._id;
    }

    return await ctx.db.insert("packages", entry);
  },
});
