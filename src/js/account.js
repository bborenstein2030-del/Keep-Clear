/* Accounts and cloud save through Supabase. Keepclear works fully without it:
   when no project is configured (or inside a Claude artifact) this stays off. */
(function () {
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
  const META_KEY = 'keepclear.sync.v1';
  const TABLE = 'user_data';
  const cfg = window.KEEPCLEAR_CONFIG || {};

  const A = {
    configured: !!(cfg.supabaseUrl && cfg.supabaseKey),
    inArtifact: !!(window.claude && typeof window.claude.use === 'function'),
    providers: Array.isArray(cfg.providers) ? cfg.providers : [],
    user: null,
    status: 'signed-out', // signed-out | loading | saving | saved | offline | error
    lastSavedAt: null,
    message: '',
  };
  A.available = A.configured && !A.inArtifact;

  let client = null, hooks = null, channel = null;
  let timer = null, retry = null, busy = false, changeSeq = 0, applying = false;
  let meta = U.store.get(META_KEY) || {};
  const saveMeta = () => U.store.set(META_KEY, meta);

  const listeners = [];
  A.onChange = (fn) => listeners.push(fn);
  const set = (patch) => { Object.assign(A, patch); listeners.forEach((fn) => { try { fn(A); } catch (e) { console.error(e); } }); };

  function loadLibrary() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('library'));
      document.head.appendChild(s);
    });
  }

  A.init = async (h) => {
    hooks = h;
    if (!A.available) return;
    set({ status: 'loading' });
    try {
      const lib = await loadLibrary();
      client = lib.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (e) {
      set({ status: 'error', message: 'Couldn’t load sign-in. Check your connection and reload the page.' });
      return;
    }
    // Supabase advises against awaiting other Supabase calls inside this callback.
    client.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuth(session), 0); });
    await client.auth.getSession(); // finishes a sign-in redirect if there is one
    const params = new URLSearchParams(location.search);
    if (params.has('code') || params.has('error')) {
      const err = params.get('error_description');
      history.replaceState(null, '', location.pathname + location.hash);
      if (err) set({ status: 'signed-out', message: err });
    }
    window.addEventListener('online', () => { if (A.user) (meta.dirty ? push() : pull()); });
    window.addEventListener('focus', () => { if (A.user && !meta.dirty) pull(); });
  };

  async function onAuth(session) {
    const user = session && session.user;
    if (!user) {
      stop();
      if (A.user) set({ user: null, status: 'signed-out', lastSavedAt: null });
      else if (A.status === 'loading') set({ status: 'signed-out' });
      return;
    }
    if (A.user && A.user.id === user.id) return;
    const provider = (user.app_metadata && user.app_metadata.provider) || 'email';
    A.user = { id: user.id, email: user.email || '', provider };
    await connect();
  }

  // First contact after sign-in: decide whether this browser or the account has the data to keep.
  async function connect() {
    set({ status: 'loading', message: '' });
    const uid = A.user.id;
    if (meta.userId !== uid) { meta = { userId: uid, version: null, dirty: false }; saveMeta(); }
    const { data: row, error } = await client.from(TABLE).select('data, version, updated_at').eq('user_id', uid).maybeSingle();
    if (error) return failed(error);
    const local = hooks.getState();
    if (!row) {
      meta.version = null;
      if (!hooks.isEmpty(local)) { meta.dirty = true; saveMeta(); await push(); } else set({ status: 'saved' });
    } else if (meta.version === row.version) {
      if (meta.dirty) await push(); else set({ status: 'saved', lastSavedAt: row.updated_at });
    } else if ((meta.version != null && !meta.dirty) || hooks.isEmpty(local)) {
      adopt(row);
    } else {
      const choice = await hooks.chooseSource(row.data, local);
      if (choice === 'account') { hooks.backup(local); adopt(row); } else { meta.version = row.version; meta.dirty = true; saveMeta(); await push(); }
    }
    listen();
  }

  function adopt(row, note) {
    applying = true;
    try { hooks.replaceState(row.data, note); } finally { applying = false; }
    meta.version = row.version; meta.dirty = false; saveMeta();
    set({ status: 'saved', lastSavedAt: row.updated_at, message: '' });
  }

  // Called by the app after every local save.
  A.changed = () => {
    if (!A.user || applying || !client) return;
    changeSeq++;
    meta.dirty = true; saveMeta();
    clearTimeout(timer);
    timer = setTimeout(push, 1200);
    if (A.status !== 'saving') set({ status: 'saving' });
  };

  async function push() {
    if (!client || !A.user) return;
    if (busy) { clearTimeout(timer); timer = setTimeout(push, 400); return; }
    busy = true; clearTimeout(timer); clearTimeout(retry);
    const seq = changeSeq;
    const uid = A.user.id;
    const now = new Date().toISOString();
    set({ status: 'saving' });
    try {
      let saved = null;
      if (meta.version == null) {
        const res = await client.from(TABLE).insert({ user_id: uid, data: hooks.getState(), version: 1, updated_at: now }).select('version, updated_at').single();
        if (res.error && res.error.code === '23505') { busy = false; return conflict(); } // another device created it first
        if (res.error) throw res.error;
        saved = res.data;
      } else {
        const res = await client.from(TABLE).update({ data: hooks.getState(), version: meta.version + 1, updated_at: now })
          .eq('user_id', uid).eq('version', meta.version).select('version, updated_at');
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) { busy = false; return conflict(); } // another device saved first
        saved = res.data[0];
      }
      meta.version = saved.version;
      meta.dirty = changeSeq !== seq;
      saveMeta();
      set({ status: meta.dirty ? 'saving' : 'saved', lastSavedAt: saved.updated_at, message: '' });
      busy = false;
      if (meta.dirty) push();
    } catch (e) {
      busy = false;
      failed(e);
    }
  }

  async function conflict() {
    const { data: row, error } = await client.from(TABLE).select('data, version, updated_at').eq('user_id', A.user.id).maybeSingle();
    if (error || !row) return failed(error || new Error('missing row'));
    const mine = JSON.parse(JSON.stringify(hooks.getState()));
    adopt(row);
    hooks.notify('Another device saved first, so this browser now shows those changes. Your last change here wasn’t saved.', {
      label: 'Keep mine', run: () => { meta.version = row.version; saveMeta(); hooks.replaceState(mine, null, true); },
    });
  }

  async function pull() {
    if (!client || !A.user || busy) return;
    const { data: row, error } = await client.from(TABLE).select('data, version, updated_at').eq('user_id', A.user.id).maybeSingle();
    if (error) return failed(error);
    if (row && row.version !== meta.version && !meta.dirty) adopt(row, 'Updated with changes from another device.');
  }

  function listen() {
    if (channel) client.removeChannel(channel);
    channel = client.channel('user-data-' + A.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + A.user.id }, (payload) => {
        const row = payload.new;
        if (!row || !row.version || row.version === meta.version || meta.dirty || busy) return;
        adopt(row, 'Updated with changes from another device.');
      })
      .subscribe();
  }

  function stop() {
    clearTimeout(timer); clearTimeout(retry);
    if (channel && client) client.removeChannel(channel);
    channel = null;
  }

  function failed(e) {
    const msg = String((e && (e.message || e.code)) || e || '');
    if (!navigator.onLine || /fetch|network|load failed/i.test(msg)) {
      set({ status: 'offline', message: '' });
      clearTimeout(retry);
      retry = setTimeout(() => { if (A.user) (meta.dirty ? push() : pull()); }, 30000);
      return;
    }
    let message = 'Couldn’t save to your account. Your changes are still in this browser.';
    if (e && (e.code === '42P01' || e.code === 'PGRST205')) message = 'The database table is missing. Run supabase/schema.sql in your Supabase project.';
    console.error('Keepclear sync:', e);
    set({ status: 'error', message });
  }

  // ---------- sign-in actions ----------
  const redirectTo = () => location.origin + location.pathname;
  A.signInWith = async (provider) => {
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    if (error) throw error;
  };
  A.sendLink = async (email) => {
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
    if (error) throw error;
  };
  A.signOut = async () => {
    if (meta.dirty) { try { await push(); } catch (e) { /* keep signing out */ } }
    stop();
    await client.auth.signOut();
    meta = {}; U.store.del(META_KEY);
    A.user = null;
    set({ status: 'signed-out', lastSavedAt: null, message: '' });
  };
  A.deleteAccount = async () => {
    const { error } = await client.rpc('delete_my_account');
    if (error) throw error;
    stop();
    meta = {}; U.store.del(META_KEY);
    await client.auth.signOut().catch(() => {});
    A.user = null;
    set({ status: 'signed-out', lastSavedAt: null, message: '' });
  };
  A.hasUnsaved = () => !!(A.user && meta.dirty);

  window.Account = A;
})();
