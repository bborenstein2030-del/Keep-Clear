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

  function load() {
    OLD_KEYS.forEach((k) => U.store.del(k));
    const saved = U.store.get(STORE_KEY);
    if (saved && saved.version === 2) {
      const T = U.todayKey();
      if (saved.plans) for (const k of Object.keys(saved.plans)) if (k !== T) delete saved.plans[k];
      saved.log = saved.log || {};
      saved.series = saved.series || [];
      delete saved.friends; // Friends feature removed until sign-in exists
      return saved;
    }
    return empty();
  }

  window.Data = {
    empty, load,
    save(state) { U.store.set(STORE_KEY, state); },
    clear() { U.store.del(STORE_KEY); return empty(); },
    INTERESTS: ['guitar', 'running', 'cooking', 'friends', 'drawing', 'podcasts', 'reading', 'basketball', 'gaming', 'photography', 'baking', 'yoga'],
  };
})();
