import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

function setup(n, settings = {}, seed = 1) {
  let s = E.emptyState();
  s.settings = { ...s.settings, ...settings };
  s = E.applyPatch(s, E.addPlayersPatch(s, E.demoNames(n)).patch);
  return E.applyPatch(s, E.drawGroups(s, E.seededRng(seed)));
}

// Applies the autopilot until it has nothing left to do.
function settle(s, reports = []) {
  for (let i = 0; i < 20; i++) {
    const step = E.autoStep(s, reports);
    if (!step.patch) return s;
    s = E.applyPatch(s, step.patch);
  }
  throw new Error('autopilot did not settle');
}

function checkInvariants(s) {
  const open = E.currentMatches(s);
  const tables = open.filter((m) => m.table != null).map((m) => m.table);
  assert.equal(new Set(tables).size, tables.length, 'two matches being played share a table');
  const seen = new Set();
  for (const m of open) {
    for (const id of [m.a, m.b]) {
      assert.ok(id == null || !seen.has(id), 'a player is in two matches at once');
      seen.add(id);
    }
  }
}

// Plays a whole tournament the way a real evening goes: matches finish in random order, both players
// report, the autopilot moves things along. `disputeEvery` makes some matches go through the organiser.
function playAll(s, rng, { disputeEvery = 0, hook } = {}) {
  const reports = [];
  let count = 0;
  for (let i = 0; i < 5000; i++) {
    checkInvariants(s);
    hook?.(s);
    const open = E.currentMatches(s);
    if (!open.length) {
      const step = E.autoStep(s, reports);
      if (step.blocked?.ties) {
        for (const t of step.blocked.ties) s = E.applyPatch(s, E.tiePatch(t.ids));
        continue;
      }
      if (step.patch) {
        s = E.applyPatch(s, step.patch);
        continue;
      }
      return s;
    }
    const m = open[Math.floor(rng() * open.length)];
    const winner = rng() < 0.5 ? m.a : m.b;
    const mars = m.stage === 'group' && rng() < 0.2;
    count++;
    if (disputeEvery && count % disputeEvery === 0) {
      reports.push({ m: m.id, p: m.a, winner: m.a, mars: false }, { m: m.id, p: m.b, winner: m.b, mars: false });
      assert.equal(E.reportStatus(m, reports).status, 'disputed');
      s = E.applyPatch(s, E.resultPatch(m.id, E.winResult(winner)));
    } else {
      reports.push({ m: m.id, p: m.a, winner, mars }, { m: m.id, p: m.b, winner, mars });
    }
    s = settle(s, reports);
  }
  throw new Error('tournament did not finish');
}

for (const n of [4, 5, 6, 7, 8, 9, 12, 16, 23, 31, 36, 50, 64, 80, 120, 200]) {
  test(`full rolling tournament with ${n} players`, () => {
    const s0 = setup(n, {}, n);
    const inGroups = Object.values(s0.groups).flatMap((g) => g.players);
    assert.equal(inGroups.length, n);
    assert.equal(new Set(inGroups).size, n);
    for (const g of Object.values(s0.groups)) {
      const pairs = Object.values(s0.matches)
        .filter((m) => m.group === g.id)
        .map((m) => [m.a, m.b].sort().join('|'));
      assert.equal(new Set(pairs).size, pairs.length);
      assert.equal(pairs.length, (g.players.length * (g.players.length - 1)) / 2);
    }
    const plan = E.planTournament(n, s0.settings);
    assert.ok(plan.koSize >= 2);

    let sawKoRound1 = false;
    const s = playAll(s0, E.seededRng(n), {
      disputeEvery: 7,
      hook(cur) {
        if (cur.stage === 'knockout' && !sawKoRound1) {
          sawKoRound1 = true;
          for (const m of Object.values(cur.matches).filter((x) => x.stage === 'ko' && x.round === 1)) {
            if (m.a && m.b && Object.keys(cur.groups).length > 1) {
              assert.notEqual(cur.players[m.a].group, cur.players[m.b].group, 'group-mates meet in round 1');
            }
          }
        }
      },
    });
    assert.equal(s.ko.size, plan.koSize);
    assert.ok(E.champion(s), 'there must be a champion');
    assert.equal(E.stageLabel(s), 'הטורניר הסתיים');
    assert.equal(E.progress(s).done, E.progress(s).total);
  });
}

