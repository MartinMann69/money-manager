'use strict';

/* =====================================================================
   Money Manager — all data lives in localStorage on this device and is
   optionally synced to a private GitHub Gist (see sync.js).
   ===================================================================== */

/* ---------------- Utilities ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let _uidSeq = 0;
const uid = () => Date.now().toString(36) + (_uidSeq++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ym = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const today = () => { const d = new Date(); return `${ym(d)}-${pad(d.getDate())}`; };
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function addMonths(m, n) {
  let [y, mo] = m.split('-').map(Number);
  mo += n;
  y += Math.floor((mo - 1) / 12);
  mo = ((mo - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(mo)}`;
}
/** months from a to b (b - a) */
function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
function addDays(date, n) {
  const [y, mo, d] = date.split('-').map(Number);
  const x = new Date(y, mo - 1, d + n);
  return `${ym(x)}-${pad(x.getDate())}`;
}
function daysInMonth(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }

/** Accepts "12.5", "12,50", "1.234,56", "1,234.56", "€ 12" */
function parseAmount(v) {
  if (typeof v === 'number') return r2(v);
  let t = String(v || '').replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.')) {
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (t.includes(',')) {
    t = t.replace(',', '.');
  }
  const n = parseFloat(t);
  return isNaN(n) ? NaN : r2(n);
}

const locale = () => (Store.data.settings.locale || undefined);
let _fmt = null, _fmtKey = '';
function money(n) {
  const s = Store.data.settings;
  const key = `${s.currency}|${s.locale}`;
  if (key !== _fmtKey) {
    try { _fmt = new Intl.NumberFormat(s.locale || undefined, { style: 'currency', currency: s.currency || 'EUR' }); }
    catch { _fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }); }
    _fmtKey = key;
  }
  return _fmt.format(r2(n));
}
function monthLabel(m, short = false) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(locale(), { month: short ? 'short' : 'long', year: 'numeric' });
}
function monthOnly(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(locale(), { month: 'short' });
}
function dateLabel(d) {
  const [y, mo, da] = d.split('-').map(Number);
  return new Date(y, mo - 1, da).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}
function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleString(locale());
}

const EVERY = { 1: 'Monthly', 2: 'Every 2 months', 3: 'Every 3 months', 6: 'Every 6 months', 12: 'Yearly' };
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'TRY', 'JPY', 'CNY', 'INR', 'CAD', 'AUD', 'NZD', 'BRL', 'MXN', 'ZAR'];
const LOCALES = [['', 'Automatic (this device)'], ['en-US', '1,234.56'], ['de-DE', '1.234,56'], ['fr-FR', '1 234,56'], ['de-CH', "1’234.56"], ['en-GB', '1,234.56 (UK)']];

/* ---------------- Data store ---------------- */
const STORAGE_KEY = 'mm-data-v1';
const COLLS = ['items', 'budgets', 'txs', 'credits', 'goals', 'wishes'];

function emptyData() {
  return { version: 1, settings: { currency: 'EUR', locale: '', balance: null, cushion: 0, carryOver: true, updatedAt: 0 }, items: [], budgets: [], txs: [], credits: [], goals: [], wishes: [] };
}
function normalizeData(d) {
  const e = emptyData();
  d = d || {};
  const out = { ...e, settings: { ...e.settings, ...(d.settings || {}) } };
  for (const k of COLLS) out[k] = Array.isArray(d[k]) ? d[k] : [];
  return out;
}

const Store = {
  data: emptyData(),
  rev: 0, // bumps on every change; used to cache calculations
  load() {
    this.rev++;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.data = raw ? normalizeData(JSON.parse(raw)) : emptyData();
    } catch { this.data = emptyData(); }
  },
  persist() {
    this.rev++;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
    catch (e) { toast('Could not save on this device: ' + e.message); }
  },
  /** save locally, re-render, push to sync */
  commit() {
    this.persist();
    render();
    Sync.schedule();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  },
  /** used by sync: replace without triggering another sync */
  replace(d) { this.data = normalizeData(d); this.persist(); render(true); },
  live(coll) { return this.data[coll].filter(r => !r.deleted); },
  get(coll, id) { return this.data[coll].find(r => r.id === id && !r.deleted); },
  put(coll, rec) {
    rec.updatedAt = Date.now();
    const arr = this.data[coll];
    const i = arr.findIndex(r => r.id === rec.id);
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    this.commit();
    return rec;
  },
  del(coll, id) {
    const arr = this.data[coll];
    const i = arr.findIndex(r => r.id === id);
    if (i >= 0) arr[i] = { id, deleted: true, updatedAt: Date.now() };
    this.commit();
  },
  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch, updatedAt: Date.now() };
    this.commit();
  },
};
/** clone a record, change it, save it */
function edit(coll, id, fn) {
  const cur = Store.get(coll, id);
  if (!cur) return;
  const rec = structuredClone(cur);
  fn(rec);
  Store.put(coll, rec);
}
/** replace everything (restore / reset) in a way that also wins against synced copies */
function replaceAll(newData) {
  const n = Date.now();
  const d = normalizeData(newData);
  const out = emptyData();
  out.settings = { ...d.settings, updatedAt: n };
  for (const k of COLLS) {
    const keep = d[k].filter(r => !r.deleted).map(r => ({ ...r, updatedAt: n }));
    const ids = new Set(keep.map(r => r.id));
    const tomb = Store.data[k].filter(r => !ids.has(r.id)).map(r => ({ id: r.id, deleted: true, updatedAt: n }));
    out[k] = [...keep, ...tomb];
  }
  Store.data = out;
  Store.commit();
}

/* ---------------- Budget logic ----------------
   items:   recurring income / fixed costs  {kind, name, every, start, end, amounts:[{from,amount}], overrides:{month: amount|null}, paid:{month:true}}
   budgets: planned spending per category    {name, emoji, every:1, start, end, amounts, overrides}
   txs:     actual money in/out              {kind:'expense'|'income', name, amount, date, month (month it is paid in), budgetId}
   credits: things paid off in installments  {name, total, payments, start, paid:{month:true}}
------------------------------------------------- */
const Model = {
  isActive(it, m) {
    if (!it.start || m < it.start) return false;
    if (it.end && m > it.end) return false;
    return monthDiff(it.start, m) % (it.every || 1) === 0;
  },
  baseAmount(it, m) {
    const list = [...(it.amounts || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
    if (!list.length) return 0;
    let a = list[0].amount;
    for (const e of list) if (e.from <= m) a = e.amount;
    return a;
  },
  hasOverride(it, m) { return !!it.overrides && Object.prototype.hasOwnProperty.call(it.overrides, m); },
  isSkipped(it, m) { return this.hasOverride(it, m) && it.overrides[m] === null; },
  amountFor(it, m) {
    if (!this.isActive(it, m)) return null;
    if (this.hasOverride(it, m)) return it.overrides[m] === null ? 0 : it.overrides[m];
    return this.baseAmount(it, m);
  },
  /** change amount from month m on (history kept) */
  setAmountFrom(it, m, amount) {
    const from = m < it.start ? it.start : m;
    it.amounts = (it.amounts || []).filter(e => e.from < from);
    it.amounts.push({ from, amount });
    if (it.overrides) delete it.overrides[m];
  },
  setAmountOnly(it, m, amount) {
    it.overrides = { ...(it.overrides || {}) };
    if (amount === this.baseAmount(it, m)) delete it.overrides[m];
    else it.overrides[m] = amount;
  },

  creditPart(c, i) {
    const cents = Math.round(c.total * 100), n = c.payments;
    const base = Math.floor(cents / n);
    return (i < n - 1 ? base : cents - base * (n - 1)) / 100;
  },
  creditDue(c, m) {
    const i = monthDiff(c.start, m);
    if (i < 0 || i >= c.payments) return null;
    return { index: i, amount: this.creditPart(c, i) };
  },
  creditEnd(c) { return addMonths(c.start, c.payments - 1); },
  /** amount still to pay after month m */
  creditRemainingAfter(c, m) {
    let sum = 0;
    for (let i = Math.max(0, monthDiff(c.start, m) + 1); i < c.payments; i++) sum += this.creditPart(c, i);
    return r2(sum);
  },
  paymentsLeftFrom(c, m) { return Math.min(c.payments, Math.max(0, c.payments - monthDiff(c.start, m))); },

  /* ---- cached lookups (rebuilt whenever data changes) ---- */
  _idx: null,
  idx() {
    if (this._idx && this._idx.rev === Store.rev && this._idx.cur === ym()) return this._idx;
    const spent = new Map(), byMonth = new Map();
    for (const tx of Store.live('txs')) {
      if (!byMonth.has(tx.month)) byMonth.set(tx.month, []);
      byMonth.get(tx.month).push(tx);
      if (tx.kind !== 'income' && tx.budgetId) {
        const k = `${tx.budgetId}|${tx.month}`;
        spent.set(k, r2((spent.get(k) || 0) + tx.amount));
      }
    }
    this._idx = { rev: Store.rev, cur: ym(), spent, byMonth, sums: new Map() };
    return this._idx;
  },
  budgetSpent(id, m) { return this.idx().spent.get(`${id}|${m}`) || 0; },

  /** money carried into month m from earlier months (only for budgets with carry-over on) */
  budgetCarry(b, m) {
    if (!b.rollover) return 0;
    const cur = ym();
    let carry = 0;
    for (let k = b.start; k < m; k = addMonths(k, 1)) {
      if (!this.isActive(b, k)) continue;
      const avail = r2((this.amountFor(b, k) || 0) + carry);
      if (k < cur) carry = r2(avail - this.budgetSpent(b.id, k));           // what was really left
      else if (k === cur) carry = Math.min(0, r2(avail - this.budgetSpent(b.id, k))); // overspending so far carries; leftover is still being spent
      else carry = Math.min(0, avail);                                       // future: assume the plan gets used
    }
    return carry;
  },

  /* ---- savings goals ---- */
  /** contribution in each month from start until `until` */
  goalPlan(g, until) {
    let saved = r2(g.initial || 0), reach = saved >= g.target ? g.start : null;
    const months = new Map();
    const last = until || addMonths(g.start, 600);
    for (let k = g.start; k <= last; k = addMonths(k, 1)) {
      let c;
      if (g.put && Object.prototype.hasOwnProperty.call(g.put, k)) c = g.put[k];
      else if (g.done) c = 0;
      else c = Math.max(0, Math.min(g.monthly || 0, r2(g.target - saved)));
      saved = r2(saved + c);
      months.set(k, { c, saved });
      if (!reach && saved >= g.target) reach = k;
      if (!until && (reach || g.done || !(g.monthly > 0)) && !(g.put && Object.keys(g.put).some(p => p > k))) break;
    }
    return { months, reach, saved };
  },
  goalContribution(g, m) {
    if (m < g.start) return 0;
    const e = this.goalPlan(g, m).months.get(m);
    return e ? e.c : 0;
  },
  goalSavedBy(g, m) {
    if (m < g.start) return r2(g.initial || 0);
    return this.goalPlan(g, m).saved;
  },

  /* ---- wishlist ---- */
  /** what wish w costs in month m if bought in month `start` */
  wishCost(w, start, m) {
    if (!start) return 0;
    if (w.pay === 'split' && w.payments > 1) {
      const d = this.creditDue({ total: w.price, payments: w.payments, start }, m);
      return d ? d.amount : 0;
    }
    return m === start ? r2(w.price) : 0;
  },
  wishPlanned(w) { return !!(w.month && w.month >= ym()); },

  /** start-of-current-month balance and end-of-month balances for the next H months */
  /* ---- days within a month ---- */
  /** day of month m this record is paid (clamped to short months), or null if no day is set */
  dayOf(rec, m) { return rec && rec.day ? Math.min(rec.day, daysInMonth(m)) : null; },

  /** money in/out of month m in date order, with the running balance through the month */
  timeline(m) {
    const cache = this.idx().sums, key = `tl|${m}`;
    if (cache.has(key)) return cache.get(key);
    const S = this.summarize(m), cur = ym(), dim = daysInMonth(m);
    const todayD = m === cur ? new Date().getDate() : m < cur ? dim : 0;
    const ev = [];
    const add = (day, name, amount, kind, extra = {}) => { if (amount) ev.push({ day, name, amount: r2(amount), kind, ...extra }); };
    const txDay = tx => (tx.date.slice(0, 7) === m ? +tx.date.slice(8) : 1);
    for (const r of S.income) {
      if (r.it) { if (!r.skipped) add(this.dayOf(r.it, m), r.it.name, r.amount, 'income', { id: r.it.id, action: 'item-month', paid: r.paid }); }
      else add(txDay(r.tx), r.tx.name, r.amount, 'income', { id: r.tx.id, action: 'edit-tx', actual: true });
    }
    for (const r of S.fixed) if (!r.skipped) add(this.dayOf(r.it, m), r.it.name, -r.amount, 'fixed', { id: r.it.id, action: 'item-month', paid: r.paid, group: fixedGroup(r.it) });
    for (const r of S.credits) add(this.dayOf(r.c, m), r.c.name, -r.amount, 'credit', { id: r.c.id, action: 'edit-credit', paid: r.paid });
    for (const r of S.savings) add(this.dayOf(r.g, m), `${r.g.emoji ? r.g.emoji + ' ' : ''}${r.g.name}`, -r.amount, 'savings', { id: r.g.id, action: 'goal-month', paid: r.paid });
    for (const r of S.wishes) add(null, r.w.name, -r.amount, 'wish', { id: r.w.id, action: 'edit-wish' });
    // everyday spending (budgets + other) by its date — counted, but not listed one by one
    const daily = new Array(dim + 2).fill(0);
    for (const b of S.budgets) for (const tx of b.txs) daily[txDay(tx)] -= tx.amount;
    for (const tx of S.other) daily[txDay(tx)] -= tx.amount;
    // budget money not spent yet is spread over the remaining days
    const rem = S.past ? 0 : S.t.budgetLeft;
    const firstSpread = m === cur ? todayD + 1 : 1;
    const spreadDays = Math.max(0, dim - firstSpread + 1);
    const perDay = spreadDays ? rem / spreadDays : 0;

    // start = money on the account on the 1st: entered savings/balance + leftovers since then
    const acct = this.accountStart(m);
    const known = acct !== null;
    const start = known ? acct : this.carryIn(m);
    let bal = start, low = Infinity, lowDay = null, now = null, spread = 0;
    const dayBal = [];
    // something ticked as paid/received before its day already happened: count it today
    for (const e of ev) e.eff = m === cur && e.paid && e.day && e.day > todayD ? todayD : (e.day || 1);
    for (let d = 1; d <= dim; d++) {
      for (const e of ev) if (e.eff === d && e.amount > 0) bal += e.amount;   // money in first (usually arrives early in the day)
      for (const e of ev) if (e.eff === d && e.amount < 0) bal += e.amount;
      bal += daily[d];
      if (d >= firstSpread) { const s = d === dim ? r2(rem - spread) : r2(perDay); spread = r2(spread + s); bal -= s; }
      bal = r2(bal);
      dayBal[d] = bal;
      if (d >= Math.max(1, todayD) && bal < low) { low = bal; lowDay = d; }
    }
    if (!spreadDays && todayD === dim && lowDay === null) { low = bal; lowDay = dim; }
    ev.sort((a, b) => (a.day || 0) - (b.day || 0) || b.amount - a.amount);
    ev.forEach(e => { e.balance = dayBal[e.eff]; });
    const nextIncome = d => ev.find(e => e.amount > 0 && (e.day || 1) > d);
    // balance today = start + what really came in / went out so far:
    // entries dated up to today, plus income/bills that are ticked or whose day has passed.
    // Things without a day that aren't ticked yet are not counted (listed in `pending`).
    const pending = [];
    if (todayD) {
      now = start;
      for (const e of ev) {
        if (e.kind === 'wish') continue;
        // entries you typed in count from their date; income/bills once ticked, or automatically the day after their day
        const happened = e.actual ? (e.day || 1) <= todayD : (e.paid || (e.day && e.day < todayD));
        if (happened) now += e.amount;
        else if (!e.day) pending.push(e);
      }
      for (let d = 1; d <= todayD; d++) now += daily[d];
      now = r2(now);
    }
    const res = { m, ev, dayBal, start, known, end: r2(bal), low: low === Infinity ? null : low, lowDay, now, pending, todayD, nextIncome, undated: ev.filter(e => !e.day), budgetLeft: rem };
    cache.set(key, res);
    return res;
  },

  /* ---- paydays: how much has to be on the account for the bills ---- */
  /** main income of month m that has a day set (the biggest one) */
  payday(m) {
    let best = null;
    for (const r of this.summarize(m).income) {
      if (!r.it || r.skipped || !r.it.day) continue;
      if (!best || r.amount > best.amount) best = { it: r.it, amount: r.amount, day: this.dayOf(r.it, m), date: `${m}-${pad(this.dayOf(r.it, m))}` };
    }
    return best;
  },
  /** bills (fixed costs, credits, savings) from date `from` to `to` (inclusive, YYYY-MM-DD) */
  billsBetween(from, to) {
    const out = [];
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) {
      for (const e of this.timeline(m).ev) {
        if (e.amount >= 0 || e.kind === 'wish') continue;
        const date = `${m}-${pad(e.day || 1)}`;
        if (date >= from && date <= to) out.push({ ...e, date, m, amount: -e.amount });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  },
  /** the pay period around month m: from one payday to the day before the next one */
  payCycle(m) {
    const cur = ym();
    const t = today();
    const here = this.payday(m);
    if (!here) return null;
    let from, to, pay;
    const nextOf = mm => { for (let i = 1; i <= 3; i++) { const p = this.payday(addMonths(mm, i)); if (p) return p; } return null; };
    // this month: the period that contains today. Other months: the period covering most of the month
    const usePrev = m === cur ? t < here.date : here.day > 15;
    if (usePrev) {                                  // period started at the previous payday
      let prev = null;
      for (let i = 1; i <= 3 && !prev; i++) prev = this.payday(addMonths(m, -i));
      pay = prev; from = prev ? prev.date : `${m}-01`; to = addDays(here.date, -1);
    } else {
      const next = nextOf(m);
      pay = here; from = here.date; to = next ? addDays(next.date, -1) : `${addMonths(m, 1)}-${pad(daysInMonth(addMonths(m, 1)))}`;
    }
    const bills = this.billsBetween(from, to);
    const total = r2(bills.reduce((s, b) => s + b.amount, 0));
    // everyday spending in that period, from the budgets
    let spend = 0;
    for (let mm = from.slice(0, 7); mm <= to.slice(0, 7); mm = addMonths(mm, 1)) {
      const dim = daysInMonth(mm);
      const d1 = mm === from.slice(0, 7) ? +from.slice(8) : 1, d2 = mm === to.slice(0, 7) ? +to.slice(8) : dim;
      spend += (this.summarize(mm).t.planned * Math.max(0, d2 - d1 + 1)) / dim;
    }
    const nextPay = addDays(to, 1);
    return { from, to, pay, nextPay, bills, total, spend: r2(spend), isCurrent: m === cur && t >= from && t <= to };
  },

  /** everything coming in / going out from one payday to the next (falls back to the calendar month) */
  cycleTimeline(m) {
    const cache = this.idx().sums, key = `cyc|${m}`;
    if (cache.has(key)) return cache.get(key);
    const P = this.payCycle(m);
    const from = P ? P.from : `${m}-01`, to = P ? P.to : `${m}-${pad(daysInMonth(m))}`;
    const t0 = today();
    const ev = [];
    let low = Infinity, lowDate = null, anyKnown = false;
    for (let mm = from.slice(0, 7); mm <= to.slice(0, 7); mm = addMonths(mm, 1)) {
      const T = this.timeline(mm);
      for (const e of T.ev) {
        const date = `${mm}-${pad(e.eff)}`;
        if (date >= from && date <= to) ev.push({ ...e, date, m: mm });
      }
      if (!T.known) continue; // balances only where the starting money is known
      anyKnown = true;
      for (let d = 1; d <= daysInMonth(mm); d++) {
        const date = `${mm}-${pad(d)}`;
        if (date < from || date > to || date < t0) continue; // lowest point from today on
        if (T.dayBal[d] < low) { low = T.dayBal[d]; lowDate = date; }
      }
    }
    // money at the start of the period = what was there at the end of the day before
    const Tf = this.timeline(from.slice(0, 7));
    const start = from.slice(8) === '01' ? Tf.start : Tf.dayBal[+from.slice(8) - 1];
    const res = {
      P, from, to, ev, start: Tf.known ? start : null, known: anyKnown,
      low: low === Infinity ? null : low, lowDate,
      now: from <= t0 && t0 <= to ? this.timeline(ym()).now : null,
      budgetLeft: this.timeline(ym()).budgetLeft,
    };
    cache.set(key, res);
    return res;
  },

  /** bills not paid yet from today until `until`: dated ones after today (or today and not ticked),
      plus this month's bills without a day that aren't ticked yet */
  billsStillToPay(until) {
    const cur = ym(), t0 = today();
    // a bill is either still to pay or already paid (ticked) — never both
    const bills = this.billsBetween(t0, until).filter(b => (b.m !== cur || b.day) && !b.paid);
    for (const e of this.timeline(cur).pending) if (e.amount < 0) bills.push({ ...e, amount: -e.amount, date: null, m: cur });
    return bills.sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));
  },

  /* ---- free to spend: money you can use for anything without missing a bill ---- */
  freeToSpend() {
    const cur = ym(), t0 = today();
    const T = this.timeline(cur);
    if (!T.known || T.now === null) return null;
    const P = this.payCycle(cur);
    const paydayKnown = !!(P && P.isCurrent);
    const until = paydayKnown ? P.to : `${cur}-${pad(daysInMonth(cur))}`;
    const bills = this.billsStillToPay(until);
    const billTotal = r2(bills.reduce((s, b) => s + b.amount, 0));
    // planned purchases in that period
    const wishes = [];
    for (let m = cur; m <= until.slice(0, 7); m = addMonths(m, 1)) {
      // planned purchases have no day: this month's are still to come, later ones count from the 1st
      for (const w of this.summarize(m).wishes) if (`${m}-01` <= until) wishes.push({ name: w.w.name, amount: w.amount, m });
    }
    const wishTotal = r2(wishes.reduce((s, w) => s + w.amount, 0));
    // budget money (food etc.) still planned until then
    let budgets = 0;
    const todayD = new Date().getDate();
    for (let m = cur; m <= until.slice(0, 7); m = addMonths(m, 1)) {
      const S = this.summarize(m), dim = daysInMonth(m);
      const endD = m === until.slice(0, 7) ? +until.slice(8) : dim;
      if (m === cur) budgets += S.t.budgetLeft * Math.max(0, endD - todayD + 1) / (dim - todayD + 1);
      else budgets += S.t.planned * endD / dim;
    }
    budgets = r2(budgets);
    const cushion = r2(Store.data.settings.cushion || 0);
    const free = r2(T.now - billTotal - wishTotal - budgets - cushion);
    const [y, mo, d] = until.split('-').map(Number);
    const days = Math.max(1, Math.round((new Date(y, mo - 1, d) - new Date(new Date().getFullYear(), new Date().getMonth(), todayD)) / 864e5) + 1);
    return { free, now: T.now, bills, billTotal, wishes, wishTotal, budgets, cushion, until, paydayKnown, nextPay: paydayKnown ? P.nextPay : null, days, perDay: free > 0 ? r2(free / days) : 0 };
  },

  /* ---- money left over from earlier months ---- */
  carryOn() { return Store.data.settings.carryOver !== false; },
  /** month you started tracking: when the first entry was created (ids start with a timestamp),
      or earlier if you entered/imported real spending for earlier months. At most 3 years back. */
  trackStart() {
    const cache = this.idx().sums;
    if (cache.has('start')) return cache.get('start');
    const fixedStart = Store.data.settings.trackFrom; // set by "start counting from this month"
    if (isMonth(fixedStart)) { cache.set('start', fixedStart); return fixedStart; }
    let s = ym();
    const now = Date.now();
    for (const k of COLLS) for (const r of Store.live(k)) {
      const ts = parseInt(String(r.id).slice(0, 8), 36);
      if (ts > 1.5e12 && ts <= now + 864e5) { const m = ym(new Date(ts)); if (m < s) s = m; }
    }
    for (const tx of Store.live('txs')) if (isMonth(tx.month) && tx.month < s) s = tx.month;
    const cap = addMonths(ym(), -36);
    if (s < cap) s = cap;
    cache.set('start', s);
    return s;
  },
  /** money on the account on the 1st of month m (entered balance + what was left since), or null if unknown */
  accountStart(m) {
    const bal = Store.data.settings.balance;
    if (!bal || !isMonth(bal.month) || bal.month > m) return null;
    const cache = this.idx().sums, key = `acct|${m}`;
    if (cache.has(key)) return cache.get(key);
    let v = bal.amount;
    for (let x = bal.month; x < m; x = addMonths(x, 1)) v = r2(v + this.summarize(x).t.left);
    cache.set(key, v);
    return v;
  },
  /** what was left over (or overspent, negative) from all months before m, since you started using the app */
  carryIn(m) {
    if (!this.carryOn()) return 0;
    const cache = this.idx().sums, key = `carry|${m}`;
    if (cache.has(key)) return cache.get(key);
    let v = 0;
    if (m > this.trackStart()) {
      const p = addMonths(m, -1);
      v = r2(this.carryIn(p) + this.summarize(p).t.left);
    }
    cache.set(key, v);
    return v;
  },

  balanceSeries(H = 24) {
    const cur = ym();
    const key = `bal|${H}`;
    const cache = this.idx().sums;
    if (cache.has(key)) return cache.get(key);
    const bal = Store.data.settings.balance;
    let running = 0;
    if (bal && isMonth(bal.month) && bal.month <= cur) {
      running = bal.amount;
      for (let x = bal.month; x < cur; x = addMonths(x, 1)) running = r2(running + this.summarize(x).t.left);
    } else running = this.carryIn(cur); // leftovers from earlier months (0 when switched off)
    const months = [], end = [], left = [];
    for (let i = 0; i < H; i++) {
      const m = addMonths(cur, i);
      if (bal && isMonth(bal.month) && bal.month > cur && bal.month === m) running = bal.amount;
      const l = this.summarize(m).t.left;
      running = r2(running + l);
      months.push(m); end.push(running); left.push(l);
    }
    const res = { months, end, left, hasBalance: !!bal };
    cache.set(key, res);
    return res;
  },
  /** balances with wish w taken out of the plan */
  seriesWithout(w, series) {
    if (!w || !this.wishPlanned(w)) return series.end.slice();
    let cum = 0;
    return series.end.map((v, i) => { cum += this.wishCost(w, w.month, series.months[i]); return r2(v + cum); });
  },
  /** does w fit if bought in month `start`? base = balances without w */
  wishFit(w, start, base, months) {
    const i0 = months.indexOf(start);
    if (i0 < 0) return null;
    const cushion = Store.data.settings.cushion || 0;
    let cum = 0, worst = Infinity, worstM = null;
    for (let i = i0; i < months.length; i++) {
      cum += this.wishCost(w, start, months[i]);
      const v = r2(base[i] - cum);
      if (v < worst) { worst = v; worstM = months[i]; }
    }
    return { ok: worst >= cushion, worst, worstM };
  },
  wishBest(w, base, months) {
    for (const m of months) { const f = this.wishFit(w, m, base, months); if (f && f.ok) return m; }
    return null;
  },

  summarize(m) {
    const cache = this.idx().sums;
    if (cache.has(m)) return cache.get(m);
    const S = this._summarize(m);
    cache.set(m, S);
    return S;
  },
  _summarize(m) {
    const cur = ym();
    const S = { m, past: m < cur, current: m === cur, future: m > cur, income: [], fixed: [], budgets: [], credits: [], other: [], savings: [], wishes: [], t: {} };
    for (const it of Store.live('items')) {
      if (!this.isActive(it, m)) continue;
      const skipped = this.isSkipped(it, m);
      const row = {
        it, skipped,
        amount: skipped ? 0 : this.amountFor(it, m),
        paid: !!(it.paid && it.paid[m]),
        changed: !skipped && this.hasOverride(it, m),
      };
      (it.kind === 'income' ? S.income : S.fixed).push(row);
    }
    const bmap = new Map();
    for (const b of Store.live('budgets')) {
      if (!this.isActive(b, m)) continue;
      const planned = this.amountFor(b, m) || 0, carry = this.budgetCarry(b, m);
      bmap.set(b.id, { b, planned, carry, available: r2(planned + carry), changed: this.hasOverride(b, m), spent: 0, txs: [] });
    }
    for (const tx of this.idx().byMonth.get(m) || []) {
      if (tx.kind === 'income') { S.income.push({ tx, amount: tx.amount }); continue; }
      const bb = tx.budgetId && bmap.get(tx.budgetId);
      if (bb) { bb.spent = r2(bb.spent + tx.amount); bb.txs.push(tx); }
      else S.other.push(tx);
    }
    // order by the day money comes in / goes out (no day = at the end)
    const dayKey = x => (x.it ? this.dayOf(x.it, m) : x.tx ? +x.tx.date.slice(8) : null) || 99;
    S.income.sort((a, b) => dayKey(a) - dayKey(b));
    S.fixed.sort((a, b) => dayKey(a) - dayKey(b));
    S.budgets = [...bmap.values()];
    S.budgets.forEach(b => b.txs.sort((a, c) => (a.date < c.date ? 1 : -1)));
    S.other.sort((a, c) => (a.date < c.date ? 1 : -1));
    for (const c of Store.live('credits')) {
      const d = this.creditDue(c, m);
      if (d) S.credits.push({ c, ...d, paid: !!(c.paid && c.paid[m]) });
    }
    for (const g of Store.live('goals')) {
      if (m < g.start) continue;
      const plan = this.goalPlan(g, m).months.get(m);
      if (!plan || (plan.c === 0 && !(g.put && Object.prototype.hasOwnProperty.call(g.put, m)))) continue;
      S.savings.push({ g, amount: plan.c, saved: plan.saved, paid: !!(g.paid && g.paid[m]), changed: !!(g.put && Object.prototype.hasOwnProperty.call(g.put, m)) });
    }
    for (const w of Store.live('wishes')) {
      if (!this.wishPlanned(w)) continue;
      const amount = this.wishCost(w, w.month, m);
      if (amount) S.wishes.push({ w, amount, index: monthDiff(w.month, m) });
    }
    const sum = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));
    const t = S.t;
    t.income = sum(S.income, x => x.amount);
    t.fixed = sum(S.fixed, x => x.amount);
    t.credits = sum(S.credits, x => x.amount);
    t.planned = sum(S.budgets, x => x.available);
    t.spent = sum(S.budgets, x => x.spent);
    // past months: what was actually spent. current/future: plan, or more if already over plan
    t.budgets = S.past ? t.spent : sum(S.budgets, x => Math.max(x.available, x.spent, 0));
    t.budgetLeft = sum(S.budgets, x => Math.max(0, x.available - x.spent));
    t.budgetOver = sum(S.budgets, x => Math.max(0, x.spent - Math.max(0, x.available)));
    t.other = sum(S.other, x => x.amount);
    t.savings = sum(S.savings, x => x.amount);
    t.wishes = sum(S.wishes, x => x.amount);
    t.out = r2(t.fixed + t.credits + t.budgets + t.other + t.savings + t.wishes);
    t.left = r2(t.income - t.out);
    return S;
  },
};

