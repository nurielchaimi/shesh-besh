// Tournament engine: pure functions over a plain-JSON state.
// No DOM and no network, so the same code runs in the admin page, in the tests and in demo mode.
//
// Format: group stage (round-robin inside each group, win = 1 point, mars win = 2 points)
// followed by a single-elimination bracket seeded from the group results.
//
// Progress is rolling, not synchronised: every group moves to its next round as soon as its own
// matches are done, and a knockout match is created the moment both feeder matches are finished.
// Players report their own results; a result is final when both players report the same thing
// (or the organiser sets it). `autoStep` is what moves the tournament forward.

export const DEL = '__DELETE__'; // patch value meaning "remove this field"

export const DEFAULT_SETTINGS = {
  name: 'טורניר שש-בש',
  groupSize: 0, // 0 = pick automatically from the number of players at draw time
  advance: 2,
  pointsWin: 1,
  pointsMars: 2,
  roundMinutes: 20,
  registrationOpen: true,
};

export const LEVELS = { new: 'מתחיל/ת', casual: 'משחק/ת מדי פעם', experienced: 'מנוסה', pro: 'מקצוען/ית' };

export function emptyState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    stage: 'setup', // setup | groups | knockout
    round: 0,
    signupCount: 0,
    players: {},
    groups: {},
    matches: {},
    ko: null,
  };
}

// ---------- helpers ----------

// Apply a Firestore-style patch ({ 'a.b.c': value }) to a copy of the state.
export function applyPatch(state, patch) {
  const next = structuredClone(state);
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.');
    let node = next;
    for (const k of keys.slice(0, -1)) {
      if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
      node = node[k];
    }
    const last = keys[keys.length - 1];
    if (value === DEL) delete node[last];
    else node[last] = structuredClone(value);
  }
  return next;
}

// The smallest patch that turns `before` into `after`; never emits overlapping paths.
export function diffPatch(before, after) {
  const out = {};
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const walk = (path, a, b) => {
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(b)) {
        const p = path ? `${path}.${k}` : k;
        if (!(k in a)) out[p] = b[k];
        else walk(p, a[k], b[k]);
      }
      for (const k of Object.keys(a)) if (!(k in b)) out[path ? `${path}.${k}` : k] = DEL;
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[path] = b;
    }
  };
  walk('', before, after);
  return out;
}

export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const nextPow2 = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

export const groupIds = (s) => Object.keys(s.groups).sort((a, b) => a - b);
export const sortedPlayers = (s) =>
  Object.values(s.players).sort((a, b) => a.name.localeCompare(b.name, 'he'));