test('automatic group size gives neat brackets', () => {
  const at = (n) => E.planTournament(n, E.DEFAULT_SETTINGS);
  assert.equal(at(64).groupSize, 4);
  assert.equal(at(64).byes, 0);
  assert.equal(at(80).groupSize, 5);
  assert.equal(at(80).koSize, 32);
  assert.equal(at(80).byes, 0);
  for (let n = 4; n <= 200; n++) {
    const p = at(n);
    assert.ok(p.koSize >= 2, `no bracket for ${n}`);
    assert.ok(p.sizes.every((x) => x >= 2), `group too small for ${n}`);
  }
});

test('mars win is worth 2 points, normal win 1, technical win 1', () => {
  let s = setup(4, { groupSize: 4 });
  const [a, b, c, d] = s.groups['1'].players;
  const set = (x, y, opts) => {
    const m = Object.values(s.matches).find((mm) => [mm.a, mm.b].includes(x) && [mm.a, mm.b].includes(y));
    s = E.applyPatch(s, { [`matches.${m.id}.result`]: E.winResult(x, opts) });
  };
  set(a, b, { mars: true });
  set(a, c, {});
  set(a, d, { mars: true, walkover: true });
  const row = E.groupStandings(s, '1').find((r) => r.id === a);
  assert.equal(row.points, 2 + 1 + 1);
  assert.equal(row.marsWins, 1);
  assert.equal(row.wins, 3);
});

test('head-to-head decides a two-way tie, and boundary ties are reported', () => {
  let s = setup(4, { groupSize: 4, advance: 1 });
  const [a, b, c, d] = s.groups['1'].players;
  const set = (x, y) => {
    const m = Object.values(s.matches).find((mm) => [mm.a, mm.b].includes(x) && [mm.a, mm.b].includes(y));
    s = E.applyPatch(s, { [`matches.${m.id}.result`]: E.winResult(x) });
  };
  set(b, a); set(a, c); set(a, d); set(b, c); set(b, d); set(c, d);
  const rows = E.groupStandings(s, '1');
  assert.equal(rows[0].id, b);
  assert.equal(rows[1].id, a);
  assert.deepEqual(E.boundaryTies(s), []);

  s = setup(4, { groupSize: 4, advance: 1 });
  const [w, x, y, z] = s.groups['1'].players;
  const set2 = (p, q) => {
    const m = Object.values(s.matches).find((mm) => [mm.a, mm.b].includes(p) && [mm.a, mm.b].includes(q));
    s = E.applyPatch(s, { [`matches.${m.id}.result`]: E.winResult(p) });
  };
  set2(w, x); set2(x, y); set2(y, w); set2(w, z); set2(x, z); set2(y, z);
  const ties = E.boundaryTies(s);
  assert.equal(ties.length, 1);
  assert.equal(ties[0].ids.length, 3);
  s = E.applyPatch(s, E.tiePatch([y, w, x]));
  assert.deepEqual(E.boundaryTies(s), []);
  assert.equal(E.groupStandings(s, '1')[0].id, y);
});

test('withdrawing a player gives opponents technical wins and the tournament still finishes', () => {
  let s = setup(16, {}, 7);
  const victim = Object.keys(s.players)[3];
  s = E.applyPatch(s, E.withdrawPatch(s, victim));
  const done = playAll(settle(s), E.seededRng(7));
  assert.ok(E.champion(done));
  assert.notEqual(E.champion(done), victim);
});

test('report statuses: open, pending, confirmed, disputed', () => {
  const s = setup(8, {}, 2);
  const m = E.currentMatches(s)[0];
  const rep = (p, winner, mars = false) => ({ m: m.id, p, winner, mars });
  assert.equal(E.reportStatus(m, []).status, 'open');
  const pending = E.reportStatus(m, [rep(m.a, m.a, true)]);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.by, m.a);
  assert.deepEqual(pending.claim, { winner: m.a, mars: true });
  assert.equal(E.reportStatus(m, [rep(m.a, m.a, true), rep(m.b, m.a, true)]).status, 'confirmed');
  assert.equal(E.reportStatus(m, [rep(m.a, m.a, true), rep(m.b, m.a, false)]).status, 'disputed');
  assert.equal(E.reportStatus(m, [rep(m.a, m.a), rep(m.b, m.b)]).status, 'disputed');
});

test('a report for a match that is not being played yet is ignored', () => {
  const s = setup(8, { groupSize: 4 }, 3);
  const later = Object.values(s.matches).find((m) => m.round === 2);
  const reports = [{ m: later.id, p: later.a, winner: later.a }, { m: later.id, p: later.b, winner: later.a }];
  assert.equal(E.autoStep(s, reports).patch, null);
});