/* ---------------- UI state ---------------- */
const UI = {
  tab: 'month', month: ym(), arrange: false,
  // sidebar open/closed is remembered; first time it's open on big screens
  side: (() => { try { const v = localStorage.getItem('mm-side-open'); return v === null ? innerWidth >= 1280 : v === '1'; } catch { return false; } })(),
};
let deferredInstall = null;
let pendingRender = false;

/** soft = background update (sync): wait if the user is typing in a field on the page */
function render(soft = false) {
  const ae = document.activeElement;
  if (soft && ae && $('#view').contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) { pendingRender = true; return; }
  pendingRender = false;
  const views = { month: viewMonth, plan: viewPlan, goals: viewGoals, forecast: viewForecast, settings: viewSettings };
  $('#view').innerHTML = (views[UI.tab] || viewMonth)();
  $('#view').dataset.tab = UI.tab;
  document.body.dataset.tab = UI.tab;
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === UI.tab));
  $('#fab').hidden = UI.tab !== 'month';
  renderSyncPill();
  renderBalancePill();
}

/* ---------------- Current balance ---------------- */
/** estimated money on the account today, or null if the app doesn't know the starting amount yet */
function currentBalance() {
  const T = Model.timeline(ym());
  return T.known && T.now !== null ? T.now : null;
}
function renderBalancePill() {
  const btn = $('#balBtn');
  if (!btn) return;
  const b = currentBalance();
  btn.innerHTML = b === null ? 'Set balance' : `<span class="bp-label">Balance</span> ${esc(money(b))}`;
  btn.classList.toggle('neg', b !== null && b < 0);
  btn.classList.toggle('unset', b === null);
}
function balanceTile() {
  const b = currentBalance();
  if (b === null) {
    return `<button type="button" class="bal-tile unset" data-action="balance-edit">
      <span class="pb-label">Current balance</span>
      <span class="bt-cta">Enter what's on your account now →</span>
    </button>`;
  }
  return `<button type="button" class="bal-tile" data-action="balance-edit">
    <span class="pb-label">Current balance · ${esc(dateLabel(today()))}</span>
    <span class="pb-big ${b < 0 ? 'neg' : ''}">≈ ${money(b)}</span>
    <span class="bt-sub">Estimated from what you entered — tap to correct it to your bank balance</span>
  </button>`;
}
function freeTile() {
  const F = Model.freeToSpend();
  if (!F) return '';
  const untilText = F.paydayKnown ? `until payday (${esc(dateLabel(F.nextPay))})` : `until ${esc(dateLabel(F.until))}`;
  const parts = [
    F.billTotal ? `${money(F.billTotal)} bills` : '',
    F.budgets ? `${money(F.budgets)} for your budgets` : '',
    F.wishTotal ? `${money(F.wishTotal)} planned buys` : '',
    F.cushion ? `${money(F.cushion)} cushion` : '',
  ].filter(Boolean);
  return `<button type="button" class="free-tile ${F.free < 0 ? 'bad' : ''}" data-action="free-info">
    <span class="pb-label">Free to spend ${untilText}</span>
    <span class="pb-big">${money(F.free)}</span>
    <span class="bt-sub">${F.free > 0 ? `≈ ${money(F.perDay)} per day for ${F.days} day${F.days === 1 ? '' : 's'} · ` : F.free < 0 ? 'Not enough for what still has to be paid · ' : ''}${parts.length ? `already kept back: ${parts.join(', ')}` : 'nothing else to pay'}</span>
  </button>`;
}
function freeModal() {
  const F = Model.freeToSpend();
  if (!F) return;
  const line = (label, v, cls = '') => `<div class="carry-line ${cls}"><span>${label}</span><b>${v}</b></div>`;
  const billRows = F.bills.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1).map(b =>
    `<div class="row"><span class="row-main"><span class="name">${esc(b.name)}</span><span class="sub">${b.date ? esc(dateLabel(b.date)) : 'no day set, not ticked yet'}</span></span><span class="amt">${money(b.amount)}</span></div>`).join('');
  const body = `
    <p class="muted">What you can spend on anything — going out, a spontaneous buy — ${F.paydayKnown ? `until your next salary on ${esc(dateLabel(F.nextPay))}` : `until ${esc(dateLabel(F.until))}`}, and still pay everything that has to be paid.</p>
    <div class="carry">
      ${line('On your account now', money(F.now))}
      ${line('− Bills still to come', money(F.billTotal), 'muted')}
      ${line('− Budget money still planned (food etc.)', money(F.budgets), 'muted')}
      ${F.wishTotal ? line('− Planned purchases', money(F.wishTotal), 'muted') : ''}
      ${F.cushion ? line('− Cushion you always want to keep', money(F.cushion), 'muted') : ''}
      ${line('= Free to spend', `<span class="${F.free < 0 ? 'neg' : 'pos'}">${money(F.free)}</span>`, 'need-total')}
    </div>
    ${F.free < 0 ? `<p class="cal-alert bad">You're ${money(-F.free)} short until then. Spend less from your budgets, move money over, or move a planned purchase to a later month.</p>` : `<p class="hint">That's about ${money(F.perDay)} per day. Anything you spend from it, add as an expense ("Other spending") so the number stays right.</p>`}
    ${billRows ? `<h4 class="mini-head">Bills still to come</h4><div class="list">${billRows}</div>` : ''}
    ${!F.paydayKnown ? '<p class="hint">Tip: set the day your salary comes in to calculate this until payday instead of the end of the month.</p>' : ''}`;
  openModal('Free to spend', body);
}

