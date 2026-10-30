// Shared HTML renderers used by the public page, the projector page and the admin page.
import * as E from './engine.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const nm = (s, id) => esc(s.players[id]?.name ?? '—');

export const tablesLabel = (g) => {
  if (!g?.tables?.length) return '';
  return g.tables.length === 1 ? `שולחן ${g.tables[0]}` : `שולחנות ${g.tables[0]}–${g.tables.at(-1)}`;
};

export function resultTag(r) {
  if (!r || r.bye) return '';
  if (r.walkover) return '<span class="tag">טכני</span>';
  if (r.mars) return '<span class="tag mars">מארס ×2</span>';
  return '';
}

export const caption = (s, m) => (m.stage === 'group' ? `בית ${m.group}` : E.koRoundName(s.ko.size, m.round));

// One match: table number on the side, both players, the winner highlighted.
export function matchCardHtml(s, m, { me = null } = {}) {
  const r = m.result;
  const side = (id) => {
    if (id == null) return '<div class="side bye"><span class="nm">פטור</span></div>';
    const cls = !r ? '' : r.winner === id ? 'win' : 'lose';
    return `<div class="side ${cls}${id === me ? ' me' : ''}"><span class="nm">${nm(s, id)}</span>${r?.winner === id ? resultTag(r) : ''}</div>`;
  };
  return `<div class="match${r ? ' done' : ''}"><div class="tbl"><small>שולחן</small><b>${m.table ?? '—'}</b></div><div class="sides">${side(m.a)}${side(m.b)}<div class="cap">${esc(caption(s, m))}</div></div></div>`;
}

export function standingsHtml(s, gid, { me = null } = {}) {
  const rows = E.groupStandings(s, gid);
  const K = s.settings.advance;
  const done = E.groupComplete(s, gid);
  const body = rows
    .map((r) => {
      const cls = [r.rank <= K ? (done ? 'q done' : 'q') : '', r.id === me ? 'me' : '', s.players[r.id]?.withdrawn ? 'out' : ''].join(' ');
      const tie = done && r.tie != null ? '<span class="tie" title="שוויון">＝</span>' : '';
      return `<tr class="${cls}"><td class="rk">${r.rank}</td><td class="nm">${nm(s, r.id)}${tie}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.marsWins}</td><td class="pts">${r.points}</td></tr>`;
    })
    .join('');
  return `<div class="gcard${done ? ' complete' : ''}"><header><b>בית ${esc(gid)}</b><span>${tablesLabel(s.groups[gid])}</span></header><table class="st"><thead><tr><th></th><th>שחקן</th><th>מש׳</th><th>נצ׳</th><th>מארס</th><th>נק׳</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

// part/parts show one slice of the bracket (the projector pages through big brackets).
export function bracketHtml(s, { me = null, fromRound = 1, maxRounds = 99, part = 0, parts = 1 } = {}) {
  const rounds = E.koRounds(s).filter((r) => r.round >= fromRound).slice(0, maxRounds);
  const slice = (slots) =>
    parts > 1 && slots.length >= parts ? slots.slice((part * slots.length) / parts, ((part + 1) * slots.length) / parts) : slots;
  if (!rounds.length) return '<p class="empty">עץ ההדחה ייבנה בסיום שלב הבתים.</p>';
  const side = (slot, id) => {
    if (id == null) return `<div class="bs wait">${slot.bye ? 'פטור' : 'ממתין…'}</div>`;
    const cls = slot.result ? (slot.result.winner === id ? 'win' : 'lose') : '';
    const seed = s.ko.seeds?.[id];
    return `<div class="bs ${cls}${id === me ? ' me' : ''}"><span class="sd">${seed ?? ''}</span><span class="nm">${nm(s, id)}</span></div>`;
  };
  const col = (r) =>
    `<div class="bcol"><h4>${esc(r.name)}</h4><div class="bcells">${slice(r.slots)
      .map((slot) => `<div class="bm">${slot.table ? `<i>${slot.table}</i>` : ''}${side(slot, slot.a)}${side(slot, slot.b)}</div>`)
      .join('')}</div></div>`;
  return `<div class="bracket">${rounds.map(col).join('')}</div>`;
}

export function championHtml(s) {
  const id = E.champion(s);
  if (!id) return '';
  const final = s.matches[E.koMatchId(s.ko.rounds, 0)];
  const second = final.a === id ? final.b : final.a;
  return `<div class="champ"><div class="trophy">🏆</div><small>אלוף הטורניר</small><h2>${nm(s, id)}</h2>${second ? `<p>מקום שני: ${nm(s, second)}</p>` : ''}</div>`;
}

export function progressHtml(s) {
  const p = E.progress(s);
  if (!p.total) return '';
  const pct = Math.round((p.done / p.total) * 100);
  return `<div class="prog"><div class="bar"><i style="width:${pct}%"></i></div><span>${p.done} מתוך ${p.total} משחקים</span></div>`;
}

// A short introduction to a player: used to tell someone who they are about to play.
export function profileCardHtml(s, id, { title = '' } = {}) {
  const p = s.players[id];
  if (!p) return '';
  const row = p.group && s.groups[p.group] ? E.groupStandings(s, p.group).find((r) => r.id === id) : null;
  const record = row?.played ? `${row.wins} ניצחונות מתוך ${row.played} משחקים${row.marsWins ? ` · ${row.marsWins} מארסים` : ''}` : 'עוד לא שיחק/ה בטורניר';
  const level = E.LEVELS[p.level];
  return `<div class="profile">${title ? `<small>${esc(title)}</small>` : ''}<h3>${esc(p.name)}</h3><div class="chips">${level ? `<span class="tag">${esc(level)}</span>` : ''}${p.study ? `<span class="tag">${esc(p.study)}</span>` : ''}${p.group ? `<span class="tag">בית ${esc(p.group)}</span>` : ''}</div>${p.bio ? `<q>${esc(p.bio)}</q>` : ''}<p class="rec">${esc(record)}</p></div>`;
}
