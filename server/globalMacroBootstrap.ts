import { GLOBAL_MACRO_BOOTSTRAP_KEYS, type GlobalMacroBootstrap } from '../src/lib/globalMacroPreload.ts';
import type { createPublicDataCache } from './publicDataCache.ts';

export async function readGlobalMacroBootstrap(cache?: ReturnType<typeof createPublicDataCache>): Promise<GlobalMacroBootstrap> {
  const resources: Record<string, unknown> = {};
  if (cache) await Promise.all(GLOBAL_MACRO_BOOTSTRAP_KEYS.map(async key => {
    const prepared = await cache.readPrepared(key);
    if (prepared) resources[key] = { ...prepared.data as object, _publicCache: prepared.meta };
  }));
  return { generatedAt: new Date().toISOString(), resources };
}
