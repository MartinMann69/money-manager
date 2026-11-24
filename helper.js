'use strict';

/* =====================================================================
   Helper tab: a budget coach that works only with your own numbers,
   on your device. Rules of thumb (50/30/20, emergency fund, …) applied
   to what you entered — no AI service, nothing is sent anywhere.
   ===================================================================== */

const SUB_RE = /netflix|spotify|disney|prime|youtube|apple|icloud|hbo|\bwow\b|\bsky\b|dazn|paramount|crunchyroll|audible|kindle|xbox|game ?pass|playstation|ps ?plus|nintendo|adobe|microsoft 365|office 365|chatgpt|openai|patreon|twitch|\bgym\b|fitness|mcfit|urban sports|duolingo|tinder|bumble|deezer|tidal|joyn|rtl\+|magazin|zeitung|newspaper|\babo\b|subscription|membership/i;
const STREAM_RE = /netflix|disney|prime|hbo|\bwow\b|\bsky\b|dazn|paramount|crunchyroll|apple tv|joyn|rtl\+|youtube premium/i;
const MUSIC_RE = /spotify|apple music|deezer|tidal|youtube music|amazon music/i;
const NEED_RE = /rent|miete|wohnung|housing|nebenkosten|strom|electric|heating|heizung|\bgas\b|water|wasser|insurance|versicherung|phone|handy|mobile|internet|school|schule|kita|kindergarten|tuition|health|kranken|tax|steuer|loan|kredit|transport|ticket|bahn|bus pass|childcare/i;
const NEED_GROUPS = ['Rent & housing', 'School & education', 'Insurance'];
const NEED_BUDGET_RE = /food|grocer|lebensmittel|^essen$|supermarkt|transport|fuel|tank|benzin|bahn|health|gesundheit|drug|apotheke|pharmacy|kids|kinder|child|baby|pet|tier|household|haushalt/i;
const EMERGENCY_RE = /emergency|notgroschen|notfall|rücklage|ruecklage|reserve|puffer|buffer|safety/i;

const isSubscription = it => it.group === 'Subscriptions' || SUB_RE.test(it.name || '');
const isNeedItem = it => !isSubscription(it) && (NEED_GROUPS.includes(fixedGroup(it)) || NEED_RE.test(it.name || '') || fixedGroup(it) === 'Other');
const isNeedBudget = b => NEED_BUDGET_RE.test(b.name || '');
const round5 = v => Math.max(0, Math.round(v / 5) * 5);
const pctOf = (v, base) => (base > 0 ? Math.round((v / base) * 100) : 0);

/** everything the helper needs, for the current month (monthly amounts) */
function helperData() {
  const cur = ym();
  const S = Model.summarize(cur);
  const activeNow = it => Model.isActive({ ...it, every: 1 }, cur) && !(it.end && it.end < cur);
  const monthly = it => r2(Model.baseAmount(it, cur) / (it.every || 1));

  const incomeItems = Store.live('items').filter(i => i.kind === 'income' && activeNow(i));
  let income = r2(incomeItems.reduce((s, i) => s + monthly(i), 0));
  if (!income) income = S.t.income;

  const fixed = Store.live('items').filter(i => i.kind === 'fixed' && activeNow(i))
    .map(it => ({ it, monthly: monthly(it), sub: isSubscription(it), need: isNeedItem(it) }));
  const budgets = S.budgets.map(x => ({ b: x.b, planned: x.planned, need: isNeedBudget(x.b) }));

  // "other spending": average of the last full months you tracked (this month is still running)
  const start = Model.trackStart();
  const prev = [1, 2, 3].map(i => addMonths(cur, -i)).filter(m => m >= start);
  const otherAvg = prev.length ? r2(prev.reduce((s, m) => s + Model.summarize(m).t.other, 0) / prev.length) : S.t.other;

  const credits = S.t.credits;
  const goals = S.t.savings;
  const sum = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
  const needs = r2(sum(fixed.filter(f => f.need), f => f.monthly) + sum(budgets.filter(b => b.need), b => b.planned) + credits);
  const wantsFixed = sum(fixed.filter(f => !f.need), f => f.monthly);
  const wantsBudgets = sum(budgets.filter(b => !b.need), b => b.planned);
  const wants = r2(wantsFixed + wantsBudgets + otherAvg);
  const unplanned = r2(income - needs - wants - goals);
  const savings = r2(goals + Math.max(0, unplanned));

  // targets: 50 / 30 / 20 — adjusted when essentials take more than half
  const n = income ? needs / income : 0;
  const sT = n <= 0.5 ? 0.2 : Math.max(0.1, Math.min(0.2, 1 - n - 0.2));
  const wT = Math.max(0, 1 - Math.max(n, 0.5) - sT);
  return {
    cur, S, income, fixed, budgets, otherAvg, credits, goals, needs, wants, wantsFixed, wantsBudgets, savings, unplanned,
    // essentials can't be cut overnight: when they're above 50%, the plan works with what they are
    target: { needs: r2(income * Math.max(n, 0.5)), nP: Math.round(Math.max(n, 0.5) * 100), wants: r2(income * wT), savings: r2(income * sT), wP: Math.round(wT * 100), sP: Math.round(sT * 100) },
    prevMonths: prev,
  };
}

