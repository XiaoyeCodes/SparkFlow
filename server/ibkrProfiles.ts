import type { Holding } from '../src/lib/ibkr/workbenchTypes.ts';

type VerifiedProfile = Pick<Holding, 'name' | 'sector' | 'industry' | 'instrumentType' | 'profileUrl'>;
export type ProfileBatchFetcher = (tickers: string[]) => Promise<unknown>;

const successTtl = 7 * 24 * 60 * 60 * 1000;
const failureTtl = 5 * 60 * 1000;
const venues: Record<string, string> = { NASDAQ: 'NASDAQ', ISLAND: 'NASDAQ', NYSE: 'NYSE', ARCA: 'AMEX', NYSEARCA: 'AMEX', AMEX: 'AMEX', BATS: 'BATS' };

function text(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximum ? value.trim() : undefined;
}

export function profileIdentity(holding: Holding) {
  if (holding.currency !== 'USD' || holding.assetType !== 'STK') return null;
  const symbol = holding.symbol.trim().toUpperCase().replace(/ /g, '.');
  if (!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(symbol)) return null;
  const exchange = (holding.exchange || 'SMART').toUpperCase();
  const candidates = venues[exchange] ? [venues[exchange]] : ['', 'SMART'].includes(exchange) ? ['NASDAQ', 'NYSE', 'AMEX', 'BATS'] : [];
  return candidates.length ? { key: symbol.replaceAll('.', '-'), symbol, tickers: candidates.map(candidate => `${candidate}:${symbol}`) } : null;
}

export function verifyTradingViewProfile(row: unknown, identity: NonNullable<ReturnType<typeof profileIdentity>>): VerifiedProfile | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const raw = row as { s?: unknown; d?: unknown };
  if (typeof raw.s !== 'string' || !identity.tickers.includes(raw.s) || !Array.isArray(raw.d)) return undefined;
  const [symbol, name, sector, industry, type, typeSpecs] = raw.d;
  if (text(symbol, 24)?.replaceAll('.', '-') !== identity.key) return undefined;
  const instrumentType = type === 'fund' || Array.isArray(typeSpecs) && typeSpecs.includes('etf') ? 'ETF' : type === 'stock' || type === 'dr' ? 'STK' : undefined;
  const verified = { name: text(name, 160), sector: text(sector, 120), industry: text(industry, 160), instrumentType, profileUrl: `https://www.tradingview.com/symbols/${encodeURIComponent(raw.s.replace(':', '-'))}/` };
  return verified.name || verified.sector || verified.industry || verified.instrumentType ? verified : undefined;
}

function needsProfile(holding: Holding) {
  if (holding.instrumentType === 'ETF') return false;
  return !holding.instrumentType || !holding.sector || !holding.industry || !holding.name || holding.name.trim().toUpperCase() === holding.symbol.trim().toUpperCase();
}

export class IbkrProfiles {
  private cache = new Map<string, { at: number; value?: VerifiedProfile }>();
  private flight?: Promise<void>;
  constructor(private scan: ProfileBatchFetcher) {}

  async enrich(holdings: Holding[]) {
    const identities = [...new Map(holdings.filter(needsProfile).map(profileIdentity).filter((identity): identity is NonNullable<typeof identity> => Boolean(identity)).map(identity => [identity.key, identity])).values()];
    const missing = identities.filter(identity => { const cached = this.cache.get(identity.key); return !cached || Date.now() - cached.at >= (cached.value ? successTtl : failureTtl); });
    if (missing.length) {
      if (!this.flight) this.flight = this.load(missing).finally(() => { this.flight = undefined; });
      await this.flight;
    }
    return holdings.map(holding => {
      const identity = profileIdentity(holding); const profile = identity && this.cache.get(identity.key)?.value;
      return profile ? { ...holding, ...Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined)) } : holding;
    });
  }

  private async load(identities: NonNullable<ReturnType<typeof profileIdentity>>[]) {
    const at = Date.now();
    try {
      const result = await this.scan([...new Set(identities.flatMap(identity => identity.tickers))]);
      const rows: unknown[] = result && typeof result === 'object' && !Array.isArray(result) && Array.isArray((result as any).data) ? (result as any).data : [];
      for (const identity of identities) {
        const profiles = rows.map((row: unknown) => verifyTradingViewProfile(row, identity)).filter((profile: VerifiedProfile | undefined): profile is VerifiedProfile => Boolean(profile));
        const unique = [...new Map<string, VerifiedProfile>(profiles.map(profile => [JSON.stringify(profile), profile])).values()];
        this.cache.set(identity.key, { at, value: unique.length === 1 ? unique[0] : undefined });
      }
    } catch {
      for (const identity of identities) this.cache.set(identity.key, { at });
    }
  }
}
