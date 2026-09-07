export function quantity(value: string | number | null | undefined) {
 if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
 const n=Number(value); if(n!==0&&Math.abs(n)<.00000001)return n<0?'−<0.00000001':'<0.00000001';
 return n.toLocaleString('en-US',{maximumFractionDigits:8});
}
