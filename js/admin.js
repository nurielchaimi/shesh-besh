// Admin page: open registration, draw, watch the evening, fix what needs fixing.
// While this page is open the "autopilot" moves the tournament forward by itself: it turns results both
// players agree on into final results, starts each group's next round and creates the knockout matches.
import { openStore } from './store.js';
import * as E from './engine.js';
import { esc, nm, colorDot, standingsHtml, progressHtml, championHtml, caption } from './render.js';

const $ = (sel) => document.querySelector(sel);
const store = await openStore();
const demo = store.mode === 'demo';
let state = E.emptyState();
let signups = [];
let reports = [];
let user = null;
let tab = null;
let flash = '';
let dirty = false;
let loginError = '';
let auto = true;
try {
  auto = localStorage.getItem('sheshbesh:auto') !== '0';
} catch {}
const tieDraft = {};
const filter = { q: '', round: 'all', open: false };
const lower = (v) => String(v ?? '').toLowerCase();
const hours = (min) => (min / 60).toFixed(1);
const baseUrl = () => location.href.replace(/admin\.html.*$/, '');

const sizeSummary = (sizes) => {
  const counts = {};
  sizes.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
  return Object.entries(counts)
    .sort((a, b) => b[0] - a[0])
    .map(([size, count]) => `${count} של ${size}`)
    .join(' + ');
};

// ---------- autopilot ----------

let pilotTimer = null;
let pilotBusy = false;
function schedulePilot() {
  clearTimeout(pilotTimer);
  pilotTimer = setTimeout(pilot, 250);
}
async function pilot() {
  if (!auto || (store.auth.required && !user) || pilotBusy) return;
  pilotBusy = true;
  try {
    const approvedCount = E.approvedSignups(signups).length;
    if (state.stage === 'setup' && (state.signupCount ?? 0) !== approvedCount) await store.patch({ signupCount: approvedCount });
    const step = E.autoStep(state, reports);
    if (step.patch) await store.patch(step.patch);
  } catch (err) {
    flash = `⚠️ הטייס האוטומטי נכשל: ${err.message}`;
    render();
  } finally {
    pilotBusy = false;
  }
}

// ---------- registration and setup ----------