function balanceModal() {
  const T = Model.timeline(ym());
  const est = T.known ? T.now : null;
  const movement = r2((T.now ?? T.start) - T.start); // what came in/went out this month so far
  const cur = ym();
  const fresh = Store.data.settings.trackFrom === cur && Store.data.settings.balance && Store.data.settings.balance.month === cur && Store.data.settings.balance.amount === 0;
  const pending = T.pending || [];
  const body = `
    ${est !== null ? `<p class="muted">${fresh ? `Counted from what came in and went out since ${esc(dateLabel(cur + '-01'))}` : 'From what you entered'}, you should have about <b>${money(est)}</b>.</p>` : ''}
    ${pending.length ? `<p class="hint">Not counted yet (no day set and not ticked as paid/received): ${pending.map(e => `${esc(e.name)} ${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}`).join(', ')}. Tick them in the Month view once they've happened.</p>` : ''}
    ${fresh ? '' : `<div class="fresh-box">
      <b>Start counting from this month</b>
      <p class="small muted">The balance is then worked out only from what you enter for ${esc(monthLabel(cur))}: add what you had left from last month as income, plus your salary and bills as they come in. Next month simply continues from there.</p>
      <button type="button" class="btn primary small" data-m="fresh">Start from ${esc(monthLabel(cur))} →</button>
    </div>`}
    <label class="field"><span>${est !== null ? 'Or correct it — on my account right now' : 'Or enter what is on my account right now'} (${esc(dateLabel(today()))})</span><input name="amount" class="amount-input" inputmode="decimal" value="${est !== null ? est : ''}" placeholder="0.00"></label>
    <p class="hint">Tip: if it doesn't match your bank, check that income and bills which already happened are entered, ticked, or have the right day.</p>
    <p class="form-error"></p>`;
  openModal('Current balance', body, {
    onMount(form) {
      $('[data-m=fresh]', form)?.addEventListener('click', () => {
        Store.setSettings({ balance: { amount: 0, month: cur }, trackFrom: cur });
        toast(`Counting from ${monthLabel(cur)} — now add what you had left`);
        txModal({ kind: 'income', name: 'Left over from last month', date: `${cur}-01` });
      });
    },
    onSubmit(fd, form) {
      const real = parseAmount(fd.amount);
      if (isNaN(real)) return formError(form, 'Please enter your balance.');
      // store it as "money on the 1st", so that today's estimate equals what you entered
      Store.setSettings({ balance: { amount: r2(real - movement), month: ym() } });
      toast(`Balance set to ${money(real)}`);
    },
  });
}

function renderSyncPill() {
  const btn = $('#syncBtn');
  const map = { off: 'Not synced', idle: 'Sync', syncing: 'Syncing…', ok: 'Synced', error: 'Sync problem', offline: 'Offline' };
  btn.textContent = map[Sync.status] || 'Sync';
  btn.className = `sync-pill s-${Sync.status}`;
  btn.title = Sync.error || (Sync.cfg.lastSync ? `Last sync ${timeAgo(Sync.cfg.lastSync)}` : '');
  const box = $('#syncStatusBox');
  if (box) { box.className = `sync-status s-${Sync.status}`; box.textContent = syncStatusText(); }
}
function syncStatusText() {
  switch (Sync.status) {
    case 'syncing': return 'Syncing…';
    case 'ok': return `✓ Synced ${timeAgo(Sync.cfg.lastSync)}`;
    case 'offline': return 'Offline — will sync when you are back online.';
    case 'error': return `⚠ ${Sync.error}`;
    default: return Sync.cfg.lastSync ? `Last sync ${timeAgo(Sync.cfg.lastSync)}` : 'Not synced yet';
  }
}

/* ---------------- Day of the month ---------------- */
function dayField(value, label) {
  return `<label class="field"><span class="day-label">${label}</span><input name="day" type="number" inputmode="numeric" min="1" max="31" value="${value || ''}" placeholder="e.g. 1 (optional)"></label>`;
}
function readDay(v) { const d = parseInt(v, 10); return d >= 1 && d <= 31 ? d : null; }
const dayDate = (m, d) => dateLabel(`${m}-${pad(Math.min(d, daysInMonth(m)))}`);

/* ---------------- Fixed-cost groups ---------------- */
const DEFAULT_GROUPS = ['Rent & housing', 'School & education', 'Subscriptions', 'Insurance', 'Other'];
/** group of a fixed cost; items without one get a sensible guess from their name */
function fixedGroup(it) {
  if (it.group && it.group.trim()) return it.group.trim();
  const n = (it.name || '').toLowerCase();
  if (/rent|miete|wohnung|apartment|flat|nebenkosten|housing|hausgeld|mortgage|kredit haus/.test(n)) return 'Rent & housing';
  if (/school|schule|schul|kita|kindergarten|tuition|uni|studium|semester|kurs|course|education|nachhilfe|hort/.test(n)) return 'School & education';
  return 'Other';
}
function allGroups() {
  const used = Store.live('items').filter(i => i.kind === 'fixed').map(fixedGroup);
  return [...new Set([...used, ...DEFAULT_GROUPS])];
}
/** split rows into groups, biggest first, "Other" last */
function groupFixed(list, getItem, getAmount) {
  const map = new Map();
  for (const x of list) {
    const g = fixedGroup(getItem(x));
    if (!map.has(g)) map.set(g, { name: g, rows: [], total: 0 });
    const e = map.get(g);
    e.rows.push(x);
    e.total = r2(e.total + (getAmount(x) || 0));
  }
  return [...map.values()].sort((a, b) => (a.name === 'Other') - (b.name === 'Other') || b.total - a.total);
}
function groupedBody(groups, rowFn, totalLabel = money) {
  if (groups.length <= 1) return groups.map(g => g.rows.map(rowFn).join('')).join('');
  return groups.map(g => `<div class="grp-head"><span>${esc(g.name)}</span><span>${totalLabel(g.total)}</span></div>${g.rows.map(rowFn).join('')}`).join('');
}

/* ---------------- Collapsible cards ---------------- */
// which cards are folded up is a per-device view setting (not synced)
const Collapsed = {
  key: 'mm-collapsed-v1',
  set: new Set((() => { try { return JSON.parse(localStorage.getItem('mm-collapsed-v1')) || []; } catch { return []; } })()),
  has(k) { return this.set.has(k); },
  toggle(k) { if (this.set.has(k)) this.set.delete(k); else this.set.add(k); this.save(); },
  setAll(keys, closed) { keys.forEach(k => (closed ? this.set.add(k) : this.set.delete(k))); this.save(); },
  save() { try { localStorage.setItem(this.key, JSON.stringify([...this.set])); } catch { /* ignore */ } },
};
/* ---------------- Month view layout: which card is where (per device) ---------------- */
const CARD_KEYS = {
  summary: 'month-summary', budgets: 'month-budgets', other: 'month-other', income: 'month-income', fixed: 'month-fixed',
  credits: 'month-credits', wishes: 'month-wishes', savings: 'month-savings', calendar: 'month-calendar', need: 'month-need',
};
const CARD_NAMES = {
  summary: 'Summary', budgets: 'Budgets', other: 'Other spending', income: 'Income', fixed: 'Fixed costs',
  credits: 'Credits & installments', wishes: 'Planned purchases', savings: 'Savings goals', calendar: 'Payment calendar', need: 'Needed until payday',
};
const ZONES = ['top', 'c1', 'c2', 'c3', 'side'];
const MAIN_ZONES = ['top', 'c1', 'c2', 'c3'];
const DEFAULT_LAYOUT = { top: ['summary'], c1: ['budgets', 'other'], c2: ['fixed', 'credits', 'wishes', 'savings'], c3: ['calendar', 'need'], side: ['income'] };
const Layout = {
  key: 'mm-layout-v1',
  data: null,
  get() {
    if (this.data) return this.data;
    let d;
    try { d = JSON.parse(localStorage.getItem(this.key)); } catch { d = null; }
    d = d && typeof d === 'object' ? d : structuredClone(DEFAULT_LAYOUT);
    // every card exactly once; unknown ones dropped, new ones go to the sidebar
    const seen = new Set();
    for (const z of ZONES) d[z] = (Array.isArray(d[z]) ? d[z] : []).filter(id => CARD_KEYS[id] && !seen.has(id) && seen.add(id));
    for (const id of Object.keys(CARD_KEYS)) if (!seen.has(id)) d.side.push(id);
    this.data = d;
    return d;
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch { /* ignore */ } },
  zoneOf(id) { const d = this.get(); return ZONES.find(z => d[z].includes(id)); },
  move(id, zone, index) {
    const d = this.get();
    for (const z of ZONES) d[z] = d[z].filter(x => x !== id);
    const list = d[zone];
    list.splice(Math.max(0, Math.min(index ?? list.length, list.length)), 0, id);
    this.save();
  },
  hide(id) { this.move(id, 'side'); Collapsed.setAll([CARD_KEYS[id]], true); },
  show(id) {
    const d = this.get();
    const target = ['c1', 'c2', 'c3'].reduce((a, b) => (d[b].length < d[a].length ? b : a)); // the emptiest column
    this.move(id, target);
    Collapsed.setAll([CARD_KEYS[id]], false);
  },
  /** move up/down through top → column 1 → column 2 → column 3 */
  step(id, dir) {
    const d = this.get();
    const z = this.zoneOf(id);
    if (!MAIN_ZONES.includes(z)) return;
    const i = d[z].indexOf(id);
    const zi = MAIN_ZONES.indexOf(z);
    if (dir < 0) {
      if (i > 0) this.move(id, z, i - 1);
      else if (zi > 0) this.move(id, MAIN_ZONES[zi - 1]);
    } else if (i < d[z].length - 1) this.move(id, z, i + 1);
    else if (zi < MAIN_ZONES.length - 1) this.move(id, MAIN_ZONES[zi + 1], 0);
  },
  reset() { this.data = structuredClone(DEFAULT_LAYOUT); this.save(); },
};

function cardHead(key, title, total) {
  const closed = Collapsed.has(key);
  return `<button type="button" class="sec-head sec-toggle" data-action="toggle-card" data-key="${key}" aria-expanded="${!closed}" title="${closed ? 'Show' : 'Hide'}">
    <h2><span class="chev" aria-hidden="true"></span>${title}</h2>${total !== '' && total != null ? `<span class="sec-total">${total}</span>` : ''}
  </button>`;
}
/** a card that can be folded up; folded it shows `summary` instead of its content */
function card(key, title, total, inner, summary = '', cls = '', attrs = '') {
  const closed = Collapsed.has(key);
  return `<section class="card ${cls} ${closed ? 'collapsed' : ''}" data-card="${key}" ${attrs}>
    ${cardHead(key, title, total)}
    ${closed ? (summary ? `<p class="sec-summary" data-action="toggle-card" data-key="${key}">${summary}</p>` : '') : inner}
  </section>`;
}
function section(title, total, body, addBtn = '', extraCls = '', key = '', summary = '') {
  const inner = `${body || '<p class="empty">Nothing here yet.</p>'}${addBtn}`;
  if (key) return card(key, title, total, inner, summary, extraCls);
  return `<section class="card ${extraCls}">
    <div class="sec-head"><h2>${title}</h2>${total !== '' ? `<span class="sec-total">${total}</span>` : ''}</div>
    ${inner}
  </section>`;
}
const joinSum = parts => parts.filter(Boolean).map(p => `<span>${p}</span>`).join('<span class="dot-sep">·</span>');

/* ---------------- Month view ---------------- */
const addBtn = (action, label, data = '') => `<button type="button" class="add-row" data-action="${action}" ${data}>+ ${label}</button>`;

function welcomeCard() {
  return `<section class="card welcome">
    <h2>Welcome 👋</h2>
    <p>Set up your month in three steps — after that you only add what you spend.</p>
    <ol>
      <li>Add your monthly <b>income</b> (salary, …)</li>
      <li>Add <b>fixed costs</b> — rent, subscriptions, insurance</li>
      <li>Add <b>budgets</b> for things like food or going out</li>
    </ol>
    <div class="btn-row">
      <button type="button" class="btn primary" data-action="add-item" data-kind="income">Add income</button>
      <button type="button" class="btn" data-action="example-data">Try with example data</button>
    </div>
  </section>`;
}

function summaryCard(S) {
  const t = S.t;
  const carry = Model.carryIn(S.m);
  const total = r2(t.left + carry); // what's left including money from earlier months
  const prevLabel = monthLabel(addMonths(S.m, -1), true);
  const segs = [
    ['fixed', t.fixed, 'Fixed costs'],
    ['credits', t.credits + t.wishes, t.wishes ? 'Credits & planned buys' : 'Credits & installments'],
    ['budgets', t.budgets, S.past ? 'Budgets (spent)' : 'Budgets'],
    ['savings', t.savings, 'Savings goals'],
    ['other', t.other, 'Other spending'],
  ];
  const leftLabel = S.past ? 'Left over' : S.current ? 'Left at the end of this month' : 'Expected left over';
  const carryLine = carry
    ? `<div class="carry-line"><span>${carry > 0 ? `Still left from ${esc(prevLabel)}` : `Overspent until ${esc(prevLabel)}`}</span><b class="${carry < 0 ? 'neg' : 'pos'}">${carry > 0 ? '+' : ''}${money(carry)}</b></div>
       <div class="carry-line muted"><span>${S.past ? 'This month' : 'This month alone'}</span><b>${t.left > 0 ? '+' : ''}${money(t.left)}</b></div>`
    : '';
  let hint = '';
  if (!S.past && t.budgetLeft > 0) hint = `You can still spend <b>${money(t.budgetLeft)}</b> from your budgets — that's already included.`;
  if (t.budgetOver > 0) hint += `${hint ? '<br>' : ''}<span class="neg">You are ${money(t.budgetOver)} over budget.</span>`;
  const key = 'month-summary';
  const sum = joinSum([`income ${money(t.income)}`, `out ${money(t.out)}`, !S.past && t.budgetLeft ? `${money(t.budgetLeft)} budget left` : '', t.budgetOver ? `<b class="neg">${money(t.budgetOver)} over budget</b>` : '']);
  const D = segInfo(S, segs);
  return card(key, Collapsed.has(key) ? esc(leftLabel) : 'Summary', Collapsed.has(key) ? `<b class="${total < 0 ? 'neg' : ''}">${money(total)}</b>` : '', `
    <div class="sum-top">
      <div>
        <div class="label">${leftLabel}</div>
        <div class="big ${total < 0 ? 'neg' : ''}">${money(total)}</div>
      </div>
      <div class="sum-income"><div class="label">Income</div><div class="pos">${money(t.income)}</div></div>
    </div>
    ${carryLine ? `<div class="carry">${carryLine}</div>` : ''}
    ${D.bar}
    <div class="legend">
      ${segs.filter(s => s[1] > 0 || s[0] !== 'savings').map(s => `<button type="button" class="lg-row" data-seg="${s[0]}"><span class="dot c-${s[0]}"></span>${s[2]}<b>${money(s[1])}</b></button>`).join('')}
      ${t.left > 0 ? `<button type="button" class="lg-row" data-seg="left"><span class="dot c-left"></span>Left over this month<b>${money(t.left)}</b></button>` : ''}
    </div>
    <div class="dn-detail" id="dnDetail">${t.income || t.out ? 'Hover or tap a part of the line or a category to see what\'s in it.' : ''}</div>
    ${!S.past && t.planned ? `<div class="legend-note">Budgets: ${money(t.spent)} spent of ${money(t.planned)} planned</div>` : ''}
    ${hint ? `<p class="hint">${hint}</p>` : ''}`, sum, 'summary');
}

/* ---------------- Colour line: where this month's money goes ---------------- */
let donutDetails = {};
function segInfo(S, segs) {
  const t = S.t;
  const slices = segs.filter(s => s[1] > 0).map(([k, v, label]) => ({ k, v, label }));
  if (t.left > 0) slices.push({ k: 'left', v: t.left, label: 'Left over this month' });
  const base = Math.max(t.income, t.out, 1);
  const pct = v => (t.income ? `${Math.round((v / t.income) * 100)}% of income` : '');
  // what is inside each slice (shown on hover / tap)
  const list = rows => rows.filter(r => r[1]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, v]) => `<span>${esc(n)} <b>${money(v)}</b></span>`).join('');
  const groups = groupFixed(S.fixed.filter(r => r.amount), r => r.it, r => r.amount);
  donutDetails = {
    fixed: list(groups.length > 1 ? groups.map(g => [g.name, g.total]) : S.fixed.map(r => [r.it.name, r.amount])),
    credits: list([...S.credits.map(c => [c.c.name, c.amount]), ...S.wishes.map(w => [`${w.w.name} (planned)`, w.amount])]),
    budgets: list(S.budgets.map(b => [`${b.b.emoji || ''} ${b.b.name}`.trim(), S.past ? b.spent : Math.max(b.available, b.spent, 0)])),
    savings: list(S.savings.map(g => [g.g.name, g.amount])),
    other: list(S.other.map(x => [x.name, x.amount])),
    left: `<span>What stays from this month's income</span>`,
  };
  donutDetails.meta = Object.fromEntries(slices.map(s => [s.k, `<b>${esc(s.label)}</b>: ${money(s.v)}${pct(s.v) ? ` · ${pct(s.v)}` : ''}`]));

  const bar = `<div class="stackbar" role="img" aria-label="${esc(slices.map(s => `${s.label} ${money(s.v)}`).join(', '))}">${
    slices.map(s => `<i class="c-${s.k} bseg" data-seg="${s.k}" style="width:${(Math.min(s.v, base) / base) * 100}%" title="${esc(s.label)}: ${esc(money(s.v))}"></i>`).join('')
    || '<i class="c-empty" style="width:100%"></i>'}</div>`;
  return { bar };
}
function showDonut(k) {
  const box = $('#dnDetail');
  if (!box || !donutDetails.meta || !donutDetails.meta[k]) return;
  box.innerHTML = `<div>${donutDetails.meta[k]}</div>${donutDetails[k] ? `<div class="dn-items">${donutDetails[k]}</div>` : ''}`;
  $$('.stackbar .bseg').forEach(s => s.classList.toggle('dim', s.dataset.seg !== k));
  $$('.lg-row').forEach(r => r.classList.toggle('sel', r.dataset.seg === k));
}
function clearDonut() {
  $$('.stackbar .bseg').forEach(s => s.classList.remove('dim'));
  $$('.lg-row').forEach(r => r.classList.remove('sel'));
}

function itemRow(r, kind) {
  const it = r.it;
  const subs = [];
  const d = Model.dayOf(it, UI.month);
  if (d) subs.push(`${kind === 'income' ? 'comes' : 'taken'} ${dayDate(UI.month, d)}`);
  if ((it.every || 1) > 1) subs.push(EVERY[it.every]);
  if (r.skipped) subs.push('skipped this month');
  else if (r.changed) subs.push(`changed this month (normally ${money(Model.baseAmount(it, UI.month))})`);
  if (it.end === UI.month) subs.push('last time');
  const checkLabel = kind === 'income' ? 'received' : 'paid';
  return `<div class="row ${r.paid ? 'is-paid' : ''} ${r.skipped ? 'is-skipped' : ''}">
    <button type="button" class="check ${r.paid ? 'on' : ''}" data-action="toggle-paid" data-id="${it.id}" aria-label="Mark ${checkLabel}" title="Mark ${checkLabel}">✓</button>
    <button type="button" class="row-main" data-action="item-month" data-id="${it.id}">
      <span class="name">${esc(it.name)}</span>${subs.length ? `<span class="sub">${esc(subs.join(' · '))}</span>` : ''}
    </button>
    <span class="amt ${kind === 'income' ? 'pos' : ''}">${kind === 'income' ? '+' : ''}${money(r.amount)}</span>
  </div>`;
}

function txRow(tx, showBudget = false) {
  const subs = [dateLabel(tx.date)];
  if (tx.date.slice(0, 7) !== tx.month) subs.push(`paid in ${monthLabel(tx.month, true)}`);
  if (showBudget && tx.budgetId) { const b = Store.get('budgets', tx.budgetId); if (b) subs.push(`${b.emoji || ''} ${b.name}`.trim()); }
  const inc = tx.kind === 'income';
  return `<div class="row">
    <button type="button" class="row-main" data-action="edit-tx" data-id="${tx.id}">
      <span class="name">${esc(tx.name)}</span><span class="sub">${esc(subs.join(' · '))}</span>
    </button>
    <span class="amt ${inc ? 'pos' : ''}">${inc ? '+' : ''}${money(tx.amount)}</span>
  </div>`;
}

function carryText(row) {
  if (!row.b.rollover || !row.carry) return '';
  return row.carry > 0 ? `incl. ${money(row.carry)} from last month` : `${money(-row.carry)} less (overspent last month)`;
}
function budgetCard(row, S) {
  const { b, available, spent } = row;
  const left = r2(available - spent);
  const pct = available > 0 ? Math.min(100, (spent / available) * 100) : (spent > 0 ? 100 : 0);
  const state = left < 0 ? 'over' : pct >= 85 ? 'warn' : 'ok';
  let perDay = '';
  if (S.current && left > 0) {
    const daysLeft = daysInMonth(S.m) - new Date().getDate() + 1;
    perDay = ` · ≈ ${money(left / daysLeft)}/day`;
  }
  const carry = carryText(row);
  return `<div class="budget" data-action="budget-open" data-id="${b.id}" role="button" tabindex="0">
    <div class="b-top">
      <span class="name">${esc(b.emoji || '')} ${esc(b.name)}${b.rollover ? ' <span class="tag" title="Unused money carries over">↻</span>' : ''}</span>
      <span class="amt">${money(spent)} <span class="muted">/ ${money(available)}</span></span>
    </div>
    <div class="bar ${state}"><i style="width:${pct}%"></i></div>
    <div class="b-bottom">
      <span class="${left < 0 ? 'neg' : 'muted'}">${left < 0 ? `${money(-left)} over budget` : `${money(left)} left${perDay}`}${carry ? `<br><small class="muted">${carry}</small>` : ''}</span>
      <button type="button" class="mini" data-action="add-expense" data-budget="${b.id}">+ Add</button>
    </div>
  </div>`;
}

