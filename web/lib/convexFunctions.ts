import { api } from "@/convex/_generated/api";

export const getCachedPackage = api.packages.get;
export const cachePackage = api.packages.put;
