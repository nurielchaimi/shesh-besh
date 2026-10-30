// Public page: what players open on their phones.
// Register, see who you play next and at which table, report the result, read the standings.
import { openStore } from './store.js';
import * as E from './engine.js';
import { esc, nm, matchCardHtml, standingsHtml, bracketHtml, championHtml, progressHtml, profileCardHtml } from './render.js';
import { rulesHtml } from './rules.js';

const $ = (sel) => document.querySelector(sel);
const store = await openStore();
// Rehearsal only: ?as=<signup id> in demo mode plays as that player without any claiming.
const impersonate = store.mode === 'demo' ? new URLSearchParams(location.search).get('as') : null;

let state = E.emptyState();
let online = true;
// New visitors land on the rules; once they have seen them the site opens on their own page.
const RULES_SEEN = 'sheshbesh:rules-seen';
const seenRules = () => {
  try {
    return localStorage.getItem(RULES_SEEN) === '1';
  } catch {
    return true;
  }
};
let tab = seenRules() ? 'me' : 'rules';
let mySignup = null;
let reports = [];
let stopReports = null;
let watchedMatch = null;
let showPicker = false;
let editing = false;
let correcting = false;
let unclaimed = null;
let message = '';
let dirty = false;
let lastActiveId; // undefined until we know who the player is
let freshUntil = 0;

const TABS = [['rules', 'חוקים'], ['me', 'אני'], ['tables', 'שולחנות'], ['groups', 'בתים'], ['bracket', 'עץ הדחה']];
const lower = (v) => String(v ?? '').toLowerCase();
const first = (id) => String(state.players[id]?.name ?? '').split(' ')[0];
const note = (text) => `<p class="empty">${text}</p>`;
const meId = () => impersonate ?? mySignup?.id ?? null;
const oppOf = (m, me) => (m.a === me ? m.b : m.a);
const tableList = (ms) => [...new Set(ms.map((m) => m.table).filter((t) => t != null))].sort((a, b) => a - b).join(', ');
const roundsOf = (gid) => Math.max(0, ...Object.values(state.matches).filter((m) => m.stage === 'group' && m.group === gid).map((m) => m.round));
const colorLine = (s, m, me) => {
  const c = E.colorOf(s, m, me);
  return `<div class="mycolor"><i class="chk lg" style="background:${esc(c.hex)}"></i> הצבע שלך: <b>${esc(c.name)}</b></div>`;
};
const messageHtml = () => (message ? `<div class="note bad">${esc(message)}</div>` : '');

// ---------- registration ----------

const regFormHtml = (v = {}, id = 'regForm', label = 'הרשמה') => `<form id="${id}" class="regform">
  <div class="field"><label>שם מלא</label><input name="name" required minlength="2" maxlength="40" value="${esc(v.name ?? '')}" autocomplete="name"></div>
  <div class="field"><label>מה את/ה לומד/ת?</label><input name="study" maxlength="40" value="${esc(v.study ?? '')}" placeholder="למשל: הנדסת תוכנה"></div>
  <div class="field"><label>רמת ניסיון בשש-בש</label><select name="level">${Object.entries(E.LEVELS)
    .map(([k, text]) => `<option value="${k}"${(v.level || 'casual') === k ? ' selected' : ''}>${text}</option>`)
    .join('')}</select></div>
  <div class="field"><label>משפט אחד עלייך (היריבים יראו אותו)</label><textarea name="bio" maxlength="90" style="min-height:70px" placeholder="למשל: משחק/ת מגיל 8, מעדיף/ה מארס על פני הכול">${esc(v.bio ?? '')}</textarea></div>
  <button class="btn primary big" type="submit">${label}</button></form>`;

function pickerHtml(q) {
  if (unclaimed == null) return note('טוען…');
  if (!q) return `<div class="card"><p class="muted" style="margin:0">הקלד/י את השם שלך בחיפוש למעלה.</p></div>`;
  const hits = unclaimed.filter((p) => lower(p.name).includes(lower(q))).slice(0, 20);
  if (!hits.length) return note('לא נמצא שם פנוי. אם השם כבר תפוס, פנה/י למארגנים.');
  return `<div class="pick">${hits.map((p) => `<button data-claim="${p.id}">${esc(p.name)}${p.study ? `<small>${esc(p.study)}</small>` : ''}</button>`).join('')}</div>`;
}