function viewMonth() {
  const S = Model.summarize(UI.month);
  const t = S.t;
  const empty = COLLS.every(k => Store.live(k).length === 0);

  const incomeBody = S.income.map(r => (r.it ? itemRow(r, 'income') : txRow(r.tx))).join('');
  const fixedBody = groupedBody(groupFixed(S.fixed, r => r.it, r => r.amount), r => itemRow(r, 'fixed'));
  const budgetBody = S.budgets.length ? `<div class="budgets">${S.budgets.map(r => budgetCard(r, S)).join('')}</div>` : '';
  const creditBody = S.credits.map(({ c, index, amount, paid }) => {
    const after = Model.creditRemainingAfter(c, S.m);
    return `<div class="row ${paid ? 'is-paid' : ''}">
      <button type="button" class="check ${paid ? 'on' : ''}" data-action="toggle-credit-paid" data-id="${c.id}" aria-label="Mark paid" title="Mark paid">✓</button>
      <button type="button" class="row-main" data-action="edit-credit" data-id="${c.id}">
        <span class="name">${esc(c.name)}</span>
        <span class="sub">${c.day ? `${dayDate(S.m, c.day)} · ` : ''}Payment ${index + 1} of ${c.payments} · ${after > 0 ? `${money(after)} left after this` : 'last payment 🎉'}</span>
      </button>
      <span class="amt">${money(amount)}</span>
    </div>`;
  }).join('');
  const otherBody = S.other.map(tx => txRow(tx)).join('');
  const savingsBody = S.savings.map(({ g, amount, saved, paid, changed }) => `<div class="row ${paid ? 'is-paid' : ''}">
      <button type="button" class="check ${paid ? 'on' : ''}" data-action="toggle-goal-paid" data-id="${g.id}" aria-label="Mark as put aside" title="Mark as put aside">✓</button>
      <button type="button" class="row-main" data-action="goal-month" data-id="${g.id}">
        <span class="name">${esc(g.emoji ? g.emoji + ' ' : '')}${esc(g.name)}</span>
        <span class="sub">${g.day ? `${dayDate(UI.month, g.day)} · ` : ''}${changed ? 'changed this month · ' : ''}${money(saved)} of ${money(g.target)} saved after this</span>
      </button>
      <span class="amt">${money(amount)}</span>
    </div>`).join('');
  const wishBody = S.wishes.map(({ w, amount, index }) => `<div class="row">
      <button type="button" class="row-main" data-action="edit-wish" data-id="${w.id}">
        <span class="name">${esc(w.name)}</span>
        <span class="sub">${w.pay === 'split' && w.payments > 1 ? `Planned · payment ${index + 1} of ${w.payments}` : 'Planned purchase'}</span>
      </button>
      ${index === 0 ? `<button type="button" class="mini" data-action="wish-bought" data-id="${w.id}">Bought it</button>` : ''}
      <span class="amt">${money(amount)}</span>
    </div>`).join('');

  /* ---- one-line summaries shown when a card is folded up ---- */
  const todayD = S.current ? new Date().getDate() : S.past ? 99 : 0;
  const nextOpen = rows => rows
    .map(r => ({ r, d: r.it ? Model.dayOf(r.it, S.m) : null }))
    .filter(x => x.r.it && !x.r.paid && !x.r.skipped && (x.d === null || x.d >= todayD))
    .sort((a, b) => (a.d || 99) - (b.d || 99))[0];
  const recurring = rows => rows.filter(r => r.it && !r.skipped);
  const incRec = recurring(S.income), fixRec = recurring(S.fixed);
  const nInc = nextOpen(S.income), nFix = nextOpen(S.fixed);
  const incomeSum = joinSum([
    incRec.length ? `${incRec.filter(r => r.paid).length} of ${incRec.length} received` : '',
    nInc ? `next: ${esc(nInc.r.it.name)}${nInc.d ? ` ${esc(dayDate(S.m, nInc.d))}` : ''}` : incRec.length ? '✓ all in' : '',
    S.income.some(r => r.tx) ? `${S.income.filter(r => r.tx).length} one-time` : '',
  ]);
  const groups = groupFixed(S.fixed.filter(r => r.amount), r => r.it, r => r.amount);
  const fixedSum = joinSum([
    fixRec.length ? `${fixRec.filter(r => r.paid).length} of ${fixRec.length} paid` : '',
    nFix ? `next: ${esc(nFix.r.it.name)}${nFix.d ? ` ${esc(dayDate(S.m, nFix.d))}` : ''}` : fixRec.length ? '✓ all paid' : '',
    groups.length > 1 ? `${esc(groups[0].name)} ${money(groups[0].total)}` : '',
  ]);
  const creditSum = joinSum([
    S.credits.length ? `${S.credits.length} payment${S.credits.length === 1 ? '' : 's'}` : 'none this month',
    S.credits.length ? `${money(r2(S.credits.reduce((s, x) => s + Model.creditRemainingAfter(x.c, S.m), 0)))} still owed after` : '',
  ]);
  const wishSum = joinSum(S.wishes.map(x => esc(x.w.name)).slice(0, 3));
  const savingsSum = joinSum(S.savings.length ? S.savings.map(x => `${esc(x.g.name)} ${Math.min(100, Math.round((x.saved / x.g.target) * 100))}%`) : ['nothing this month']);
  const worst = [...S.budgets].sort((a, b) => (b.spent / Math.max(b.available, 1)) - (a.spent / Math.max(a.available, 1)))[0];
  const budgetSum = joinSum(S.budgets.length ? [
    S.past ? `${money(t.spent)} spent` : `${money(t.budgetLeft)} left`,
    t.budgetOver ? `<b class="neg">${money(t.budgetOver)} over</b>` : '',
    worst && !S.past ? `${esc(worst.b.name)} ${Math.round((worst.spent / Math.max(worst.available, 1)) * 100)}% used` : '',
  ] : ['no budgets yet']);
  const lastOther = S.other[0];
  const otherSum = joinSum([
    S.other.length ? `${S.other.length} entr${S.other.length === 1 ? 'y' : 'ies'}` : 'nothing yet',
    lastOther ? `last: ${esc(lastOther.name)}` : '',
  ]);
  // past months: only show what has entries (empty cards there are just noise)
  const show = body => !S.past || !!body;
  const pastEmpty = S.past && !incomeBody && !fixedBody && !budgetBody && !creditBody && !otherBody && !savingsBody;
  // every card of the Month view; where each one goes is up to you (Layout)
  const cards = {
    summary: summaryCard(S),
    budgets: show(budgetBody) ? section('Budgets', S.past ? money(t.spent) : `${money(t.spent)} / ${money(t.planned)}`, budgetBody, addBtn('add-budget', 'Budget (food, going out…)'), '', 'month-budgets', budgetSum) : '',
    other: show(otherBody) ? section('Other spending', money(t.other), otherBody, addBtn('add-expense', 'Expense', 'data-budget=""') + addBtn('import-csv', 'Import from bank (CSV)'), '', 'month-other', otherSum) : '',
    income: show(incomeBody) ? section('Income', money(t.income), incomeBody, addBtn('add-item', 'Monthly income', 'data-kind="income"') + addBtn('add-income-tx', 'One-time income'), '', 'month-income', incomeSum) : '',
    fixed: show(fixedBody) ? section('Fixed costs', money(t.fixed), fixedBody, addBtn('add-item', 'Fixed cost (rent, subscription…)', 'data-kind="fixed"'), '', 'month-fixed', fixedSum) : '',
    credits: show(creditBody) ? section('Credits & installments', money(t.credits), creditBody, addBtn('add-credit', 'Credit / installment plan'), '', 'month-credits', creditSum) : '',
    wishes: S.wishes.length || !S.past ? section('Planned purchases', money(t.wishes), wishBody || '<p class="empty">No planned purchases this month.</p>', addBtn('tab', 'Wishlist', 'data-tab="goals"'), '', 'month-wishes', S.wishes.length ? wishSum : 'none this month') : '',
    savings: show(savingsBody) ? section('Savings goals', money(t.savings), savingsBody, addBtn('add-goal', 'Savings goal'), '', 'month-savings', savingsSum) : '',
    calendar: calendarCard(S),
    need: needCard(S),
  };
  const L = Layout.get();
  const mainIds = [...L.top, ...L.c1, ...L.c2, ...L.c3];
  const allKeys = mainIds.map(id => CARD_KEYS[id]);
  const allClosed = allKeys.length && allKeys.every(k => Collapsed.has(k));
  const sideOpen = UI.side;

  const dc = (id, zone) => {
    let html = cards[id];
    if (zone !== 'side' && !html) return '';
    if (!html) html = section(CARD_NAMES[id], '', '<p class="empty">Nothing to show for this month.</p>', '', '', CARD_KEYS[id], 'nothing to show');
    const tools = zone === 'side'
      ? `<button type="button" class="dc-btn dc-grip" title="Drag into your view" aria-label="Drag ${esc(CARD_NAMES[id])}">⠿</button>
         <button type="button" class="dc-btn dc-add" data-action="card-show" data-cid="${id}" title="Put in your view">＋ Add</button>`
      : `<button type="button" class="dc-btn dc-grip" title="Drag to move" aria-label="Drag ${esc(CARD_NAMES[id])}">⠿</button>
         <button type="button" class="dc-btn dc-arr" data-action="card-up" data-cid="${id}" title="Move up" aria-label="Move up">↑</button>
         <button type="button" class="dc-btn dc-arr" data-action="card-down" data-cid="${id}" title="Move down" aria-label="Move down">↓</button>
         <button type="button" class="dc-btn" data-action="card-hide" data-cid="${id}" title="Move to the sidebar" aria-label="Move to the sidebar">⇤</button>`;
    return `<div class="dcard" data-cid="${id}"><div class="dc-tools">${tools}</div>${html}</div>`;
  };
  const zone = name => `<div class="zone zone-${name}" data-zone="${name}">${L[name].map(id => dc(id, name)).join('')}<div class="zone-empty">Drop cards here</div></div>`;

  return `
  <div class="month-layout ${sideOpen ? 'side-open' : ''} ${UI.arrange ? 'arranging' : ''}">
    <aside class="sidebar" aria-label="Sidebar">
      <div class="side-head"><b>Sidebar</b><button type="button" class="icon-btn" data-action="sidebar-toggle" aria-label="Close sidebar">✕</button></div>
      <p class="hint side-hint">Cards you don't need all the time. Open one to look at it or edit it. Drag it into your view or tap <b>＋ Add</b>. To put a card away, drag it here or tap <b>⇤</b> on it.</p>
      ${zone('side')}
      <button type="button" class="link side-reset" data-action="layout-reset">Reset layout</button>
    </aside>
    <div class="side-backdrop" data-action="sidebar-toggle"></div>
    <div class="month-main">
      <div class="month-nav">
        <button type="button" class="icon-btn" data-action="month-prev" aria-label="Previous month">‹</button>
        <div class="month-title">
          <div>${monthLabel(UI.month)}</div>
          ${S.current ? '<small>This month</small>' : `<button type="button" class="link" data-action="month-today">Back to this month</button>`}
        </div>
        <button type="button" class="icon-btn" data-action="month-next" aria-label="Next month">›</button>
      </div>
      ${empty ? welcomeCard() : ''}
      ${S.current && !empty ? `<div class="top-row ${Model.freeToSpend() ? 'has-free' : ''}">${freeTile()}${balanceTile()}${paydayBanner()}</div>` : ''}
      ${!empty ? `<div class="dash-tools">
        <button type="button" class="btn small" data-action="sidebar-toggle">☰ Sidebar${L.side.length ? ` <span class="pill-count">${L.side.length}</span>` : ''}</button>
        <span class="spacer"></span>
        <button type="button" class="link" data-action="arrange-toggle">${UI.arrange ? '✓ Done' : '↕ Arrange'}</button>
        ${!pastEmpty ? `<button type="button" class="link" data-action="toggle-all" data-keys="${allKeys.join(',')}" data-close="${allClosed ? '0' : '1'}">${allClosed ? '▾ Expand all' : '▸ Collapse all'}</button>` : ''}
      </div>` : ''}
      ${UI.arrange ? '<p class="hint arrange-hint">Drag cards by ⠿ (on a computer), or use ↑ ↓ to move them. ⇤ puts a card in the sidebar.</p>' : ''}
      ${pastEmpty ? `<section class="card empty-month"><h2>Nothing recorded for ${esc(monthLabel(S.m))}</h2><p class="muted">You weren't using the app yet, or nothing was entered for this month.</p><button type="button" class="btn" data-action="month-today">Back to this month</button></section>` : `
      ${zone('top')}
      <div class="mgrid">${zone('c1')}${zone('c2')}${zone('c3')}</div>`}
    </div>
  </div>`;
}

/* ---------------- Plan view ---------------- */
function viewPlan() {
  const cur = ym();
  const sortActive = arr => [...arr].sort((a, b) => (!!(a.end && a.end < cur)) - (!!(b.end && b.end < cur)));
  const itemRowPlan = it => {
    const ended = it.end && it.end < cur, upcoming = it.start > cur;
    const amt = Model.baseAmount(it, upcoming ? it.start : cur);
    const sub = [EVERY[it.every || 1], upcoming ? `starts ${monthLabel(it.start, true)}` : `since ${monthLabel(it.start, true)}`, it.end ? `${ended ? 'ended' : 'until'} ${monthLabel(it.end, true)}` : ''].filter(Boolean).join(' · ');
    return `<div class="row ${ended ? 'is-ended' : ''}">
      <button type="button" class="row-main" data-action="${it.kind ? 'edit-item' : 'edit-budget'}" data-id="${it.id}">
        <span class="name">${esc(it.emoji ? it.emoji + ' ' : '')}${esc(it.name)}</span><span class="sub">${esc(sub)}</span>
      </button>
      <span class="amt ${it.kind === 'income' ? 'pos' : ''}">${money(amt)}</span>
    </div>`;
  };
  const monthlyEq = arr => r2(arr.filter(it => Model.isActive({ ...it, every: 1 }, cur))
    .reduce((s, it) => s + Model.baseAmount(it, cur) / (it.every || 1), 0));
  const income = sortActive(Store.live('items').filter(i => i.kind === 'income'));
  const fixed = sortActive(Store.live('items').filter(i => i.kind === 'fixed'));
  const budgets = sortActive(Store.live('budgets'));
  const credits = [...Store.live('credits')].sort((a, b) => (Model.creditEnd(a) < cur) - (Model.creditEnd(b) < cur));

  const creditRows = credits.map(c => {
    const left = Model.paymentsLeftFrom(c, cur);
    const owed = Model.creditRemainingAfter(c, addMonths(cur, -1));
    const done = left === 0;
    const sub = done ? `Paid off ${monthLabel(Model.creditEnd(c), true)}`
      : `${money(Model.creditPart(c, 0))}/month · ${left} of ${c.payments} payments left · last ${monthLabel(Model.creditEnd(c), true)}`;
    return `<div class="row ${done ? 'is-ended' : ''}">
      <button type="button" class="row-main" data-action="edit-credit" data-id="${c.id}">
        <span class="name">${esc(c.name)}</span><span class="sub">${esc(sub)}</span>
      </button>
      <span class="amt">${done ? '✓' : money(owed)}</span>
    </div>`;
  }).join('');
  const owedTotal = r2(credits.reduce((s, c) => s + Model.creditRemainingAfter(c, addMonths(cur, -1)), 0));
  const planSum = list => { const active = list.filter(i => !(i.end && i.end < cur)).length; return `${active} active${list.length > active ? `, ${list.length - active} ended` : ''}`; };
  const fixedGroups = groupFixed(fixed, it => it, it => (Model.isActive({ ...it, every: 1 }, cur) ? Model.baseAmount(it, cur) / (it.every || 1) : 0));

  return `
  <h1 class="page-title">Plan</h1>
  <p class="muted page-sub">Everything that repeats. Changes here apply from this month on — to change a single month, tap the item in the Month tab.</p>
  <div class="grid">
    <div class="col">
      ${section('Monthly income', `≈ ${money(monthlyEq(income))}/mo`, income.map(itemRowPlan).join(''), addBtn('add-item', 'Income', 'data-kind="income"'), '', 'plan-income', planSum(income))}
      ${section('Fixed costs', `≈ ${money(monthlyEq(fixed))}/mo`,
        groupedBody(fixedGroups, itemRowPlan, v => `≈ ${money(v)}/mo`),
        addBtn('add-item', 'Fixed cost', 'data-kind="fixed"'), '', 'plan-fixed',
        joinSum([planSum(fixed), ...fixedGroups.slice(0, 2).map(g => `${esc(g.name)} ≈ ${money(g.total)}`)]))}
    </div>
    <div class="col">
      ${section('Budgets', `${money(monthlyEq(budgets))}/mo`, budgets.map(itemRowPlan).join(''), addBtn('add-budget', 'Budget'), '', 'plan-budgets', joinSum([planSum(budgets), ...budgets.slice(0, 3).map(b => esc(`${b.emoji || ''} ${b.name}`.trim()))]))}
      ${section('Credits & installments', owedTotal ? `${money(owedTotal)} to pay` : '', creditRows, addBtn('add-credit', 'Credit / installment plan'), '', 'plan-credits',
        joinSum([`${credits.filter(c => Model.paymentsLeftFrom(c, cur) > 0).length} open`, credits.length ? `last payment ${monthLabel(credits.map(Model.creditEnd.bind(Model)).sort().pop(), true)}` : '']))}
    </div>
  </div>`;
}

/* ---------------- Payment calendar (month) ---------------- */
function calendarCard(S) {
  const C = Model.cycleTimeline(S.m);
  const T = Model.timeline(S.m);
  if (!C.ev.length) return '';
  const m = S.m, t0 = today();
  const kindLabel = e => ({ income: 'Income', fixed: e.group || 'Fixed cost', credit: 'Credit', savings: 'Savings goal', wish: 'Planned purchase' }[e.kind] || '');
  const dated = C.ev.filter(e => e.day);
  const isPast = e => e.date < t0 || (e.date === t0 && (e.paid || e.actual));
  const coming = dated.filter(e => !isPast(e)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  const done = dated.filter(isPast).sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.amount - b.amount));
  const nextIncomeAfter = date => coming.find(e => e.amount > 0 && e.date > date);
  let info = '';
  if (!C.known && dated.length && !S.past) {
    info = `<form id="calStartForm" class="cal-start" data-m="${ym()}">
      <label for="calStartIn">To see what you'll have each day, enter what was on your account on <b>${esc(dayDate(ym(), 1))}</b> (before rent etc. was taken):</label>
      <div class="cal-start-row"><input id="calStartIn" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off"><button type="submit" class="btn small primary">Save</button></div>
    </form>`;
  } else if (!S.past && C.low !== null && dated.length) {
    if (C.low < 0) {
      const nx = nextIncomeAfter(C.lowDate);
      info = `<div class="cal-alert bad">⚠ Tight around <b>${esc(dateLabel(C.lowDate))}</b>: you'd be at <b>${money(C.low)}</b>${nx ? ` until ${esc(nx.name)} comes in on ${esc(dateLabel(nx.date))}` : ''}.</div>`;
    } else {
      info = `<div class="cal-alert">Lowest point${C.now !== null ? ' from today' : ''}: <b>${money(C.low)}</b> on ${esc(dateLabel(C.lowDate))}.</div>`;
    }
  }
  if (C.known && C.now !== null) info += `<div class="cal-alert">Right now you should have about <b>${money(C.now)}</b> — compare it with your bank account.</div>`;
  const row = e => `<button type="button" class="cal-row ${isPast(e) ? 'is-past' : ''}" data-action="${e.m === UI.month ? e.action : ({ 'item-month': 'edit-item', 'goal-month': 'edit-goal' }[e.action] || e.action)}" data-id="${e.id}">
      <span class="cal-day"><b>${+e.date.slice(8)}</b><small>${esc(monthOnly(e.m))}</small></span>
      <span class="row-main"><span class="name">${esc(e.name)}${e.paid ? ' <span class="muted">✓</span>' : ''}</span><span class="sub">${esc(kindLabel(e))}${Model.timeline(e.m).known ? ` · then ${money(e.balance)}` : ''}</span></span>
      <span class="amt ${e.amount > 0 ? 'pos' : ''}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</span>
    </button>`;
  const rows = (coming.length ? `<div class="cal-sub">Coming up</div>${coming.map(row).join('')}` : `<p class="empty">✓ Nothing more until ${esc(dateLabel(addDays(C.to, 1)))}.</p>`)
    + (done.length ? `<div class="cal-sub done">Already happened</div>${done.map(row).join('')}` : '');
  const undated = T.undated.filter(e => e.kind !== 'wish');
  const upcoming = coming[0];
  const calSum = joinSum([
    upcoming ? `next: ${esc(upcoming.name)} ${upcoming.amount > 0 ? '+' : '−'}${money(Math.abs(upcoming.amount))} on ${esc(dateLabel(upcoming.date))}` : dated.length ? 'nothing more this period' : 'no days set yet',
    C.known && !S.past && C.low !== null ? (C.low < 0 ? `<b class="neg">tight: ${money(C.low)} on ${esc(dateLabel(C.lowDate))}</b>` : `lowest ${money(C.low)}`) : '',
  ]);
  return card('month-calendar', 'Payment calendar', `${esc(dateLabel(C.from))} – ${esc(dateLabel(C.to))}`, `
    ${C.P ? `<p class="muted small cal-period">From payday to payday${C.start !== null ? ` · started with ${money(C.start)}` : ''}</p>` : ''}
    ${info}
    ${dated.length ? `<div class="cal-list">${rows}</div>` : '<p class="empty">Set the day your money comes in and the day each cost is taken, and you\'ll see here when money comes and goes — and whether it gets tight before payday.</p>'}
    ${undated.length ? `<p class="hint">No day set yet: ${undated.map(e => `<a href="#" data-action="${e.action}" data-id="${e.id}">${esc(e.name)}</a>`).join(', ')} — tap one to set its day.</p>` : ''}
    ${dated.length && C.known ? `<p class="hint">"then" = what you'd have after that day, including your everyday spending${C.budgetLeft ? ` and the budget money still planned, spread over the remaining days` : ''}.</p>` : ''}`, calSum);
}

/* ---------------- Banner: still to pay until payday (top of this month) ---------------- */
function daysUntil(date) {
  const [y, m, d] = date.split('-').map(Number), n = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
}
const whenText = n => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function paydayBanner() {
  const P = Model.payCycle(ym());
  if (!P || !P.isCurrent) return '';
  const t = today();
  const still = Model.billsStillToPay(P.to);
  const total = r2(still.reduce((s, b) => s + b.amount, 0));
  const T = Model.timeline(ym());
  const payIn = daysUntil(P.nextPay);
  const payText = `${esc(dateLabel(P.nextPay))}, ${whenText(payIn)}`;
  let cls = 'ok', money2 = '';
  if (T.known && T.now !== null) {
    const free = r2(T.now - total);
    if (free < 0) { cls = 'bad'; money2 = `You have about ${money(T.now)} — that's <b class="short">${money(-free)} too little</b>.`; }
    else money2 = `You have about ${money(T.now)} — <b>${money(free)}</b> left after these bills.`;
  }
  if (!still.length) {
    if (T.known && T.now !== null) money2 = T.now >= 0 ? `You have about <b>${money(T.now)}</b> left for everything else until then.` : `But your account is at about <b class="short">${money(T.now)}</b> until then.`;
    return `<button type="button" class="pay-banner ${cls === 'bad' ? 'bad' : 'done'}" data-action="scroll-need">
      <span class="pb-main"><span class="pb-label">Until payday (${payText})</span><span class="pb-big">✓ All bills paid</span></span>
      ${money2 ? `<span class="pb-sub">${money2}</span>` : ''}
    </button>`;
  }
  const dated = still.filter(b => b.date), undated = still.filter(b => !b.date);
  const next = dated[0];
  const nextText = next ? `Next: <b>${esc(next.name)}</b> ${money(next.amount)} on ${esc(dateLabel(next.date))} (${whenText(daysUntil(next.date))})` : '';
  const undatedText = undated.length ? `Not ticked yet (no day set): ${undated.map(b => esc(b.name)).join(', ')}` : '';
  return `<button type="button" class="pay-banner ${cls}" data-action="scroll-need">
    <span class="pb-main">
      <span class="pb-label">Still to pay until payday (${payText})</span>
      <span class="pb-big">${money(total)} <small>${still.length} bill${still.length === 1 ? '' : 's'}</small></span>
    </span>
    <span class="pb-sub">${[nextText, undatedText, money2].filter(Boolean).join('<br>')}</span>
  </button>`;
}