/* ---------------- 1. Money check-up ---------------- */
function helperHealth(D) {
  const checks = [];
  const sP = pctOf(D.savings, D.income), nP = pctOf(D.needs, D.income);
  checks.push(sP >= 20 ? [20, '✓', `You save ${sP}% of your income — great.`]
    : sP >= 10 ? [12, '✓', `You save ${sP}% of your income. 20% would be even better.`]
      : sP > 0 ? [6, '⚠', `You only save ${sP}% of your income. Aim for at least 10%.`]
        : [0, '⚠', 'Nothing is left to save at the moment.']);
  checks.push(nP <= 50 ? [20, '✓', `Essential costs take ${nP}% of your income (50% or less is ideal).`]
    : nP <= 60 ? [12, '⚠', `Essential costs take ${nP}% — a bit high (ideal: up to 50%).`]
      : nP <= 70 ? [6, '⚠', `Essential costs take ${nP}% — that leaves little room.`]
        : [0, '⚠', `Essential costs take ${nP}% of your income — try to lower the big ones.`]);
  const ef = helperEmergency(D);
  const efPts = Math.round(Math.min(1, ef.saved / Math.max(ef.target, 1)) * 20);
  checks.push([efPts, efPts >= 20 ? '✓' : '⚠', ef.goal ? `Emergency fund: ${money(ef.saved)} of ${money(ef.target)} (${pctOf(ef.saved, ef.target)}%).` : 'No emergency fund yet (3 months of essential costs).']);
  const overNow = D.S.budgets.filter(b => b.spent > Math.max(0, b.available)).map(b => b.b.name);
  const trend = helperBudgetTrends(D).filter(x => x.type === 'over').map(x => x.b.name);
  checks.push(!overNow.length && !trend.length ? [20, '✓', 'You stay within your budgets.']
    : [overNow.length && trend.length ? 0 : 10, '⚠', `Over budget: ${[...new Set([...overNow, ...trend])].join(', ')}.`]);
  const series = Model.balanceSeries(12);
  const negMonths = series.months.filter((m, i) => series.left[i] < 0);
  const balNeg = series.end.some(v => v < 0);
  checks.push(!negMonths.length ? [20, '✓', 'Every coming month ends with money left.']
    : !balNeg ? [10, '⚠', `You'll spend more than you earn in ${negMonths.map(m => monthLabel(m, true)).join(', ')} — your savings cover it.`]
      : [0, '⚠', `You'll run short in ${negMonths.map(m => monthLabel(m, true)).join(', ')}.`]);
  const score = checks.reduce((s, c) => s + c[0], 0);
  const label = score >= 80 ? 'Great' : score >= 60 ? 'Good' : score >= 40 ? 'OK' : 'Needs attention';
  const cls = score >= 60 ? 'good' : score >= 40 ? 'ok' : 'bad';
  return card('helper-health', 'Money check-up', `<b>${score}</b>/100`, `
    <div class="hs-top">
      <div class="hs-score ${cls}"><span>${score}</span><small>/100</small></div>
      <div><div class="hs-label">${label}</div><div class="hs-bar"><i class="${cls}" style="width:${score}%"></i></div></div>
    </div>
    <ul class="hs-list">${checks.map(c => `<li class="${c[1] === '✓' ? 'ok' : 'warn'}"><span>${c[1]}</span>${esc(c[2])}</li>`).join('')}</ul>`,
  joinSum([`<b>${score}/100</b> ${label}`, `${checks.filter(c => c[1] === '⚠').length} thing${checks.filter(c => c[1] === '⚠').length === 1 ? '' : 's'} to improve`]));
}