function anonymousView(s, q) {
  const open = s.stage === 'setup' && s.settings.registrationOpen;
  if (open && !showPicker) {
    return `${messageHtml()}<div class="card"><h2>הרשמה לטורניר</h2><p class="muted">ההרשמה כפופה לאישור המארגנים. אחרי האישור וההגרלה נשלח לכאן, בכל משחק, מול מי משחקים ובאיזה שולחן. השאר/י את הדף פתוח.</p>${regFormHtml()}<button class="btn ghost" data-tab="rules" style="width:100%;margin-top:8px">קראו קודם את חוקי הטורניר</button></div>
      <div class="card"><p class="muted" style="margin:0 0 8px">המארגנים כבר רשמו אותך?</p><button class="btn" data-act="picker">כן, חפש את השם שלי</button></div>`;
  }
  const title = open ? 'חיפוש השם שלך' : s.stage === 'setup' ? 'ההרשמה נסגרה' : 'הטורניר כבר התחיל';
  return `${messageHtml()}<div class="card"><h2>${title}</h2><p class="muted">אם המארגנים רשמו אותך, הקלד/י את שמך בחיפוש ובחר/י "זה אני". אחרת, פנה/י אליהם.</p>${open ? '<button class="btn" data-act="unpicker">חזרה להרשמה</button>' : ''}</div>${pickerHtml(q)}`;
}

function lobbyView(s) {
  const me = mySignup ?? s.players[meId()] ?? {};
  const level = E.LEVELS[me.level];
  const status = E.signupStatus(me);
  const title = { pending: 'ההרשמה התקבלה ⏳', approved: 'אושרת! ✓', rejected: 'ההרשמה לא אושרה' }[status];
  const blurb = {
    pending: 'המארגנים צריכים לאשר אותך לפני שתיכנס/י להגרלה. ברגע שתאושר/י תופיע כאן הודעה. <b>השאר/י את הדף פתוח.</b>',
    approved: 'ההגרלה עוד לא התקיימה. ברגע שהיא מתקיימת תופיע כאן הקבוצה שלך, היריב הראשון ומספר השולחן. <b>השאר/י את הדף פתוח.</b>',
    rejected: 'ההרשמה שלך לא אושרה להשתתפות בטורניר. אם זו טעות, פנה/י למארגנים.',
  }[status];
  if (editing && mySignup) return `${messageHtml()}<div class="card"><h2>עריכת הפרטים שלי</h2>${regFormHtml(me, 'editForm', 'שמירה')}<button class="btn ghost" data-act="cancelEdit" style="margin-top:8px">ביטול</button></div>`;
  return `${messageHtml()}<div class="card me-card"><h2>${title}</h2>
    <div class="profile"><h3>${esc(me.name)}</h3><div class="chips">${level ? `<span class="tag">${esc(level)}</span>` : ''}${me.study ? `<span class="tag">${esc(me.study)}</span>` : ''}</div>${me.bio ? `<q>${esc(me.bio)}</q>` : ''}</div>
    <p>${blurb}</p>
    ${mySignup && status !== 'rejected' ? '<button class="btn" data-act="edit">עריכת פרטים</button>' : ''}</div>`;
}

// ---------- the player's flow ----------

function reportHtml(s, flow) {
  const m = flow.active;
  const me = flow.player.id;
  const opp = oppOf(m, me);
  const ko = m.stage === 'ko';
  const st = E.reportStatus(m, reports);
  const mine = reports.find((r) => r.p === me);
  const say = (c, named = true) => `${c.winner === me ? 'ניצחת' : `${named ? `${nm(s, opp)} ` : ''}ניצח/ה אותך`}${c.mars ? ' במארס' : ''}`;
  if (st.status === 'confirmed') return '<div class="note">התוצאה אושרה ✓ מעדכנים…</div>';
  if (st.status === 'pending' && st.by !== me && !correcting) {
    return `<div class="note"><b>${nm(s, st.by)}</b> דיווח/ה: ${say(st.claim, false)}.<br>זה נכון?</div>
      <div class="report"><button class="btn win span2" data-act="confirm">כן, נכון</button><button class="btn span2" data-act="correct">לא, זה לא מה שקרה</button></div>`;
  }
  if (mine && !correcting) {
    const line = st.status === 'disputed' ? 'הדיווחים לא תואמים, המארגנים יכריעו.' : `ממתינים לאישור של ${nm(s, opp)}.`;
    return `<div class="note">הדיווח שלך: ${say(mine)}. ${line}</div><button class="btn" data-act="correct">שינוי הדיווח</button>`;
  }
  return `<h3 style="margin-top:14px">איך נגמר המשחק?</h3><div class="report">
    <button class="btn win" data-act="report" data-w="me" data-mars="0">ניצחתי</button>
    ${ko ? '' : '<button class="btn win" data-act="report" data-w="me" data-mars="1">ניצחתי במארס</button>'}
    <button class="btn lose" data-act="report" data-w="opp" data-mars="0">הפסדתי</button>
    ${ko ? '' : '<button class="btn lose" data-act="report" data-w="opp" data-mars="1">הפסדתי במארס</button>'}</div>`;
}

