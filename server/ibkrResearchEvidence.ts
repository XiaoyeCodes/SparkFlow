/** Structural evidence selection: never serialize half a JSON record. */
export function evidenceExcerpt(content: string, limit: number, title = '', asOf = new Date().toISOString()): string {
  let parsed: any;
  try { parsed = JSON.parse(content); } catch {
    if (content.length <= limit) return content;
    let start = Math.max(0, content.indexOf('Markdown Content:'));
    if (/calendar|日历|FOMC/i.test(title)) {
      const year = asOf.slice(0, 4);
      const marker = new RegExp(`(?:^|\\n)\\s*${year}\\s+(?:FOMC\\s+)?(?:Meetings|Calendar|Schedule)`, 'i').exec(content);
      if (marker) start = marker.index;
    }
    return content.slice(start, start + limit);
  }
  const date = (v: any) => String(v?.date ?? v?.REPORT_DATE ?? v?.trade_date ?? v?.end ?? '');
  const normalize = (v: any): any => {
    if (Array.isArray(v)) {
      const rows = v.map(normalize);
      if (rows.length && rows.every(r => r && typeof r === 'object' && date(r))) rows.sort((a,b)=>date(b).localeCompare(date(a)));
      return rows;
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]));
    return v;
  };
  const value = normalize(parsed);
  let serialized = JSON.stringify(value);
  if (serialized.length <= limit) return serialized;
  // Remove oldest rows before shortening any prose; preserve every series' latest observation.
  const arrays: any[][] = [];
  const strings: Array<{ parent: any; key: string }> = [];
  const visit = (v: any) => {
    if (Array.isArray(v)) { if(v.length && v.every(r=>r && typeof r==='object' && date(r))) arrays.push(v); v.forEach(visit); }
    else if (v && typeof v === 'object') for (const [key,x] of Object.entries(v)) {
      if (typeof x === 'string' && x.length > 300) strings.push({parent:v,key}); else visit(x);
    }
  };
  visit(value);
  while (serialized.length > limit) {
    const candidates = arrays.filter(a=>a.length > 2).sort((a,b)=>JSON.stringify(b).length - JSON.stringify(a).length);
    if (!candidates.length) break;
    candidates[0].pop(); serialized = JSON.stringify(value);
  }
  for (const {parent,key} of strings) {
    if (serialized.length <= limit) break;
    parent[key] = parent[key].slice(0,300) + '…'; serialized = JSON.stringify(value);
  }
  // Tiny budgets cannot hold some source records. Prefer a complete record to broken JSON.
  return serialized;
}