function setupView() {
  const st = { ...E.DEFAULT_SETTINGS, ...state.settings };
  const approved = E.approvedSignups(signups);
  const pending = signups.filter((x) => E.signupStatus(x) === 'pending');
  const rejected = signups.filter((x) => E.signupStatus(x) === 'rejected');
  const n = approved.length;
  const plan = E.planTournament(n, st);
  const alts = E.planAlternatives(n, st).filter((a) => a.koSize);
  const best = E.bestGroupSize(n, st);
  const link = `${baseUrl()}index.html`;
  const open = st.registrationOpen;
  const field = (key, label, attrs = '') => `<div class="field"><label>${label}</label><input data-set="${key}" value="${esc(st[key])}" ${attrs}></div>`;

  const planBlock =
    n < 4
      ? '<p class="muted">צריך לפחות 4 נרשמים כדי לראות תוכנית.</p>'
      : `<div class="plan"><b>${n} שחקנים → ${plan.sizes.length} בתים</b> (${sizeSummary(plan.sizes)}${st.groupSize ? '' : ', גודל בית אוטומטי'}) → ${plan.qualifiers} עולים → עץ של ${plan.koSize}${plan.byes ? ` (${plan.byes} פטורים בסיבוב הראשון)` : ''}<br>סה״כ ${plan.rounds} סיבובים (${plan.groupRounds} בתים + ${plan.koRounds} הדחה), עד ${plan.tables} שולחנות במקביל, בערך ${hours(plan.minutes)} שעות.
        <table><thead><tr><th>גודל בית</th><th>בתים</th><th>עולים</th><th>עץ</th><th>פטורים</th><th>סיבובים</th><th>שעות</th><th></th></tr></thead><tbody>${alts
          .map(
            (a) =>
              `<tr class="${a.groupSize === plan.groupSize ? 'cur' : ''}"><td>${a.groupSize}${a.groupSize === best ? ' ⭐' : ''}</td><td>${a.sizes.length}</td><td>${a.qualifiers}</td><td>${a.koSize}</td><td>${a.byes}</td><td>${a.rounds}</td><td>${hours(a.minutes)}</td><td>${a.groupSize === plan.groupSize ? '' : `<button class="btn" data-act="useSize" data-v="${a.groupSize}">בחר</button>`}</td></tr>`,
          )
          .join('')}</tbody></table></div>`;

  const rows = approved
    .map((p) => {
      const tags = [E.LEVELS[p.level], p.study].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
      return `<div class="p"><span class="nm">${esc(p.name)} ${tags}${p.uid ? ' <span title="נרשם/ה בעצמו/ה">✓</span>' : ''}</span><span class="row">${p.uid ? `<button class="btn ghost" data-act="release" data-id="${p.id}" title="שחרר את השם כדי שאפשר יהיה לתפוס אותו מטלפון אחר">שחרר</button>` : ''}<button class="btn ghost danger" data-act="rmSignup" data-id="${p.id}" title="הסר">✕</button></span></div>`;
    })
    .join('');

  const tagsOf = (p) => [E.LEVELS[p.level], p.study].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
  const pendingCard = pending.length
    ? `<div class="card" style="border-color:var(--gold)"><div class="row sp"><h2>ממתינים לאישור (${pending.length})</h2><button class="btn primary" data-act="approveAll">אשר את כולם</button></div>
    <p class="muted">רק מי שמאושר נכנס להגרלה ולטורניר. מי שנדחה רואה בטלפון שההרשמה לא אושרה.</p>
    <div class="plist">${pending
      .map(
        (p) =>
          `<div class="p"><span class="nm" style="white-space:normal">${esc(p.name)} ${tagsOf(p)}${p.bio ? `<br><small class="muted">${esc(p.bio)}</small>` : ''}</span><span class="row"><button class="btn primary" data-act="approveSignup" data-id="${p.id}">אשר</button><button class="btn ghost danger" data-act="rejectSignup" data-id="${p.id}">דחה</button></span></div>`,
      )
      .join('')}</div></div>`
    : '';
  const rejectedCard = rejected.length
    ? `<details class="card"><summary>נדחו (${rejected.length})</summary><div class="plist" style="margin-top:10px">${rejected
        .map((p) => `<div class="p out"><span class="nm">${esc(p.name)}</span><span class="row"><button class="btn" data-act="approveSignup" data-id="${p.id}">אשר בכל זאת</button><button class="btn ghost danger" data-act="rmSignup" data-id="${p.id}">✕</button></span></div>`)
        .join('')}</div></details>`
    : '';

  return `
  ${pendingCard}${rejectedCard}
  <div class="card"><div class="row sp"><h2>הרשמה · ${n} אושרו</h2><button class="btn ${open ? 'danger' : 'primary'}" data-act="toggleReg">${open ? 'סגור הרשמה' : 'פתח הרשמה'}</button></div>
    <p>קישור להרשמה ולמעקב (לשתף בקבוצה, וגם ב-QR על המסך): <br><b dir="ltr">${esc(link)}</b> <button class="btn" data-act="copy" data-v="${esc(link)}">העתק</button></p>
    <p class="muted">${open ? 'ההרשמה פתוחה: כל מי שנכנס לקישור יכול להירשם.' : 'ההרשמה סגורה.'} ההגרלה סוגרת אותה אוטומטית.</p>
    <div class="field"><label>להוסיף נרשמים ידנית (שם בכל שורה). הם יוכלו לתפוס את השם שלהם מהטלפון</label><textarea id="names" placeholder="נועה כהן&#10;יוסי לוי"></textarea></div>
    <div class="row"><button class="btn primary" data-act="addPlayers">הוסף</button>${demo ? '<button class="btn" data-act="demoPlayers" data-n="20">20 נרשמי דמו</button><button class="btn" data-act="demoPlayers" data-n="64">64</button><button class="btn" data-act="demoPlayers" data-n="80">80</button>' : ''}</div>
    <div class="plist" style="margin-top:12px">${rows || '<p class="muted">עוד אף אחד לא נרשם.</p>'}</div></div>
  <div class="card"><h2>הגדרות</h2><div class="fields">
    ${field('name', 'שם הטורניר')}
    <div class="field"><label>גודל בית</label><select data-set="groupSize"><option value="0"${st.groupSize ? '' : ' selected'}>אוטומטי (מומלץ)</option>${[3, 4, 5, 6, 7, 8].map((x) => `<option value="${x}"${st.groupSize === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
    ${field('advance', 'עולים מכל בית', 'type="number" min="1" max="4"')}
    ${field('pointsWin', 'נקודות לניצחון', 'type="number" min="1" max="9"')}
    ${field('pointsMars', 'נקודות למארס', 'type="number" min="1" max="9"')}
    ${field('roundMinutes', 'דקות לסיבוב (להערכה)', 'type="number" min="5" max="180"')}
    ${field('color1Name', 'צבע דמקות ראשון (שם)')}
    ${field('color1Hex', 'הגוון שלו', 'type="color"')}
    ${field('color2Name', 'צבע דמקות שני (שם)')}
    ${field('color2Hex', 'הגוון שלו', 'type="color"')}
  </div></div>
  <div class="card"><h2>תוכנית ויציאה לדרך</h2>${planBlock}
    <button class="btn primary big" data-act="draw" ${n < 4 ? 'disabled' : ''}>סגור הרשמה, הגרל והתחל</button>
    <p class="muted">אפשר להגריל מחדש כל עוד לא הוזנה אף תוצאה. הטייס האוטומטי צריך שהדף הזה יישאר פתוח במחשב או בטלפון של מארגן לאורך הערב.</p></div>`;
}

// ---------- running the evening ----------

const claimText = (c) => `${nm(state, c.winner)} ניצח/ה${c.mars ? ' במארס' : ''}`;

function entryHtml(m) {
  const r = m.result;
  const ko = m.stage === 'ko';
  const st = r ? null : E.reportStatus(m, reports);
  const row = (id) => {
    if (id == null) return '<div class="prow"><span class="nm muted">פטור</span></div>';
    if (r?.bye) return `<div class="prow"><span class="nm">${nm(state, id)}</span><span class="tag">עולה (פטור)</span></div>`;
    const won = r?.winner === id;
    return `<div class="prow"><span class="nm">${colorDot(state, m, id)}${nm(state, id)}</span>
      <button class="btn${won && !r.mars && !r.walkover ? ' on' : ''}" data-act="win" data-m="${m.id}" data-w="${id}">ניצח</button>
      ${ko ? '' : `<button class="btn mars${won && r.mars && !r.walkover ? ' on' : ''}" data-act="mars" data-m="${m.id}" data-w="${id}">מארס ×2</button>`}
      <button class="btn ghost${won && r.walkover ? ' on' : ''}" data-act="wo" data-m="${m.id}" data-w="${id}" title="ניצחון טכני: היריב לא הגיע">טכני</button></div>`;
  };
  let tag = '';
  let extra = '';
  if (st?.status === 'pending') tag = `<span class="tag">${claimText(st.claim)} (לפי ${nm(state, st.by)})</span><button class="btn" data-act="approve" data-m="${m.id}">אשר</button>`;
  if (st?.status === 'disputed') {
    tag = '<span class="tag" style="background:var(--bad);color:#fff">אי-הסכמה</span>';
    extra = `<div class="muted" style="font-size:.85em">${nm(state, m.a)}: ${claimText(st.a)} · ${nm(state, m.b)}: ${claimText(st.b)}</div>`;
  }
  const clear = r && !r.bye ? `<button class="btn ghost danger" data-act="clear" data-m="${m.id}">נקה</button>` : '';
  return `<div class="entry${r ? ' done' : ''}" id="m-${m.id}" data-table="${m.table ?? ''}"><div class="tbl"><small>שולחן</small><b>${m.table ?? '—'}</b></div><div class="sides" style="display:block">${row(m.a)}${row(m.b)}${extra}<div class="cap"><span>${esc(caption(state, m))}</span><span class="row">${tag}${clear}</span></div></div></div>`;
}

function tieHtml(ties) {
  if (!ties.length) return '';
  return `<div class="card"><h3>הכרעת שוויון</h3><p class="muted">שלב ההדחה לא יתחיל עד שתכריע. לשחקנים האלה אותו ניקוד על גבול ההעפלה. סמן אותם לפי הסדר, מהמדורג הגבוה ביותר ומטה.</p>${ties
    .map((t) => {
      const draft = tieDraft[t.group] ?? [];
      const buttons = t.ids
        .map((id) => {
          const pos = draft.indexOf(id);
          return `<button class="btn${pos >= 0 ? ' on' : ''}" data-act="tiePick" data-g="${t.group}" data-id="${id}">${pos >= 0 ? `${pos + 1}. ` : ''}${nm(state, id)}</button>`;
        })
        .join('');
      return `<div class="note"><b>בית ${esc(t.group)}</b>: ${t.spots} מתוך ${t.ids.length} עולים<div class="row" style="margin-top:8px">${buttons}<button class="btn ghost" data-act="tieReset" data-g="${t.group}">איפוס</button></div></div>`;
    })
    .join('')}</div>`;
}

function liveView() {
  const s = state;
  const active = E.currentMatches(s);
  const kind = (m) => E.reportStatus(m, reports).status;
  const disputed = active.filter((m) => kind(m) === 'disputed');
  const pending = active.filter((m) => kind(m) === 'pending');
  const playing = active.filter((m) => !['disputed', 'pending'].includes(kind(m)));
  const recent = Object.values(s.matches)
    .filter((m) => m.result?.at && !m.result.bye)
    .sort((a, b) => b.result.at - a.result.at)
    .slice(0, 12);
  const ties = s.stage === 'groups' && E.groupStageDone(s) ? E.boundaryTies(s) : [];
  const section = (title, list, hint = '') => (list.length ? `<h3 style="margin:18px 0 8px">${title} (${list.length})</h3>${hint ? `<p class="muted" style="margin:0 0 8px">${hint}</p>` : ''}<div class="grid wide">${list.map(entryHtml).join('')}</div>` : '');
  return `${E.champion(s) ? championHtml(s) : ''}
  <div class="card"><div class="row sp"><h2>${esc(E.stageLabel(s))}</h2>
    <label class="row"><input type="checkbox" data-act="toggleAuto" ${auto ? 'checked' : ''}> טייס אוטומטי</label></div>
    ${progressHtml(s)}
    <p class="muted" style="margin:0">${auto ? 'הטייס פועל: כשני השחקנים מדווחים אותו דבר, התוצאה נקבעת והמשחק הבא מוכן. <b>השאר את הדף הזה פתוח.</b>' : '<b>הטייס כבוי.</b> שום דבר לא יתקדם לבד.'}
    <button class="btn ghost" data-act="pilotNow">בדוק התקדמות עכשיו</button></p>
    <div class="row" style="margin-top:10px"><input type="number" id="jump" class="in-text" style="width:9em;flex:none" placeholder="קפוץ לשולחן"></div></div>
  ${tieHtml(ties)}
  ${section('דורש החלטה', disputed, 'השחקנים דיווחו על תוצאות שונות. בחר את התוצאה הנכונה.')}
  ${section('ממתינים לאישור השחקן השני', pending, 'אם השחקן השני לא מגיב, אפשר לאשר בשבילו.')}
  ${section('משחקים פעילים', playing)}
  ${section('הסתיימו לאחרונה', recent, 'אפשר לתקן או לנקות תוצאה.')}`;
}

function allView() {
  const s = state;
  const matches = Object.values(s.matches);
  const labels = new Map();
  matches.forEach((m) => {
    const key = `${m.stage}:${m.round}`;
    if (!labels.has(key)) labels.set(key, { key, stage: m.stage, round: m.round, text: m.stage === 'group' ? `בתים · סיבוב ${m.round}` : E.koRoundName(s.ko.size, m.round) });
  });
  const options = [...labels.values()].sort((a, b) => (a.stage === b.stage ? a.round - b.round : a.stage === 'group' ? -1 : 1));
  const q = lower(filter.q);
  const text = (m) => lower(`${s.players[m.a]?.name ?? ''} ${s.players[m.b]?.name ?? ''} ${m.table ?? ''} בית ${m.group ?? ''}`);
  const list = matches
    .filter((m) => (filter.round === 'all' || `${m.stage}:${m.round}` === filter.round) && (!filter.open || !m.result) && (!q || text(m).includes(q)))
    .sort((a, b) => (a.stage === b.stage ? a.round - b.round || (a.table ?? 9999) - (b.table ?? 9999) : a.stage === 'group' ? -1 : 1));
  return `<div class="card"><div class="row">
    <input id="fq" class="in-text" placeholder="חיפוש שחקן, שולחן או בית" value="${esc(filter.q)}">
    <select id="fr" class="in-text" style="flex:none;width:auto"><option value="all">כל הסיבובים</option>${options.map((o) => `<option value="${o.key}"${filter.round === o.key ? ' selected' : ''}>${esc(o.text)}</option>`).join('')}</select>
    <label class="row"><input type="checkbox" id="fo" ${filter.open ? 'checked' : ''}> רק פתוחים</label></div>
    <p class="muted" style="margin:8px 0 0">${list.length} משחקים. אפשר לתקן כאן כל תוצאה, גם מסיבובים קודמים.</p></div>
  <div class="grid wide">${list.map(entryHtml).join('')}</div>`;
}

const standingsView = () => `<div class="grid wide">${E.groupIds(state).map((g) => standingsHtml(state, g)).join('') || '<p class="empty">אין בתים עדיין.</p>'}</div>`;

function playersView() {
  const list = E.sortedPlayers(state);
  const claimed = new Set(signups.filter((x) => x.uid).map((x) => x.id));
  return `<div class="card"><h2>שחקנים (${list.length})</h2><p class="muted">שחקן שפורש מפסיד טכנית את כל המשחקים שנותרו. "שחרר" מתיר לתפוס את השם מטלפון אחר, למי שהטלפון שלו התחלף.</p>
  <div class="plist">${list
    .map((p) => `<div class="p${p.withdrawn ? ' out' : ''}"><span class="nm">${esc(p.name)} <small class="muted">בית ${esc(p.group ?? '—')}${claimed.has(p.id) ? ' ✓' : ''}</small></span><span class="row">${claimed.has(p.id) ? `<button class="btn ghost" data-act="release" data-id="${p.id}">שחרר</button>` : ''}${p.withdrawn ? `<button class="btn" data-act="reinstate" data-id="${p.id}">החזר</button>` : `<button class="btn ghost danger" data-act="withdraw" data-id="${p.id}">פרש</button>`}</span></div>`)
    .join('')}</div></div>`;
}

function toolsView() {
  const s = state;
  const base = baseUrl();
  return `
  <div class="card"><h2>קישורים</h2>
    <p>דף שחקנים והרשמה (לשתף בקבוצה): <a href="${base}index.html" target="_blank">${base}index.html</a></p>
    <p>מסך הקרנה: <a href="${base}tv.html" target="_blank">${base}tv.html</a> &nbsp;·&nbsp; ננעל על סצנה אחת: <code>tv.html?scene=tables</code> / <code>groups</code> / <code>bracket</code></p>
    <p class="muted">מצב: ${demo ? 'הדגמה, הנתונים נשמרים רק בדפדפן הזה. כדי לשתף עם כולם צריך לחבר Firebase (ראה README).' : `מחובר ל-Firebase כ-${esc(user)}`}</p></div>
  <div class="card"><h2>גיבוי</h2><div class="row">
    <button class="btn" data-act="export">הורד גיבוי (JSON)</button>
    <label class="btn">שחזר מגיבוי<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
    <p class="muted">מומלץ להוריד גיבוי מדי פעם במהלך הערב.</p></div>
  <div class="card"><h2>איפוס</h2><div class="row">
    ${E.canRedraw(s) ? '<button class="btn" data-act="redraw">הגרל בתים מחדש</button>' : ''}
    ${s.stage !== 'setup' ? '<button class="btn danger" data-act="reset">בטל את ההגרלה והתוצאות (שומר נרשמים)</button>' : ''}
    <button class="btn danger" data-act="wipe">מחק הכול</button></div></div>
  ${demo ? `<div class="card"><h2>כלי הדגמה</h2><p class="muted">רק במצב הדגמה, לחזרה גנרלית. כדי לשחק בתור שחקן: <code>index.html?as=מזהה</code></p><div class="row">
    <button class="btn" data-act="simulate" ${E.currentMatches(s).length ? '' : 'disabled'}>הזן תוצאות אקראיות לכל המשחקים הפעילים</button></div></div>` : ''}`;
}

function loginHtml() {
  return `<form class="card login" id="loginForm"><h2>כניסת מנהל</h2>
    <div class="field"><label>אימייל</label><input name="email" type="email" required autocomplete="username"></div>
    <div class="field"><label>סיסמה</label><input name="password" type="password" required autocomplete="current-password"></div>
    ${loginError ? `<div class="note bad">${esc(loginError)}</div>` : ''}
    <button class="btn primary big" type="submit">כניסה</button></form>`;
}

const views = { setup: setupView, live: liveView, all: allView, standings: standingsView, players: playersView, tools: toolsView };

function render() {
  dirty = false;
  const app = $('#app');
  if (store.auth.required && !user) {
    app.innerHTML = loginHtml();
    return;
  }
  const s = state;
  const pendingCount = signups.filter((x) => E.signupStatus(x) === 'pending').length;
  const attention = E.currentMatches(s).filter((m) => ['disputed', 'pending'].includes(E.reportStatus(m, reports).status)).length;
  const tabs =
    s.stage === 'setup'
      ? [['setup', `הרשמה והגדרות${pendingCount ? ` (${pendingCount})` : ''}`], ['tools', 'כלים']]
      : [['live', `חי${attention ? ` (${attention})` : ''}`], ['all', 'כל המשחקים'], ['standings', 'דירוג בתים'], ['players', 'שחקנים'], ['tools', 'כלים']];
  if (!tabs.some(([id]) => id === tab)) tab = tabs[0][0];
  const y = window.scrollY;
  app.innerHTML = `<header class="top"><div class="in"><h1>ניהול · ${esc(s.settings.name)}</h1><div class="row">
      <span class="chip">${esc(E.stageLabel(s))}</span>
      <span class="chip">${demo ? 'מצב הדגמה' : esc(user)}</span>
      <a class="chip" href="index.html" target="_blank" style="color:inherit">דף שחקנים</a>
      <a class="chip" href="tv.html" target="_blank" style="color:inherit">מסך הקרנה</a>
      ${store.auth.required ? '<button class="chip" data-act="logout" style="border:0;color:inherit;cursor:pointer">התנתק</button>' : ''}</div></div></header>
    <nav class="tabs"><div class="in">${tabs.map(([id, label]) => `<button class="tab${id === tab ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div></nav>
    <main class="wrap">${flash ? `<div class="note${flash.startsWith('⚠️') ? ' bad' : ''}">${esc(flash)}</div>` : ''}${views[tab]()}</main>`;
  window.scrollTo(0, y);
}

// Don't wipe a half-typed field when something changes elsewhere.
function softRender() {
  if (document.activeElement?.matches?.('input[type=text], input:not([type]), input[type=number], textarea, select')) {
    dirty = true;
    return;
  }
  render();
}
document.addEventListener('focusout', () => {
  if (!dirty) return;
  setTimeout(() => !document.activeElement?.matches?.('input, textarea, select') && render(), 50);
});

// ---------- actions ----------

async function run(fn, okMsg = '') {
  try {
    flash = okMsg;
    await fn();
  } catch (err) {
    flash = `⚠️ ${err.code === 'permission-denied' ? 'אין הרשאת כתיבה, התחבר עם חשבון המנהל' : err.message}`;
  }
  render();
}

const setResult = (d, opts) => run(() => store.patch(E.resultPatch(d.m, E.winResult(d.w, opts))));
const download = (name, text) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
};
const clean = (v) => v.replace(/\s+/g, ' ').trim();
const clearReports = () => Promise.all([...new Set(reports.map((r) => r.m))].map((id) => store.reports.clearMatch(id)));

const actions = {
  win: (d) => setResult(d),
  mars: (d) => setResult(d, { mars: true }),
  wo: (d) => setResult(d, { walkover: true }),
  clear: (d) =>
    run(async () => {
      await store.reports.clearMatch(d.m);
      await store.patch(E.resultPatch(d.m, null));
    }),
  approve: (d) =>
    run(() => {
      const st = E.reportStatus(state.matches[d.m], reports);
      if (st.status !== 'pending') throw new Error('אין דיווח לאישור');
      return store.patch(E.resultPatch(d.m, st.claim));
    }),

  toggleAuto: (d, el) => {
    auto = el.checked;
    try {
      localStorage.setItem('sheshbesh:auto', auto ? '1' : '0');
    } catch {}
    render();
    schedulePilot();
  },
  pilotNow: () => {
    flash = 'בודק…';
    render();
    pilot().then(() => ((flash = ''), render()));
  },
  tiePick: (d) => {
    const draft = (tieDraft[d.g] ??= []);
    if (!draft.includes(d.id)) draft.push(d.id);
    const tie = E.boundaryTies(state).find((t) => t.group === d.g);
    if (tie && draft.length === tie.ids.length) {
      const order = [...draft];
      delete tieDraft[d.g];
      return run(() => store.patch(E.tiePatch(order)), 'השוויון הוכרע');
    }
    render();
  },
  tieReset: (d) => {
    delete tieDraft[d.g];
    render();
  },

  toggleReg: () => run(() => store.patch({ 'settings.registrationOpen': !state.settings.registrationOpen })),
  copy: (d) => {
    navigator.clipboard?.writeText(d.v);
    flash = 'הקישור הועתק';
    render();
  },
  useSize: (d) => run(() => store.patch({ 'settings.groupSize': Number(d.v) })),
  addPlayers: () =>
    run(async () => {
      const have = new Set(signups.map((x) => x.name));
      const names = $('#names').value.split('\n').map(clean).filter(Boolean);
      const fresh = names.filter((name) => !have.has(name) && have.add(name));
      await Promise.all(fresh.map((name) => store.signups.add({ name, level: 'casual' })));
      flash = `נוספו ${fresh.length} שחקנים${names.length > fresh.length ? `, ${names.length - fresh.length} כפולים דולגו` : ''}`;
    }),
  demoPlayers: (d) =>
    run(async () => {
      const have = new Set(signups.map((x) => x.name));
      await Promise.all(E.demoSignups(Number(d.n)).filter((p) => !have.has(p.name)).map((p) => store.signups.add(p)));
    }),
  approveSignup: (d) => run(() => store.signups.setStatus(d.id, 'approved')),
  rejectSignup: (d) => run(() => store.signups.setStatus(d.id, 'rejected')),
  approveAll: () =>
    run(async () => {
      const waiting = signups.filter((x) => E.signupStatus(x) === 'pending');
      await Promise.all(waiting.map((p) => store.signups.setStatus(p.id, 'approved')));
      flash = `אושרו ${waiting.length} נרשמים`;
    }),
  rmSignup: (d) => run(() => store.signups.remove(d.id)),
  release: (d) => confirm('לשחרר את השם? מי שתפס אותו יצטרך לתפוס אותו שוב.') && run(() => store.signups.release(d.id), 'השם שוחרר'),
  draw: () => {
    const count = E.approvedSignups(signups).length;
    const waiting = signups.filter((x) => E.signupStatus(x) === 'pending').length;
    const plan = E.planTournament(count, state.settings);
    const warn = waiting ? `\n\nשים לב: ${waiting} נרשמים עדיין ממתינים לאישור ולא ייכללו.` : '';
    if (!confirm(`להגריל ${count} שחקנים ל-${plan.sizes.length} בתים, לסגור את ההרשמה ולהתחיל?${warn}`)) return;
    return run(async () => {
      const base = E.applyPatch(state, { players: E.playersFromSignups(signups) });
      await store.patch({ ...E.drawGroups(base), signupCount: count });
      tab = 'live';
    });
  },
  redraw: () => confirm('להגריל את הבתים מחדש?') && run(() => store.patch(E.drawGroups(state))),
  withdraw: (d) => confirm(`${state.players[d.id].name} פורש? כל המשחקים שנותרו שלו יימסרו ליריבים.`) && run(() => store.patch(E.withdrawPatch(state, d.id))),
  reinstate: (d) => run(() => store.patch(E.reinstatePatch(state, d.id))),

  export: () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`shesh-besh-backup-${stamp}.json`, JSON.stringify({ state, signups }, null, 1));
  },
  reset: () => {
    if (!confirm('לבטל את ההגרלה ואת כל התוצאות? הנרשמים נשמרים.')) return;
    return run(async () => {
      await clearReports();
      await store.replace({ ...E.emptyState(), settings: state.settings, signupCount: signups.length });
      tab = 'setup';
    });
  },
  wipe: () => {
    if (prompt('פעולה זו מוחקת הכול, כולל הנרשמים, ואי אפשר לבטל אותה. כתוב "מחק" כדי להמשיך.') !== 'מחק') return;
    return run(async () => {
      await clearReports();
      await Promise.all(signups.map((x) => store.signups.remove(x.id)));
      await store.replace(E.emptyState());
      tab = 'setup';
    });
  },
  simulate: () => run(() => store.patch(E.simulateRoundPatch(state))),
  logout: () => store.auth.logout(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act],[data-tab]');
  if (!el) return;
  if (el.dataset.tab) {
    tab = el.dataset.tab;
    flash = '';
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (el.type === 'checkbox') return; // handled on change
  actions[el.dataset.act]?.(el.dataset, el);
});