function waitHtml(s, flow) {
  const me = flow.player.id;
  if (s.stage === 'knockout') {
    const sib = flow.waitingFor[0];
    const sub = sib ? `היריב/ה יתברר/תתברר מהמשחק בשולחן ${sib.table}` : 'מכינים לך את המשחק…';
    const cands = sib ? [sib.a, sib.b].filter(Boolean).map((id) => profileCardHtml(s, id, { title: 'אחד/ת מהם יהיה היריב/ה שלך' })).join('') : '';
    return `<div class="big"><small>ניצחת! ממשיכים</small><div class="t">הבא: ${esc(flow.nextRound)}</div><div class="vs">${sub}</div></div>${cands}`;
  }
  if (flow.next) {
    const opp = oppOf(flow.next, me);
    const live = flow.waitingFor.map((m) => `שולחן ${m.table}: ${nm(s, m.a)} נגד ${nm(s, m.b)}`).join(' · ');
    const resting = flow.waitingFor.every((m) => m.a !== me && m.b !== me);
    return `<div class="big"><small>${resting ? 'בסיבוב הזה את/ה נח/ה. המשחק הבא שלך' : 'המשחק הבא שלך'}</small><div class="t">שולחן ${flow.next.table}</div><div class="vs">מול ${nm(s, opp)}</div>${colorLine(s, flow.next, me)}</div>
      ${profileCardHtml(s, opp, { title: 'היריב/ה הבא/ה' })}
      <p class="muted">אפשר ללכת לשולחן ${flow.next.table} כשהמשחק הנוכחי בבית יסתיים (${live || '—'}). נעדכן אותך כאן אוטומטית.</p>`;
  }
  let sub = 'ממתינים לשאר המשחקים בבית';
  if (flow.groupDone && flow.through) sub = 'עלית לשלב ההדחה 🎉 ממתינים לסיום שאר הבתים';
  if (flow.tied) sub = 'יש שוויון על גבול ההעפלה, המארגנים יכריעו';
  return `<div class="big${flow.through ? ' done' : ''}"><small>סיימת את משחקי הבית</small><div class="t">מקום ${flow.rank ?? '—'}${flow.groupDone ? '' : ' בינתיים'}</div><div class="vs">${sub}</div></div>`;
}

function lastHtml(s, flow) {
  const m = flow.last;
  if (!m) return '';
  const me = flow.player.id;
  const won = m.result.winner === me;
  const mars = m.result.mars && !m.result.walkover ? ' במארס' : '';
  return `<div class="last ${won ? 'won' : 'lost'}">המשחק האחרון: ${won ? `ניצחת${mars} את` : `הפסדת${mars} ל`}${won ? ' ' : '-'}${nm(s, oppOf(m, me))}</div>`;
}