/* ---------------- Needed until payday (month) ---------------- */
function needCard(S) {
  const P = Model.payCycle(S.m);
  if (!P) {
    if (!S.income.some(r => r.it)) return '';
    return section('Needed until payday', '', `<p class="empty">Set the day your salary comes in (tap it under Income → "Comes in on day") and the day your bills are taken. The app then shows how much has to be on your account so every bill can be paid before the next salary arrives.</p>`, '', '', 'month-need', 'set the day your salary comes in');
  }
  const t = today();
  const keep = r2(P.total + P.spend);
  const payName = P.pay ? P.pay.it.name : 'salary';
  const still = P.isCurrent ? Model.billsStillToPay(P.to) : [];
  const stillTotal = r2(still.reduce((s, b) => s + b.amount, 0));
  let status = '';
  if (P.isCurrent) {
    const T = Model.timeline(ym());
    if (T.known && T.now !== null) {
      const free = r2(T.now - stillTotal);
      if (!still.length) status = T.now >= 0
        ? `<div class="cal-alert">✓ All bills before ${esc(dateLabel(P.nextPay))} are paid. About <b>${money(T.now)}</b> is left for everything else until then.</div>`
        : `<div class="cal-alert bad">✓ All bills before ${esc(dateLabel(P.nextPay))} are paid, but your account is at about <b>${money(T.now)}</b> until your ${esc(payName)} comes.</div>`;
      else status = free >= 0
        ? `<div class="cal-alert">Still to pay before ${esc(dateLabel(P.nextPay))}: <b>${money(stillTotal)}</b>. You have about ${money(T.now)} now, so <b>${money(free)}</b> is left for everything else until then.</div>`
        : `<div class="cal-alert bad">⚠ Still to pay before ${esc(dateLabel(P.nextPay))}: <b>${money(stillTotal)}</b>, but you only have about ${money(T.now)}. You're <b>${money(-free)}</b> short — move money over or plan a bill later.</div>`;
    } else {
      status = `<div class="cal-alert">Still to pay before ${esc(dateLabel(P.nextPay))}: <b>${money(stillTotal)}</b>${still.length ? ` (${still.length} bill${still.length === 1 ? '' : 's'})` : ''}.</div>`;
    }
  }
  const billRow = (b, past) => {
    // bills from another month open the general edit form (the per-month form works on the month you're viewing)
    const act = b.m === UI.month ? b.action : ({ 'item-month': 'edit-item', 'goal-month': 'edit-goal' }[b.action] || b.action);
    return `<button type="button" class="cal-row ${past ? 'is-past' : ''}" data-action="${act}" data-id="${b.id}">
      <span class="cal-day">${b.day ? `<b>${+b.date.slice(8)}</b>` : '<b>–</b>'}<small>${esc(monthOnly(b.m))}</small></span>
      <span class="row-main"><span class="name">${esc(b.name)}${b.paid ? ' <span class="muted">✓</span>' : ''}</span><span class="sub">${esc({ fixed: b.group || 'Fixed cost', credit: 'Credit', savings: 'Savings goal' }[b.kind] || '')}${b.day ? '' : b.paid ? ' · no day set' : ' · no day set — tick it once paid'}</span></span>
      <span class="amt">${money(b.amount)}</span>
    </button>`;
  };
  // still to pay first, then what's already paid
  const bkey = b => `${b.id}|${b.m}`;
  const stillKeys = new Set(still.map(bkey));
  const future = P.from > t, open = P.isCurrent ? still : future ? P.bills : [];
  const paid = P.isCurrent ? P.bills.filter(b => !stillKeys.has(bkey(b))).sort((a, b) => (a.date > b.date ? -1 : 1)) : future ? [] : P.bills;
  const rows = (open.length ? `<div class="cal-sub">Still to pay</div>${open.map(b => billRow(b, false)).join('')}` : P.isCurrent ? `<p class="empty">✓ Everything until ${esc(dateLabel(P.nextPay))} is paid.</p>` : '')
    + (paid.length ? `<div class="cal-sub done">Paid</div>${paid.map(b => billRow(b, true)).join('')}` : '');
  const needSum = joinSum([
    `bills ${money(P.total)}`,
    `keep ${money(keep)} after payday`,
    P.isCurrent ? (still.length ? `<b>${money(stillTotal)} still to pay</b>` : '✓ all paid') : '',
  ]);
  return card('month-need', 'Needed until payday', `${esc(dateLabel(P.from))} – ${esc(dateLabel(P.to))}`, `
    <p class="muted small" style="margin:4px 0 8px">${P.pay ? `Your ${esc(payName)} comes on ${esc(dateLabel(P.from))}; the next one on ${esc(dateLabel(P.nextPay))}.` : `Your next ${esc(payName)} comes on ${esc(dateLabel(P.nextPay))}.`} These bills are taken in between, so the money for them has to be on your account:</p>
    <div class="carry">
      <div class="carry-line"><span>Bills in this period</span><b>${money(P.total)}</b></div>
      <div class="carry-line muted"><span>Everyday spending (your budgets)</span><b>≈ ${money(P.spend)}</b></div>
      <div class="carry-line need-total"><span>Keep at least this after payday</span><b>${money(keep)}</b></div>
    </div>
    ${status}
    ${rows ? `<div class="cal-list">${rows}</div>` : '<p class="empty">No bills in this period.</p>'}`, needSum, '', 'id="needCard"');
}

/* ---------------- Goals view (savings goals + wishlist) ---------------- */
function goalStatus(g) {
  const cur = ym();
  const saved = Model.goalSavedBy(g, cur);
  const plan = Model.goalPlan(g);
  if (g.done) return { saved, text: 'Finished — no more saving planned.' };
  if (saved >= g.target) return { saved, text: '🎉 Reached!' };
  if (!plan.reach) return { saved, text: 'Set a monthly amount to reach it.', bad: true };
  let text = `${money(g.monthly)}/month · reached in ${monthLabel(plan.reach)}`;
  let bad = false;
  if (g.deadline && plan.reach > g.deadline) {
    const monthsLeft = monthDiff(cur, g.deadline); // months after this one
    text += monthsLeft > 0
      ? ` — too late for ${monthLabel(g.deadline, true)}. You'd need ${money(Math.ceil(((g.target - saved) / monthsLeft) * 100) / 100)}/month from next month.`
      : ` — not reached by ${monthLabel(g.deadline, true)}.`;
    bad = true;
  }
  return { saved, text, bad };
}

function goalCard(g) {
  const st = goalStatus(g);
  const pct = g.target > 0 ? Math.min(100, (st.saved / g.target) * 100) : 0;
  return `<div class="goal ${g.done ? 'is-ended' : ''}" data-action="edit-goal" data-id="${g.id}" role="button" tabindex="0">
    <div class="b-top">
      <span class="name">${esc(g.emoji ? g.emoji + ' ' : '')}${esc(g.name)}</span>
      <span class="amt">${money(st.saved)} <span class="muted">/ ${money(g.target)}</span></span>
    </div>
    <div class="bar ok"><i style="width:${pct}%"></i></div>
    <div class="sub-wrap ${st.bad ? 'neg' : 'muted'}">${esc(st.text)}${g.deadline && !st.bad && !g.done ? ` <span class="muted">(goal: ${esc(monthLabel(g.deadline, true))})</span>` : ''}</div>
  </div>`;
}

function wishPriceText(w) {
  return w.pay === 'split' && w.payments > 1
    ? `${money(w.price)} · ${w.payments} × ${money(Model.creditPart({ total: w.price, payments: w.payments }, 0))}`
    : money(w.price);
}

function wishCard(w, series) {
  const cur = ym();
  const base = Model.seriesWithout(w, series);
  const months = series.months;
  const best = Model.wishBest(w, base, months);
  const planned = Model.wishPlanned(w);
  const fit = planned ? Model.wishFit(w, w.month, base, months) : null;
  let status, cls = '';
  if (planned && fit) {
    if (fit.ok) { cls = 'ok'; status = `✓ Planned for ${monthLabel(w.month)} — it fits. Lowest point afterwards: ${money(fit.worst)} in ${monthLabel(fit.worstM, true)}.`; }
    else { cls = 'bad'; status = `⚠ Planned for ${monthLabel(w.month)} — doesn't fit: you'd go down to ${money(fit.worst)} in ${monthLabel(fit.worstM, true)}.${best ? ` It fits from ${monthLabel(best)}.` : ''}`; }
  } else if (best) {
    cls = 'ok';
    status = `${w.month && w.month < cur ? `Was planned for ${monthLabel(w.month, true)}. ` : ''}${best === cur ? 'Fits this month already.' : `Fits best from ${monthLabel(best)}.`}`;
  } else {
    cls = 'bad';
    status = `Doesn't fit in the next 2 years with your current plan.`;
  }
  const btns = [];
  if (planned) {
    if (w.month === cur) btns.push(`<button type="button" class="btn small" data-action="wish-bought" data-id="${w.id}">Bought it</button>`);
    btns.push(`<button type="button" class="btn small" data-action="wish-plan" data-id="${w.id}" data-m="">Not decided</button>`);
    if (!fit.ok && best) btns.push(`<button type="button" class="btn small primary" data-action="wish-plan" data-id="${w.id}" data-m="${best}">Move to ${esc(monthLabel(best, true))}</button>`);
  } else {
    if (best) btns.push(`<button type="button" class="btn small primary" data-action="wish-plan" data-id="${w.id}" data-m="${best}">Plan for ${esc(monthLabel(best, true))}</button>`);
    btns.push(`<button type="button" class="btn small" data-action="wish-bought" data-id="${w.id}">Bought it</button>`);
  }
  return `<div class="wish">
    <div class="wish-head" data-action="edit-wish" data-id="${w.id}" role="button" tabindex="0">
      <span class="name">${esc(w.name)}</span><span class="amt">${wishPriceText(w)}</span>
    </div>
    <div class="wish-status ${cls}">${esc(status)}</div>
    <div class="btn-row">${btns.join('')}<button type="button" class="btn small" data-action="edit-wish" data-id="${w.id}">Choose month…</button></div>
  </div>`;
}

function viewGoals() {
  const goals = Store.live('goals');
  const active = goals.filter(g => !g.done), done = goals.filter(g => g.done);
  const wishes = Store.live('wishes');
  const series = Model.balanceSeries(24);
  const s = Store.data.settings;
  const totalSaved = r2(goals.reduce((sum, g) => sum + Model.goalSavedBy(g, ym()), 0));
  const sortedWishes = [...wishes].sort((a, b) => (Model.wishPlanned(b) - Model.wishPlanned(a)) || ((a.month || '9') < (b.month || '9') ? -1 : 1));
  return `
  <h1 class="page-title">Goals</h1>
  <p class="muted page-sub">Save up for something, or check if something you're thinking of buying fits into your plan — and when.</p>
  <div class="grid">
    <div class="col">
      ${section('Thinking of buying', '', `
        <form id="cushionForm" class="cushion">
          <label for="cushionIn">Always keep at least</label>
          <input id="cushionIn" name="cushion" inputmode="decimal" value="${s.cushion || 0}" autocomplete="off">
          <button type="submit" class="btn small">Set</button>
        </form>
        ${!series.hasBalance ? `<p class="hint">Tip: enter the money you already have in <a href="#" data-action="tab" data-tab="settings">Settings → Leftover money &amp; savings</a>. Until then only money left over since you started using the app is counted.</p>` : ''}
        ${sortedWishes.length ? `<div class="wishes">${sortedWishes.map(w => wishCard(w, series)).join('')}</div>` : '<p class="empty">Add something you\'re thinking about buying — the app shows if and when it fits.</p>'}`,
        addBtn('add-wish', 'Something I want to buy'), '', 'goals-wishes',
        joinSum(sortedWishes.length ? sortedWishes.slice(0, 3).map(w => {
          const best = Model.wishBest(w, Model.seriesWithout(w, series), series.months);
          return `${esc(w.name)} ${Model.wishPlanned(w) ? `→ ${esc(monthLabel(w.month, true))}` : best ? `fits ${esc(monthLabel(best, true))}` : `<span class="neg">doesn't fit</span>`}`;
        }) : ['nothing on your list']))}
    </div>
    <div class="col">
      ${section('Savings goals', goals.length ? `${money(totalSaved)} saved` : '', active.length ? `<div class="goals">${active.map(goalCard).join('')}</div>` : '<p class="empty">E.g. "Holiday €1,200 by July" — the app works out how much to put aside each month.</p>', addBtn('add-goal', 'Savings goal'), '', 'goals-goals',
        joinSum(active.length ? active.map(g => `${esc(g.name)} ${Math.min(100, Math.round((Model.goalSavedBy(g, ym()) / g.target) * 100))}%`) : ['no goals yet']))}
      ${done.length ? section('Finished goals', '', `<div class="goals">${done.map(goalCard).join('')}</div>`, '', '', 'goals-done', joinSum(done.map(g => esc(g.name)))) : ''}
    </div>
  </div>`;
}

const EMOJI_CHIPS = (list, form) => {
  $$('.chip', form).forEach(c => (c.onclick = () => { form.elements.emoji.value = c.dataset.emoji; }));
  return list;
};

function goalModal(src) {
  const isNew = !src.id;
  const cur = ym();
  const g = isNew
    ? { id: uid(), name: '', emoji: '', target: '', initial: 0, start: cur, deadline: '', monthly: '', put: {}, paid: {}, done: false }
    : structuredClone(src);
  const body = `
    <div class="two emoji-row">
      <label class="field"><span>Icon</span><input name="emoji" value="${esc(g.emoji)}" maxlength="8" placeholder="🏖️"></label>
      <label class="field"><span>Saving for</span><input name="name" value="${esc(g.name)}" placeholder="e.g. Holiday, emergency fund" required></label>
    </div>
    <div class="chips">${['🏖️', '🚗', '💻', '🏠', '🎓', '💍', '🛟', '🎁', '📱', '🚲'].map(e => `<button type="button" class="chip" data-emoji="${e}">${e}</button>`).join('')}</div>
    <div class="two">
      <label class="field"><span>Target amount</span><input name="target" inputmode="decimal" value="${g.target}" placeholder="0.00"></label>
      <label class="field"><span>Already saved</span><input name="initial" inputmode="decimal" value="${g.initial || 0}"></label>
    </div>
    <div class="two">
      <label class="field"><span>Start saving in</span><input type="month" name="start" value="${g.start}"></label>
      <label class="field"><span>Reach it by (optional)</span><input type="month" name="deadline" value="${g.deadline || ''}"></label>
    </div>
    <div class="two">
      <label class="field"><span>Put aside per month</span><input name="monthly" inputmode="decimal" value="${g.monthly}" placeholder="from the date"></label>
      ${dayField(g.day, 'Put aside on day')}
    </div>
    <p class="hint preview"></p>
    <p class="form-error"></p>`;
  openModal(isNew ? 'New savings goal' : 'Edit savings goal', body, {
    submitLabel: isNew ? 'Add' : 'Save',
    extraButtons: isNew ? '' : `<button type="button" class="btn danger" data-m="delete">Delete</button><button type="button" class="btn" data-m="done">${g.done ? 'Continue' : 'Finish'}</button>`,
    onMount(form) {
      const el = form.elements;
      EMOJI_CHIPS(null, form);
      if (isNew) setTimeout(() => el.name.focus(), 50);
      let manual = !isNew && !g.deadline;
      const recalc = fromMonthly => {
        if (fromMonthly) manual = true;
        const target = parseAmount(el.target.value), initial = parseAmount(el.initial.value) || 0;
        if (!fromMonthly && !manual && target > 0 && isMonth(el.deadline.value) && isMonth(el.start.value) && el.deadline.value >= el.start.value) {
          const n = monthDiff(el.start.value, el.deadline.value) + 1;
          el.monthly.value = Math.max(0, Math.ceil(((target - initial) / n) * 100) / 100);
        }
        const monthly = parseAmount(el.monthly.value);
        const p = $('.preview', form);
        if (target > 0 && isMonth(el.start.value)) {
          const plan = Model.goalPlan({ ...g, target, initial, start: el.start.value, monthly: monthly || 0, put: g.put || {} });
          p.textContent = initial >= target ? 'Already reached!' : plan.reach
            ? `${money(monthly)}/month from ${monthLabel(el.start.value, true)} → reached in ${monthLabel(plan.reach)}.`
            : 'Enter how much to put aside per month (or a date to work it out).';
        } else p.textContent = '';
      };
      el.monthly.addEventListener('input', () => recalc(true));
      ['target', 'initial', 'start'].forEach(n => el[n].addEventListener('input', () => recalc(false)));
      el.deadline.addEventListener('input', () => { manual = false; recalc(false); });
      recalc(false);
      $('[data-m=delete]', form)?.addEventListener('click', () => {
        if (confirm(`Delete goal "${g.name}"?`)) { Store.del('goals', g.id); closeModal(); toast('Deleted'); }
      });
      $('[data-m=done]', form)?.addEventListener('click', () => {
        edit('goals', g.id, r => { r.done = !r.done; });
        closeModal(); toast(g.done ? 'Saving continues' : 'Goal finished — no more saving planned');
      });
    },
    onSubmit(fd, form) {
      const target = parseAmount(fd.target), initial = parseAmount(fd.initial) || 0, monthly = parseAmount(fd.monthly) || 0;
      if (!fd.name.trim()) return formError(form, 'Please enter what you are saving for.');
      if (!(target > 0)) return formError(form, 'Please enter a target amount.');
      if (!isMonth(fd.start)) return formError(form, 'Please choose a start month.');
      if (fd.deadline && (!isMonth(fd.deadline) || fd.deadline < fd.start)) return formError(form, 'The "reach it by" month is before the start.');
      if (monthly <= 0 && initial < target) return formError(form, 'Please enter how much to put aside per month.');
      Object.assign(g, { name: fd.name.trim(), emoji: fd.emoji.trim(), target, initial, start: fd.start, deadline: fd.deadline || '', monthly, day: readDay(fd.day) });
      Store.put('goals', g);
      toast(isNew ? 'Goal added' : 'Saved');
    },
  });
}

function goalMonthModal(id) {
  const g = Store.get('goals', id);
  if (!g) return;
  const m = UI.month, ml = monthLabel(m, true);
  const has = g.put && Object.prototype.hasOwnProperty.call(g.put, m);
  const planned = Model.goalContribution({ ...g, put: Object.fromEntries(Object.entries(g.put || {}).filter(([k]) => k !== m)) }, m);
  const now = Model.goalContribution(g, m);
  const body = `
    <p class="muted">${money(Model.goalSavedBy(g, m))} of ${money(g.target)} saved after ${ml}${has ? ` · normally ${money(planned)}` : ''}</p>
    <label class="field"><span>Put aside in ${monthLabel(m)}</span><input name="amount" class="amount-input" inputmode="decimal" value="${now}"></label>
    <p class="hint">Put less aside in a tight month (or more in a good one). Later months adjust automatically until the goal is reached.</p>
    <div class="btn-row wrap">
      ${has ? '<button type="button" class="btn small" data-m="reset">Back to plan</button>' : ''}
      <button type="button" class="btn small" data-m="edit">Edit goal…</button>
    </div>
    <p class="form-error"></p>`;
  openModal(`${esc(g.emoji || '')} ${esc(g.name)}`, body, {
    onMount(form) {
      $('[data-m=reset]', form)?.addEventListener('click', () => { edit('goals', id, r => { delete r.put[m]; }); closeModal(); toast('Back to plan'); });
      $('[data-m=edit]', form).onclick = () => goalModal(Store.get('goals', id));
    },
    onSubmit(fd, form) {
      const a = parseAmount(fd.amount);
      if (isNaN(a) || a < 0) return formError(form, 'Please enter a valid amount.');
      edit('goals', id, r => { r.put = { ...(r.put || {}) }; if (a === planned) delete r.put[m]; else r.put[m] = a; });
      toast('Saved');
    },
  });
}

function wishModal(src) {
  const isNew = !src.id;
  const cur = ym();
  const w = isNew ? { id: uid(), name: '', price: '', pay: 'once', payments: 3, month: null } : structuredClone(src);
  const series = Model.balanceSeries(24);
  const base = Model.seriesWithout(isNew ? null : src, series);
  const chipMonths = series.months.slice(0, 12);
  const body = `
    <label class="field"><span>What is it?</span><input name="name" value="${esc(w.name)}" placeholder="e.g. New phone, PlayStation, jacket" required></label>
    <label class="field"><span>Price</span><input name="price" class="amount-input" inputmode="decimal" value="${w.price}" placeholder="0.00"></label>
    <fieldset class="field"><legend>How would you pay?</legend>${segRadio('pay', [['once', 'All at once'], ['split', 'Installments']], w.pay === 'split' ? 'split' : 'once')}</fieldset>
    <label class="field split-only" ${w.pay === 'split' ? '' : 'hidden'}><span>Number of monthly payments</span><input name="payments" type="number" inputmode="numeric" min="2" max="120" value="${w.payments || 3}"></label>
    <fieldset class="field"><legend>When would you buy it?</legend>
      <p class="hint fit-best" style="margin:0 0 8px"></p>
      <div class="month-chips">
        <button type="button" class="mchip ${!w.month || w.month < cur ? 'sel' : ''}" data-mm="">Not decided</button>
        ${chipMonths.map(m => `<button type="button" class="mchip ${w.month === m ? 'sel' : ''}" data-mm="${m}">${esc(monthLabel(m, true))}</button>`).join('')}
      </div>
      <p class="hint fit-detail"></p>
    </fieldset>
    <input type="hidden" name="month" value="${w.month && w.month >= cur ? w.month : ''}">
    <p class="form-error"></p>`;
  openModal(isNew ? 'Thinking of buying…' : 'Edit wish', body, {
    submitLabel: isNew ? 'Add' : 'Save',
    extraButtons: isNew ? '' : '<button type="button" class="btn danger" data-m="delete">Delete</button>',
    onMount(form) {
      const el = form.elements;
      if (isNew) setTimeout(() => el.name.focus(), 50);
      const cand = () => ({ price: parseAmount(el.price.value), pay: form.querySelector('input[name=pay]:checked').value, payments: parseInt(el.payments.value, 10) || 0 });
      const upd = () => {
        const c = cand();
        $('.split-only', form).hidden = c.pay !== 'split';
        const valid = c.price > 0 && (c.pay === 'once' || c.payments >= 2);
        const best = valid ? Model.wishBest(c, base, series.months) : null;
        $$('.mchip[data-mm]', form).forEach(b => {
          const m = b.dataset.mm;
          b.classList.remove('fit', 'nofit', 'best');
          if (!m || !valid) return;
          const f = Model.wishFit(c, m, base, series.months);
          b.classList.add(f.ok ? 'fit' : 'nofit');
          if (m === best) b.classList.add('best');
        });
        $('.fit-best', form).textContent = !valid ? 'Enter a price to see which months it fits.'
          : best ? `★ Earliest month it fits: ${monthLabel(best)}. Green = fits, red = too tight.` : "It doesn't fit in the next 2 years with your current plan.";
        const sel = el.month.value;
        const d = $('.fit-detail', form);
        if (valid && sel) {
          const f = Model.wishFit(c, sel, base, series.months);
          d.className = `hint fit-detail ${f.ok ? 'pos' : 'neg'}`;
          d.textContent = f.ok ? `Fits in ${monthLabel(sel)}. Your lowest point afterwards: ${money(f.worst)} (${monthLabel(f.worstM, true)}).`
            : `Too tight in ${monthLabel(sel)}: you'd go down to ${money(f.worst)} in ${monthLabel(f.worstM, true)}.`;
        } else d.textContent = '';
      };
      $$('.mchip', form).forEach(b => (b.onclick = () => {
        $$('.mchip', form).forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        el.month.value = b.dataset.mm;
        upd();
      }));
      form.addEventListener('input', upd);
      form.addEventListener('change', upd);
      upd();
      $('[data-m=delete]', form)?.addEventListener('click', () => {
        if (confirm(`Remove "${w.name}" from your list?`)) { Store.del('wishes', w.id); closeModal(); toast('Removed'); }
      });
    },
    onSubmit(fd, form) {
      const price = parseAmount(fd.price), n = parseInt(fd.payments, 10);
      if (!fd.name.trim()) return formError(form, 'What is it?');
      if (!(price > 0)) return formError(form, 'Please enter the price.');
      if (fd.pay === 'split' && !(n >= 2 && n <= 120)) return formError(form, 'Number of payments must be between 2 and 120.');
      Object.assign(w, { name: fd.name.trim(), price, pay: fd.pay, payments: fd.pay === 'split' ? n : 1, month: isMonth(fd.month) ? fd.month : null });
      Store.put('wishes', w);
      toast(w.month ? `Planned for ${monthLabel(w.month)}` : (isNew ? 'Added to your list' : 'Saved'));
    },
  });
}

