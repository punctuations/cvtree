import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  packages: defineTable({
    key: v.string(),
    ecosystem: v.string(),
    name: v.string(),
    version: v.string(),
    vulnerabilityCount: v.number(),
    report: v.any(),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),
});
