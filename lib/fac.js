// Federal Audit Clearinghouse (api.fac.gov) pull and ranking for the Aclarian audit-findings tool.
// The hourly job (api/refresh.js) and the local test build (scripts/build-local.mjs) both use this file.
//
// The store is { rows: { "<uei>|<audit_year>": row }, cursor, seeded: [years] }.
// A row is a slimmed FAC "general" record when the audit disclosed a material weakness in internal control
// over financial reporting, or a { clean: true } marker when it did not, so a newer clean audit
// displaces an older finding.

export const API = 'https://api.fac.gov/general';
export const FIELDS = [
  'report_id', 'audit_year', 'auditee_uei', 'auditee_name', 'auditee_city', 'auditee_state', 'fy_end_date',
  'fac_accepted_date', 'total_amount_expended', 'gaap_results', 'is_going_concern_included',
  'is_internal_control_material_weakness_disclosed', 'auditor_firm_name',
  'auditee_contact_name', 'auditee_contact_title', 'auditee_email', 'auditee_phone',
];

// Aclarian sells to cities, counties, clerks, tax collectors and special districts. FAC's "local" entity type
// also covers schools, housing authorities, hospitals and tribes, which are dropped by name.
const SKIP = /school|elementary|academy|universit|college|charter|education|career|technical|supervisory union|\b[iu]?sd\b|\bhsd\b|head start|housing|hospital|health|medical|clinic|cardio|behavioral|mental|tribe|tribal|\bnation\b|rancheria|pueblo|band of|library|service board|community services|human services|cusd/i;
// Territories (Puerto Rico, Guam and others) are outside Aclarian's market.
const STATES = /^(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/;

// The audit year the list is built on: the newest year whose filings are mostly in. Single audits are due nine
// months after year end, so a fiscal year is reasonably complete about 18 months after it starts.
export function focusYear(today = new Date()) {
  const d = new Date(today);
  d.setMonth(d.getMonth() - 18);
  return d.getFullYear();
}

export function query(params, key = 'DEMO_KEY') {
  return fetch(`${API}?${new URLSearchParams({ select: FIELDS.join(','), limit: '20000', ...params })}`,
    { headers: { 'X-Api-Key': key } });
}

const weak = r => r.is_internal_control_material_weakness_disclosed === 'Yes';

export function merge(store, rows, today = new Date()) {
  const oldest = focusYear(today) - 2;
  for (const r of rows) {
    if (!r.auditee_uei || +r.audit_year < oldest) continue;
    const key = `${r.auditee_uei}|${r.audit_year}`;
    const prev = store.rows[key];
    if (prev && prev.fac_accepted_date > r.fac_accepted_date) continue;
    store.rows[key] = weak(r)
      ? Object.fromEntries(FIELDS.map(f => [f, r[f]]))
      : { auditee_uei: r.auditee_uei, audit_year: r.audit_year, fac_accepted_date: r.fac_accepted_date, clean: true };
    if (!store.cursor || r.fac_accepted_date > store.cursor) store.cursor = r.fac_accepted_date;
  }
  for (const [key, r] of Object.entries(store.rows)) if (+r.audit_year < oldest) delete store.rows[key];
  return store;
}

const kind = name =>
  /county|parish|fiscal court|board of supervisors|clerk|tax collector|comptroller|sheriff/i.test(name) ? 'County'
  : /\b(city|town|village|township|borough|municipality)\b/i.test(name) ? 'City or town'
  : 'Special district';

const days = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const iso = d => d.toISOString().slice(0, 10);

// One record per government whose newest audit in the focus year (or later) disclosed a material weakness.
// Ranked by how many years running the weakness has been reported (45%), how well the government's size fits
// Aclarian (25%), how recently the audit was filed (15%), and other red flags on the same audit (15%).
export function buildTargets(store, today = new Date()) {
  const byEntity = {};
  for (const r of Object.values(store.rows)) (byEntity[r.auditee_uei] ||= []).push(r);
  const focus = focusYear(today), now = iso(today);
  const records = [];
  for (const list of Object.values(byEntity)) {
    list.sort((a, b) => b.audit_year - a.audit_year);
    const r = list[0];
    if (r.clean || +r.audit_year < focus || SKIP.test(r.auditee_name) || !STATES.test(r.auditee_state)) continue;
    const type = kind(r.auditee_name);
    // Incorporated nonprofits file as "local" too; a county board can carry "Inc." and stays.
    if (type === 'Special district' && /\b(inc|llc)\b/i.test(r.auditee_name)) continue;
    let streak = 0;
    for (let y = +r.audit_year; list.find(x => +x.audit_year === y && !x.clean); y--) streak++;
    // Due nine months after fiscal year end.
    const due = new Date(r.fy_end_date + 'T00:00:00'); due.setMonth(due.getMonth() + 9);
    const lateDays = Math.max(0, days(iso(due), r.fac_accepted_date));
    const modified = /qualified|adverse|disclaimer/.test(r.gaap_results || '');
    const goingConcern = r.is_going_concern_included === 'Yes';
    const spend = r.total_amount_expended || 0;
    const fit = spend >= 1e6 && spend <= 40e6 ? 1 : spend > 150e6 ? 0 : 0.5;
    const daysSinceFiled = days(r.fac_accepted_date, now);
    const score = 0.45 * Math.min((streak - 1) / 2, 1) + 0.25 * fit
      + 0.15 * Math.max(0, 1 - daysSinceFiled / 365) + 0.15 * (modified || goingConcern || lateDays > 30 ? 1 : 0);
    records.push({
      id: r.auditee_uei, reportId: r.report_id, name: r.auditee_name, city: r.auditee_city, state: r.auditee_state,
      type, auditYear: +r.audit_year, fyEnd: r.fy_end_date, filed: r.fac_accepted_date,
      daysSinceFiled, lateDays, streak, spend, modified, goingConcern, auditor: r.auditor_firm_name || '',
      contact: { name: r.auditee_contact_name || '', title: r.auditee_contact_title || '', email: r.auditee_email || '', phone: r.auditee_phone || '' },
      score: Math.round(score * 1000) / 1000,
      priority: score >= 0.75 ? 'High' : score >= 0.45 ? 'Medium' : 'Low',
    });
  }
  records.sort((a, b) => b.score - a.score);
  return { updated: new Date(today).toISOString(), cursor: store.cursor, focusYear: focus, records };
}
