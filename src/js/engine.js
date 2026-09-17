/* Scheduling engine: estimates, day frames, task chunking, placement, forecasts, overlap. */
(function () {
  const E = {};
  let S = null;
  E.bind = (state) => { S = state; };

  const HORIZON = 14;
  const REAL_FREE_MIN = 20; // stretches shorter than this don't count as real free time

  E.today = () => U.todayKey();
  E.now = () => {
    const s = S.settings;
    if (s.clockMode === 'demo') return s.demoNow;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };

  // ---------- energy ----------
  E.energy = (m) => {
    const s = S.settings;
    if (s.focus.some((f) => m >= f.start && m < f.end)) return 'peak';
    if (m >= s.bed - 150 || m < s.wake + 60) return 'low';
    if (m >= 780 && m < 870) return 'low'; // after-lunch dip
    return 'mid';
  };
  E.energySplit = (a, b) => {
    const out = { peak: 0, mid: 0, low: 0 };
    for (let t = a; t < b; t += 5) out[E.energy(t)] += Math.min(5, b - t);
    return out;
  };
  E.energyBands = () => {
    const s = S.settings, bands = [];
    let cur = null;
    for (let t = s.wake; t < s.bed; t += 5) {
      const e = E.energy(t);
      if (!cur || cur.level !== e) { cur = { level: e, start: t, end: t + 5 }; bands.push(cur); } else cur.end = t + 5;
    }
    return bands;
  };

  // ---------- estimates that learn ----------
  E.factor = (category) => {
    const rows = S.history.filter((h) => h.category === category && h.estimate > 0);
    if (!rows.length) return { f: 1, n: 0 };
    const ratio = rows.reduce((a, r) => a + r.actual, 0) / rows.reduce((a, r) => a + r.estimate, 0);
    const w = Math.min(1, rows.length / 4);
    return { f: U.clamp(1 + (ratio - 1) * w, 0.6, 1.8), n: rows.length };
  };
  E.estimate = (t) => (t.manual ? t.base : U.round5(t.base * E.factor(t.category).f));
  E.remaining = (t) => Math.max(0, E.estimate(t) - t.spent);
  E.activeTasks = () => S.tasks.filter((t) => !t.done && !t.dropped);

  // ---------- fixed commitments ----------
  E.eventsOn = (k) => {
    const dw = U.dow(k);
    return S.events
      .filter((ev) => (ev.date ? ev.date === k : (ev.days || []).includes(dw) && (!ev.from || k >= ev.from) && (!ev.until || k <= ev.until)) && !(ev.skipDates || []).includes(k))
      .map((ev) => ({ ...ev }))
      .sort((a, b) => a.start - b.start);
  };

  E.fixedBlocks = (k) => {
    const s = S.settings;
    const evs = E.eventsOn(k);
    const blocks = [];
    const evIntervals = evs.map((e) => [e.start, e.end]);
    evs.forEach((ev) => {
      blocks.push({ type: 'event', key: 'ev:' + ev.id, title: ev.title, start: ev.start, end: ev.end, location: ev.location, kind: ev.kind, eventId: ev.id, source: ev.source });
    });
    const extras = [];
    evs.forEach((ev, i) => {
      const prev = evs[i - 1], next = evs[i + 1];
      if (ev.location && ev.travel > 0) {
        const cameFromSame = prev && prev.location === ev.location && ev.start - prev.end <= ev.travel + 30;
        if (!cameFromSame) extras.push({ type: 'travel', key: 'tr-in:' + ev.id, title: 'Travel to ' + ev.location, start: ev.start - ev.travel, end: ev.start });
        const goingToSame = next && next.location === ev.location && next.start - ev.end <= ev.travel + 30;
        if (!goingToSame) extras.push({ type: 'travel', key: 'tr-out:' + ev.id, title: 'Travel from ' + ev.location, start: ev.end, end: ev.end + ev.travel });
      }
      if (ev.kind !== 'meal' && s.buffer > 0) {
        const after = ev.end + (ev.location && ev.travel > 0 ? ev.travel : 0);
        extras.push({ type: 'buffer', key: 'buf:' + ev.id, title: 'Buffer', start: after, end: after + s.buffer });
      }
    });
    // Travel and buffers never overlap real events or each other.
    if (s.morning > 0) {
      blocks.push({ type: 'routine', key: 'morning', title: 'Wake up and get ready', start: s.wake, end: s.wake + s.morning });
      evIntervals.push([s.wake, s.wake + s.morning]);
    }
    let taken = evIntervals.slice();
    extras.sort((a, b) => (a.type === 'travel' ? 0 : 1) - (b.type === 'travel' ? 0 : 1) || a.start - b.start);
    extras.forEach((x) => {
      const pieces = U.subtract([[x.start, x.end]], taken);
      pieces.forEach(([a, b], j) => {
        if (b - a >= 3) blocks.push({ ...x, key: x.key + (j ? ':' + j : ''), start: a, end: b });
      });
      taken = taken.concat(pieces);
    });
    return blocks
      .map((b) => ({ ...b, start: Math.max(b.start, s.wake), end: Math.min(b.end, s.bed) }))
      .filter((b) => b.end > b.start)
      .sort((a, b) => a.start - b.start);
  };

  // ---------- choosing today's share of each task ----------
  function pickChunks(k, R) {
    const list = [];
    const tasks = E.activeTasks().slice().sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999')
      || ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]));
    for (const t of tasks) {
      const r = R[t.id] || 0;
      if (r < 5) continue;
      if (t.postponeUntil && k < t.postponeUntil) continue;
      if ((t.avoidDays || []).includes(k)) continue;
      let target;
      if (t.deadline) {
        let n = U.diffDays(k, t.deadline) + 1;
        if (n < 1) n = 1;
        target = n === 1 ? r : Math.ceil(r / n);
        target = Math.min(r, Math.max(target, Math.min(r, t.heavy ? 50 : 30)));
        target = Math.min(target, n === 1 ? 420 : 160);
        target = Math.min(r, Math.ceil(target / 5) * 5);
      } else {
        target = Math.min(r, 60);
      }
      const size = t.heavy ? 50 : 45;
      let left = target;
      while (left > 0) {
        let m = Math.min(size, left);
        if (left - m > 0 && left - m < 20) m = left; // don't leave a crumb
        list.push({ taskId: t.id, title: t.title, heavy: t.heavy, minutes: m, deadline: t.deadline, optional: t.optional });
        left -= m;
      }
    }
    return list;
  }

  function score(c, a, b, windStart) {
    const en = E.energySplit(a, b);
    const wd = U.overlap(a, b, windStart, S.settings.bed);
    if (c.heavy) return 3 * en.peak + en.mid - 2 * en.low - 0.01 * a;
    return 2 * en.low + en.mid - 1.5 * en.peak - 0.5 * wd - 0.01 * a;
  }

  function reserveFree(gaps, need, windStart) {
    if (need <= 0) return [];
    const pool = U.subtract(gaps, [[windStart, S.settings.bed]]).filter((g) => g[1] - g[0] >= 30).sort((a, b) => b[1] - a[1]);
    const out = [];
    for (const g of pool) {
      if (need <= 0) break;
      const take = Math.min(need, g[1] - g[0]);
      if (take < 30) continue;
      out.push([g[1] - take, g[1]]);
      need -= take;
    }
    return out;
  }

  const ACTIVE = new Set(['running', 'basketball', 'yoga']);
  function habitsFor(k, placedHabitsByDay) {
    const ws = U.weekStart(k);
    const dwIdx = (U.dow(k) + 6) % 7; // Mon = 0
    const daysLeft = 7 - dwIdx;
    return S.habits.filter((h) => {
      const done = h.doneDates.filter((x) => x >= ws && x < k).length;
      let planned = 0, lastPlanned = null;
      for (const [day, ids] of Object.entries(placedHabitsByDay)) {
        if (day >= ws && day < k && ids.includes(h.id)) { planned++; if (!lastPlanned || day > lastPlanned) lastPlanned = day; }
      }
      if (h.doneDates.includes(k)) return false;
      const rem = h.perWeek - done - planned;
      if (rem <= 0) return false;
      if (daysLeft - 1 < rem * 2) return true;
      return false;
    });
  }

  // Builds one day. `from` hides the past; `kept` are blocks that already happened.
  function buildDay(k, opts) {
    const s = S.settings;
    const from = opts.from ?? s.wake;
    const kept = opts.kept || [];
    const R = opts.R;
    const windStart = s.bed - 60;
    const fixed = E.fixedBlocks(k);
    const busy = fixed.concat(kept).map((b) => [b.start, b.end]);
    const gaps = U.subtract([[Math.max(s.wake, from), s.bed]], busy);

    const enjoyed = kept.filter((b) => b.type === 'free' || b.type === 'habit').reduce((a, b) => a + b.end - b.start, 0);
    const needFree = Math.max(0, s.minFree - enjoyed);
    const protectedIv = reserveFree(gaps, needFree, windStart);
    const protectedMin = protectedIv.reduce((a, g) => a + g[1] - g[0], 0);
    let open = U.subtract(gaps, protectedIv);

    const chunks = pickChunks(k, R).sort((a, b) =>
      (a.deadline || '9999').localeCompare(b.deadline || '9999') || (b.heavy - a.heavy));
    const blocks = [];
    for (const c of chunks) {
      if ((R[c.taskId] || 0) < 5) continue;
      let best = null;
      for (const [a, e] of open) {
        const lim = Math.min(e, windStart);
        const want = Math.min(c.minutes, R[c.taskId]);
        const len = lim - a;
        if (len < Math.min(want, 25)) continue;
        const m = want <= len ? want : Math.floor(len / 5) * 5;
        const cands = new Set([a, lim - m]);
        for (let t = a; t + m <= lim && cands.size < 60; t += 15) cands.add(t);
        s.focus.forEach((f) => { if (f.start >= a && f.start + m <= lim) cands.add(f.start); });
        for (const t of cands) {
          const sc = score(c, t, t + m, windStart) - (m < want ? 60 + (want - m) : 0);
          if (!best || sc > best.sc) best = { t, m, sc };
        }
      }
      if (!best) continue;
      const { t, m } = best;
      blocks.push({ type: 'task', key: 'task:' + c.taskId + ':' + t, taskId: c.taskId, title: c.title, heavy: c.heavy, optional: c.optional, start: t, end: t + m, status: 'planned' });
      R[c.taskId] -= m;
      open = U.subtract(open, [[t - s.breakLen, t + m + s.breakLen]]);
    }

    // Habits sit inside free time as optional blocks.
    const habitIds = [];
    const freeSpaces = () => {
      const taskIv = blocks.map((b) => [b.start, b.end]);
      return {
        open: U.subtract(gaps, protectedIv.concat(taskIv)),
        prot: protectedIv,
      };
    };
    const habitBlocks = [];
    for (const h of habitsFor(k, opts.placedHabitsByDay || {})) {
      const sp = freeSpaces();
      const taken = habitBlocks.map((b) => [b.start - 5, b.end + 5]);
      const pickFrom = (ivs) => {
        let best = null;
        for (const [a, e] of U.subtract(ivs, taken)) {
          if (e - a < h.minutes) continue;
          const lateLimit = ACTIVE.has(h.interest) ? Math.min(e, 1260) : e;
          const cands = [a, lateLimit - h.minutes, Math.max(a, 1020)];
          for (const t of cands) {
            if (t < a || t + h.minutes > e) continue;
            let sc = -Math.abs(t - 1110) / 10;
            if (ACTIVE.has(h.interest) && t + h.minutes > 1260) sc -= 100;
            if (U.overlap(t, t + h.minutes, windStart, s.bed) && ACTIVE.has(h.interest)) sc -= 100;
            if (!best || sc > best.sc) best = { t, sc };
          }
        }
        return best;
      };
      let best = pickFrom(U.subtract(sp.open, [[windStart, s.bed]]));
      let inProtected = false;
      if (!best) { best = pickFrom(sp.prot); inProtected = !!best; }
      if (!best) continue;
      habitBlocks.push({ type: 'habit', key: 'habit:' + h.id + ':' + k, habitId: h.id, title: h.title, interest: h.interest, start: best.t, end: best.t + h.minutes, status: 'planned', optional: true, inProtected });
      habitIds.push(h.id);
    }

    // Free, open and wind-down blocks from whatever is left.
    const occupied = blocks.concat(habitBlocks).map((b) => [b.start, b.end]);
    U.subtract(protectedIv, occupied).forEach(([a, b]) => {
      if (b - a >= 10) blocks.push({ type: 'free', key: 'free:' + a, title: 'Free time', start: a, end: b, protected: true });
    });
    const leftover = U.subtract(gaps, protectedIv.concat(occupied));
    leftover.forEach(([a, b]) => {
      const inWind = U.subtract([[a, b]], [[s.wake, windStart]]);
      const beforeWind = U.subtract([[a, b]], [[windStart, s.bed]]);
      beforeWind.forEach(([x, y]) => { if (y - x >= REAL_FREE_MIN) blocks.push({ type: 'open', key: 'open:' + x, title: 'Open', start: x, end: y }); });
      inWind.forEach(([x, y]) => { if (y - x >= 10) blocks.push({ type: 'winddown', key: 'wind:' + x, title: 'Wind down', start: x, end: y }); });
    });
    blocks.push(...habitBlocks);
    const all = fixed.concat(kept, blocks).sort((a, b) => a.start - b.start || (a.type === 'event' ? -1 : 1));

    // Label short gaps between work blocks as breaks.
    const withBreaks = [];
    all.forEach((b, i) => {
      withBreaks.push(b);
      const n = all[i + 1];
      if (b.type === 'task' && n && n.type === 'task' && n.start > b.end && n.start - b.end <= 2 * s.breakLen + 1) {
        withBreaks.push({ type: 'break', key: 'brk:' + b.end, title: 'Break', start: b.end, end: n.start });
      }
    });
    return { date: k, blocks: withBreaks, habitIds, protectedMin, needFree, floorMissed: protectedMin + 1 < needFree };
  }

  // ---------- today's plan, cached so "reflow" has something to rebuild ----------
  function taskPool(excludeTodayPlan) {
    const R = {};
    E.activeTasks().forEach((t) => { R[t.id] = E.remaining(t); });
    if (excludeTodayPlan) {
      excludeTodayPlan.blocks.forEach((b) => {
        if (b.type === 'task' && b.status !== 'done' && b.status !== 'skipped' && R[b.taskId] != null) R[b.taskId] -= b.end - b.start;
      });
    }
    return R;
  }

  E.ensureToday = () => {
    const T = E.today();
    if (S.plans[T]) return S.plans[T];
    const R = taskPool(null);
    const plan = buildDay(T, { from: S.settings.wake, R, placedHabitsByDay: {} });
    plan.generatedAt = S.settings.wake;
    S.plans = { [T]: plan };
    return plan;
  };

  // Rebuild the rest of today from `from` (defaults to now), keeping what already happened.
  E.replan = (opts = {}) => {
    const T = E.today();
    const old = E.ensureToday();
    const now = E.now();
    const running = old.blocks.find((b) => b.status === 'running');
    let from = Math.max(now, opts.from || 0, running ? running.end : 0);
    const kept = [];
    old.blocks.forEach((b) => {
      if (['event', 'travel', 'buffer', 'routine', 'open', 'break', 'winddown'].includes(b.type)) return;
      if (b === running) { kept.push(b); return; }
      if (b.type === 'task' && (b.status === 'done' || b.status === 'skipped')) { if (b.status === 'skipped') b.handled = true; kept.push(b); return; }
      if (b.end <= from) {
        if (b.type === 'task' && b.status === 'planned') {
          // Unmarked past blocks count as done.
          const t = S.tasks.find((x) => x.id === b.taskId);
          if (t) t.spent += b.end - b.start;
          kept.push({ ...b, status: 'done', assumed: true });
          return;
        }
        kept.push(b);
        return;
      }
      if ((b.type === 'free' || b.type === 'habit') && b.start < from) {
        if (b.type === 'free') kept.push({ ...b, end: from, key: b.key + ':kept' });
      }
    });
    // A skipped slot later today stays blocked (you said you can't do it then); past skips hide.
    const R = taskPool(null);
    kept.forEach((b) => { if (b.type === 'task' && b.status === 'running' && R[b.taskId] != null) R[b.taskId] -= b.end - b.start; });
    const placed = {};
    const busyKept = kept.filter((b) => b.status !== 'skipped' || b.end > from);
    const plan = buildDay(T, { from, kept: busyKept, R, placedHabitsByDay: placed });
    kept.filter((b) => b.status === 'skipped' && b.end <= from).forEach((b) => plan.blocks.push({ ...b, ghost: true }));
    plan.blocks.sort((a, b) => a.start - b.start);
    plan.generatedAt = from;
    const before = old.blocks.filter((b) => b.type === 'task' && b.start >= from).map((b) => b.key);
    const after = plan.blocks.filter((b) => b.type === 'task' && b.start >= from).map((b) => b.key);
    S.plans = { [T]: plan };
    return { plan, from, moved: after.filter((x) => !before.includes(x)).length, removed: before.filter((x) => !after.includes(x)).length };
  };

  // ---------- the full horizon ----------
  E.simulate = () => {
    const s = S.settings;
    const T = E.today();
    const todayPlan = E.ensureToday();
    const R = taskPool(todayPlan);
    const days = {};
    const order = [];
    const placedHabitsByDay = { [T]: todayPlan.habitIds || [] };
    days[T] = todayPlan;
    order.push(T);
    const shortfalls = [];
    const checkDeadlines = (k) => {
      E.activeTasks().forEach((t) => {
        if (t.deadline && t.deadline === k && R[t.id] >= 10 && !(t.postponeUntil && t.postponeUntil > k)) {
          shortfalls.push({ taskId: t.id, title: t.title, deadline: t.deadline, short: R[t.id] });
        }
      });
    };
    E.activeTasks().forEach((t) => {
      if (t.deadline && t.deadline < T && R[t.id] >= 10) shortfalls.push({ taskId: t.id, title: t.title, deadline: t.deadline, short: R[t.id], overdue: true });
    });
    // Work due today only falls short if it can't fit in the open time left today.
    const nowMin = E.now();
    const openLeft = todayPlan.blocks.filter((b) => b.type === 'open' && b.end > nowMin).reduce((a, b) => a + b.end - Math.max(b.start, nowMin), 0);
    E.activeTasks().forEach((t) => {
      if (t.deadline === T && R[t.id] >= 10 && R[t.id] > openLeft) shortfalls.push({ taskId: t.id, title: t.title, deadline: t.deadline, short: R[t.id] - openLeft });
    });
    for (let i = 1; i < HORIZON; i++) {
      const k = U.addDays(T, i);
      const plan = buildDay(k, { from: s.wake, R, placedHabitsByDay });
      placedHabitsByDay[k] = plan.habitIds;
      days[k] = plan;
      order.push(k);
      checkDeadlines(k);
    }
    const noDeadlineLeft = E.activeTasks().filter((t) => !t.deadline && R[t.id] >= 10).map((t) => ({ taskId: t.id, left: R[t.id] }));

    // Session labels across the horizon.
    const counts = {};
    order.forEach((k) => days[k].blocks.forEach((b) => { if (b.type === 'task' && !b.ghost) counts[b.taskId] = (counts[b.taskId] || 0) + 1; }));
    const seen = {};
    order.forEach((k) => days[k].blocks.forEach((b) => {
      if (b.type !== 'task' || b.ghost) return;
      seen[b.taskId] = (seen[b.taskId] || 0) + 1;
      b.part = seen[b.taskId]; b.parts = counts[b.taskId];
    }));

    const sim = { today: T, days, order, shortfalls, noDeadlineLeft };
    sim.stats = {};
    order.forEach((k) => { sim.stats[k] = E.dayStats(days[k], k === T ? E.now() : s.wake); });
    return sim;
  };

  E.dayStats = (plan, from) => {
    const st = { free: 0, protected: 0, open: 0, habit: 0, wind: 0, task: 0, heavy: 0, light: 0, event: 0, travel: 0, freeLeft: 0 };
    plan.blocks.forEach((b) => {
      if (b.ghost) return;
      const len = b.end - b.start;
      const after = Math.max(0, b.end - Math.max(b.start, from));
      if (b.type === 'free') { st.protected += len; st.free += len; st.freeLeft += after; }
      if (b.type === 'open') { st.open += len; st.free += len; if (after >= REAL_FREE_MIN) st.freeLeft += after; }
      if (b.type === 'habit') { st.habit += len; st.free += len; st.freeLeft += after; if (b.inProtected) st.protected += len; }
      if (b.type === 'winddown') { st.wind += len; st.free += len; st.freeLeft += after; }
      if (b.type === 'task') { st.task += len; if (b.heavy) st.heavy += len; else st.light += len; }
      if (b.type === 'event') st.event += len;
      if (b.type === 'travel' || b.type === 'buffer') st.travel += len;
    });
    return st;
  };

  // ---------- weekly forecast ----------
  E.forecast = (sim) => {
    const s = S.settings;
    const days = sim.order.slice(0, 7).map((k) => {
      const st = sim.stats[k];
      const dayFree = st.free - st.wind;
      const packed = dayFree < s.minFree + 30 || st.task >= 300 || sim.days[k].floorMissed;
      return { k, st, free: st.free, packed, floorMissed: sim.days[k].floorMissed };
    });
    const moves = [];
    days.forEach((d, i) => {
      if (!d.packed) return;
      const blocks = sim.days[d.k].blocks.filter((b) => b.type === 'task' && !b.ghost && b.status === 'planned' && b.start >= (i === 0 ? E.now() : 0));
      const byTask = {};
      blocks.forEach((b) => { byTask[b.taskId] = (byTask[b.taskId] || 0) + b.end - b.start; });
      let best = null;
      for (const [taskId, min] of Object.entries(byTask)) {
        const t = S.tasks.find((x) => x.id === taskId);
        if (!t) continue;
        const lastDay = t.deadline || sim.order[6];
        for (let j = i + 1; j < days.length; j++) {
          const L = days[j];
          if (L.k > lastDay || L.packed) continue;
          const gain = L.free - d.free;
          if (gain < 60) continue;
          const sc = gain + min + (t.deadline ? 0 : 60);
          if (!best || sc > best.sc) best = { sc, taskId, title: t.title, minutes: min, from: d.k, to: L.k, toFree: L.free };
        }
      }
      if (best) moves.push(best);
    });
    return { days, moves };
  };

  // ---------- overcommitment ----------
  E.overcommit = (sim) => {
    const list = sim.shortfalls;
    if (!list.length) return null;
    const total = list.reduce((a, x) => a + x.short, 0);
    const crunch = list.reduce((a, x) => (x.deadline > a ? x.deadline : a), list[0].deadline);
    const minutesBy = (taskId) => {
      let m = 0;
      for (const k of sim.order) {
        if (k > crunch) break;
        sim.days[k].blocks.forEach((b) => { if (b.type === 'task' && !b.ghost && b.taskId === taskId && b.status === 'planned') m += b.end - b.start; });
      }
      return m;
    };
    const recs = [];
    let freed = 0;
    const cands = E.activeTasks().filter((t) => !list.some((x) => x.taskId === t.id));
    const push = (t, action, why) => {
      const m = action === 'drop' ? Math.max(minutesBy(t.id), E.remaining(t)) : minutesBy(t.id);
      if (m < 10) return;
      recs.push({ taskId: t.id, title: t.title, action, minutes: m, why, until: U.addDays(crunch, 1) });
      freed += m;
    };
    cands.filter((t) => t.optional).forEach((t) => push(t, 'drop', 'marked optional'));
    cands.filter((t) => !t.optional && !t.deadline).forEach((t) => { if (freed < total) push(t, 'postpone', 'no deadline'); });
    cands.filter((t) => !t.optional && t.deadline && U.diffDays(crunch, t.deadline) >= 2)
      .sort((a, b) => b.deadline.localeCompare(a.deadline))
      .forEach((t) => { if (freed < total) push(t, 'postpone', 'due ' + U.fmtDate(t.deadline, 'short')); });
    const extension = list.slice().sort((a, b) => b.short - a.short)[0];
    return { total, crunch, list, recs, freed, extension };
  };

  // ---------- daily summary for the recap ----------
  E.snapshot = (sim) => {
    const s = S.settings;
    const plan = sim.days[sim.today];
    const now = E.now();
    const st = sim.stats[sim.today];
    const snap = {
      planned: { events: st.event, heavy: st.heavy, light: st.light, habit: st.habit, free: st.free, travel: st.travel },
      actual: { heavy: 0, light: 0, habit: 0 },
      protected: st.protected, floor: s.minFree, awake: s.bed - s.wake, blocks: 0, done: 0,
    };
    plan.blocks.forEach((b) => {
      if (b.type !== 'task' && b.type !== 'habit') return;
      const counts = b.status === 'done' || b.status === 'skipped' || b.end <= now;
      if (counts) snap.blocks++;
      if (b.status !== 'done') return;
      snap.done++;
      if (b.type === 'habit') snap.actual.habit += b.end - b.start;
      else snap.actual[b.heavy ? 'heavy' : 'light'] += b.actual || b.end - b.start;
    });
    return snap;
  };

  // ---------- activity suggestions ----------
  const IDEAS = {
    guitar: [{ t: 'Learn the intro to a song you like', min: 20 }, { t: 'Play one song start to finish, no stopping', min: 15, calm: true }],
    running: [{ t: 'Easy 3 km loop around campus', min: 30, active: true }, { t: 'Walk and stretch outside', min: 20, active: true }],
    cooking: [{ t: 'Make a real dinner for tomorrow’s lunch too', min: 50 }, { t: 'Try a 20-minute noodle recipe', min: 25 }],
    friends: [{ t: 'Text a friend and grab food', min: 60 }, { t: 'Call someone you haven’t talked to in a while', min: 20, calm: true }],
    drawing: [{ t: 'Sketch whatever is on your desk', min: 15, calm: true }, { t: 'Fill one sketchbook page', min: 40, calm: true }],
    podcasts: [{ t: 'Walk and listen to one episode', min: 35 }, { t: 'Lie down with an episode', min: 25, calm: true }],
    reading: [{ t: 'Read a chapter of something not for class', min: 25, calm: true }],
    basketball: [{ t: 'Shoot around at the park', min: 40, active: true }],
    gaming: [{ t: 'One match with friends online', min: 30 }],
    photography: [{ t: 'Photo walk: find five good shadows', min: 30, active: true }],
    baking: [{ t: 'Bake cookies from what’s in the pantry', min: 60 }],
    yoga: [{ t: '15-minute stretch routine', min: 15, calm: true }],
  };
  E.suggest = (start, end, n = 2) => {
    const len = end - start;
    const s = S.settings;
    const late = start >= s.bed - 90;
    const pool = [];
    (s.interests || []).forEach((i) => (IDEAS[i] || []).forEach((idea) => {
      if (idea.min > len) return;
      if (late && !idea.calm) return;
      if (idea.active && start >= 1230) return;
      pool.push({ ...idea, interest: i });
    }));
    if (!pool.length) pool.push({ t: 'Nothing planned. Rest counts.', min: Math.min(len, 20), interest: 'rest', calm: true });
    const seed = Math.floor(start / 15);
    const picked = [];
    for (let i = 0; i < pool.length && picked.length < n; i++) picked.push(pool[(seed + i * 3) % pool.length]);
    return picked.filter((x, i, a) => a.indexOf(x) === i);
  };

  window.E = E;
})();