test('each group moves to its next round on its own', () => {
  let s = setup(8, { groupSize: 4 }, 4);
  const r1 = Object.values(s.matches).filter((m) => m.group === '1' && m.round === 1);
  const reports = r1.flatMap((m) => [{ m: m.id, p: m.a, winner: m.a }, { m: m.id, p: m.b, winner: m.a }]);
  s = settle(s, reports);
  assert.equal(s.groups['1'].round, 2);
  assert.equal(s.groups['2'].round, 1);
});

test('player flow: play, wait for the group, play again', () => {
  let s = setup(8, { groupSize: 4 }, 5);
  const [m1, m2] = Object.values(s.matches).filter((m) => m.group === '1' && m.round === 1);
  assert.equal(E.playerFlow(s, m1.a).phase, 'play');
  assert.equal(E.playerFlow(s, m1.a).active.id, m1.id);

  s = settle(s, [{ m: m1.id, p: m1.a, winner: m1.a }, { m: m1.id, p: m1.b, winner: m1.a }]);
  const waiting = E.playerFlow(s, m1.a);
  assert.equal(waiting.phase, 'wait');
  assert.equal(waiting.next.round, 2);
  assert.deepEqual(waiting.waitingFor.map((m) => m.id), [m2.id]);
  assert.equal(waiting.last.id, m1.id);

  s = settle(s, [m1, m2].flatMap((m) => [{ m: m.id, p: m.a, winner: m.a }, { m: m.id, p: m.b, winner: m.a }]));
  const again = E.playerFlow(s, m1.a);
  assert.equal(again.phase, 'play');
  assert.equal(again.active.round, 2);
});

test('byes go to the top seeds', () => {
  const s0 = setup(50, { groupSize: 4 }, 3);
  const plan = E.planTournament(50, s0.settings);
  assert.equal(plan.byes, 6);
  let checked = false;
  const done = playAll(s0, E.seededRng(3), {
    hook(cur) {
      if (cur.stage === 'knockout' && !checked) {
        checked = true;
        const byes = Object.values(cur.matches).filter((m) => m.stage === 'ko' && m.result?.bye);
        assert.equal(byes.length, plan.byes);
        for (const m of byes) assert.ok(cur.ko.seeds[m.a] <= plan.byes, 'only the top seeds get byes');
      }
    },
  });
  assert.ok(E.champion(done));
});

test('only approved signups reach the draw', () => {
  const signups = [
    { id: 'a', name: 'א', status: 'approved' },
    { id: 'b', name: 'ב', status: 'pending' },
    { id: 'c', name: 'ג', status: 'rejected' },
    { id: 'd', name: 'ד' }, // from before approvals existed
  ];
  assert.deepEqual(E.approvedSignups(signups).map((x) => x.id), ['a', 'd']);
  assert.deepEqual(Object.keys(E.playersFromSignups(signups)), ['a', 'd']);
});

test('every match splits the colours and groups stay balanced', () => {
  const s = setup(24, { groupSize: 4 }, 9);
  const tally = {};
  for (const m of Object.values(s.matches)) {
    assert.ok([m.a, m.b].includes(m.c1));
    const other = m.c1 === m.a ? m.b : m.a;
    (tally[m.c1] ??= { c1: 0, c2: 0 }).c1++;
    (tally[other] ??= { c1: 0, c2: 0 }).c2++;
    assert.notEqual(E.colorOf(s, m, m.a).name, E.colorOf(s, m, m.b).name);
  }
  for (const t of Object.values(tally)) assert.ok(Math.abs(t.c1 - t.c2) <= 1, `unbalanced: ${t.c1} vs ${t.c2}`);
  const done = playAll(s, E.seededRng(9));
  for (const m of Object.values(done.matches).filter((x) => x.stage === 'ko' && x.a && x.b)) assert.ok([m.a, m.b].includes(m.c1));
});

test('diffPatch never emits overlapping paths', () => {
  const a = { x: { y: 1, z: { k: 1 } }, arr: [1], gone: 1 };
  const b = { x: { y: 2, z: { k: 1 }, w: { n: 1 } }, arr: [1, 2] };
  assert.deepEqual(E.diffPatch(a, b), { 'x.y': 2, 'x.w': { n: 1 }, arr: [1, 2], gone: E.DEL });
  assert.deepEqual(E.applyPatch(a, E.diffPatch(a, b)), b);
});