function flowView(s, flow) {
  const me = flow.player.id;
  let body = '';
  if (flow.phase === 'play') {
    const m = flow.active;
    const opp = oppOf(m, me);
    const where = m.stage === 'group' ? `בית ${m.group} · סיבוב ${m.round} מתוך ${roundsOf(m.group)}` : E.koRoundName(s.ko.size, m.round);
    body = `<div class="big${Date.now() < freshUntil ? ' fresh' : ''}"><small>${esc(where)}</small><div class="t">שולחן ${m.table}</div><div class="vs">מול ${nm(s, opp)}</div>${colorLine(s, m, me)}</div>
      ${profileCardHtml(s, opp, { title: 'היריב/ה שלך' })}
      <ol class="steps"><li>גש/י לשולחן ${m.table}</li><li>שחק/י נגד ${esc(first(opp))}</li><li>כשהמשחק נגמר, דווח/י כאן על התוצאה</li></ol>
      ${reportHtml(s, flow)}`;
  } else if (flow.phase === 'wait') body = waitHtml(s, flow);
  else if (flow.phase === 'champion') body = '<div class="big done"><div class="t">🏆</div><div class="vs">אתה/את אלוף/ת הטורניר!</div></div>';
  else {
    const why = flow.withdrawn ? 'הוצאת מהטורניר' : flow.eliminatedAt ? `הודחת ב${flow.eliminatedAt}` : `סיימת במקום ${flow.rank} בבית ${flow.group}`;
    body = `<div class="big lost"><div class="t">תודה ששיחקת!</div><div class="vs">${esc(why)}</div></div><p class="muted">אפשר להמשיך לעקוב אחרי הטורניר בלשוניות למעלה.</p>`;
  }
  const group = flow.group && s.groups[flow.group] ? `<div class="card"><h3>הבית שלי</h3>${standingsHtml(s, flow.group, { me })}</div>` : '';
  const mine = flow.matches.length ? `<div class="card"><h3>המשחקים שלי</h3><div class="grid">${flow.matches.map((m) => matchCardHtml(s, m, { me })).join('')}</div></div>` : '';
  return `${messageHtml()}<div class="card me-card"><div class="who"><h2>${nm(s, me)}</h2></div>${body}${lastHtml(s, flow)}</div>${group}${mine}`;
}

function meView(s, q) {
  const id = meId();
  if (!id) return anonymousView(s, q);
  if (s.stage === 'setup') return lobbyView(s);
  const flow = E.playerFlow(s, id);
  if (!flow) {
    const unapproved = mySignup && E.signupStatus(mySignup) !== 'approved';
    return `<div class="card"><h2>${unapproved ? 'ההרשמה שלך לא אושרה' : 'נרשמת, אבל אינך ברשימת המשתתפים'}</h2><p class="muted">ההגרלה כבר התקיימה${unapproved ? ' וההרשמה שלך לא אושרה בזמן, ולכן אינך משתתף/ת בטורניר' : ''}. פנה/י למארגנים אם זו טעות.</p></div>`;
  }
  return flowView(s, flow);
}

// ---------- the other tabs ----------

function tablesView(s, q) {
  if (s.stage === 'setup') return note(`ההרשמה ${s.settings.registrationOpen ? 'פתוחה' : 'נסגרה'}. אושרו ${s.signupCount ?? 0} משתתפים.`);
  if (E.champion(s)) return championHtml(s);
  const ms = E.currentMatches(s);
  if (!ms.length) return note('אין משחקים פעילים כרגע.');
  const text = (m) => lower(`${s.players[m.a]?.name ?? ''} ${s.players[m.b]?.name ?? ''} ${m.table ?? ''} בית ${m.group ?? ''}`);
  const shown = q ? ms.filter((m) => text(m).includes(lower(q))) : ms;
  return `<h3 style="margin-bottom:6px">${esc(E.stageLabel(s))}</h3>${progressHtml(s)}<div class="grid">${shown.map((m) => matchCardHtml(s, m, { me: meId() })).join('') || note('לא נמצא.')}</div>`;
}

function groupsView(s, q) {
  const ids = E.groupIds(s);
  if (!ids.length) return note('הבתים יוגרלו בתחילת הטורניר.');
  const shown = ids.filter((gid) => !q || String(gid) === q.trim() || s.groups[gid].players.some((id) => lower(s.players[id].name).includes(lower(q))));
  return `<div class="grid wide">${shown.map((gid) => standingsHtml(s, gid, { me: meId() })).join('') || note('לא נמצא.')}</div>`;
}

const rulesView = (s) => `${rulesHtml(s)}<button class="btn primary big" data-tab="me" style="width:100%">הבנתי, ממשיכים ←</button>`;

const views = { rules: rulesView, me: meView, tables: tablesView, groups: groupsView, bracket: (s) => `${championHtml(s)}${bracketHtml(s, { me: meId() })}` };

// ---------- rendering ----------