/* ---------------- 2. Budget plan (needs / wants / savings) ---------------- */
function helperPlan(D) {
  const I = D.income;
  const rows = [
    ['needs', 'Needs', `rent, bills, food, transport, credits${D.target.nP > 50 ? ' · ideal: up to 50%' : ''}`, D.needs, D.target.needs, D.target.nP],
    ['wants', 'Wants', 'subscriptions, going out, shopping, other', D.wants, D.target.wants, D.target.wP],
    ['savings', 'Savings', 'savings goals + what is left over', D.savings, D.target.savings, D.target.sP],
  ];
  const colorOf = { needs: 'c-fixed', wants: 'c-other', savings: 'c-left' };
  const bar = vals => `<div class="stackbar hp-bar">${vals.map(([k, v]) => (v > 0 ? `<i class="${colorOf[k]}" style="width:${Math.min(100, (v / Math.max(I, 1)) * 100)}%" title="${k}"></i>` : '')).join('')}</div>`;
  const nP = pctOf(D.needs, I);
  let advice;
  if (nP > 80) advice = `Your essential costs take <b>${nP}%</b> of your income. That's very tight — the biggest lever is lowering a large fixed cost (rent, car, phone, insurance) or increasing income.`;
  else if (nP > 50) advice = `Your essential costs take <b>${nP}%</b> (often the case with high rent). A realistic split for you: <b>${nP}% needs, ${D.target.wP}% wants, ${D.target.sP}% savings</b>.`;
  else advice = `The classic rule: <b>50% needs, 30% wants, 20% savings</b>. Your essentials take ${nP}%, so that works for you.`;

  // suggested budgets: bring "wants" down to the target by scaling the flexible budgets
  const sugg = [];
  const overWants = r2(D.wants - D.target.wants);
  const flex = D.budgets.filter(b => !b.need && b.planned > 0);
  if (overWants > 5 && flex.length) {
    const flexTotal = flex.reduce((s, b) => s + b.planned, 0);
    const room = Math.max(0, D.target.wants - D.wantsFixed - D.otherAvg);
    const f = flexTotal ? Math.min(1, room / flexTotal) : 1;
    for (const b of flex) {
      const s = round5(b.planned * Math.max(f, 0.5)); // never suggest cutting more than half at once
      if (s < b.planned - 2) sugg.push({ b: b.b, now: b.planned, s });
    }
  }
  const saveGap = r2(D.target.savings - D.savings);
  return card('helper-plan', 'Your budget plan', `income ≈ ${money(I)}/mo`, `
    <p class="hp-advice">${advice}</p>
    <div class="hp-compare">
      <div class="hp-lab">Now</div>${bar(rows.map(r => [r[0], r[3]]))}
      <div class="hp-lab">Suggested</div>${bar(rows.map(r => [r[0], r[4]]))}
    </div>
    <div class="hp-table">
      <div class="hp-row hp-head"><span></span><span>Now</span><span>Suggested</span></div>
      ${rows.map(([k, label, sub, now, tgt, p]) => {
        const diff = r2(now - tgt);
        const bad = (k === 'savings' && diff < -5) || (k === 'wants' && diff > 5) || (k === 'needs' && now > I * 0.5 + 5);
        return `<div class="hp-row">
          <span><span class="dot ${colorOf[k]}"></span><b>${label}</b><small>${sub}</small></span>
          <span class="${bad ? 'neg' : ''}">${money(now)}<small>${pctOf(now, I)}%</small></span>
          <span>${money(tgt)}<small>${p}%</small></span>
        </div>`;
      }).join('')}
    </div>
    ${sugg.length ? `<h4 class="mini-head">Suggested budgets</h4>
      <p class="hint" style="margin-top:2px">Your wants are ${money(overWants)} over the suggestion. These budgets would bring you closer:</p>
      ${sugg.map(x => `<div class="row"><span class="row-main"><span class="name">${esc(`${x.b.emoji || ''} ${x.b.name}`.trim())}</span><span class="sub">${money(x.now)} → ${money(x.s)} · saves ${money(x.now - x.s)}/month</span></span>
        <button type="button" class="btn small" data-action="helper-apply-budget" data-id="${x.b.id}" data-amount="${x.s}">Use ${money(x.s)}</button></div>`).join('')}` : ''}
    ${saveGap > 5 ? `<p class="cal-alert">To reach the suggested savings, put about <b>${money(saveGap)}</b> more aside each month${D.unplanned > 0 ? '' : ' (after lowering some wants)'}.
      <button type="button" class="link inline" data-action="helper-goal" data-name="Savings" data-emoji="🐷" data-monthly="${round5(saveGap)}" data-target="${round5(saveGap * 12)}">Create a savings goal</button></p>`
      : `<p class="hint">✓ You already reach the suggested savings.</p>`}
    <p class="hint">"Savings" includes money that isn't planned for anything (${money(Math.max(0, D.unplanned))}/month) — it only becomes real savings if you don't spend it. A savings goal makes it fixed.</p>`,
  joinSum([`needs ${pctOf(D.needs, I)}%`, `wants ${pctOf(D.wants, I)}%`, `savings ${pctOf(D.savings, I)}%`, sugg.length ? `${sugg.length} suggestion${sugg.length === 1 ? '' : 's'}` : '']));
}

