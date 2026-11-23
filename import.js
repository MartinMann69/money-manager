'use strict';

/* =====================================================================
   Bank CSV import
   1. read the file (UTF-8 or Windows-1252), detect separator + header row
   2. guess the columns (date / amount / payee …) — remembered per bank
   3. review: every row gets a suggestion (budget, "rent → mark paid",
      "already imported" …) that can be changed before importing
   ===================================================================== */

const CSV_MAPS_KEY = 'mm-csv-maps-v1';

/* ---------------- reading & parsing ---------------- */
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('windows-1252').decode(buf); }
  return text.replace(/^﻿/, '');
}

function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(s => s.trim())).filter(r => r.some(x => x !== ''));
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 60).join('\n');
  let best = ',', bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const rows = parseCSV(sample, d);
    const counts = rows.map(r => r.length).filter(n => n > 1);
    if (!counts.length) continue;
    const freq = {};
    counts.forEach(n => (freq[n] = (freq[n] || 0) + 1));
    const [mode, times] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = times * Math.min(+mode, 12);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})|^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;
function looksLikeDate(s) { return DATE_RE.test((s || '').trim()); }
function detectDateOrder(values) {
  let dmy = false, mdy = false, dot = false;
  for (const v of values) {
    const m = (v || '').trim().match(/^(\d{1,2})([./-])(\d{1,2})[./-]\d{2,4}/);
    if (!m) continue;
    if (m[2] === '.') dot = true;
    if (+m[1] > 12) dmy = true;
    if (+m[3] > 12) mdy = true;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  if (dot) return 'dmy';
  return (navigator.language || '').toLowerCase() === 'en-us' ? 'mdy' : 'dmy';
}
function parseDateFlex(s, order) {
  s = (s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; }
  else {
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!m) return null;
    let a, b;
    [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    [d, mo] = order === 'mdy' ? [b, a] : [a, b];
  }
  y = +y; mo = +mo; d = +d;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** signed amount: "-12,50", "12.50-", "(12.50)", "1.234,56 €", "−5" */
function parseSigned(s) {
  s = String(s || '').trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /[-−]/.test(s);
  let t = s.replace(/[−()\-+\s€$£]/g, '').replace(/[A-Za-z]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');      // 1.234 = thousands
  if (/^\d{1,3}(,\d{3})+$/.test(t) && !/\./.test(t)) t = t.replace(/,/g, ''); // 1,234
  const v = parseAmount(t);
  return isNaN(v) ? NaN : (neg ? -v : v);
}
const isAmountLike = s => /\d/.test(s || '') && !isNaN(parseSigned(s)) && !looksLikeDate(s) && String(s).replace(/[^\d]/g, '').length <= 12;

function detectHeaderRow(rows) {
  const counts = rows.map(r => r.length);
  const freq = {};
  counts.forEach(n => { if (n > 1) freq[n] = (freq[n] || 0) + 1; });
  const mode = +(Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [2])[0];
  for (let i = 0; i < Math.min(rows.length - 1, 40); i++) {
    const r = rows[i];
    if (r.length < Math.max(2, mode - 1)) continue;
    const textCells = r.filter(c => c && !looksLikeDate(c) && !isAmountLike(c)).length;
    const next = rows[i + 1];
    if (textCells >= Math.ceil(r.length * 0.6) && next && next.some(looksLikeDate)) return i;
  }
  // no header? first row that has a date
  const first = rows.findIndex(r => r.length >= mode - 1 && r.some(looksLikeDate));
  return first > 0 ? first - 1 : -1; // -1 = no header row
}

/* ---------------- guessing columns ---------------- */
const KW = {
  date: /^(buchungs?tag|buchungsdatum|datum|date|booking ?date|transaction ?date|started ?date|completed ?date|wertstellung|valuta|value ?date|fecha|data)$|buchung|datum|date/i,
  amount: /^(betrag|amount|umsatz|value|summe|importe|montant|betrag \(eur\)|amount \(eur\))$|betrag|amount|umsatz/i,
  out: /soll|debit|ausgang|withdraw|paid out|money out|lastschrift/i,
  in: /haben|credit|eingang|deposit|paid in|money in|gutschrift/i,
  name: /empf(ä|ae)nger|beg(ü|ue)nstigter|auftraggeber|zahlungspflichtiger|payee|counterparty|name|merchant|description|beschreibung|partner|recipient/i,
  details: /verwendungszweck|purpose|reference|referenz|buchungstext|details|memo|notiz|text|vorgang|type/i,
};
function guessMapping(rows, headerIdx) {
  const header = headerIdx >= 0 ? rows[headerIdx] : [];
  const data = rows.slice(headerIdx + 1, headerIdx + 60);
  const ncol = Math.max(...data.map(r => r.length), header.length);
  const colVals = i => data.map(r => r[i] || '');
  const share = (i, fn) => { const v = colVals(i).filter(Boolean); return v.length ? v.filter(fn).length / v.length : 0; };
  const find = (re, test, exclude = []) => {
    for (let i = 0; i < header.length; i++) if (!exclude.includes(i) && re.test(header[i]) && (!test || share(i, test) > 0.5)) return i;
    return -1;
  };
  const m = { date: -1, amountMode: 'one', amount: -1, out: -1, in: -1, name: -1, details: -1, flip: false };
  m.date = find(KW.date, looksLikeDate);
  if (m.date < 0) { let best = 0; for (let i = 0; i < ncol; i++) { const s = share(i, looksLikeDate); if (s > best) { best = s; m.date = i; } } }
  m.amount = find(KW.amount, isAmountLike, [m.date]);
  if (m.amount < 0) {
    const o = find(KW.out, isAmountLike, [m.date]), n = find(KW.in, isAmountLike, [m.date]);
    if (o >= 0 && n >= 0) { m.amountMode = 'two'; m.out = o; m.in = n; }
  }
  if (m.amount < 0 && m.amountMode === 'one') {
    let best = 0;
    for (let i = 0; i < ncol; i++) {
      if (i === m.date) continue;
      const s = share(i, v => isAmountLike(v) && /[.,]\d{2}\b/.test(v));
      if (s > best) { best = s; m.amount = i; }
    }
  }
  const used = [m.date, m.amount, m.out, m.in];
  m.name = find(KW.name, null, used);
  m.details = find(/verwendungszweck|purpose|reference|referenz|memo|description/i, null, [...used, m.name]);
  if (m.details < 0) m.details = find(KW.details, null, [...used, m.name]);
  if (m.name < 0) {
    let best = 0;
    for (let i = 0; i < ncol; i++) {
      if (used.includes(i) || i === m.details) continue;
      const avg = colVals(i).reduce((a, v) => a + (isAmountLike(v) || looksLikeDate(v) ? 0 : v.length), 0) / Math.max(1, data.length);
      if (avg > best) { best = avg; m.name = i; }
    }
  }
  return m;
}

/* ---------------- turning rows into transactions ---------------- */
function cleanText(s) {
  return String(s || '')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, ' ')           // IBANs
    .replace(/\b(SEPA[- ]?(Lastschrift|Überweisung|Ueberweisung|Gutschrift|Basislastschrift)?|Kartenzahlung|Lastschrift|Folgelastschrift|Card payment|POS|VISA|Debitk\.?\d*)\b/gi, ' ')
    .replace(/\b\S*\d{6,}\S*\b/g, ' ')                           // long reference numbers
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,/.:-]+|[\s,/.:-]+$/g, '')
    .trim();
}
function rowText(r, m) {
  const name = m.name >= 0 ? cleanText(r[m.name]) : '';
  const details = m.details >= 0 ? cleanText(r[m.details]) : '';
  return { name: (name || details || 'Bank transaction').slice(0, 70), full: [r[m.name], r[m.details]].filter(Boolean).join(' · ') };
}
function buildRows(state) {
  const { rows, headerIdx, map } = state;
  const data = rows.slice(headerIdx + 1);
  const order = detectDateOrder(data.map(r => r[map.date]));
  const out = [];
  for (const r of data) {
    const date = parseDateFlex(r[map.date], order);
    if (!date) continue;
    let amount;
    if (map.amountMode === 'two') {
      const o = Math.abs(parseSigned(r[map.out]) || 0), n = Math.abs(parseSigned(r[map.in]) || 0);
      amount = r2(n - o);
    } else amount = parseSigned(r[map.amount]);
    if (isNaN(amount) || amount === 0) continue;
    if (map.flip) amount = -amount;
    out.push({ date, amount, ...rowText(r, map) });
  }
  return out;
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-zäöüß ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
function hashKey(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

const HINTS = [
  [/rewe|aldi|lidl|edeka|kaufland|netto|penny|tegut|globus|tesco|sainsbury|asda|carrefour|\bspar\b|billa|hofer|migros|coop|walmart|safeway|albert heijn|jumbo|mercadona|dm[- ]drogerie|rossmann/i, /food|grocer|lebensmittel|essen|supermarkt|einkauf/i],
  [/deutsche bahn|db vertrieb|\bdb\b|uber|bolt|\bshell\b|aral|esso|\bjet\b|total|bvg|mvv|hvv|kvb|vrr|tfl|flixbus|ryanair|lufthansa|easyjet|tankstelle|parking|parken/i, /transport|car|auto|fahr|travel|verkehr|mobil|tank/i],
  [/restaurant|mcdonald|burger king|kfc|subway|lieferando|deliveroo|uber ?eats|wolt|starbucks|caf[eé]|bar\b|pizza|kebab|döner|doener|sushi/i, /going out|restaurant|ausgehen|fun|freizeit|eating|essen gehen|ausgeh/i],
  [/amazon|zalando|h&m|zara|primark|ikea|mediamarkt|saturn|otto|about you|decathlon/i, /shopping|einkauf|kleidung|clothes|stuff/i],
];

/** suggest what each bank row is */
function suggest(rows) {
  const txs = Store.live('txs');
  const keysSeen = new Set(txs.filter(t => t.importKey).map(t => t.importKey));
  const budgetsByName = new Map();
  [...txs].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(t => { if (t.budgetId && Store.get('budgets', t.budgetId)) budgetsByName.set(norm(t.name), t.budgetId); });
  const used = new Set(); // item|month already matched
  const occ = {};
  return rows.map(r => {
    const m = r.date.slice(0, 7);
    const base = `${r.date}|${r.amount}|${norm(r.full || r.name)}`;
    occ[base] = (occ[base] || 0) + 1;
    const key = hashKey(`${base}#${occ[base]}`);
    const out = { ...r, month: m, key, target: r.amount < 0 ? 'other' : 'income', include: true, note: '' };
    const abs = Math.abs(r.amount);
    const text = `${r.name} ${r.full}`.toLowerCase();
    const wordHit = name => String(name).toLowerCase().split(/[^a-zäöüß0-9]+/).some(w => w.length >= 3 && text.includes(w));

    if (keysSeen.has(key)) { out.include = false; out.note = 'already imported'; return out; }
    const dup = txs.find(t => !t.importKey && t.kind === (r.amount < 0 ? 'expense' : 'income') && Math.abs(t.amount - abs) < 0.005
      && Math.abs((new Date(t.date) - new Date(r.date)) / 864e5) <= 3);
    if (dup) { out.include = false; out.note = `looks already entered ("${dup.name}")`; out.target = dup.budgetId ? `b:${dup.budgetId}` : out.target; return out; }

    if (r.amount > 0) {
      let best = null;
      for (const it of Store.live('items')) {
        if (it.kind !== 'income' || !Model.isActive(it, m) || used.has(`${it.id}|${m}`)) continue;
        const plan = Model.amountFor(it, m) || 0;
        const diff = Math.abs(plan - abs);
        if (plan && (diff <= plan * 0.1 || (wordHit(it.name) && diff <= plan * 0.3)) && (!best || diff < best.diff)) best = { it, diff };
      }
      if (best) {
        used.add(`${best.it.id}|${m}`); out.target = `item:${best.it.id}`; out.note = `matches ${best.it.name}`;
        if (best.it.paid && best.it.paid[m]) { out.include = false; out.note = `${best.it.name} already marked received`; }
      }
      return out;
    }
    // money out: fixed cost, credit or savings goal?
    let best = null;
    for (const it of Store.live('items')) {
      if (it.kind !== 'fixed' || !Model.isActive(it, m) || used.has(`${it.id}|${m}`)) continue;
      const plan = Model.amountFor(it, m) || 0;
      const diff = Math.abs(plan - abs);
      const ok = diff < 0.005 || (wordHit(it.name) && diff <= Math.max(1, plan * 0.15));
      if (plan && ok && (!best || diff < best.diff)) best = { t: `item:${it.id}`, id: `${it.id}|${m}`, name: it.name, diff };
    }
    for (const c of Store.live('credits')) {
      const d = Model.creditDue(c, m);
      if (!d || used.has(`${c.id}|${m}`)) continue;
      const diff = Math.abs(d.amount - abs);
      if (diff < 0.005 && (!best || diff < best.diff)) best = { t: `credit:${c.id}`, id: `${c.id}|${m}`, name: c.name, diff };
    }
    for (const g of Store.live('goals')) {
      const c = Model.goalContribution(g, m);
      if (!c || used.has(`${g.id}|${m}`)) continue;
      const diff = Math.abs(c - abs);
      if (diff < 0.005 && wordHit(g.name) && (!best || diff < best.diff)) best = { t: `goal:${g.id}`, id: `${g.id}|${m}`, name: g.name, diff };
    }
    if (best) {
      used.add(best.id); out.target = best.t; out.note = `matches ${best.name}`;
      const [coll, rid] = best.t.split(':');
      const rec = Store.get({ item: 'items', credit: 'credits', goal: 'goals' }[coll], rid);
      if (rec && rec.paid && rec.paid[m]) { out.include = false; out.note = `${best.name} already marked paid`; }
      return out;
    }

    const known = budgetsByName.get(norm(r.name));
    const active = Store.live('budgets').filter(b => Model.isActive(b, m));
    if (known && active.some(b => b.id === known)) { out.target = `b:${known}`; return out; }
    for (const [shop, budgetRe] of HINTS) {
      if (!shop.test(text)) continue;
      const b = active.find(x => budgetRe.test(x.name));
      if (b) { out.target = `b:${b.id}`; break; }
    }
    return out;
  });
}

/* ---------------- the import dialog ---------------- */
function csvImportStart() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv,text/plain,.txt';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await readTextFile(file);
      const delim = detectDelimiter(text);
      const rows = parseCSV(text, delim);
      if (rows.length < 2) throw new Error('The file looks empty.');
      const state = { fileName: file.name, text, delim, rows, headerIdx: detectHeaderRow(rows) };
      const saved = loadCsvMap(state);
      state.map = saved || guessMapping(rows, state.headerIdx);
      state.remembered = !!saved;
      csvStep1(state);
    } catch (e) { alert('Could not read this file: ' + e.message); }
  };
  input.click();
}