const FIRST = ['נועה', 'יוסי', 'מיכל', 'דניאל', 'תמר', 'איתי', 'שירה', 'עומר', 'ליאור', 'רוני', 'אביב', 'מאיה', 'גל', 'הדר', 'אורי', 'נעמי', 'עידו', 'יעל', 'אלון', 'טל', 'רותם', 'שקד', 'אסף', 'דנה', 'ניר', 'מור', 'איילת', 'רן', 'סהר', 'לימור'];
const LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'דהן', 'אזולאי', 'פרידמן', 'שפירא'];
const STUDY = ['הנדסת תוכנה', 'פסיכולוגיה', 'משפטים', 'כלכלה', 'ביולוגיה', 'תקשורת', 'מדעי המחשב', 'עיצוב', 'הנדסה אזרחית', 'חינוך'];
const BIO = ['משחק/ת מגיל 8, לא מפסיק/ה לדבר בזמן המשחק', 'בא/ה לנצח, לא רק להשתתף', 'למדתי מסבא, עדיין מנסה להבין את הקוביות', 'מעדיף/ה מארס על פני הכול', 'פה בשביל הקפה והחברים', 'מזל זה כישרון', 'שש-בש בלילה, מבחן בבוקר'];
export const demoNames = (n) =>
  Array.from({ length: n }, (_, i) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`);
export const demoSignups = (n) =>
  demoNames(n).map((name, i) => ({ name, study: STUDY[i % STUDY.length], level: Object.keys(LEVELS)[(i * 7) % 4], bio: BIO[i % BIO.length] }));

// ---------- players ----------

export function addPlayersPatch(s, names) {
  const have = new Set(Object.values(s.players).map((p) => p.name));
  const stamp = Date.now().toString(36);
  const patch = {};
  let added = 0;
  let skipped = 0;
  names
    .map((n) => n.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .forEach((name, i) => {
      if (have.has(name)) {
        skipped++;
        return;
      }
      have.add(name);
      const id = `p${stamp}${i.toString(36)}`;
      patch[`players.${id}`] = { id, name };
      added++;
    });
  return { patch, added, skipped };
}

// The signup list (collected on the public page) becomes the player list at draw time.
export function playersFromSignups(signups) {
  return Object.fromEntries(
    signups.map((x) => [x.id, { id: x.id, name: x.name, study: x.study ?? '', level: x.level ?? '', bio: x.bio ?? '', uid: x.uid ?? null }]),
  );
}

export const removePlayerPatch = (id) => ({ [`players.${id}`]: DEL });

// A withdrawn player forfeits every unplayed match: the opponent gets a technical win.
export function withdrawPatch(s, pid) {
  const patch = { [`players.${pid}.withdrawn`]: true };
  for (const m of Object.values(s.matches)) {
    if (m.result || (m.a !== pid && m.b !== pid)) continue;
    const other = m.a === pid ? m.b : m.a;
    if (other) patch[`matches.${m.id}.result`] = { winner: other, walkover: true, at: Date.now() };
  }
  return patch;
}

export function reinstatePatch(s, pid) {
  const patch = { [`players.${pid}.withdrawn`]: DEL };
  for (const m of Object.values(s.matches)) {
    if ((m.a === pid || m.b === pid) && m.result?.walkover) patch[`matches.${m.id}.result`] = DEL;
  }
  return patch;
}

// ---------- planning and draw ----------

export function splitGroups(n, groupSize) {
  if (n < 2) return [];
  const count = Math.max(1, Math.min(Math.floor(n / 2), Math.round(n / groupSize)));
  const base = Math.floor(n / count);
  const extra = n % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

// Automatic group size: the neatest bracket for this many players with the fewest rounds.
// Every bye costs a quarter of a round in the score, so 80 players get groups of 5 (a full bracket
// of 32) and 64 players get groups of 4.
export function bestGroupSize(n, settings) {
  const options = [3, 4, 5, 6]
    .map((groupSize) => ({ groupSize, plan: planTournament(n, { ...settings, groupSize }) }))
    .filter((o) => o.plan.koSize)
    .map((o) => ({ ...o, score: o.plan.rounds + 0.25 * o.plan.byes }));
  if (!options.length) return 4;
  options.sort((x, y) => x.score - y.score || Math.abs(x.groupSize - 4) - Math.abs(y.groupSize - 4));
  return options[0].groupSize;
}

export const effectiveGroupSize = (n, settings) => (settings.groupSize > 0 ? settings.groupSize : bestGroupSize(n, settings));

export function planTournament(n, settings) {
  const groupSize = effectiveGroupSize(n, settings);
  const sizes = splitGroups(n, groupSize);
  const qualifiers = sizes.reduce((sum, size) => sum + Math.min(settings.advance, size), 0);
  const koSize = qualifiers > 1 ? nextPow2(qualifiers) : 0;
  const groupRounds = Math.max(0, ...sizes.map((size) => (size % 2 ? size : size - 1)));
  const koRounds = koSize ? Math.log2(koSize) : 0;
  const groupTables = sizes.reduce((sum, size) => sum + Math.floor(size / 2), 0);
  const rounds = groupRounds + koRounds;
  return {
    groupSize,
    sizes,
    qualifiers,
    koSize,
    byes: koSize ? koSize - qualifiers : 0,
    groupRounds,
    koRounds,
    rounds,
    tables: Math.max(groupTables, koSize / 2),
    minutes: rounds * (settings.roundMinutes || 20),
  };
}

// Same plan for group sizes 3-6, so the admin can see which one gives a neat bracket.
export function planAlternatives(n, settings) {
  return [3, 4, 5, 6].map((groupSize) => ({ groupSize, ...planTournament(n, { ...settings, groupSize }) }));
}

// Circle method. Returns an array of rounds, each a list of [a, b] pairs (byes left out).
export function roundRobin(ids) {
  const arr = [...ids];
  if (arr.length % 2) arr.push(null);
  const m = arr.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a != null && b != null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

export function drawGroups(s, rng = Math.random) {
  const ids = shuffle(Object.keys(s.players), rng);
  const sizes = splitGroups(ids.length, effectiveGroupSize(ids.length, s.settings));
  const groups = {};
  const matches = {};
  const players = {};
  let at = 0;
  let table = 1;
  sizes.forEach((size, gi) => {
    const gid = String(gi + 1);
    const members = ids.slice(at, at + size);
    at += size;
    const perRound = Math.floor(size / 2);
    const tables = Array.from({ length: perRound }, (_, k) => table + k);
    table += perRound;
    groups[gid] = { id: gid, players: members, tables, round: 1 };
    members.forEach((pid) => (players[pid] = { ...s.players[pid], group: gid }));
    roundRobin(members).forEach((pairs, ri) =>
      pairs.forEach(([a, b], k) => {
        const id = `g${gid}r${ri + 1}m${k}`;
        matches[id] = { id, stage: 'group', group: gid, round: ri + 1, table: tables[k], a, b };
      }),
    );
  });
  return { players, groups, matches, stage: 'groups', round: 1, ko: null, 'settings.registrationOpen': false };
}

export const canRedraw = (s) =>
  s.stage === 'groups' && !Object.values(s.matches).some((m) => m.result);

// ---------- results and standings ----------

export function resultPatch(matchId, result) {
  return { [`matches.${matchId}.result`]: result ? { ...result, at: Date.now() } : DEL };
}

export const winResult = (winner, { mars = false, walkover = false } = {}) => {
  const r = { winner };
  if (mars) r.mars = true;
  if (walkover) r.walkover = true;
  return r;
};

const cmpKeys = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

function breakTies(block, games, worth, players) {
  if (block.length < 2) return block;
  const ids = new Set(block.map((r) => r.id));
  const mini = Object.fromEntries(block.map((r) => [r.id, 0]));
  for (const m of games) if (ids.has(m.a) && ids.has(m.b)) mini[m.result.winner] += worth(m);
  for (const r of block) {
    r.key = [-mini[r.id], -r.wins, -r.marsWins, r.marsLosses, players[r.id]?.tb ?? Infinity];
  }
  return block.sort((x, y) => cmpKeys(x.key, y.key));
}

// Order: points, then head-to-head among the tied, wins, mars wins, fewer mars losses, manual order.
// Rows that are still level get the same `tie` cluster id so the organiser can decide.
export function groupStandings(s, gid) {
  const g = s.groups[gid];
  const { pointsWin, pointsMars } = s.settings;
  const rows = g.players.map((id) => ({ id, played: 0, wins: 0, losses: 0, marsWins: 0, marsLosses: 0, points: 0 }));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const games = Object.values(s.matches).filter((m) => m.stage === 'group' && m.group === gid && m.result);
  const isMars = (m) => m.result.mars && !m.result.walkover;
  const worth = (m) => (isMars(m) ? pointsMars : pointsWin);
  for (const m of games) {
    const w = by[m.result.winner];
    const l = by[m.result.winner === m.a ? m.b : m.a];
    w.played++;
    l.played++;
    w.wins++;
    l.losses++;
    w.points += worth(m);
    if (isMars(m)) {
      w.marsWins++;
      l.marsLosses++;
    }
  }
  rows.sort((x, y) => y.points - x.points);
  const ranked = [];
  for (let i = 0; i < rows.length; ) {
    let j = i;
    while (j < rows.length && rows[j].points === rows[i].points) j++;
    ranked.push(...breakTies(rows.slice(i, j), games, worth, s.players));
    i = j;
  }
  ranked.forEach((r, i) => {
    r.rank = i + 1;
    r.tie = null;
  });
  let cluster = 0;
  for (let i = 0; i + 1 < ranked.length; i++) {
    const x = ranked[i];
    const y = ranked[i + 1];
    if (x.points === y.points && x.key && y.key && cmpKeys(x.key, y.key) === 0) {
      if (x.tie == null) x.tie = ++cluster;
      y.tie = x.tie;
    }
  }
  return ranked;
}

export function groupComplete(s, gid) {
  const ms = Object.values(s.matches).filter((m) => m.stage === 'group' && m.group === gid);
  return ms.length > 0 && ms.every((m) => m.result);
}

export const groupStageDone = (s) => {
  const ms = Object.values(s.matches).filter((m) => m.stage === 'group');
  return ms.length > 0 && ms.every((m) => m.result);
};

// Ties that straddle the qualification line and must be settled by hand.
export function boundaryTies(s) {
  const K = s.settings.advance;
  const out = [];
  for (const gid of groupIds(s)) {
    const rows = groupStandings(s, gid);
    if (rows.length <= K) continue;
    const edge = rows[K - 1];
    if (edge.tie != null && edge.tie === rows[K].tie) {
      const cluster = rows.filter((r) => r.tie === edge.tie);
      out.push({ group: gid, ids: cluster.map((r) => r.id), spots: K - cluster[0].rank + 1 });
    }
  }
  return out;
}

// ids is ordered best first.
export const tiePatch = (ids) => Object.fromEntries(ids.map((id, i) => [`players.${id}.tb`, i]));

// ---------- players' reports ----------

export const reportId = (matchId, playerId) => `${matchId}_${playerId}`;

// reports: [{ m: matchId, p: playerId, winner, mars }]
// open      nobody reported yet
// pending   one player reported, the other has not answered
// confirmed both reported the same winner and mars flag, the result is final
// disputed  both reported but they disagree: the organiser decides
export function reportStatus(m, reports) {
  const mine = reports.filter((r) => r.m === m.id);
  const ra = mine.find((r) => r.p === m.a);
  const rb = mine.find((r) => r.p === m.b);
  if (!ra && !rb) return { status: 'open' };
  if (ra && rb) {
    if (ra.winner === rb.winner && !!ra.mars === !!rb.mars) return { status: 'confirmed', result: winResult(ra.winner, { mars: !!ra.mars }) };
    return { status: 'disputed', a: ra, b: rb };
  }
  const only = ra ?? rb;
  return { status: 'pending', by: only.p, claim: winResult(only.winner, { mars: !!only.mars }) };
}

// A match can take a result only while it is actually being played.
export function isActive(s, m) {
  if (m.result) return false;
  if (m.stage === 'group') return s.stage === 'groups' && m.round === s.groups[m.group]?.round;
  return s.stage === 'knockout';
}

// ---------- knockout ----------

export const koMatchId = (round, slot) => `k${round}s${slot}`;

export function koRoundName(size, round) {
  const left = size / 2 ** (round - 1);
  return { 2: 'גמר', 4: 'חצי גמר', 8: 'רבע גמר', 16: 'שמינית גמר', 32: '1/16 גמר', 64: '1/32 גמר' }[left] ?? `סיבוב ${left}`;
}

function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((x) => [x, n + 1 - x]);
  }
  return order;
}

export function qualifiers(s) {
  const out = [];
  for (const gid of groupIds(s)) {
    groupStandings(s, gid)
      .slice(0, s.settings.advance)
      .forEach((r) =>
        out.push({ id: r.id, group: gid, place: r.rank, ppg: r.played ? r.points / r.played : 0, wins: r.wins, marsWins: r.marsWins }),
      );
  }
  out.sort((x, y) => x.place - y.place || y.ppg - x.ppg || y.wins - x.wins || y.marsWins - x.marsWins || x.group - y.group);
  out.forEach((q, i) => (q.seed = i + 1));
  return out;
}

// Keep group-mates from meeting in the first knockout round by swapping the lower seeds.
function separateSameGroup(pairs) {
  const clash = ([x, y]) => x && y && x.group === y.group;
  for (let i = 0; i < pairs.length; i++) {
    if (!clash(pairs[i])) continue;
    for (let j = 0; j < pairs.length; j++) {
      if (j === i || !pairs[j][0] || !pairs[j][1]) continue;
      const [x, y] = pairs[i];
      const [p, q] = pairs[j];
      if (x.group !== q.group && p.group !== y.group) {
        pairs[i] = [x, q];
        pairs[j] = [p, y];
        break;
      }
    }
  }
}

function koMakeMatch(s, round, slot, a, b, table) {
  const id = koMatchId(round, slot);
  const m = { id, stage: 'ko', round, slot, a, b };
  if (a == null || b == null) {
    m.result = { winner: a ?? b, bye: true };
  } else {
    const wa = !!s.players[a]?.withdrawn;
    const wb = !!s.players[b]?.withdrawn;
    if (wa !== wb) m.result = { winner: wa ? b : a, walkover: true, at: Date.now() };
    else m.table = table;
  }
  return m;
}

export function buildKnockout(s) {
  const qs = qualifiers(s);
  if (qs.length < 2) return null;
  const size = nextPow2(qs.length);
  const order = seedOrder(size);
  const bySeed = Object.fromEntries(qs.map((q) => [q.seed, q]));
  const pairs = [];
  for (let i = 0; i < size; i += 2) pairs.push([bySeed[order[i]] ?? null, bySeed[order[i + 1]] ?? null]);
  separateSameGroup(pairs);
  const matches = {};
  let table = 1;
  pairs.forEach(([x, y], slot) => {
    const m = koMakeMatch(s, 1, slot, x?.id ?? null, y?.id ?? null, table);
    if (m.table != null) table++;
    matches[m.id] = m;
  });
  return { meta: { size, rounds: Math.log2(size), seeds: Object.fromEntries(qs.map((q) => [q.id, q.seed])) }, matches };
}

const lowestFreeTable = (s) => {
  const used = new Set(Object.values(s.matches).filter((m) => !m.result && m.table != null).map((m) => m.table));
  let t = 1;
  while (used.has(t)) t++;
  return t;
};

// Create every knockout match whose two feeder matches are finished, on the lowest free table.
function koGrow(s) {
  let cur = s;
  const { size, rounds } = cur.ko;
  for (let r = 1; r < rounds; r++) {
    for (let slot = 0; slot < size / 2 ** (r + 1); slot++) {
      const id = koMatchId(r + 1, slot);
      if (cur.matches[id]) continue;
      const f1 = cur.matches[koMatchId(r, 2 * slot)];
      const f2 = cur.matches[koMatchId(r, 2 * slot + 1)];
      if (!f1?.result || !f2?.result) continue;
      cur = applyPatch(cur, { [`matches.${id}`]: koMakeMatch(cur, r + 1, slot, f1.result.winner, f2.result.winner, lowestFreeTable(cur)) });
    }
  }
  return cur;
}

// Bracket for display, including future rounds filled in with whoever is already known.
export function koRounds(s) {
  if (!s.ko) return [];
  const { size, rounds } = s.ko;
  const out = [];
  let prev = null;
  for (let r = 1; r <= rounds; r++) {
    const slots = [];
    for (let i = 0; i < size / 2 ** r; i++) {
      const m = s.matches[koMatchId(r, i)];
      if (m) {
        slots.push({ id: m.id, a: m.a, b: m.b, table: m.table ?? null, result: m.result ?? null, bye: !!m.result?.bye });
      } else {
        const f1 = prev[2 * i];
        const f2 = prev[2 * i + 1];
        slots.push({ id: koMatchId(r, i), a: f1?.result?.winner ?? null, b: f2?.result?.winner ?? null, table: null, result: null, pending: true });
      }
    }
    out.push({ round: r, name: koRoundName(size, r), slots });
    prev = slots;
  }
  return out;
}

export function koCurrentRound(s) {
  const ko = Object.values(s.matches).filter((m) => m.stage === 'ko');
  const open = ko.filter((m) => !m.result).map((m) => m.round);
  if (open.length) return Math.min(...open);
  return ko.length ? Math.max(...ko.map((m) => m.round)) : 0;
}

export function champion(s) {
  if (!s.ko) return null;
  return s.matches[koMatchId(s.ko.rounds, 0)]?.result?.winner ?? null;
}

// ---------- the autopilot ----------

const byTable = (x, y) => (x.table ?? 9999) - (y.table ?? 9999);

// Matches being played right now.
export function currentMatches(s) {
  return Object.values(s.matches)
    .filter((m) => isActive(s, m))
    .sort(byTable);
}

export function progress(s) {
  const all = Object.values(s.matches);
  if (s.stage === 'groups') {
    const ms = all.filter((m) => m.stage === 'group');
    return { total: ms.length, done: ms.filter((m) => m.result).length };
  }
  if (s.stage === 'knockout') {
    const ko = all.filter((m) => m.stage === 'ko');
    const byes = ko.filter((m) => m.result?.bye).length;
    return { total: s.ko.size - 1 - byes, done: ko.filter((m) => m.result && !m.result.bye).length };
  }
  return { total: 0, done: 0 };
}

const prefixed = (matches) => Object.fromEntries(Object.entries(matches).map(([id, m]) => [`matches.${id}`, m]));

// Applies everything that can happen without a human decision:
//   1. results both players agree on become final
//   2. a group whose current round is finished moves to the next round
//   3. when every group is finished the knockout bracket is built (unless a tie needs the organiser)
//   4. knockout matches are created as soon as both feeders are finished
// Returns { patch, blocked }. `patch` is null when there is nothing to do.
export function autoStep(s, reports = []) {
  const byMatch = new Map();
  for (const r of reports) {
    if (!byMatch.has(r.m)) byMatch.set(r.m, []);
    byMatch.get(r.m).push(r);
  }
  let cur = s;
  let blocked = null;
  for (let guard = 0; guard < 300; guard++) {
    const before = cur;
    blocked = null;

    const finals = {};
    for (const m of Object.values(cur.matches)) {
      if (!isActive(cur, m)) continue;
      const st = reportStatus(m, byMatch.get(m.id) ?? []);
      if (st.status === 'confirmed') finals[`matches.${m.id}.result`] = { ...st.result, at: Date.now(), via: 'players' };
    }
    if (Object.keys(finals).length) cur = applyPatch(cur, finals);

    if (cur.stage === 'groups') {
      for (const gid of groupIds(cur)) {
        const r = cur.groups[gid].round;
        const all = Object.values(cur.matches).filter((m) => m.stage === 'group' && m.group === gid);
        const now = all.filter((m) => m.round === r);
        if (now.length && now.every((m) => m.result) && all.some((m) => m.round > r)) {
          cur = applyPatch(cur, { [`groups.${gid}.round`]: r + 1 });
        }
      }
      if (groupStageDone(cur)) {
        const ties = boundaryTies(cur);
        if (ties.length) blocked = { reason: 'ties', ties };
        else {
          const ko = buildKnockout(cur);
          if (ko) cur = applyPatch(cur, { stage: 'knockout', round: 1, ko: ko.meta, ...prefixed(ko.matches) });
        }
      }
    }

    if (cur.stage === 'knockout') cur = koGrow(cur);
    if (cur === before) break;
  }
  const patch = diffPatch(s, cur);
  return { patch: Object.keys(patch).length ? patch : null, blocked };
}

export function stageLabel(s) {
  if (s.stage === 'setup') return s.settings.registrationOpen ? 'ההרשמה פתוחה' : 'ההרשמה נסגרה';
  if (champion(s)) return 'הטורניר הסתיים';
  if (s.stage === 'groups') {
    const p = progress(s);
    return `שלב הבתים · ${p.done} מתוך ${p.total} משחקים`;
  }
  return `שלב ההדחה · ${koRoundName(s.ko.size, koCurrentRound(s))}`;
}

// What should this player see right now?
//   lobby     registered, the draw has not happened
//   play      go to `active.table` and play
//   wait      finished for now; `next` / `waitingFor` / `nextRound` say what comes next
//   out       finished the tournament (group rank or knockout round in `eliminatedAt`)
//   champion
export function playerFlow(s, pid) {
  const player = s.players[pid];
  if (!player) return null;
  const mine = Object.values(s.matches)
    .filter((m) => m.a === pid || m.b === pid)
    .sort((x, y) => (x.stage === y.stage ? x.round - y.round : x.stage === 'group' ? -1 : 1));
  const decided = mine.filter((m) => m.result && !m.result.bye);
  const flow = { player, group: player.group ?? null, matches: mine, last: decided.at(-1) ?? null, phase: 'lobby', active: null, next: null, waitingFor: [], rank: null, eliminatedAt: null, nextRound: null };
  if (s.stage === 'setup') return flow;
  if (champion(s) === pid) return { ...flow, phase: 'champion' };
  if (player.withdrawn) return { ...flow, phase: 'out', withdrawn: true };

  const gid = flow.group;
  const rank = () => groupStandings(s, gid).find((r) => r.id === pid)?.rank ?? null;

  if (s.stage === 'knockout') {
    const open = mine.find((m) => m.stage === 'ko' && !m.result);
    if (open) return { ...flow, phase: 'play', active: open };
    const ko = mine.filter((m) => m.stage === 'ko');
    const lost = ko.find((m) => m.result.winner !== pid);
    if (lost) return { ...flow, phase: 'out', eliminatedAt: koRoundName(s.ko.size, lost.round) };
    if (!ko.length) return { ...flow, phase: 'out', rank: rank(), notQualified: true };
    const lastKo = ko.at(-1);
    const sibling = s.matches[koMatchId(lastKo.round, lastKo.slot ^ 1)];
    return { ...flow, phase: 'wait', nextRound: koRoundName(s.ko.size, lastKo.round + 1), waitingFor: sibling && !sibling.result ? [sibling] : [] };
  }

  const g = s.groups[gid];
  const open = mine.find((m) => m.stage === 'group' && !m.result);
  const unresolved = Object.values(s.matches).filter((m) => m.stage === 'group' && m.group === gid && !m.result);
  if (open) {
    if (open.round === g.round) return { ...flow, phase: 'play', active: open };
    return { ...flow, phase: 'wait', next: open, waitingFor: unresolved.filter((m) => m.round === g.round) };
  }
  if (unresolved.length) return { ...flow, phase: 'wait', rank: rank(), groupDone: false, waitingFor: unresolved };
  const r = rank();
  const through = r <= s.settings.advance;
  const tied = boundaryTies(s).some((t) => t.group === gid && t.ids.includes(pid));
  return { ...flow, phase: through || tied ? 'wait' : 'out', rank: r, groupDone: true, through, tied };
}

// For rehearsals and tests: random results for every match being played.
export function simulateRoundPatch(s, rng = Math.random) {
  const patch = {};
  for (const m of currentMatches(s)) {
    const winner = rng() < 0.5 ? m.a : m.b;
    const mars = m.stage === 'group' && rng() < 0.2;
    patch[`matches.${m.id}.result`] = { ...winResult(winner, { mars }), at: Date.now() };
  }
  return patch;
}