const NUMBER_LIMITS = { groupSize: [0, 8], advance: [1, 4], pointsWin: [1, 9], pointsMars: [1, 9], roundMinutes: [5, 180] };

function jumpTo(num) {
  const el = document.querySelector(`.entry[data-table="${Number(num)}"]`);
  if (!el) {
    flash = `⚠️ שולחן ${num} לא פעיל כרגע`;
    render();
    return;
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'toggleAuto') return actions.toggleAuto(t.dataset, t);
  if (t.dataset.set) {
    const key = t.dataset.set;
    let value = t.value.trim();
    if (NUMBER_LIMITS[key]) {
      const [lo, hi] = NUMBER_LIMITS[key];
      value = Math.min(hi, Math.max(lo, Math.round(Number(value)) || lo));
    }
    if (value === '') value = E.DEFAULT_SETTINGS[key];
    t.blur();
    run(() => store.patch({ [`settings.${key}`]: value }));
  } else if (t.id === 'jump') {
    const v = t.value;
    t.value = '';
    jumpTo(v);
  } else if (t.id === 'fr') {
    filter.round = t.value;
    render();
  } else if (t.id === 'fo') {
    filter.open = t.checked;
    render();
  } else if (t.id === 'imp' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (!data.state?.settings || !data.state?.matches) throw new Error('הקובץ לא נראה כמו גיבוי של הטורניר');
      if (confirm('לשחזר מהגיבוי? המצב הנוכחי יוחלף.')) {
        run(async () => {
          await store.replace(data.state);
          await Promise.all((data.signups ?? []).map((x) => store.signups.set(x.id, x)));
        }, 'שוחזר מגיבוי');
      }
    } catch (err) {
      flash = `⚠️ ${err.message}`;
      render();
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'fq') return;
  filter.q = e.target.value;
  render();
  const el = $('#fq');
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await store.auth.login(form.get('email'), form.get('password'));
    loginError = '';
  } catch {
    loginError = 'אימייל או סיסמה שגויים';
    render();
  }
});

store.subscribe((s) => {
  state = s;
  softRender();
  schedulePilot();
});
store.signups.watchAll((list) => {
  signups = list;
  softRender();
  schedulePilot();
});
store.reports.watchAll((list) => {
  reports = list;
  softRender();
  schedulePilot();
});
store.auth.onChange((email) => {
  user = email;
  if (!store.auth.required || email) store.ensure().catch(() => {});
  render();
  schedulePilot();
});
