/* App state: starts empty, with best-effort local persistence. */
(function () {
  const STORE_KEY = 'margin.state.v2';
  const OLD_KEYS = ['margin.state.v1'];

  function empty() {
    return {
      version: 2,
      settings: {
        wake: 420, bed: 1380,
        focus: [{ start: 540, end: 720 }, { start: 870, end: 1020 }],
        minFree: 120, buffer: 10, morning: 30, breakLen: 10, travelDefault: 15,
        interests: [],
        clockMode: 'real', demoNow: 780,
      },
      events: [],
      tasks: [],
      series: [], // repeating tasks: the rule lives here, occurrences are generated into tasks
      history: [],
      habits: [],
      ideas: [],
      plans: {},
      log: {}, // one summary per day you had Keepclear open, feeds the weekly recap
    };
  }

  // Fills in anything older saves are missing. Used for this browser's data and for data from an account.
  function normalize(saved) {
    if (!saved || saved.version !== 2) return empty();
    const base = empty();
    const T = U.todayKey();
    for (const key of Object.keys(base)) if (saved[key] == null) saved[key] = base[key];
    saved.settings = { ...base.settings, ...saved.settings };
    for (const k of Object.keys(saved.plans)) if (k !== T) delete saved.plans[k];
    delete saved.friends; // Friends feature removed until sign-in exists
    return saved;
  }

  function load() {
    OLD_KEYS.forEach((k) => U.store.del(k));
    return normalize(U.store.get(STORE_KEY));
  }

  window.Data = {
    empty, load, normalize,
    save(state) { U.store.set(STORE_KEY, state); },
    clear() { U.store.del(STORE_KEY); return empty(); },
    INTERESTS: ['guitar', 'running', 'cooking', 'friends', 'drawing', 'podcasts', 'reading', 'basketball', 'gaming', 'photography', 'baking', 'yoga'],
  };
})();