function csvSignature(state) { return state.headerIdx >= 0 ? state.rows[state.headerIdx].join('|').toLowerCase() : `noheader|${state.rows[0].length}`; }
function loadCsvMap(state) {
  try {
    const all = JSON.parse(localStorage.getItem(CSV_MAPS_KEY)) || {};
    const sig = Object.keys(all).find(s => s === csvSignature(state));
    return sig ? all[sig] : null;
  } catch { return null; }
}
function saveCsvMap(state) {
  try {
    const all = JSON.parse(localStorage.getItem(CSV_MAPS_KEY)) || {};
    all[csvSignature(state)] = state.map;
    localStorage.setItem(CSV_MAPS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function csvStep1(state) {
  const { rows, headerIdx, map } = state;
  const header = headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => `Column ${i + 1}`);
  const colOpts = (sel, optional) => `${optional ? `<option value="-1" ${sel < 0 ? 'selected' : ''}>— none —</option>` : ''}${header.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}`;
  const preview = buildRows(state);
  const delims = [[';', 'Semicolon ;'], [',', 'Comma ,'], ['\t', 'Tab'], ['|', 'Pipe |']];
  const body = `
    <p class="muted small">${esc(state.fileName)} · ${preview.length} transactions found${state.remembered ? ' · <b>using your saved settings for this bank</b>' : ''}</p>
    <p class="hint" style="margin-top:0">Check that the columns are right — the preview below should show sensible dates, names and amounts (money out with a minus). This is remembered for next time.</p>
    <div class="two">
      <label class="field"><span>Separator</span><select name="delim">${delims.map(([v, l]) => `<option value="${esc(v)}" ${v === state.delim ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Column names are in row</span><select name="headerIdx">
        <option value="-1" ${headerIdx < 0 ? 'selected' : ''}>No header row</option>
        ${rows.slice(0, 30).map((r, i) => `<option value="${i}" ${i === headerIdx ? 'selected' : ''}>${i + 1}: ${esc(r.slice(0, 3).join(' | ').slice(0, 40))}</option>`).join('')}
      </select></label>
    </div>
    <div class="two">
      <label class="field"><span>Date</span><select name="date">${colOpts(map.date)}</select></label>
      <label class="field"><span>Amount is in</span><select name="amountMode"><option value="one" ${map.amountMode === 'one' ? 'selected' : ''}>One column (+/−)</option><option value="two" ${map.amountMode === 'two' ? 'selected' : ''}>Two columns (out / in)</option></select></label>
    </div>
    ${map.amountMode === 'two'
      ? `<div class="two"><label class="field"><span>Money out</span><select name="out">${colOpts(map.out)}</select></label><label class="field"><span>Money in</span><select name="in">${colOpts(map.in)}</select></label></div>`
      : `<label class="field"><span>Amount</span><select name="amount">${colOpts(map.amount)}</select></label>`}
    <div class="two">
      <label class="field"><span>Name / payee</span><select name="name">${colOpts(map.name, true)}</select></label>
      <label class="field"><span>Details (optional)</span><select name="details">${colOpts(map.details, true)}</select></label>
    </div>
    <label class="toggle"><input type="checkbox" name="flip" ${map.flip ? 'checked' : ''}><span>Spending shows as <b>positive</b> numbers in this file (some credit card statements)</span></label>
    <div class="csv-preview">
      ${preview.slice(0, 6).map(r => `<div class="row"><span class="row-main"><span class="name">${esc(r.name)}</span><span class="sub">${esc(dateLabel(r.date))} ${r.date.slice(0, 4)}</span></span><span class="amt ${r.amount > 0 ? 'pos' : ''}">${r.amount > 0 ? '+' : '−'}${money(Math.abs(r.amount))}</span></div>`).join('') || '<p class="empty">No transactions recognised yet — adjust the columns above.</p>'}
    </div>
    <p class="form-error"></p>`;
  openModal('Import from bank — columns', body, {
    wide: true,
    submitLabel: 'Next →',
    onMount(form) {
      form.addEventListener('change', e => {
        const n = e.target.name, v = e.target.value;
        if (n === 'delim') {
          state.delim = v; state.rows = parseCSV(state.text, v);
          state.headerIdx = detectHeaderRow(state.rows); state.map = guessMapping(state.rows, state.headerIdx);
        } else if (n === 'headerIdx') {
          state.headerIdx = +v; state.map = guessMapping(state.rows, state.headerIdx);
        } else if (n === 'flip') state.map.flip = e.target.checked;
        else if (n === 'amountMode') state.map.amountMode = v;
        else if (n in state.map) state.map[n] = +v;
        state.remembered = false;
        csvStep1(state);
      });
    },
    onSubmit(fd, form) {
      const list = buildRows(state);
      if (!list.length) return formError(form, 'No transactions recognised — check the date and amount columns.');
      saveCsvMap(state);
      setTimeout(() => csvStep2(state, suggest(list)), 0);
      return false; // keep dialog open, step 2 replaces the content
    },
  });
}

function targetOptions(r) {
  const m = r.month;
  const opt = (v, l) => `<option value="${v}" ${v === r.target ? 'selected' : ''}>${esc(l)}</option>`;
  const parts = [opt('skip', "Don't import")];
  if (r.amount > 0) {
    parts.push(opt('income', 'One-time income'));
    const inc = Store.live('items').filter(i => i.kind === 'income' && Model.isActive(i, m));
    if (inc.length) parts.push(`<optgroup label="Monthly income (mark received)">${inc.map(i => opt(`item:${i.id}`, i.name)).join('')}</optgroup>`);
    return parts.join('');
  }
  parts.push(opt('other', 'Other spending'));
  const budgets = Store.live('budgets').filter(b => Model.isActive(b, m));
  if (budgets.length) parts.push(`<optgroup label="Budget">${budgets.map(b => opt(`b:${b.id}`, `${b.emoji || ''} ${b.name}`.trim())).join('')}</optgroup>`);
  const fixed = Store.live('items').filter(i => i.kind === 'fixed' && Model.isActive(i, m));
  if (fixed.length) parts.push(`<optgroup label="Fixed cost (mark paid)">${fixed.map(i => opt(`item:${i.id}`, i.name)).join('')}</optgroup>`);
  const credits = Store.live('credits').filter(c => Model.creditDue(c, m));
  if (credits.length) parts.push(`<optgroup label="Credit payment (mark paid)">${credits.map(c => opt(`credit:${c.id}`, c.name)).join('')}</optgroup>`);
  const goals = Store.live('goals').filter(g => !g.done && m >= g.start);
  if (goals.length) parts.push(`<optgroup label="Savings goal (put aside)">${goals.map(g => opt(`goal:${g.id}`, g.name)).join('')}</optgroup>`);
  return parts.join('');
}

function csvStep2(state, list) {
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  const first = list[list.length - 1].date, last = list[0].date;
  const skipped = list.filter(r => !r.include).length;
  const body = `
    <p class="muted small">${list.length} transactions from ${esc(dateLabel(first))} ${first.slice(0, 4)} to ${esc(dateLabel(last))} ${last.slice(0, 4)}.
      ${skipped ? `<b>${skipped}</b> unticked because they were already imported or look already entered.` : ''}</p>
    <p class="hint" style="margin-top:0">Check the category of each one. Matches with rent, subscriptions, salary or credits don't add a new entry — they tick that item as paid (and use the real amount for that month). Untick transfers between your own accounts.</p>
    <div class="imp-tools btn-row"><button type="button" class="btn small" data-m="all">Tick all</button><button type="button" class="btn small" data-m="none">Untick all</button></div>
    <div class="imp-list">
      ${list.map((r, i) => `<div class="imp-row ${r.include ? '' : 'off'}" data-i="${i}">
        <input type="checkbox" class="imp-check" name="inc${i}" ${r.include ? 'checked' : ''} aria-label="Import this">
        <div class="imp-main">
          <span class="name" title="${esc(r.full)}">${esc(r.name)}</span>
          <span class="sub">${esc(dateLabel(r.date))}${r.note ? ` · ${esc(r.note)}` : ''}</span>
        </div>
        <span class="amt ${r.amount > 0 ? 'pos' : ''}">${r.amount > 0 ? '+' : '−'}${money(Math.abs(r.amount))}</span>
        <select class="imp-target" name="t${i}">${targetOptions(r)}</select>
      </div>`).join('')}
    </div>
    <p class="form-error"></p>`;
  const count = form => $$('.imp-check', form).filter(c => c.checked).length;
  openModal('Import from bank — review', body, {
    wide: true,
    submitLabel: `Import ${list.filter(r => r.include && r.target !== 'skip').length}`,
    extraButtons: '<button type="button" class="btn" data-m="back">← Columns</button>',
    onMount(form) {
      const submit = $('#modal .modal-foot .btn.primary');
      const upd = () => { submit.textContent = `Import ${count(form)}`; };
      form.addEventListener('change', e => {
        const row = e.target.closest('.imp-row');
        if (!row) return;
        const chk = $('.imp-check', row), sel = $('.imp-target', row);
        if (e.target === sel) chk.checked = sel.value !== 'skip';
        if (e.target === chk && chk.checked && sel.value === 'skip') sel.value = list[+row.dataset.i].amount > 0 ? 'income' : 'other';
        row.classList.toggle('off', !chk.checked);
        upd();
      });
      $('[data-m=all]', form).onclick = () => { $$('.imp-row', form).forEach(r => { const s = $('.imp-target', r); if (s.value === 'skip') s.value = list[+r.dataset.i].amount > 0 ? 'income' : 'other'; $('.imp-check', r).checked = true; r.classList.remove('off'); }); upd(); };
      $('[data-m=none]', form).onclick = () => { $$('.imp-check', form).forEach(c => { c.checked = false; c.closest('.imp-row').classList.add('off'); }); upd(); };
      $('[data-m=back]', form).onclick = () => csvStep1(state);
      upd();
    },
    onSubmit(fd) {
      const res = applyImport(list.map((r, i) => ({ ...r, include: fd[`inc${i}`] === 'on', target: fd[`t${i}`] })));
      toast(`Imported ${res.added} transaction${res.added === 1 ? '' : 's'}${res.marked ? `, marked ${res.marked} as paid/received` : ''}`);
    },
  });
}

function applyImport(list) {
  const n = Date.now();
  const d = Store.data;
  let added = 0, marked = 0;
  const touch = (coll, id, fn) => {
    const i = d[coll].findIndex(r => r.id === id && !r.deleted);
    if (i < 0) return false;
    const rec = structuredClone(d[coll][i]);
    fn(rec); rec.updatedAt = n; d[coll][i] = rec;
    return true;
  };
  for (const r of list) {
    if (!r.include || r.target === 'skip') continue;
    const abs = Math.abs(r.amount);
    const [kind, id] = r.target.includes(':') ? r.target.split(/:(.+)/) : [r.target, null];
    if (kind === 'item') {
      if (touch('items', id, it => {
        it.paid = { ...(it.paid || {}), [r.month]: true };
        if (!it.day) it.day = +r.date.slice(8); // learn the day it's usually paid
        if (Math.abs((Model.amountFor(it, r.month) || 0) - abs) >= 0.005) Model.setAmountOnly(it, r.month, abs);
      })) marked++;
    } else if (kind === 'credit') {
      if (touch('credits', id, c => { c.paid = { ...(c.paid || {}), [r.month]: true }; if (!c.day) c.day = +r.date.slice(8); })) marked++;
    } else if (kind === 'goal') {
      if (touch('goals', id, g => {
        g.paid = { ...(g.paid || {}), [r.month]: true };
        if (Math.abs(Model.goalContribution(g, r.month) - abs) >= 0.005) g.put = { ...(g.put || {}), [r.month]: abs };
      })) marked++;
    } else {
      d.txs.push({
        id: uid(), kind: r.amount > 0 ? 'income' : 'expense', name: r.name, amount: abs, date: r.date, month: r.month,
        budgetId: kind === 'b' ? id : null, importKey: r.key, bankText: r.full.slice(0, 300), updatedAt: n,
      });
      added++;
    }
  }
  Store.commit();
  return { added, marked };
}

actions['import-csv'] = csvImportStart;
