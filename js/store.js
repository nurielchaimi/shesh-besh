// Data layer. Two interchangeable backends with the same interface:
//   demo     - localStorage + BroadcastChannel (tabs in one browser stay in sync, no security)
//   firebase - Firestore. `tournaments/main` holds the tournament (only the organiser writes it),
//              `signups` holds registrations, `reports` holds the players' result reports.
//              Players sign in anonymously; the security rules tie each signup and report to that identity.
import { CONFIG } from '../config.js';
import { applyPatch, emptyState, reportId, DEL } from './engine.js';

const FIREBASE_VERSION = '10.14.1';
const PROFILE_FIELDS = ['name', 'study', 'level', 'bio'];
const pickProfile = (p) => ({
  name: String(p.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
  study: String(p.study ?? '').trim().slice(0, 40),
  level: String(p.level ?? ''),
  bio: String(p.bio ?? '').trim().slice(0, 90),
});

function localStore() {
  const K = { state: 'sheshbesh:state', signups: 'sheshbesh:signups', reports: 'sheshbesh:reports', device: 'sheshbesh:device' };
  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  let state = read(K.state, null) ?? emptyState();
  let signups = read(K.signups, {});
  let reports = read(K.reports, {});
  let device = read(K.device, null);
  if (!device) write(K.device, (device = `d${Math.random().toString(36).slice(2, 10)}`));

  const listeners = new Set();
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('sheshbesh') : null;
  const notify = () => listeners.forEach((fn) => fn());
  const reload = () => {
    state = read(K.state, null) ?? emptyState();
    signups = read(K.signups, {});
    reports = read(K.reports, {});
    notify();
  };
  const commit = () => {
    write(K.state, state);
    write(K.signups, signups);
    write(K.reports, reports);
    notify();
    channel?.postMessage('changed');
  };
  channel?.addEventListener('message', reload);
  addEventListener('storage', (e) => Object.values(K).includes(e.key) && reload());

  const watch = (fn, get) => {
    const run = () => fn(get());
    listeners.add(run);
    run();
    return () => listeners.delete(run);
  };
  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const list = (obj) => Object.values(obj);

  return {
    mode: 'demo',
    deviceId: device,
    subscribe: (fn) => watch((s) => fn(s, { online: true }), () => state),
    async patch(p) {
      state = applyPatch(state, p);
      commit();
    },
    async replace(s) {
      state = structuredClone(s);
      commit();
    },
    async ensure() {},
    auth: { required: false, onChange: (fn) => fn('demo'), login: async () => {}, logout: async () => {} },
    identity: async () => device,

    signups: {
      watchMine: (fn) => watch(fn, () => list(signups).find((x) => x.uid === device) ?? null),
      watchAll: (fn) => watch(fn, () => list(signups).sort((a, b) => a.createdAt - b.createdAt)),
      async listUnclaimed() {
        return list(signups).filter((x) => !x.uid);
      },
      async register(profile) {
        if (!state.settings.registrationOpen) throw new Error('ההרשמה סגורה');
        const data = pickProfile(profile);
        if (data.name.length < 2) throw new Error('צריך להזין שם');
        const id = newId();
        signups[id] = { id, ...data, uid: device, status: 'pending', createdAt: Date.now() };
        commit();
        return id;
      },
      async claim(id) {
        if (!signups[id]) throw new Error('שחקן לא נמצא');
        if (signups[id].uid && signups[id].uid !== device) throw new Error('השם הזה כבר תפוס, פנה למארגנים');
        signups[id].uid = device;
        commit();
      },
      async update(id, fields) {
        Object.assign(signups[id], pickProfile({ ...signups[id], ...fields }));
        commit();
      },
      async add(profile) {
        const data = pickProfile(profile);
        const id = newId();
        signups[id] = { id, ...data, uid: null, status: 'approved', createdAt: Date.now() };
        commit();
        return id;
      },
      async set(id, data) {
        signups[id] = { ...data, id };
        commit();
      },
      async setStatus(id, status) {
        if (signups[id]) signups[id].status = status;
        commit();
      },
      async remove(id) {
        delete signups[id];
        commit();
      },
      async release(id) {
        if (signups[id]) signups[id].uid = null;
        commit();
      },
    },

    reports: {
      watchMatch: (matchId, fn) => watch(fn, () => list(reports).filter((r) => r.m === matchId)),
      watchAll: (fn) => watch(fn, () => list(reports)),
      async submit({ m, p, winner, mars }) {
        reports[reportId(m, p)] = { id: reportId(m, p), m, p, winner, mars: !!mars, at: Date.now() };
        commit();
      },
      async retract(m, p) {
        delete reports[reportId(m, p)];
        commit();
      },
      async clearMatch(m) {
        for (const r of list(reports)) if (r.m === m) delete reports[r.id];
        commit();
      },
    },
  };
}

async function firebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = initializeApp(cfg.firebase);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  const stateRef = fs.doc(db, 'tournaments', cfg.docId || 'main');
  const col = (name) => fs.collection(db, name);
  const toFirestore = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === DEL ? fs.deleteField() : v]));
  const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let last = emptyState();

  // Players are signed in anonymously the first time they need an identity; the organiser logs in with email.
  const authReady = new Promise((resolve) => {
    const off = au.onAuthStateChanged(auth, () => {
      off();
      resolve();
    });
  });
  async function identity() {
    await authReady;
    return auth.currentUser?.uid ?? (await au.signInAnonymously(auth)).user.uid;
  }
  // Wait for the identity before starting a listener, but hand back a function that can stop it at once.
  const later = (start) => {
    let stop = null;
    let cancelled = false;
    start().then((fn) => (cancelled ? fn() : (stop = fn)));
    return () => {
      cancelled = true;
      stop?.();
    };
  };

  return {
    mode: 'firebase',
    subscribe(fn) {
      return fs.onSnapshot(
        stateRef,
        { includeMetadataChanges: true },
        (snap) => {
          if (snap.exists()) last = snap.data();
          fn(last, { online: !snap.metadata.fromCache });
        },
        () => fn(last, { online: false }),
      );
    },
    async patch(p) {
      try {
        await fs.updateDoc(stateRef, toFirestore(p));
      } catch (err) {
        if (err.code !== 'not-found') throw err;
        await fs.setDoc(stateRef, applyPatch(emptyState(), p));
      }
    },
    async replace(s) {
      await fs.setDoc(stateRef, s);
    },
    async ensure() {
      if (!(await fs.getDoc(stateRef)).exists()) await fs.setDoc(stateRef, emptyState());
    },
    auth: {
      required: true,
      onChange: (fn) => au.onAuthStateChanged(auth, (u) => fn(u?.email ?? null)),
      login: (email, password) => au.signInWithEmailAndPassword(auth, email, password),
      logout: () => au.signOut(auth),
    },
    identity,

    signups: {
      watchMine: (fn) =>
        later(async () => {
          const uid = await identity();
          return fs.onSnapshot(fs.query(col('signups'), fs.where('uid', '==', uid)), (snap) => fn(docs(snap)[0] ?? null));
        }),
      watchAll: (fn) => fs.onSnapshot(col('signups'), (snap) => fn(docs(snap).sort((a, b) => a.createdAt - b.createdAt))),
      async listUnclaimed() {
        return docs(await fs.getDocs(fs.query(col('signups'), fs.where('uid', '==', null))));
      },
      async register(profile) {
        const data = pickProfile(profile);
        if (data.name.length < 2) throw new Error('צריך להזין שם');
        const ref = fs.doc(col('signups'));
        await fs.setDoc(ref, { ...data, uid: await identity(), status: 'pending', createdAt: Date.now() });
        return ref.id;
      },
      async claim(id) {
        await fs.updateDoc(fs.doc(db, 'signups', id), { uid: await identity() });
      },
      async update(id, fields) {
        const data = pickProfile(fields);
        const keep = Object.fromEntries(PROFILE_FIELDS.filter((k) => k in fields).map((k) => [k, data[k]]));
        await fs.updateDoc(fs.doc(db, 'signups', id), keep);
      },
      async add(profile) {
        const ref = fs.doc(col('signups'));
        await fs.setDoc(ref, { ...pickProfile(profile), uid: null, status: 'approved', createdAt: Date.now() });
        return ref.id;
      },
      set: (id, data) => fs.setDoc(fs.doc(db, 'signups', id), data),
      setStatus: (id, status) => fs.updateDoc(fs.doc(db, 'signups', id), { status }),
      remove: (id) => fs.deleteDoc(fs.doc(db, 'signups', id)),
      release: (id) => fs.updateDoc(fs.doc(db, 'signups', id), { uid: null }),
    },

    reports: {
      watchMatch: (matchId, fn) => fs.onSnapshot(fs.query(col('reports'), fs.where('m', '==', matchId)), (snap) => fn(docs(snap))),
      watchAll: (fn) => fs.onSnapshot(col('reports'), (snap) => fn(docs(snap))),
      submit: ({ m, p, winner, mars }) => fs.setDoc(fs.doc(db, 'reports', reportId(m, p)), { m, p, winner, mars: !!mars, at: Date.now() }),
      retract: (m, p) => fs.deleteDoc(fs.doc(db, 'reports', reportId(m, p))),
      async clearMatch(m) {
        const snap = await fs.getDocs(fs.query(col('reports'), fs.where('m', '==', m)));
        await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)));
      },
    },
  };
}

export async function openStore() {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  return CONFIG.firebase?.apiKey && !forceDemo ? firebaseStore(CONFIG) : localStore();
}