/* ---------------- 3. Saving: emergency fund + bills that don't come every month ---------------- */
function helperEmergency(D) {
  const essentials = r2(D.needs - D.credits); // what you'd have to keep paying without income
  const target = round5(essentials * 3);
  const goal = Store.live('goals').find(g => EMERGENCY_RE.test(g.name || ''));
  const saved = goal ? Model.goalSavedBy(goal, D.cur) : 0;
  return { target, goal, saved, essentials };
}
function helperSaving(D) {
  const E = helperEmergency(D);
  const monthlySugg = round5(Math.max(25, Math.min(Math.max(D.unplanned, 0) * 0.5 || D.target.savings / 2, E.target / 12)));
  const emergency = E.goal
    ? `<div class="hp-item"><b>🛟 Emergency fund</b><div class="bar ok"><i style="width:${Math.min(100, pctOf(E.saved, E.target))}%"></i></div>
        <span class="muted small">${money(E.saved)} of ${money(E.target)} (3 months of essential costs${E.goal.target !== E.target ? ` — your goal is set to ${money(E.goal.target)}` : ''}).</span></div>`
    : `<div class="hp-item"><b>🛟 Emergency fund</b>
        <p class="small">Money for surprises — a broken phone, a repair, losing your job. A good target is <b>3 months of essential costs: ${money(E.target)}</b>. With ${money(monthlySugg)}/month you'd have it in about ${Math.ceil(E.target / monthlySugg)} months.</p>
        <button type="button" class="btn small primary" data-action="helper-goal" data-name="Emergency fund" data-emoji="🛟" data-target="${E.target}" data-monthly="${monthlySugg}">Create this goal</button></div>`;
  // bills that come every few months / once a year: save a little every month instead of one big hit
  const cur = D.cur;
  // includes ones that only start later (e.g. a yearly insurance from January)
  const lumpy = Store.live('items').filter(it => it.kind === 'fixed' && (it.every || 1) > 1 && !(it.end && it.end < cur)).map(it => {
    let next = null;
    for (let i = 0; i < 24 && !next; i++) { const m = addMonths(cur, i); if (Model.isActive(it, m)) next = m; }
    return { it, amount: Model.baseAmount(it, next || cur), next };
  }).filter(f => f.next).sort((a, b) => (a.next < b.next ? -1 : 1));
  const covered = name => Store.live('goals').some(g => !g.done && (g.name || '').toLowerCase().includes(name.toLowerCase()));
  const lumpyHtml = lumpy.length ? `<div class="hp-item"><b>📅 Bills that don't come every month</b>
      <p class="small">Put a little aside every month, so the month they come isn't tight:</p>
      ${lumpy.map(f => {
        const months = Math.max(1, monthDiff(cur, f.next));
        const per = Math.ceil((f.amount / months) * 100) / 100;
        return `<div class="row"><span class="row-main"><span class="name">${esc(f.it.name)}</span><span class="sub">${money(f.amount)} ${EVERY[f.it.every].toLowerCase()} · next ${monthLabel(f.next, true)} → ${money(per)}/month until then</span></span>
          ${covered(f.it.name) ? '<span class="muted small">✓ goal exists</span>' : `<button type="button" class="btn small" data-action="helper-goal" data-name="${esc(f.it.name)}" data-emoji="📅" data-target="${f.amount}" data-monthly="${per}" data-deadline="${f.next}-${pad(Model.dayOf(f.it, f.next) || 1)}">Save for it</button>`}</div>`;
      }).join('')}</div>` : '';
  return card('helper-saving', 'Saving', E.goal ? `${pctOf(E.saved, E.target)}% emergency fund` : '', `${emergency}${lumpyHtml}`,
    joinSum([E.goal ? `emergency fund ${pctOf(E.saved, E.target)}%` : 'no emergency fund yet', lumpy.length ? `${lumpy.length} bill${lumpy.length === 1 ? '' : 's'} to save for` : '']));
}

