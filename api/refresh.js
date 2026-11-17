// Hourly job (see vercel.json). Makes one FAC request per run so a shared demo key stays under its cap of
// 10 requests an hour. Until the last three audit years are seeded it pulls one year per run; after that it
// pulls only filings accepted since the last run. Results go to Vercel Blob, which the page reads.
import { put, head } from '@vercel/blob';
import { query, merge, buildTargets, focusYear } from '../lib/fac.js';

const RAW = 'fac/raw.json';
const OUT = 'fac/targets.json';
const save = (path, data) => put(path, JSON.stringify(data), {
  access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
});

async function load() {
  const blob = await head(RAW).catch(() => null);
  if (!blob) return { rows: {}, cursor: null, seeded: [] };
  const res = await fetch(blob.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Blob read ${res.status}`);
  return res.json();
}

export async function GET(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const store = await load();
  const focus = focusYear();
  store.seeded = (store.seeded || []).filter(y => y >= focus - 2);
  const year = [focus - 2, focus - 1, focus].find(y => !store.seeded.includes(y));
  const step = year ? `seed ${year}` : `new filings since ${store.cursor}`;
  const res = await query(year
    ? { entity_type: 'eq.local', audit_year: `eq.${year}`, is_internal_control_material_weakness_disclosed: 'eq.Yes' }
    : { entity_type: 'eq.local', fac_accepted_date: `gte.${store.cursor}`, order: 'fac_accepted_date.asc' },
    process.env.FAC_API_KEY || 'DEMO_KEY');
  // On a rate limit or outage, keep the last good data and try again next hour.
  if (!res.ok) return Response.json({ ok: false, step, status: res.status }, { status: 502 });
  const rows = await res.json();
  merge(store, rows);
  if (year) store.seeded.push(year);
  const out = buildTargets(store);
  await save(RAW, store);
  await save(OUT, out);
  return Response.json({ ok: true, step, fetched: rows.length, records: out.records.length, cursor: store.cursor });
}
