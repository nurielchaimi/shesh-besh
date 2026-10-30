// Projector page: rotates through scenes by itself. Nobody needs to touch it.
//   ?interval=12   seconds per slide        ?scene=tables|groups|bracket|recent   pin one scene
//   ?cols=4        match cards per row      ?rows=4                               rows of cards per page
import { openStore } from './store.js';
import * as E from './engine.js';
import { esc, matchCardHtml, standingsHtml, bracketHtml, championHtml, progressHtml } from './render.js';
import { rulesHtml } from './rules.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const interval = Math.max(4, Number(params.get('interval')) || 12) * 1000;
const pinned = params.get('scene');
const cols = Number(params.get('cols')) || (innerWidth >= 1500 ? 4 : innerWidth >= 1000 ? 3 : 2);
const rows = Number(params.get('rows')) || 4;

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const page = (i, n) => (n > 1 ? `<small>עמוד ${i + 1} מתוך ${n}</small>` : '');

function buildSlides(s) {
  const slides = [];
  const add = (scene, html) => slides.push({ scene, html });
  if (s.stage === 'setup') {
    const intro = s.settings.registrationOpen ? 'ההרשמה פתוחה! סרקו כדי להירשם' : 'ההרשמה נסגרה, ההגרלה בקרוב';
    add('wait', `<div class="lobby"><h2>${esc(s.settings.name)}</h2><p>${intro}</p><div class="big-qr">${qrSvg()}</div><p class="count">נרשמו ${s.signupCount ?? 0} משתתפים</p></div>`);
    add('rules', rulesSlide(s));
    return slides;
  }
  const done = !!E.champion(s);
  if (done) add('champion', championHtml(s));

  const open = E.currentMatches(s);
  if (!done && open.length) {
    const pages = chunk(open, cols * rows);
    pages.forEach((pg, i) =>
      add('tables', `<h2><span>${esc(E.stageLabel(s))} · לאן ללכת</span>${page(i, pages.length)}</h2>${progressHtml(s)}<div class="tv-grid" style="--cols:${cols}">${pg.map((m) => matchCardHtml(s, m)).join('')}</div>`),
    );
  }

  if (s.stage === 'groups' || pinned === 'groups') {
    const gcols = Math.min(cols, 3);
    const pages = chunk(E.groupIds(s), gcols * 2);
    pages.forEach((ids, i) =>
      add('groups', `<h2><span>דירוג הבתים</span>${page(i, pages.length)}</h2><div class="tv-grid" style="--cols:${gcols}">${ids.map((g) => standingsHtml(s, g)).join('')}</div>`),
    );
  }

  if (s.ko) {
    const first = done ? Math.max(1, s.ko.rounds - 2) : E.koCurrentRound(s);
    const firstCount = s.ko.size / 2 ** first;
    const parts = Math.max(1, Math.ceil(firstCount / 8));
    for (let part = 0; part < parts; part++) {
      add('bracket', `<h2><span>עץ ההדחה</span>${page(part, parts)}</h2>${bracketHtml(s, { fromRound: first, maxRounds: 3, part, parts })}`);
    }
  }

  const recent = Object.values(s.matches)
    .filter((m) => m.result?.at && !m.result.bye)
    .sort((a, b) => b.result.at - a.result.at)
    .slice(0, cols * 3);
  if (recent.length) {
    add('recent', `<h2><span>תוצאות אחרונות</span></h2><div class="tv-grid" style="--cols:${cols}">${recent.map((m) => matchCardHtml(s, m)).join('')}</div>`);
  }
  add('rules', rulesSlide(s));
  return slides;
}

const rulesSlide = (s) => `<h2><span>חוקי המשחק</span></h2>${rulesHtml(s, { compact: true })}`;

let state = E.emptyState();
let slides = [];
let idx = 0;
let shown = '';

function show(animate) {
  if (!slides.length) return;
  idx %= slides.length;
  const html = slides[idx].html;
  const area = $('#area');
  if (!animate && html === shown) return;
  area.innerHTML = `<div class="slide"${animate ? '' : ' style="animation:none"'}>${html}</div>`;
  shown = html;
  $('#dots').innerHTML = slides.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('');
}

function refresh() {
  document.title = `${state.settings.name} · מסך הקרנה`;
  $('#title').textContent = state.settings.name;
  $('#stage').textContent = E.stageLabel(state);
  const all = buildSlides(state);
  const filtered = pinned ? all.filter((sl) => sl.scene === pinned) : all;
  slides = filtered.length ? filtered : all;
  show(false);
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function pageUrl() {
  const url = new URL('index.html', location.href);
  url.search = '';
  return url;
}

function qrSvg() {
  if (typeof qrcode !== 'function') return '';
  const qr = qrcode(0, 'M');
  qr.addData(pageUrl().href);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}

function drawQr() {
  const url = pageUrl();
  $('#url').textContent = `היכנסו מהטלפון: ${url.host}${url.pathname.replace(/index\.html$/, '')}`;
  $('#qr').innerHTML = qrSvg();
}

const store = await openStore();
store.subscribe((s, meta) => {
  state = s;
  $('#dot').classList.toggle('off', !meta.online);
  refresh();
});
setInterval(() => {
  idx++;
  show(true);
}, interval);
setInterval(tickClock, 15000);
tickClock();
drawQr();