/* ---------------- Past months chart (overview) ---------------- */
const HIST_GROUPS = [['fixed', 'Fixed costs'], ['credits', 'Credits'], ['budgets', 'Budgets'], ['savings', 'Savings'], ['other', 'Other']];
function histData(m) {
  const t = Model.summarize(m).t;
  const vals = { fixed: t.fixed, credits: r2(t.credits + t.wishes), budgets: t.spent, savings: t.savings, other: t.other };
  const out = r2(Object.values(vals).reduce((a, b) => a + b, 0));
  return { m, t, vals, out, left: r2(t.income - out) };
}
function histDetail(d) {
  return `<div class="hd-title"><b>${esc(monthLabel(d.m))}</b>${d.m === ym() ? ' <span class="muted">(so far)</span>' : ''}
      <button type="button" class="link" data-action="goto-month" data-m="${d.m}">Open month ›</button></div>
    <div class="legend">
      <div><span class="dot dot-income"></span>Income<b>${money(d.t.income)}</b></div>
      ${HIST_GROUPS.filter(([k]) => d.vals[k]).map(([k, l]) => `<div><span class="dot c-${k}"></span>${l}<b>${money(d.vals[k])}</b></div>`).join('')}
      <div><span class="dot"></span>${d.left >= 0 ? 'Left over' : 'Overspent'}<b class="${d.left < 0 ? 'neg' : ''}">${money(d.left)}</b></div>
    </div>`;
}
function historyCard() {
  const cur = ym();
  const data = Array.from({ length: 6 }, (_, i) => histData(addMonths(cur, i - 5)));
  if (!data.some(d => d.out || d.t.income)) return '';
  const max = Math.max(1, ...data.map(d => Math.max(d.out, d.t.income)));
  const sel = data.length > 1 && (data[4].out || data[4].t.income) ? data[4] : data[5];
  const cols = data.map(d => `<button type="button" class="hc-col ${d.m === sel.m ? 'sel' : ''}" data-hist="${d.m}" aria-label="${esc(monthLabel(d.m))}">
      <span class="hc-plot">
        <span class="hc-stack">${HIST_GROUPS.filter(([k]) => d.vals[k] > 0).map(([k]) => `<i class="c-${k}" style="height:${(d.vals[k] / max) * 100}%"></i>`).join('')}</span>
        ${d.t.income ? `<span class="hc-income" style="bottom:${(d.t.income / max) * 100}%"></span>` : ''}
      </span>
      <span class="fc-label">${esc(monthOnly(d.m))}</span>
    </button>`).join('');
  const histSum = joinSum(data.slice(3, 5).reverse().filter(d => d.out || d.t.income)
    .map(d => `${esc(monthOnly(d.m))}: ${d.left >= 0 ? `+${money(d.left)} left` : `<span class="neg">${money(d.left)}</span>`}`));
  return card('ov-history', 'Last 6 months', 'spent vs. income', `
    <div class="chart-legend">${HIST_GROUPS.map(([k, l]) => `<span><span class="dot c-${k}"></span>${l}</span>`).join('')}<span><span class="dot dot-income"></span>Income</span></div>
    <div class="hc-chart">${cols}</div>
    <div id="histDetail" class="hist-detail">${histDetail(sel)}</div>`, histSum);
}
function showHist(m) {
  const box = $('#histDetail');
  if (!box) return;
  box.innerHTML = histDetail(histData(m));
  $$('.hc-col').forEach(c => c.classList.toggle('sel', c.dataset.hist === m));
}

/** short amount for chart labels: "€940", "€1.2k" (wide screens) or "940", "1.2k" (phones, less room) */
function shortAmount(v, symbol) {
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  const s = Store.data.settings;
  if (a >= 1000) {
    const k = (a / 1000).toLocaleString(locale(), { maximumFractionDigits: a >= 10000 ? 0 : 1 });
    return `${sign}${symbol ? money(0).replace(/[\d.,\s ]+/, '').trim() : ''}${k}k`;
  }
  if (!symbol) return sign + Math.round(a).toLocaleString(locale());
  try { return sign + new Intl.NumberFormat(s.locale || undefined, { style: 'currency', currency: s.currency || 'EUR', maximumFractionDigits: 0 }).format(Math.round(a)); }
  catch { return sign + Math.round(a); }
}
function barValue(v, pos) {
  return `<span class="fc-val ${v < 0 ? 'neg' : ''}" style="${pos}"><span class="fv-wide">${esc(shortAmount(v, true))}</span><span class="fv-narrow">${esc(shortAmount(v, false))}</span></span>`;
}

/* ---------------- Forecast view ---------------- */
function viewForecast() {
  const start = ym();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
  const bal = Store.data.settings.balance;
  let running = null;
  if (bal && isMonth(bal.month) && bal.month <= start) {
    running = bal.amount;
    for (let x = bal.month; x < start; x = addMonths(x, 1)) running = r2(running + Model.summarize(x).t.left);
  } else if (Model.carryOn()) running = Model.carryIn(start);
  const balWord = bal ? 'balance' : 'total left';
  const rows = months.map(m => {
    const S = Model.summarize(m);
    if (running === null && bal && bal.month === m) running = bal.amount;
    if (running !== null) running = r2(running + S.t.left);
    return { m, t: S.t, bal: running, credits: S.credits.length, later: S.other.filter(tx => tx.date.slice(0, 7) < m).length };
  });
  const maxPos = Math.max(0, ...rows.map(r => r.t.left));
  const maxNeg = Math.max(0, ...rows.map(r => -r.t.left));
  const hasNeg = maxNeg > 0;
  // positive and negative areas get height in proportion to their biggest bar
  const posFlex = Math.max(maxPos, (maxPos + maxNeg) * 0.15) || 1;
  const negFlex = Math.max(maxNeg, (maxPos + maxNeg) * 0.15);
  const bars = rows.map(r => {
    const hp = maxPos ? (r.t.left / maxPos) * (maxPos / posFlex) * 100 : 0;
    const hn = maxNeg ? (-r.t.left / maxNeg) * (maxNeg / negFlex) * 100 : 0;
    return `<button type="button" class="fc-col" data-action="goto-month" data-m="${r.m}" title="${esc(monthLabel(r.m))}: ${esc(money(r.t.left))}">
      <span class="fc-pos" style="flex:${posFlex}">${r.t.left >= 0 ? `<i style="height:${hp}%"></i>${barValue(r.t.left, `bottom:calc(${hp}% + 3px)`)}` : ''}</span>
      ${hasNeg ? `<span class="fc-neg" style="flex:${negFlex}">${r.t.left < 0 ? `<i style="height:${hn}%"></i>${barValue(r.t.left, `top:calc(${hn}% + 3px)`)}` : ''}</span>` : ''}
      <span class="fc-label">${esc(monthOnly(r.m))}</span>
    </button>`;
  }).join('');

  const list = rows.map(r => `<button type="button" class="fc-row" data-action="goto-month" data-m="${r.m}">
    <span class="fc-main">
      <span class="name">${monthLabel(r.m)}${r.m === start ? ' <span class="tag">now</span>' : ''}</span>
      <span class="sub">in ${money(r.t.income)} · out ${money(r.t.out)}${r.t.credits ? ` · credits ${money(r.t.credits)}` : ''}${r.later ? ` · ${r.later} bought earlier` : ''}</span>
    </span>
    <span class="fc-right">
      <span class="amt ${r.t.left < 0 ? 'neg' : 'pos'}">${r.t.left >= 0 ? '+' : ''}${money(r.t.left)}</span>
      ${r.bal !== null ? `<span class="sub">${balWord} ${money(r.bal)}</span>` : ''}
    </span>
  </button>`).join('');

  const credits = Store.live('credits').filter(c => Model.creditEnd(c) >= start);
  const owed = r2(credits.reduce((s, c) => s + Model.creditRemainingAfter(c, addMonths(start, -1)), 0));
  const debtFree = credits.length ? credits.map(c => Model.creditEnd(c)).sort().pop() : null;
  const negMonths = rows.filter(r => r.t.left < 0);

  return `
  <h1 class="page-title">Overview</h1>
  <p class="muted page-sub">How the last months went, and what's left each coming month if everything goes as planned — fixed costs, budgets, credits, savings goals, planned purchases and things you bought now but pay later.</p>
  ${negMonths.length ? `<div class="card alert ${running !== null && Math.min(...rows.map(r => r.bal)) >= 0 ? 'soft' : ''}">⚠ You'll spend more than you earn in ${negMonths.map(r => monthLabel(r.m, true)).join(', ')}.${running !== null ? (Math.min(...rows.map(r => r.bal)) >= 0 ? ' Your savings cover it.' : ' Your savings are not enough to cover it.') : ''}</div>` : ''}
  ${historyCard()}
  ${card('ov-chart', 'Coming months: left over', 'tap a bar to open', `<div class="fc-chart ${hasNeg ? 'has-neg' : ''}">${bars}</div>`,
    joinSum([negMonths.length ? `<span class="neg">minus in ${negMonths.map(r => esc(monthOnly(r.m))).join(', ')}</span>` : 'every month positive', `best: ${esc(monthOnly(rows.reduce((a, b) => (b.t.left > a.t.left ? b : a)).m))}`]))}
  <div class="grid">
    <div class="col">
      ${card('ov-list', 'Next 12 months', money(r2(rows.reduce((s, r) => s + r.t.left, 0))), `
        <div class="fc-list">${list}</div>
        ${running === null ? `<p class="hint">Tip: enter the money you already have in <a href="#" data-action="tab" data-tab="settings">Settings → Leftover money &amp; savings</a> to see your running balance.</p>` : ''}`,
        joinSum([`this month ${rows[0].t.left >= 0 ? '+' : ''}${money(rows[0].t.left)}`, rows[11].bal !== null ? `${balWord} in ${esc(monthOnly(rows[11].m))}: ${money(rows[11].bal)}` : '']))}
    </div>
    <div class="col">
      ${card('ov-credits', 'Credits', owed ? money(owed) : '', `
        ${credits.length ? `<p>You still have to pay <b>${money(owed)}</b>. ${debtFree ? `Debt-free after <b>${monthLabel(debtFree)}</b>.` : ''}</p>
          ${credits.map(c => `<div class="row"><button type="button" class="row-main" data-action="edit-credit" data-id="${c.id}"><span class="name">${esc(c.name)}</span><span class="sub">${Model.paymentsLeftFrom(c, start)} payments left · last ${monthLabel(Model.creditEnd(c), true)}</span></button><span class="amt">${money(Model.creditRemainingAfter(c, addMonths(start, -1)))}</span></div>`).join('')}`
        : '<p class="empty">No open credits. 🎉</p>'}
        ${addBtn('add-credit', 'Credit / installment plan')}`,
        credits.length ? joinSum([`${credits.length} open`, debtFree ? `debt-free after ${esc(monthLabel(debtFree, true))}` : '']) : 'no open credits 🎉')}
    </div>
  </div>`;
}

/* ---------------- Settings view ---------------- */
function viewSettings() {
  const s = Store.data.settings;
  const bal = s.balance;
  return `
  <h1 class="page-title">Settings</h1>
  <div class="grid">
  <div class="col">
  <section class="card"><h2>General</h2>
    <form id="genForm">
      <div class="two">
        <label class="field"><span>Currency</span><input name="currency" value="${esc(s.currency)}" list="currencies" maxlength="3" autocapitalize="characters" autocomplete="off"></label>
        <label class="field"><span>Number format</span><select name="locale">${LOCALES.map(([v, l]) => `<option value="${v}" ${v === (s.locale || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      </div>
      <datalist id="currencies">${CURRENCIES.map(c => `<option value="${c}">`).join('')}</datalist>
      <p class="hint">Looks like: ${money(1234.5)}</p>
      <p class="form-error"></p>
      <button class="btn primary" type="submit">Save</button>
    </form>
  </section>
  <section class="card"><h2>Leftover money &amp; savings</h2>
    <label class="toggle"><input type="checkbox" id="carryToggle" ${Model.carryOn() ? 'checked' : ''}><span><b>Carry leftover money to the next month</b> — what you don't spend shows up in the next month as "still left from last month" (and overspending is taken off).</span></label>
    <p class="muted">What was on your account at the start of a month. Used for your current balance, the payment calendar and the Overview. Easiest: tap the balance at the top and enter what your bank shows today.</p>
    <form id="balForm">
      <div class="two">
        <label class="field"><span>Amount</span><input name="amount" inputmode="decimal" value="${bal ? bal.amount : ''}" placeholder="0.00" autocomplete="off"></label>
        <label class="field"><span>At the start of</span><input type="month" name="month" value="${bal ? bal.month : ym()}"></label>
      </div>
      <p class="form-error"></p>
      <div class="btn-row"><button class="btn primary" type="submit">Save</button>${bal ? '<button type="button" class="btn" data-action="clear-balance">Clear</button>' : ''}</div>
    </form>
  </section>
  ${installSection()}
  </div>
  <div class="col">
  ${syncSection()}
  <section class="card"><h2>Import from your bank</h2>
    <p class="muted">Download your transactions as a CSV file in your online banking (often under "Export" or "Download"), then load it here. You check everything before it's added, and transactions you already imported are skipped.</p>
    <button type="button" class="btn primary" data-action="import-csv">Import bank CSV…</button>
  </section>
  ${transferSection()}
  <section class="card"><h2>Danger zone</h2>
    <p class="muted">Removes everything${Sync.enabled() ? ' — on all synced devices' : ''}.</p>
    <button type="button" class="btn danger" data-action="reset">Delete all data</button>
  </section>
  </div>
  </div>
  <p class="footer muted">Your data is stored on this device${Sync.enabled() ? ' and synced through your own private GitHub Gist' : ''}. Nothing is sent anywhere else.</p>`;
}

const TRANSFER_KEY = 'mm-transfer-v1'; // per device: when a file was last saved / loaded
function transferInfo() { try { return JSON.parse(localStorage.getItem(TRANSFER_KEY)) || {}; } catch { return {}; } }
function setTransferInfo(patch) { localStorage.setItem(TRANSFER_KEY, JSON.stringify({ ...transferInfo(), ...patch })); }
function transferFile() {
  const data = { ...Store.data, app: 'money-manager', exportedAt: new Date().toISOString() };
  return new File([JSON.stringify(data, null, 1)], `money-manager-${today()}.json`, { type: 'application/json' });
}
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] })); } catch { return false; }
}

function transferSection() {
  const info = transferInfo();
  return `<section class="card"><h2>Transfer file</h2>
    <p class="muted">Move your data to another device (like your phone), or keep a backup. Save the file here, move it over (USB cable, cloud drive, email to yourself…) and load it on the other device.</p>
    <div class="btn-row">
      <button type="button" class="btn primary" data-action="export">Save transfer file</button>
      ${canShareFiles() ? '<button type="button" class="btn" data-action="share-file">Share…</button>' : ''}
      <button type="button" class="btn" data-action="import-merge">Load transfer file…</button>
    </div>
    <p class="hint">Loading <b>combines</b> the file with what's on this device: for every entry the newest version wins, so changes made on both devices are kept — deletions too. Nothing gets lost by loading an older file.</p>
    <p class="hint">Last saved here: <b>${info.savedAt ? esc(timeAgo(info.savedAt)) : 'never'}</b> · last loaded here: <b>${info.loadedAt ? esc(timeAgo(info.loadedAt)) : 'never'}</b></p>
    <p class="hint">⚠ The file contains all your money data unencrypted. Delete it from shared places (chats, cloud folders) once it's loaded.</p>
    <details class="plan-edit"><summary>Replace everything instead</summary>
      <p class="muted small">Restoring a backup <b>replaces</b> all data on this device with the file — use this to go back to an older state.</p>
      <button type="button" class="btn" data-action="import">Restore backup (replace all)…</button>
    </details>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
  </section>`;
}

/** merge a transfer file into this device; returns number of new/changed entries */
function mergeIn(obj) {
  const local = mergeData(Store.data, null);
  const merged = mergeData(Store.data, normalizeData(obj));
  let changed = 0;
  for (const k of COLLS) {
    const before = new Map(local[k].map(r => [r.id, r.updatedAt || 0]));
    for (const r of merged[k]) if (before.get(r.id) !== (r.updatedAt || 0)) changed++;
  }
  if (merged.settings !== local.settings) changed++;
  if (changed) { Store.data = normalizeData(merged); Store.commit(); }
  return changed;
}

function syncSection() {
  if (!Sync.enabled()) {
    return `<section class="card"><h2>Sync phone &amp; PC</h2>
      <p class="muted">Keeps your data the same on all your devices, using a private GitHub Gist as storage (free, needs a GitHub account).</p>
      <ol class="steps">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a>.</li>
        <li>Name it "Money Manager", pick an expiration, and under <b>Permissions → Account</b> set <b>Gists</b> to <b>Read and write</b>. Nothing else.</li>
        <li>Generate it, copy it, paste it below. Use the same token and passphrase on every device.</li>
      </ol>
      <form id="syncForm">
        <label class="field"><span>GitHub token</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…" required></label>
        <label class="field"><span>Encryption passphrase (recommended)</span><input name="passphrase" type="password" autocomplete="new-password" placeholder="Something only you know"></label>
        <p class="hint">Your data is encrypted with this passphrase before it leaves the device, so even GitHub can't read it. If you forget it, the synced copy can't be opened (data on your devices stays).</p>
        <p class="form-error"></p>
        <button class="btn primary" type="submit">Connect</button>
      </form>
    </section>`;
  }
  return `<section class="card"><h2>Sync phone &amp; PC</h2>
    <div id="syncStatusBox" class="sync-status s-${Sync.status}">${esc(syncStatusText())}</div>
    <p class="muted">Encrypted: <b>${Sync.cfg.passphrase ? 'yes' : 'no'}</b>. Syncs automatically when you change something and when you open the app.</p>
    <div class="btn-row">
      <button type="button" class="btn primary" data-action="sync-now">Sync now</button>
      <button type="button" class="btn" data-action="sync-disconnect">Disconnect this device</button>
    </div>
    <p class="hint">Add another device: open the app there → Settings → connect with the same token and passphrase.</p>
  </section>`;
}

function installSection() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return `<section class="card"><h2>App</h2><p class="muted">✓ Installed as an app on this device.</p></section>`;
  return `<section class="card"><h2>Install as an app</h2>
    ${deferredInstall ? '<p><button type="button" class="btn primary" data-action="install">Install app</button></p>' : ''}
    <ul class="steps">
      <li><b>iPhone / iPad:</b> open in Safari → Share button → <i>Add to Home Screen</i>.</li>
      <li><b>Android:</b> open in Chrome → ⋮ menu → <i>Install app</i> (or <i>Add to Home screen</i>).</li>
      <li><b>PC:</b> in Chrome or Edge click the install icon in the address bar.</li>
    </ul>
  </section>`;
}