/* ---------------- 4. Subscriptions check ---------------- */
function helperSubs(D) {
  const subs = D.fixed.filter(f => f.sub).sort((a, b) => b.monthly - a.monthly);
  if (!subs.length) return card('helper-subs', 'Subscriptions check', '', '<p class="empty">No subscriptions found. (Put them in the group "Subscriptions" so the helper can find them.)</p>', 'none found');
  const total = r2(subs.reduce((s, f) => s + f.monthly, 0));
  const notes = [];
  const streams = subs.filter(f => STREAM_RE.test(f.it.name));
  const music = subs.filter(f => MUSIC_RE.test(f.it.name));
  if (streams.length >= 2) notes.push(`You pay for <b>${streams.length} video streaming services</b> (${streams.map(f => esc(f.it.name)).join(', ')}) — ${money(streams.reduce((s, f) => s + f.monthly, 0))}/month. Many people keep one at a time and switch every few months.`);
  if (music.length >= 2) notes.push(`You have <b>${music.length} music services</b> (${music.map(f => esc(f.it.name)).join(', ')}). One is usually enough.`);
  for (const f of subs) {
    const list = [...(f.it.amounts || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
    if (list.length >= 2 && list[list.length - 1].amount > list[list.length - 2].amount) {
      notes.push(`<b>${esc(f.it.name)}</b> got more expensive: ${money(list[list.length - 2].amount)} → ${money(list[list.length - 1].amount)}. Check if a cheaper plan exists.`);
    }
    if ((f.it.every || 1) >= 6) notes.push(`<b>${esc(f.it.name)}</b> renews ${EVERY[f.it.every].toLowerCase()} — set a reminder to cancel in time if you don't need it anymore.`);
  }
  const share = pctOf(total, D.income);
  if (share >= 5) notes.push(`Subscriptions take <b>${share}%</b> of your income.`);
  const cancel2 = subs.slice(-2);
  return card('helper-subs', 'Subscriptions check', `${money(total)}/mo`, `
    <div class="hp-big"><b>${money(total * 12)}</b> per year <span class="muted">· ${money(total)}/month · ${subs.length} subscription${subs.length === 1 ? '' : 's'}</span></div>
    ${notes.length ? `<ul class="hp-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '<p class="hint">✓ Nothing unusual found.</p>'}
    ${subs.map(f => `<div class="row"><span class="row-main"><span class="name">${esc(f.it.name)}</span><span class="sub">${money(f.monthly)}/month · ${money(f.monthly * 12)}/year${f.it.end ? ` · ends after ${monthLabel(f.it.end, true)}` : ''}</span></span>
      ${f.it.end ? '' : `<button type="button" class="btn small" data-action="helper-cancel-sub" data-id="${f.it.id}">Cancel</button>`}</div>`).join('')}
    ${subs.length >= 3 ? `<p class="hint">Ask yourself for each one: "Did I use it last week?" Cancelling just the two smallest (${cancel2.map(f => esc(f.it.name)).join(', ')}) would save ${money(cancel2.reduce((s, f) => s + f.monthly, 0) * 12)} a year.</p>` : ''}
    <p class="hint">"Cancel" stops it in the app after this month. Don't forget to also cancel it with the provider.</p>`,
  joinSum([`${money(total * 12)}/year`, `${subs.length} subscriptions`, notes.length ? `${notes.length} hint${notes.length === 1 ? '' : 's'}` : '']));
}

/* ---------------- 5. Buying plan for the wishlist ---------------- */
/** the plan always keeps a safety buffer: one month of essential costs, or your own cushion if that's higher */
function helperKeep() {
  const D = helperData();
  return Math.max(Store.data.settings.cushion || 0, round5(D.needs - D.credits));
}
function helperBuyPlanCompute() {
  const wishes = Store.live('wishes');
  const keep = helperKeep();
  const order = UI.helperOrder === 'cheap' ? [...wishes].sort((a, b) => a.price - b.price) : wishes;
  const series = Model.balanceSeries(24);
  const months = series.months;
  let base = series.end.slice();
  const shift = (w, start, sign) => { let cum = 0; base = base.map((v, i) => { cum += Model.wishCost(w, start, months[i]); return r2(v + sign * cum); }); };
  for (const w of wishes) if (Model.wishPlanned(w)) shift(w, w.month, +1); // take current plans out
  return order.map(w => {
    const m = Model.wishBest(w, base, months, keep);
    if (m) shift(w, m, -1);
    return { w, m };
  });
}
function helperBuy() {
  const plan = helperBuyPlanCompute();
  if (!plan.length) return card('helper-buy', 'Buying plan', '', `<p class="empty">Add things you'd like to buy on the <a href="#" data-action="tab" data-tab="goals">Goals tab</a> — the helper then works out when you can buy each one without getting tight.</p>`, 'wishlist is empty');
  const changes = plan.filter(p => p.m && p.m !== p.w.month).length;
  const keep = helperKeep();
  const own = (Store.data.settings.cushion || 0) >= keep;
  return card('helper-buy', 'Buying plan', `${plan.filter(p => p.m).length} of ${plan.length} fit`, `
    <p class="small muted">One after another, so that you always keep at least <b>${money(keep)}</b> ${own ? '(your cushion)' : '(one month of essential costs as a safety buffer)'} — including all bills, budgets and goals.</p>
    <div class="btn-row" style="margin:6px 0 10px">${segRadio('helperOrder', [['list', 'Wishlist order'], ['cheap', 'Cheapest first']], UI.helperOrder === 'cheap' ? 'cheap' : 'list')}</div>
    ${plan.map(({ w, m }) => `<div class="row"><span class="row-main"><span class="name">${esc(w.name)}</span><span class="sub">${wishPriceText(w)}${w.month && Model.wishPlanned(w) ? ` · planned now: ${wishWhen(w, true)}` : ''}</span></span>
      <span class="amt ${m ? 'pos' : 'neg'}">${m ? esc(monthLabel(m, true)) : 'not in 2 years'}</span></div>`).join('')}
    ${changes ? `<button type="button" class="btn primary block" data-action="helper-apply-plan" style="margin-top:10px">Use this plan (${changes} change${changes === 1 ? '' : 's'})</button>` : '<p class="hint">✓ Your wishlist already follows this plan.</p>'}
    ${plan.some(p => !p.m) ? '<p class="hint">Something doesn\'t fit? Try paying it in installments (edit it on the Goals tab), lowering a want budget, or cancelling a subscription — then check here again.</p>' : ''}`,
  joinSum(plan.slice(0, 3).map(({ w, m }) => `${esc(w.name)} → ${m ? esc(monthLabel(m, true)) : '<span class="neg">doesn\'t fit</span>'}`)));
}

/* ---------------- 6. Tips from your history ---------------- */
function helperBudgetTrends(D) {
  const out = [];
  for (const x of D.S.budgets) {
    const hist = D.prevMonths.map(m => Model.summarize(m).budgets.find(b => b.b.id === x.b.id)).filter(Boolean);
    if (hist.length < 2) continue;
    const over = hist.filter(h => h.spent > h.available + 0.5).length;
    const avg = hist.reduce((s, h) => s + h.spent, 0) / hist.length;
    if (over >= 2) out.push({ type: 'over', b: x.b, planned: x.planned, avg, s: round5(avg) });
    else if (hist.every(h => h.spent < h.available * 0.7) && x.planned - avg > 10) out.push({ type: 'under', b: x.b, planned: x.planned, avg, s: round5(avg * 1.1) });
  }
  return out;
}
function helperTips(D) {
  const tips = [];
  for (const t of helperBudgetTrends(D)) {
    const name = esc(`${t.b.emoji || ''} ${t.b.name}`.trim());
    if (t.type === 'over') tips.push(`<b>${name}</b> was over budget in most recent months (on average ${money(t.avg)} spent, ${money(t.planned)} planned). Either set it to a realistic ${money(t.s)} or look for ways to spend less.
      <button type="button" class="link inline" data-action="helper-apply-budget" data-id="${t.b.id}" data-amount="${t.s}">Set to ${money(t.s)}</button>`);
    else tips.push(`You usually spend only about ${money(t.avg)} of your <b>${name}</b> budget (${money(t.planned)}). Lowering it to ${money(t.s)} frees ${money(t.planned - t.s)}/month for saving.
      <button type="button" class="link inline" data-action="helper-apply-budget" data-id="${t.b.id}" data-amount="${t.s}">Set to ${money(t.s)}</button>`);
  }
  const C = Model.cycleTimeline(D.cur);
  if (C.known && C.low !== null && C.low < 0) {
    const bigBefore = C.ev.filter(e => e.amount < 0 && e.date >= today() && e.date <= C.lowDate).sort((a, b) => a.amount - b.amount)[0];
    tips.push(`Money gets tight around <b>${dateLabel(C.lowDate)}</b> (${money(C.low)}) before your next salary.${bigBefore ? ` If you can, ask to move <b>${esc(bigBefore.name)}</b> (${money(-bigBefore.amount)}) to a few days after payday.` : ''}`);
  }
  const credits = Store.live('credits').filter(c => Model.creditEnd(c) >= D.cur);
  if (credits.length) {
    const soonest = [...credits].sort((a, b) => (Model.creditEnd(a) < Model.creditEnd(b) ? -1 : 1))[0];
    tips.push(`<b>${esc(soonest.name)}</b> is paid off after ${monthLabel(Model.creditEnd(soonest))}. From then on you have <b>${money(Model.creditPart(soonest, 0))}/month</b> more — a good moment to raise a savings goal by that amount instead of spending it.`);
  }
  const series = Model.balanceSeries(12);
  const negIdx = series.left.findIndex(v => v < 0);
  if (negIdx >= 0) {
    const m = series.months[negIdx];
    const S = Model.summarize(m);
    const big = [...S.fixed.filter(r => (r.it.every || 1) > 1).map(r => [r.it.name, r.amount]), ...S.credits.map(c => [c.c.name, c.amount]), ...S.wishes.map(w => [w.w.name, w.amount])].sort((a, b) => b[1] - a[1])[0];
    tips.push(`<b>${monthLabel(m)}</b> ends with ${money(series.left[negIdx])}${big ? `, mainly because of <b>${esc(big[0])}</b> (${money(big[1])})` : ''}. Saving a little each month before then avoids the dip.`);
  }
  if (D.otherAvg > D.income * 0.08) tips.push(`"Other spending" averages ${money(D.otherAvg)}/month. Giving the biggest part its own budget makes it easier to keep an eye on.`);
  if (!tips.length) tips.push('✓ No warnings right now — keep going like this.');
  return card('helper-tips', 'Tips', `${tips.length}`, `<ul class="hp-notes">${tips.map(t => `<li>${t}</li>`).join('')}</ul>`,
    tips[0].replace(/<[^>]+>/g, '').slice(0, 90) + (tips.length > 1 ? ` · +${tips.length - 1} more` : ''));
}

/* ---------------- the tab ---------------- */
function viewHelper() {
  const D = helperData();
  const head = `<h1 class="page-title">Helper</h1>
    <p class="muted page-sub">A budget coach based on your own numbers. Rules of thumb, not financial advice — everything is calculated on your device.</p>`;
  if (!D.income) {
    return `${head}<section class="card"><h2>Add your income first</h2><p class="muted">The helper builds its plan from what you earn. Add your monthly income and your fixed costs, then come back.</p>
      <button type="button" class="btn primary" data-action="add-item" data-kind="income">Add monthly income</button></section>`;
  }
  return `${head}
    ${helperHealth(D)}
    <div class="grid">
      <div class="col">${helperPlan(D)}${helperSaving(D)}</div>
      <div class="col">${helperTips(D)}${helperSubs(D)}${helperBuy()}</div>
    </div>`;
}

/* ---------------- actions ---------------- */
Object.assign(actions, {
  'helper-apply-budget': el => {
    const amount = +el.dataset.amount;
    edit('budgets', el.dataset.id, b => Model.setAmountFrom(b, ym(), amount));
    toast(`Budget set to ${money(amount)} from ${monthLabel(ym())} on`);
  },
  'helper-cancel-sub': el => {
    const it = Store.get('items', el.dataset.id);
    if (!it || !confirm(`Stop "${it.name}" after ${monthLabel(ym())}?\n\nIt won't be counted from next month on. Remember to cancel it with the provider too.`)) return;
    edit('items', it.id, r => { r.end = ym(); });
    toast(`${it.name} ends after ${monthLabel(ym())}`);
  },
  'helper-goal': el => {
    const d = el.dataset;
    goalModal({ prefill: { name: d.name || '', emoji: d.emoji || '', target: +d.target || '', monthly: +d.monthly || '', deadline: d.deadline || '' } });
  },
  'helper-apply-plan': () => {
    const plan = helperBuyPlanCompute();
    let n = 0;
    for (const { w, m } of plan) if (m && m !== w.month) { edit('wishes', w.id, r => setWishMonth(r, m)); n++; }
    toast(`Buying plan applied (${n} change${n === 1 ? '' : 's'})`);
  },
});
document.addEventListener('change', e => {
  if (e.target.name !== 'helperOrder' || !e.target.closest('#view')) return;
  UI.helperOrder = e.target.value;
  render();
});
