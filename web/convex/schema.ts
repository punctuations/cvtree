import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { deepReport, ecosystem, packageReport } from "./validators";

export default defineSchema({
  packages: defineTable({
    key: v.string(),
    ecosystem,
    name: v.string(),
    version: v.string(),
    vulnerabilityCount: v.number(),
    report: packageReport,
    fetchedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_fetchedAt", ["fetchedAt"]),

  deepReports: defineTable({
    key: v.string(),
    ecosystem,
    name: v.string(),
    version: v.string(),
    depth: v.number(),
    dependencyCount: v.number(),
    vulnerabilityCount: v.number(),
    report: deepReport,
    fetchedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_fetchedAt", ["fetchedAt"]),
});