/* ---------------- Modal helpers ---------------- */
function openModal(title, bodyHtml, { onSubmit, onMount, submitLabel = 'Save', extraButtons = '', wide = false } = {}) {
  const dlg = $('#modal');
  dlg.classList.toggle('wide', wide);
  dlg.innerHTML = `<form class="modal-form" novalidate autocomplete="off">
    <div class="modal-head"><h3>${title}</h3><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">${extraButtons}<span class="spacer"></span>${onSubmit ? `<button type="submit" class="btn primary">${submitLabel}</button>` : '<button type="button" class="btn" data-close>Close</button>'}</div>
  </form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!onSubmit) return;
    const fd = Object.fromEntries(new FormData(form));
    if (onSubmit(fd, form) !== false) closeModal();
  });
  $$('[data-close]', dlg).forEach(b => (b.onclick = closeModal));
  if (!dlg.open) dlg.showModal();
  if (onMount) onMount(form, dlg);
}
function closeModal() { const d = $('#modal'); if (d.open) d.close(); }
function formError(form, msg) { const el = $('.form-error', form); if (el) el.textContent = msg; return false; }
const segRadio = (name, opts, value) => `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function defaultDate() {
  if (UI.month === ym()) return today();
  return `${UI.month}-01`;
}

/* ---------------- Transaction (expense / one-time income) ---------------- */
function txModal(src) {
  const isNew = !src.id;
  const tx = isNew
    ? { id: uid(), kind: src.kind || 'expense', date: src.date || defaultDate(), name: src.name || '', amount: src.amount || '', budgetId: src.budgetId || '' }
    : structuredClone(src);
  const income = tx.kind === 'income';
  const refMonth = isNew ? UI.month : tx.month;
  const budgets = Store.live('budgets').filter(b => Model.isActive(b, refMonth) || b.id === tx.budgetId);
  const names = [...new Set(Store.live('txs').filter(t => t.kind === tx.kind).sort((a, b) => (a.date < b.date ? 1 : -1)).map(t => t.name))].slice(0, 60);

  const payBlock = income ? '' : isNew ? `
    <fieldset class="field"><legend>When do you pay?</legend>
      ${segRadio('pay', [['now', 'Now'], ['next', 'Next month'], ['split', 'Installments']], src.pay || 'now')}
    </fieldset>
    <div class="split-opts" hidden>
      <div class="two">
        <label class="field"><span>Monthly payments</span><input name="payments" type="number" inputmode="numeric" min="2" max="120" value="${src.payments || 3}"></label>
        <label class="field"><span>First payment</span><select name="firstPay"><option value="0">Same month</option><option value="1" selected>Next month</option></select></label>
      </div>
      <p class="hint split-preview"></p>
    </div>`
    : `<label class="field"><span>Paid in month</span><input type="month" name="month" value="${tx.month}"></label>
       <p class="hint">Bought now but paying later (credit card, "pay next month")? Set the month the money actually leaves your account.</p>`;

  const body = `
    <label class="field"><span>Amount</span><input name="amount" class="amount-input" inputmode="decimal" value="${tx.amount === '' ? '' : tx.amount}" placeholder="0.00" required></label>
    <label class="field"><span>${income ? 'From' : 'What for?'}</span><input name="name" value="${esc(tx.name)}" list="tx-names" placeholder="${income ? 'e.g. Bonus, sold bike' : 'e.g. Groceries, cinema'}"></label>
    <datalist id="tx-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${income ? '' : `<label class="field"><span>Category</span><select name="budgetId">
      <option value="">Other spending</option>
      ${budgets.map(b => `<option value="${b.id}" ${b.id === tx.budgetId ? 'selected' : ''}>${esc(b.emoji || '')} ${esc(b.name)}</option>`).join('')}
    </select></label>`}
    <label class="field"><span>Date</span><input type="date" name="date" value="${tx.date}" required></label>
    ${payBlock}
    <p class="form-error"></p>`;

  openModal(isNew ? (income ? 'One-time income' : 'Add expense') : (income ? 'Edit income' : 'Edit expense'), body, {
    submitLabel: isNew ? 'Add' : 'Save',
    extraButtons: isNew ? '' : '<button type="button" class="btn danger" data-m="delete">Delete</button>',
    onMount(form) {
      const el = form.elements;
      if (isNew) setTimeout(() => el.amount.focus(), 50);
      $('[data-m=delete]', form)?.addEventListener('click', () => {
        if (confirm(`Delete "${tx.name}"?`)) { Store.del('txs', tx.id); closeModal(); toast('Deleted'); }
      });
      // pick category automatically from earlier entries with the same name
      el.name.addEventListener('change', () => {
        if (income || !el.budgetId || el.budgetId.value) return;
        const prev = Store.live('txs').filter(t => t.name === el.name.value && t.budgetId).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (prev && [...el.budgetId.options].some(o => o.value === prev.budgetId)) el.budgetId.value = prev.budgetId;
      });
      if (!income && isNew) {
        const split = $('.split-opts', form), preview = $('.split-preview', form);
        const upd = () => {
          const isSplit = form.querySelector('input[name=pay]:checked').value === 'split';
          split.hidden = !isSplit;
          if (!isSplit) return;
          const amount = parseAmount(el.amount.value), n = parseInt(el.payments.value, 10);
          const date = isDate(el.date.value) ? el.date.value : defaultDate();
          if (amount > 0 && n >= 2) {
            const c = { total: amount, payments: n, start: addMonths(date.slice(0, 7), +el.firstPay.value) };
            preview.textContent = `${n} × ${money(Model.creditPart(c, 0))} from ${monthLabel(c.start, true)} to ${monthLabel(Model.creditEnd(c), true)}. It will show up under Credits & installments.`;
          } else preview.textContent = '';
        };
        form.addEventListener('input', upd);
        form.addEventListener('change', upd);
        upd();
      }
    },
    onSubmit(fd, form) {
      const amount = parseAmount(fd.amount);
      if (!(amount > 0)) return formError(form, 'Please enter an amount greater than 0.');
      if (!isDate(fd.date)) return formError(form, 'Please pick a date.');
      const doneWish = () => { if (src.fromWish && Store.get('wishes', src.fromWish)) Store.del('wishes', src.fromWish); };
      const b = fd.budgetId ? Store.get('budgets', fd.budgetId) : null;
      const name = (fd.name || '').trim() || (income ? 'Extra income' : b ? b.name : 'Expense');
      const dateMonth = fd.date.slice(0, 7);
      if (isNew && fd.pay === 'split') {
        const n = parseInt(fd.payments, 10);
        if (!(n >= 2 && n <= 120)) return formError(form, 'Number of payments must be between 2 and 120.');
        Store.put('credits', { id: uid(), name, total: amount, payments: n, start: addMonths(dateMonth, +fd.firstPay), paid: {}, bought: fd.date });
        doneWish();
        toast(`Added ${name} as ${n} monthly payments`);
        return;
      }
      let month;
      if (income) month = dateMonth;
      else if (isNew) month = addMonths(dateMonth, fd.pay === 'next' ? 1 : 0);
      else if (fd.month === tx.month) month = addMonths(dateMonth, Math.max(0, monthDiff(tx.date.slice(0, 7), tx.month)));
      else month = isMonth(fd.month) ? fd.month : dateMonth;
      Object.assign(tx, { amount, name, date: fd.date, month, budgetId: income ? null : (fd.budgetId || null) });
      Store.put('txs', tx);
      doneWish();
      toast(isNew ? (month !== UI.month ? `Added — counts in ${monthLabel(month)}` : 'Added') : 'Saved');
    },
  });
}

/* ---------------- Recurring item for one month ---------------- */
function itemMonthModal(id) {
  const it = Store.get('items', id);
  if (!it) return;
  const m = UI.month, ml = monthLabel(m, true);
  const skipped = Model.isSkipped(it, m);
  const base = Model.baseAmount(it, m);
  const amount = skipped ? base : Model.amountFor(it, m);
  const body = `
    <p class="muted">${it.kind === 'income' ? 'Income' : 'Fixed cost'} · ${EVERY[it.every || 1]}${Model.hasOverride(it, m) && !skipped ? ` · normally ${money(base)}` : ''}${skipped ? ' · skipped this month' : ''}</p>
    <label class="field"><span>Amount in ${monthLabel(m)}</span><input name="amount" class="amount-input" inputmode="decimal" value="${amount}"></label>
    <fieldset class="field"><legend>Change applies to</legend>${segRadio('scope', [['month', `Only ${ml}`], ['future', `${ml} and later`]], 'month')}</fieldset>
    <div class="btn-row wrap">
      <button type="button" class="btn small" data-m="skip">${skipped ? 'Don\'t skip' : `Skip ${ml}`}</button>
      <button type="button" class="btn small" data-m="end">${it.end === m ? 'Keep going after this' : `${ml} is the last time`}</button>
      <button type="button" class="btn small" data-m="edit">Edit details…</button>
    </div>
    <p class="form-error"></p>`;
  openModal(esc(it.name), body, {
    onMount(form) {
      $('[data-m=skip]', form).onclick = () => {
        edit('items', id, r => { r.overrides = { ...(r.overrides || {}) }; if (skipped) delete r.overrides[m]; else r.overrides[m] = null; });
        closeModal(); toast(skipped ? 'Back on' : `Skipped in ${ml}`);
      };
      $('[data-m=end]', form).onclick = () => {
        edit('items', id, r => { r.end = r.end === m ? null : m; });
        closeModal(); toast(it.end === m ? 'Continues' : `Ends after ${ml}`);
      };
      $('[data-m=edit]', form).onclick = () => itemModal(Store.get('items', id));
    },
    onSubmit(fd, form) {
      const a = parseAmount(fd.amount);
      if (isNaN(a) || a < 0) return formError(form, 'Please enter a valid amount.');
      edit('items', id, r => {
        if (fd.scope === 'future') Model.setAmountFrom(r, m, a);
        else Model.setAmountOnly(r, m, a);
      });
      toast('Saved');
    },
  });
}

/* ---------------- Recurring item (plan) ---------------- */
function itemModal(src) {
  const isNew = !src.id;
  const cur = ym();
  const it = isNew
    ? { id: uid(), kind: src.kind || 'fixed', name: '', every: 1, start: UI.month < cur ? cur : UI.month, end: null, amounts: [], overrides: {}, paid: {} }
    : structuredClone(src);
  const effFrom = isNew ? null : (cur < it.start ? it.start : cur);
  const orig = isNew ? '' : Model.baseAmount(it, effFrom);
  const body = `
    <fieldset class="field"><legend>Type</legend>${segRadio('kind', [['income', 'Income'], ['fixed', 'Fixed cost']], it.kind)}</fieldset>
    <label class="field"><span>Name</span><input name="name" value="${esc(it.name)}" placeholder="e.g. Salary, Rent, Netflix" required></label>
    <div class="field fixed-only" ${it.kind === 'fixed' ? '' : 'hidden'}>
      <label for="grpIn" class="field-label">Group</label>
      <input id="grpIn" name="group" value="${esc(it.kind === 'fixed' && it.name ? fixedGroup(it) : (it.group || ''))}" list="fixed-groups" placeholder="e.g. Rent & housing, School, Other" autocomplete="off">
      <datalist id="fixed-groups">${allGroups().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="chips grp-chips">${allGroups().map(g => `<button type="button" class="chip wide-chip" data-grp="${esc(g)}">${esc(g)}</button>`).join('')}</div>
    </div>
    <label class="field"><span>Amount</span><input name="amount" class="amount-input" inputmode="decimal" value="${orig}" placeholder="0.00"></label>
    ${isNew ? '' : `<p class="hint">A new amount applies from ${monthLabel(effFrom)} on — earlier months keep the old amount. To change only one month, tap it in the Month tab.</p>`}
    <div class="two">
      <label class="field"><span>How often</span><select name="every">${Object.entries(EVERY).map(([v, l]) => `<option value="${v}" ${+v === (it.every || 1) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${dayField(it.day, it.kind === 'income' ? 'Comes in on day' : 'Taken on day')}
    </div>
    <div class="two">
      <label class="field"><span>First month</span><input type="month" name="start" value="${it.start}" required></label>
      <label class="field"><span>Last month (optional)</span><input type="month" name="end" value="${it.end || ''}"></label>
    </div>
    <p class="form-error"></p>`;
  openModal(isNew ? (it.kind === 'income' ? 'Add monthly income' : 'Add fixed cost') : 'Edit', body, {
    submitLabel: isNew ? 'Add' : 'Save',
    extraButtons: isNew ? '' : '<button type="button" class="btn danger" data-m="delete">Delete</button>',
    onMount(form) {
      if (isNew) setTimeout(() => form.elements.name.focus(), 50);
      const el = form.elements;
      let groupTouched = !isNew;
      const pickChip = () => $$('.grp-chips .chip', form).forEach(c => c.classList.toggle('sel', c.dataset.grp === el.group.value.trim()));
      $$('.grp-chips .chip', form).forEach(c => (c.onclick = () => { el.group.value = c.dataset.grp; groupTouched = true; pickChip(); }));
      el.group.addEventListener('input', () => { groupTouched = true; pickChip(); });
      el.name.addEventListener('input', () => { if (!groupTouched) { el.group.value = el.name.value.trim() ? fixedGroup({ name: el.name.value }) : ''; pickChip(); } });
      form.addEventListener('change', e => {
        if (e.target.name !== 'kind') return;
        $('.fixed-only', form).hidden = e.target.value !== 'fixed';
        $('.day-label', form).textContent = e.target.value === 'income' ? 'Comes in on day' : 'Taken on day';
      });
      pickChip();
      $('[data-m=delete]', form)?.addEventListener('click', () => {
        if (confirm(`Delete "${it.name}" completely?\n\nIt also disappears from past months. To stop it from a certain month instead, set a "Last month".`)) {
          Store.del('items', it.id); closeModal(); toast('Deleted');
        }
      });
    },
    onSubmit(fd, form) {
      const amount = parseAmount(fd.amount);
      if (!fd.name.trim()) return formError(form, 'Please enter a name.');
      if (isNaN(amount) || amount < 0) return formError(form, 'Please enter a valid amount.');
      if (!isMonth(fd.start)) return formError(form, 'Please choose the first month.');
      if (fd.end && !isMonth(fd.end)) return formError(form, 'Last month looks wrong (YYYY-MM).');
      if (fd.end && fd.end < fd.start) return formError(form, 'Last month is before the first month.');
      Object.assign(it, { kind: fd.kind, name: fd.name.trim(), every: +fd.every || 1, start: fd.start, end: fd.end || null, day: readDay(fd.day) });
      if (fd.kind === 'fixed') it.group = (fd.group || '').trim() || fixedGroup({ name: it.name });
      else delete it.group;
      if (isNew) it.amounts = [{ from: it.start, amount }];
      else if (amount !== orig) Model.setAmountFrom(it, effFrom, amount);
      Store.put('items', it);
      toast(isNew ? 'Added' : 'Saved');
    },
  });
}

/* ---------------- Budget ---------------- */
function budgetModal(src) {
  const isNew = !src.id;
  const cur = ym();
  const b = isNew
    ? { id: uid(), name: '', emoji: '', every: 1, start: UI.month < cur ? cur : UI.month, end: null, amounts: [], overrides: {} }
    : structuredClone(src);
  const effFrom = isNew ? null : (cur < b.start ? b.start : cur);
  const orig = isNew ? '' : Model.baseAmount(b, effFrom);
  const body = `
    <div class="two emoji-row">
      <label class="field"><span>Icon</span><input name="emoji" value="${esc(b.emoji)}" maxlength="8" placeholder="🍔"></label>
      <label class="field"><span>Name</span><input name="name" value="${esc(b.name)}" placeholder="e.g. Food, Going out" required></label>
    </div>
    <div class="chips">${['🍔', '🛒', '🎉', '🚌', '⛽', '🛍️', '💊', '🐶', '🎁', '☕', '🎮', '✈️'].map(e => `<button type="button" class="chip" data-emoji="${e}">${e}</button>`).join('')}</div>
    <label class="field"><span>Planned per month</span><input name="amount" class="amount-input" inputmode="decimal" value="${orig}" placeholder="0.00"></label>
    ${isNew ? '' : `<p class="hint">A new amount applies from ${monthLabel(effFrom)} on. To change only one month, open the budget in the Month tab.</p>`}
    <label class="toggle"><input type="checkbox" name="rollover" ${b.rollover ? 'checked' : ''}><span><b>Carry over</b> — money not spent this month is added to next month (and overspending is taken off next month).</span></label>
    <div class="two">
      <label class="field"><span>First month</span><input type="month" name="start" value="${b.start}" required></label>
      <label class="field"><span>Last month (optional)</span><input type="month" name="end" value="${b.end || ''}"></label>
    </div>
    <p class="form-error"></p>`;
  openModal(isNew ? 'Add budget' : 'Edit budget', body, {
    submitLabel: isNew ? 'Add' : 'Save',
    extraButtons: isNew ? '' : '<button type="button" class="btn danger" data-m="delete">Delete</button>',
    onMount(form) {
      if (isNew) setTimeout(() => form.elements.name.focus(), 50);
      $$('.chip', form).forEach(c => (c.onclick = () => { form.elements.emoji.value = c.dataset.emoji; }));
      $('[data-m=delete]', form)?.addEventListener('click', () => {
        if (confirm(`Delete budget "${b.name}"?\n\nSpending in it moves to "Other spending". To stop it from a certain month instead, set a "Last month".`)) {
          Store.del('budgets', b.id); closeModal(); toast('Deleted');
        }
      });
    },
    onSubmit(fd, form) {
      const amount = parseAmount(fd.amount);
      if (!fd.name.trim()) return formError(form, 'Please enter a name.');
      if (isNaN(amount) || amount < 0) return formError(form, 'Please enter a valid amount.');
      if (!isMonth(fd.start)) return formError(form, 'Please choose the first month.');
      if (fd.end && (!isMonth(fd.end) || fd.end < fd.start)) return formError(form, 'Last month looks wrong.');
      Object.assign(b, { name: fd.name.trim(), emoji: fd.emoji.trim(), start: fd.start, end: fd.end || null, rollover: !!fd.rollover });
      if (isNew) b.amounts = [{ from: b.start, amount }];
      else if (amount !== orig) Model.setAmountFrom(b, effFrom, amount);
      Store.put('budgets', b);
      toast(isNew ? 'Added' : 'Saved');
    },
  });
}

function budgetMonthModal(id) {
  const m = UI.month, ml = monthLabel(m, true);
  const row = Model.summarize(m).budgets.find(x => x.b.id === id);
  if (!row) return;
  const { b, planned, available, spent, txs } = row;
  const left = r2(available - spent);
  const pct = available > 0 ? Math.min(100, (spent / available) * 100) : (spent > 0 ? 100 : 0);
  const carry = carryText(row);
  const body = `
    <div class="budget-hero">
      <div><span class="big">${money(spent)}</span> <span class="muted">of ${money(available)}</span></div>
      <div class="bar ${left < 0 ? 'over' : pct >= 85 ? 'warn' : 'ok'}"><i style="width:${pct}%"></i></div>
      <div class="${left < 0 ? 'neg' : 'pos'}">${left < 0 ? `${money(-left)} over budget` : `${money(left)} left`}</div>
      ${carry ? `<div class="muted small">Planned ${money(planned)}, ${carry}</div>` : ''}
    </div>
    <button type="button" class="btn block" data-action="add-expense" data-budget="${b.id}">+ Add spending</button>
    <div class="list">${txs.length ? txs.map(tx => txRow(tx)).join('') : '<p class="empty">No spending in this budget yet.</p>'}</div>
    <details class="plan-edit" ${row.changed ? 'open' : ''}>
      <summary>Change planned amount${row.changed ? ` (normally ${money(Model.baseAmount(b, m))})` : ''}</summary>
      <label class="field"><span>Planned for ${monthLabel(m)}</span><input name="amount" inputmode="decimal" value="${planned}"></label>
      <fieldset class="field"><legend>Change applies to</legend>${segRadio('scope', [['month', `Only ${ml}`], ['future', `${ml} and later`]], 'month')}</fieldset>
      <p class="form-error"></p>
      <button type="submit" class="btn primary">Save amount</button>
    </details>`;
  openModal(`${esc(b.emoji || '')} ${esc(b.name)} · ${esc(ml)}`, body, {
    extraButtons: '<button type="button" class="btn" data-m="edit">Edit budget…</button>',
    onSubmit(fd, form) {
      const a = parseAmount(fd.amount);
      if (isNaN(a) || a < 0) return formError(form, 'Please enter a valid amount.');
      if (a === planned && fd.scope === 'month') return;
      edit('budgets', id, r => { if (fd.scope === 'future') Model.setAmountFrom(r, m, a); else Model.setAmountOnly(r, m, a); });
      toast('Saved');
    },
    onMount(form) { $('[data-m=edit]', form).onclick = () => budgetModal(Store.get('budgets', id)); },
  });
  // openModal adds a Close button when there's no onSubmit; here we have a submit inside <details>, so swap footer button
  const foot = $('#modal .modal-foot .btn.primary');
  if (foot) { foot.type = 'button'; foot.textContent = 'Close'; foot.classList.remove('primary'); foot.onclick = closeModal; }
}

/* ---------------- Credit / installments ---------------- */
function creditModal(src) {
  const isNew = !src.id;
  const c = isNew ? { id: uid(), name: '', total: '', payments: 6, start: UI.month, paid: {} } : structuredClone(src);
  const monthly = c.total ? Model.creditPart(c, 0) : '';
  const cur = ym();
  const progress = isNew ? '' : (() => {
    const left = Model.paymentsLeftFrom(c, cur);
    return `<p class="muted">${left ? `${c.payments - left} of ${c.payments} payments done · ${money(Model.creditRemainingAfter(c, addMonths(cur, -1)))} still to pay` : 'Paid off ✓'}${c.bought ? ` · bought ${dateLabel(c.bought)}` : ''}</p>`;
  })();
  const body = `
    ${progress}
    <label class="field"><span>Name</span><input name="name" value="${esc(c.name)}" placeholder="e.g. Phone, Car loan, Sofa" required></label>
    <div class="two">
      <label class="field"><span>Total to pay</span><input name="total" inputmode="decimal" value="${c.total}" placeholder="0.00"></label>
      <label class="field"><span>Number of payments</span><input name="payments" type="number" inputmode="numeric" min="1" max="600" value="${c.payments}"></label>
    </div>
    <div class="two">
      <label class="field"><span>Per month</span><input name="monthly" inputmode="decimal" value="${monthly}" placeholder="0.00"></label>
      <label class="field"><span>First payment</span><input type="month" name="start" value="${c.start}" required></label>
    </div>
    <div class="two">${dayField(c.day, 'Taken on day')}</div>
    <p class="hint preview"></p>
    ${isNew ? '<p class="hint">Already paying something off? Enter what is <b>still left</b> to pay, the number of payments left, and this month as the first payment.</p>' : ''}
    <p class="form-error"></p>`;
  openModal(isNew ? 'Add credit / installments' : 'Edit credit', body, {
    submitLabel: isNew ? 'Add' : 'Save',
    extraButtons: isNew ? '' : '<button type="button" class="btn danger" data-m="delete">Delete</button>',
    onMount(form) {
      const el = form.elements;
      if (isNew) setTimeout(() => el.name.focus(), 50);
      const preview = () => {
        const total = parseAmount(el.total.value), n = parseInt(el.payments.value, 10);
        const p = $('.preview', form);
        if (total > 0 && n >= 1 && isMonth(el.start.value)) {
          const cc = { total, payments: n, start: el.start.value };
          p.textContent = n === 1 ? `One payment of ${money(total)} in ${monthLabel(cc.start)}.`
            : `${n} × ${money(Model.creditPart(cc, 0))}${Model.creditPart(cc, n - 1) !== Model.creditPart(cc, 0) ? ` (last ${money(Model.creditPart(cc, n - 1))})` : ''} · ${monthLabel(cc.start, true)} – ${monthLabel(Model.creditEnd(cc), true)}`;
        } else p.textContent = '';
      };
      const fromTotal = () => {
        const total = parseAmount(el.total.value), n = parseInt(el.payments.value, 10);
        if (total > 0 && n >= 1) el.monthly.value = Model.creditPart({ total, payments: n }, 0);
        preview();
      };
      el.total.addEventListener('input', fromTotal);
      el.payments.addEventListener('input', fromTotal);
      el.start.addEventListener('input', preview);
      el.monthly.addEventListener('input', () => {
        const mo = parseAmount(el.monthly.value), n = parseInt(el.payments.value, 10);
        if (mo > 0 && n >= 1) el.total.value = r2(mo * n);
        preview();
      });
      preview();
      $('[data-m=delete]', form)?.addEventListener('click', () => {
        if (confirm(`Delete "${c.name}"? It disappears from all months.`)) { Store.del('credits', c.id); closeModal(); toast('Deleted'); }
      });
    },
    onSubmit(fd, form) {
      const total = parseAmount(fd.total), n = parseInt(fd.payments, 10);
      if (!fd.name.trim()) return formError(form, 'Please enter a name.');
      if (!(total > 0)) return formError(form, 'Please enter the total amount.');
      if (!(n >= 1 && n <= 600)) return formError(form, 'Number of payments must be between 1 and 600.');
      if (!isMonth(fd.start)) return formError(form, 'Please choose the month of the first payment.');
      Object.assign(c, { name: fd.name.trim(), total, payments: n, start: fd.start, day: readDay(fd.day) });
      Store.put('credits', c);
      toast(isNew ? 'Added' : 'Saved');
    },
  });
}

/* ---------------- Example data ---------------- */
function loadExample() {
  const cur = ym(), n = Date.now();
  const start = addMonths(cur, -2), prev = addMonths(cur, -1);
  const day = Math.min(new Date().getDate(), daysInMonth(cur));
  const d = (m, dd) => `${m}-${pad(Math.min(dd, m === cur ? day : daysInMonth(m)))}`;
  const item = (kind, name, amount, extra = {}) => ({ id: uid(), kind, name, every: 1, start, end: null, amounts: [{ from: start, amount }], overrides: {}, paid: {}, updatedAt: n, ...extra });
  const salary = item('income', 'Salary', 2400, { day: 25, paid: { [start]: true, [prev]: true } });
  const items = [
    salary,
    item('fixed', 'Rent', 850, { day: 1, group: 'Rent & housing', paid: { [start]: true, [prev]: true, [cur]: true } }),
    item('fixed', 'Electricity & heating', 95, { day: 15, group: 'Rent & housing', paid: { [start]: true, [prev]: true } }),
    item('fixed', 'School lunches', 48, { day: 5, group: 'School & education' }),
    item('fixed', 'School trip savings', 120, { group: 'School & education', every: 6, start: prev, amounts: [{ from: prev, amount: 120 }] }),
    item('fixed', 'Internet', 35, { group: 'Other' }),
    item('fixed', 'Phone plan', 20, { group: 'Other' }),
    item('fixed', 'Netflix', 13.99, { day: 12, group: 'Subscriptions' }),
    item('fixed', 'Spotify', 10.99, { day: 18, group: 'Subscriptions' }),
    item('fixed', 'Gym', 29.9, { day: 3, group: 'Subscriptions' }),
    item('fixed', 'Car insurance', 420, { group: 'Insurance', every: 12, start: addMonths(cur, 2), amounts: [{ from: addMonths(cur, 2), amount: 420 }] }),
  ];
  const bud = (emoji, name, amount) => ({ id: uid(), emoji, name, every: 1, start, end: null, amounts: [{ from: start, amount }], overrides: {}, updatedAt: n });
  const food = bud('🍔', 'Food', 350), fun = bud('🎉', 'Going out', 120), trans = bud('🚌', 'Transport', 80), shop = bud('🛍️', 'Shopping', 100);
  const tx = (m, dd, name, amount, b, payMonth) => ({ id: uid(), kind: 'expense', name, amount, date: d(m, dd), month: payMonth || m, budgetId: b ? b.id : null, updatedAt: n });
  const txs = [
    tx(prev, 3, 'Groceries', 82.4, food), tx(prev, 10, 'Groceries', 96.1, food), tx(prev, 17, 'Groceries', 101.3, food), tx(prev, 25, 'Groceries', 94.6, food),
    tx(prev, 8, 'Concert', 55, fun), tx(prev, 20, 'Bar', 38.5, fun), tx(prev, 1, 'Monthly bus pass', 49, trans), tx(prev, 14, 'Jacket', 79.9, shop),
    tx(cur, 1, 'Monthly bus pass', 49, trans), tx(cur, 2, 'Groceries', 64.2, food), tx(cur, 6, 'Groceries', 48.75, food),
    tx(cur, 8, 'Restaurant', 42, fun), tx(cur, 9, 'Birthday gift for Sam', 35, null), tx(cur, 10, 'Groceries', 71.1, food),
    tx(cur, 12, 'Haircut', 25, null), tx(cur, 13, 'Cinema', 24, fun), tx(cur, 14, 'Sneakers', 89.99, shop),
    tx(cur, 15, 'Groceries', 72.4, food), tx(cur, 18, 'Headphones (pay next month)', 129, null, addMonths(cur, 1)),
  ];
  const credits = [
    { id: uid(), name: '📱 New phone', total: 720, payments: 12, start: addMonths(cur, -3), paid: { [addMonths(cur, -3)]: true, [addMonths(cur, -2)]: true, [prev]: true }, updatedAt: n },
    { id: uid(), name: '🛋️ Sofa', total: 600, payments: 4, start: addMonths(cur, 1), paid: {}, updatedAt: n },
  ];
  const data = Store.data;
  data.items.push(...items);
  data.budgets.push(food, fun, trans, shop);
  data.txs.push(...txs);
  data.credits.push(...credits);
  Object.assign(food, { rollover: true, start: prev, amounts: [{ from: prev, amount: 350 }] });
  data.goals.push({ id: uid(), name: 'Summer holiday', emoji: '🏖️', target: 1200, initial: 150, start: cur, deadline: addMonths(cur, 7), monthly: 131.25, put: {}, paid: {}, done: false, updatedAt: n });
  data.wishes.push(
    { id: uid(), name: 'Winter jacket', price: 180, pay: 'once', payments: 1, month: addMonths(cur, 1), updatedAt: n },
    { id: uid(), name: 'Game console', price: 549, pay: 'once', payments: 1, month: null, updatedAt: n },
    { id: uid(), name: 'New laptop', price: 1400, pay: 'split', payments: 10, month: null, updatedAt: n },
  );
  if (!data.settings.balance) data.settings = { ...data.settings, balance: { amount: 1500, month: cur }, updatedAt: n };
  Store.commit();
  toast('Example data added — delete it in Settings when you are ready');
}

/* ---------------- Actions ---------------- */
const actions = {
  tab: el => { UI.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  'month-prev': () => { UI.month = addMonths(UI.month, -1); render(); },
  'month-next': () => { UI.month = addMonths(UI.month, 1); render(); },
  'month-today': () => { UI.month = ym(); render(); },
  'goto-month': el => { UI.month = el.dataset.m; UI.tab = 'month'; render(); window.scrollTo(0, 0); },
  'add-expense': el => txModal({ kind: 'expense', budgetId: el.dataset.budget || '' }),
  'add-income-tx': () => txModal({ kind: 'income' }),
  'edit-tx': el => { const t = Store.get('txs', el.dataset.id); if (t) txModal(t); },
  'toggle-paid': el => edit('items', el.dataset.id, it => { it.paid = { ...(it.paid || {}) }; if (it.paid[UI.month]) delete it.paid[UI.month]; else it.paid[UI.month] = true; }),
  'toggle-credit-paid': el => edit('credits', el.dataset.id, c => { c.paid = { ...(c.paid || {}) }; if (c.paid[UI.month]) delete c.paid[UI.month]; else c.paid[UI.month] = true; }),
  'item-month': el => itemMonthModal(el.dataset.id),
  'budget-open': el => budgetMonthModal(el.dataset.id),
  'add-item': el => itemModal({ kind: el.dataset.kind }),
  'edit-item': el => { const it = Store.get('items', el.dataset.id); if (it) itemModal(it); },
  'add-budget': () => budgetModal({}),
  'edit-budget': el => { const b = Store.get('budgets', el.dataset.id); if (b) budgetModal(b); },
  'add-credit': () => creditModal({}),
  'edit-credit': el => { const c = Store.get('credits', el.dataset.id); if (c) creditModal(c); },
  'balance-edit': balanceModal,
  'free-info': freeModal,
  'sidebar-toggle': () => { UI.side = !UI.side; try { localStorage.setItem('mm-side-open', UI.side ? '1' : '0'); } catch { /* ignore */ } render(); },
  'arrange-toggle': () => { UI.arrange = !UI.arrange; render(); },
  'card-hide': el => { Layout.hide(el.dataset.cid); render(); toast(`${CARD_NAMES[el.dataset.cid]} moved to the sidebar`); },
  'card-show': el => { Layout.show(el.dataset.cid); if (innerWidth < 1100) { UI.side = false; } render(); toast(`${CARD_NAMES[el.dataset.cid]} added to your view`); },
  'card-up': el => { Layout.step(el.dataset.cid, -1); render(); },
  'card-down': el => { Layout.step(el.dataset.cid, 1); render(); },
  'layout-reset': () => { if (confirm('Put all cards back to where they were at the start?')) { Layout.reset(); render(); toast('Layout reset'); } },
  'toggle-card': el => { Collapsed.toggle(el.dataset.key); render(); },
  'toggle-all': el => { Collapsed.setAll(el.dataset.keys.split(','), el.dataset.close === '1'); render(); },
  'scroll-need': () => {
    if (Layout.zoneOf('need') === 'side' && !UI.side) UI.side = true;
    if (Collapsed.has('month-need')) Collapsed.toggle('month-need');
    render();
    const c = $('#needCard'); if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); },
  'add-goal': () => goalModal({}),
  'edit-goal': el => { const g = Store.get('goals', el.dataset.id); if (g) goalModal(g); },
  'goal-month': el => goalMonthModal(el.dataset.id),
  'toggle-goal-paid': el => edit('goals', el.dataset.id, g => { g.paid = { ...(g.paid || {}) }; if (g.paid[UI.month]) delete g.paid[UI.month]; else g.paid[UI.month] = true; }),
  'add-wish': () => wishModal({}),
  'edit-wish': el => { const w = Store.get('wishes', el.dataset.id); if (w) wishModal(w); },
  'wish-plan': el => {
    const m = el.dataset.m || null;
    edit('wishes', el.dataset.id, w => { w.month = m; });
    toast(m ? `Planned for ${monthLabel(m)}` : 'Not planned any more');
  },
  'wish-bought': el => {
    const w = Store.get('wishes', el.dataset.id);
    if (!w) return;
    const split = w.pay === 'split' && w.payments > 1;
    txModal({ kind: 'expense', name: w.name, amount: w.price, pay: split ? 'split' : 'now', payments: split ? w.payments : 3, fromWish: w.id, date: today() });
  },
  'example-data': loadExample,
  'clear-balance': () => { Store.setSettings({ balance: null }); toast('Cleared'); },
  'sync-now': () => { if (Sync.enabled()) Sync.run(); else { UI.tab = 'settings'; render(); } },
  'sync-disconnect': () => {
    if (confirm('Disconnect this device from sync? Your data stays on this device.')) { Sync.disconnect(); render(); toast('Disconnected'); }
  },
  install: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null; render();
  },
  export: () => {
    const file = transferFile();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setTransferInfo({ savedAt: Date.now() });
    toast('Transfer file saved to your downloads');
    if (UI.tab === 'settings') render();
  },
  'share-file': async () => {
    try {
      await navigator.share({ files: [transferFile()], title: 'Money Manager data' });
      setTransferInfo({ savedAt: Date.now() });
      render();
    } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message); }
  },
  import: () => { const f = $('#importFile'); f.dataset.mode = 'replace'; f.click(); },
  'import-merge': () => { const f = $('#importFile'); f.dataset.mode = 'merge'; f.click(); },
  reset: () => {
    if (confirm(`Delete ALL data${Sync.enabled() ? ' on all synced devices' : ''}? This can't be undone (download a backup first if unsure).`)) {
      replaceAll(emptyData()); UI.month = ym(); toast('All data deleted');
    }
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});
document.addEventListener('click', e => { const c = e.target.closest('[data-hist]'); if (c) showHist(c.dataset.hist); });
/* ---- drag & drop cards (mouse): grab ⠿, drop into a column, the top area or the sidebar ---- */
(() => {
  let dragId = null, ph = null;
  const cleanup = () => {
    if (ph) ph.remove();
    ph = null; dragId = null;
    $$('.dcard.dragging').forEach(d => d.classList.remove('dragging'));
    $$('.dcard[draggable]').forEach(d => d.removeAttribute('draggable'));
    document.body.classList.remove('is-dragging');
    $$('.zone.drop-over').forEach(z => z.classList.remove('drop-over'));
  };
  // only the ⠿ handle starts a drag, so text and buttons inside cards keep working
  document.addEventListener('mousedown', e => { const g = e.target.closest('.dc-grip'); if (g) g.closest('.dcard').setAttribute('draggable', 'true'); });
  document.addEventListener('mouseup', () => { if (!dragId) $$('.dcard[draggable]').forEach(d => d.removeAttribute('draggable')); });
  document.addEventListener('dragstart', e => {
    const dc = e.target.closest && e.target.closest('.dcard[draggable]');
    if (!dc) return;
    dragId = dc.dataset.cid;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
    setTimeout(() => dc.classList.add('dragging'), 0);
    document.body.classList.add('is-dragging');
    ph = document.createElement('div');
    ph.className = 'drop-ph';
  });
  document.addEventListener('dragover', e => {
    if (!dragId) return;
    const z = e.target.closest('[data-zone]');
    if (!z) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    $$('.zone.drop-over').forEach(x => x !== z && x.classList.remove('drop-over'));
    z.classList.add('drop-over');
    // put the placeholder before the first card whose middle is below the mouse
    const cardsIn = [...z.querySelectorAll(':scope > .dcard:not(.dragging)')];
    const before = cardsIn.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) { if (ph.nextSibling !== before) z.insertBefore(ph, before); }
    else if (ph.parentNode !== z || ph.nextSibling !== z.querySelector(':scope > .zone-empty')) z.insertBefore(ph, z.querySelector(':scope > .zone-empty'));
  });
  document.addEventListener('drop', e => {
    if (!dragId) return;
    const z = e.target.closest('[data-zone]');
    if (!z || !ph || ph.parentNode !== z) { cleanup(); return; }
    e.preventDefault();
    let index = 0;
    for (const child of z.children) { if (child === ph) break; if (child.classList.contains('dcard') && !child.classList.contains('dragging')) index++; }
    const id = dragId, zone = z.dataset.zone, from = Layout.zoneOf(id);
    Layout.move(id, zone, index);
    if (zone === 'side' && from !== 'side') Collapsed.setAll([CARD_KEYS[id]], true);
    if (zone !== 'side' && from === 'side') Collapsed.setAll([CARD_KEYS[id]], false);
    cleanup();
    render();
  });
  document.addEventListener('dragend', cleanup);
})();