function render() {
  dirty = false;
  const s = state;
  document.title = s.settings.name;
  $('#title').textContent = s.settings.name;
  $('#stage').textContent = E.stageLabel(s);
  $('#dot').classList.toggle('off', !online);
  $('#conn').textContent = online ? 'מתעדכן חי' : 'מנותק';
  const tabs = TABS.filter(([id]) => id !== 'bracket' || s.ko);
  if (!tabs.some(([id]) => id === tab)) tab = 'me';
  $('#tabs').innerHTML = tabs.map(([id, text]) => `<button class="tab${id === tab ? ' on' : ''}" data-tab="${id}">${text}</button>`).join('');
  const picking = tab === 'me' && !meId() && (showPicker || s.stage !== 'setup' || !s.settings.registrationOpen);
  $('#toolbar').hidden = !(picking || tab === 'tables' || tab === 'groups');
  $('#view').innerHTML = views[tab](s, $('#q').value.trim());
  if (tab === 'rules') {
    try {
      localStorage.setItem(RULES_SEEN, '1');
    } catch {}
  }
}

// Do not wipe a half-filled form when an update arrives.
function softRender() {
  if (document.activeElement?.matches?.('#view input, #view textarea, #view select')) {
    dirty = true;
    return;
  }
  render();
}
document.addEventListener('focusout', () => {
  if (!dirty) return;
  setTimeout(() => !document.activeElement?.matches?.('#view input, #view textarea, #view select') && render(), 50);
});

// Keeps a live listener on the reports of the match the player is currently playing, and buzzes the
// phone when a new match becomes ready.
function sync() {
  const id = meId();
  if (!id) return;
  const flow = state.stage === 'setup' ? null : E.playerFlow(state, id);
  const activeId = flow?.active?.id ?? null;
  if (lastActiveId !== undefined && activeId && activeId !== lastActiveId) {
    freshUntil = Date.now() + 12000;
    correcting = false;
    try {
      navigator.vibrate?.([250, 120, 250]);
    } catch {}
  }
  lastActiveId = activeId;
  if (activeId !== watchedMatch) {
    stopReports?.();
    stopReports = null;
    reports = [];
    watchedMatch = activeId;
    if (activeId) stopReports = store.reports.watchMatch(activeId, (list) => ((reports = list), softRender()));
  }
}

// ---------- actions ----------

async function act(fn) {
  message = '';
  try {
    await fn();
  } catch (err) {
    message = err.code === 'permission-denied' ? 'אין הרשאה לפעולה הזאת. ייתכן שההרשמה נסגרה או שהשם תפוס.' : err.message;
  }
  render();
}

const submitReport = (winner, mars) => {
  const flow = E.playerFlow(state, meId());
  return act(async () => {
    await store.reports.submit({ m: flow.active.id, p: flow.player.id, winner, mars });
    correcting = false;
  });
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab],[data-claim],[data-act]');
  if (!el) return;
  if (el.dataset.tab) {
    tab = el.dataset.tab;
    return render();
  }
  if (el.dataset.claim) return act(() => store.signups.claim(el.dataset.claim));
  const flow = meId() && state.stage !== 'setup' ? E.playerFlow(state, meId()) : null;
  switch (el.dataset.act) {
    case 'picker':
      showPicker = true;
      unclaimed = null;
      store.signups.listUnclaimed().then((list) => ((unclaimed = list), render()));
      return render();
    case 'unpicker':
      showPicker = false;
      return render();
    case 'edit':
      editing = true;
      return render();
    case 'cancelEdit':
      editing = false;
      return render();
    case 'correct':
      correcting = true;
      return render();
    case 'report': {
      const m = flow.active;
      return submitReport(el.dataset.w === 'me' ? flow.player.id : oppOf(m, flow.player.id), el.dataset.mars === '1');
    }
    case 'confirm': {
      const st = E.reportStatus(flow.active, reports);
      if (st.status === 'pending') return submitReport(st.claim.winner, !!st.claim.mars);
    }
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'regForm' && e.target.id !== 'editForm') return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  if (e.target.id === 'regForm') return act(() => store.signups.register(data));
  return act(async () => {
    await store.signups.update(mySignup.id, data);
    editing = false;
  });
});

$('#q').addEventListener('input', render);

store.signups.watchMine((x) => {
  mySignup = x;
  sync();
  softRender();
});
store.subscribe((s, meta) => {
  state = s;
  online = meta.online;
  sync();
  softRender();
});
if (impersonate) sync();
