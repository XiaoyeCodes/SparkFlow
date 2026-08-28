// Local-only cache adapter for DailyHotApi 2.0.8. No Redis connection, no shared
// database writes, and no additional service is needed for this desktop app.
import NodeCache from 'node-cache';
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, maxKeys: 500, useClones: false });
export const getCache = async (key) => cache.get(key);
export const setCache = async (key, value, ttl = 600) => cache.set(key, value, ttl);
export const delCache = async (key) => cache.del(key) > 0;