// donut: hover (mouse) or tap (phone) a slice / legend row for its details
document.addEventListener('click', e => { const s = e.target.closest('[data-seg]'); if (s) showDonut(s.dataset.seg); });
document.addEventListener('mouseover', e => { const s = e.target.closest('[data-seg]'); if (s) showDonut(s.dataset.seg); });
document.addEventListener('mouseout', e => { const s = e.target.closest('[data-seg]'); if (s && !s.contains(e.relatedTarget)) clearDonut(); });
document.addEventListener('mouseover', e => { const c = e.target.closest('[data-hist]'); if (c && !c.classList.contains('sel')) showHist(c.dataset.hist); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-action]')) { e.preventDefault(); e.target.click(); }
});

document.addEventListener('submit', async e => {
  const form = e.target;
  if (!form.id || !$('#view').contains(form)) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  if (document.activeElement) document.activeElement.blur();
  if (form.id === 'genForm') {
    const currency = (fd.currency || '').trim().toUpperCase();
    try { new Intl.NumberFormat(undefined, { style: 'currency', currency }); } catch { return formError(form, 'Unknown currency code (use 3 letters like EUR, USD, CHF).'); }
    Store.setSettings({ currency, locale: fd.locale });
    toast('Saved');
  } else if (form.id === 'balForm') {
    const amount = parseAmount(fd.amount);
    if (isNaN(amount)) return formError(form, 'Please enter an amount.');
    if (!isMonth(fd.month)) return formError(form, 'Please choose a month.');
    Store.setSettings({ balance: { amount, month: fd.month } });
    toast('Saved');
  } else if (form.id === 'calStartForm') {
    const amount = parseAmount(fd.amount);
    if (isNaN(amount)) { toast('Please enter an amount'); return; }
    Store.setSettings({ balance: { amount, month: form.dataset.m } });
    toast(`Saved — starting with ${money(amount)} on ${dayDate(form.dataset.m, 1)}`);
  } else if (form.id === 'cushionForm') {
    const c = parseAmount(fd.cushion || '0');
    if (isNaN(c) || c < 0) { toast('Please enter a valid amount'); return; }
    Store.setSettings({ cushion: c || 0 });
    toast(c ? `Keeping at least ${money(c)}` : 'No cushion');
  } else if (form.id === 'syncForm') {
    const token = (fd.token || '').trim();
    if (!token) return formError(form, 'Please paste your GitHub token.');
    Sync.connect(token, fd.passphrase || '');
    render();
  }
});

document.addEventListener('change', e => {
  if (e.target.id !== 'carryToggle') return;
  Store.setSettings({ carryOver: e.target.checked });
  toast(e.target.checked ? 'Leftover money now carries to the next month' : 'Each month now starts from zero');
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try {
    const obj = JSON.parse(await e.target.files[0].text());
    if (!obj || !COLLS.some(k => Array.isArray(obj[k]))) throw new Error('This is not a Money Manager file.');
    if (e.target.dataset.mode === 'merge') {
      const n = mergeIn(obj);
      setTransferInfo({ loadedAt: Date.now() });
      render();
      toast(n ? `Loaded — ${n} new or changed ${n === 1 ? 'entry' : 'entries'}` : 'Loaded — everything was already up to date');
    } else if (confirm('Replace ALL data on this device with this backup?')) {
      replaceAll(obj); toast('Backup restored');
    }
  } catch (err) { alert('Could not restore: ' + err.message); }
  e.target.value = '';
});

document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) render(true); }, 0));

// swipe left/right on the month view to change month
(() => {
  let sx = 0, sy = 0, st = 0;
  const main = $('#view');
  main.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  main.addEventListener('touchend', e => {
    if (UI.tab !== 'month' || $('#modal').open || (UI.side && innerWidth < 1100)) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && Date.now() - st < 600) {
      UI.month = addMonths(UI.month, dx < 0 ? 1 : -1); render();
    }
  }, { passive: true });
})();

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (UI.tab === 'settings') render(); });

// keep "this month" correct if the app stays open over midnight at month end
let lastMonth = ym();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ym() !== lastMonth) { if (UI.month === lastMonth) UI.month = ym(); lastMonth = ym(); render(); }
});

/* ---------------- Start ---------------- */
Store.load();
Sync.onChange = renderSyncPill;
render();
Sync.init();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
}
