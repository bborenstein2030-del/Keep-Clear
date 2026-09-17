/* Language understanding: Claude when the page can reach it, a built-in parser otherwise. */
(function () {
  const AI = { sample: null, mode: 'local', images: false, listeners: [] };

  AI.onChange = (fn) => AI.listeners.push(fn);
  const changed = () => AI.listeners.forEach((fn) => fn(AI.mode));

  (async () => {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      const sample = await window.claude.use('sample');
      if (!sample) return;
      AI.sample = sample;
      AI.mode = 'claude';
      try { const lim = await sample.limits(); AI.images = !!(lim && lim.images); } catch (e) { AI.images = false; }
      changed();
    } catch (e) { /* stay local */ }
  })();

  const HIDE = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
  async function askJson(prompt, opts = {}) {
    if (!AI.sample) return null;
    try {
      return await AI.sample.json(prompt, opts);
    } catch (e) {
      if (e && HIDE.has(e.code)) { AI.sample = null; AI.mode = 'local'; changed(); }
      if (e && e.code === 'images_unavailable') AI.images = false;
      return null;
    }
  }

  // ---------- shared vocabulary ----------
  const DAY_RX = {
    0: /\bsun(?:day)?s?\b|\bsu\b/, 1: /\bmon(?:day)?s?\b|\bm\b/, 2: /\btue(?:s|sday)?s?\b|\btu\b/, 3: /\bwed(?:nesday)?s?\b|\bw\b/,
    4: /\bthu(?:r|rs|rsday)?s?\b|\bth\b/, 5: /\bfri(?:day)?s?\b|\bf\b/, 6: /\bsat(?:urday)?s?\b|\bsa\b/,
  };
  const DAY_WORD = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?s?\b/g;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function nextDow(today, dw, allowToday = true) {
    for (let i = allowToday ? 0 : 1; i < 8; i++) { const k = U.addDays(today, i); if (U.dow(k) === dw) return k; }
    return today;
  }

  function findDate(lower, today) {
    let m;
    if (/\btoday|tonight|this evening\b/.test(lower)) return { date: today, rx: /\b(today|tonight|this evening)\b/ };
    if (/\btomorrow\b/.test(lower)) return { date: U.addDays(today, 1), rx: /\btomorrow\b/ };
    m = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) {
      const mi = MONTHS.indexOf(m[1].slice(0, 3));
      const y = U.parseKey(today).getFullYear();
      let k = U.key(new Date(y, mi, Number(m[2])));
      if (U.diffDays(today, k) < -60) k = U.key(new Date(y + 1, mi, Number(m[2])));
      return { date: k, rx: new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) };
    }
    m = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (m && Number(m[1]) <= 12) {
      const y = U.parseKey(today).getFullYear();
      return { date: U.key(new Date(y, Number(m[1]) - 1, Number(m[2]))), rx: new RegExp(m[0].replace('/', '\\/')) };
    }
    return null;
  }

  function findDays(lower) {
    if (/\b(every ?day|daily)\b/.test(lower)) return { days: [0, 1, 2, 3, 4, 5, 6], recurring: true };
    if (/\bweekdays?\b/.test(lower)) return { days: [1, 2, 3, 4, 5], recurring: true };
    if (/\bweekends?\b/.test(lower)) return { days: [0, 6], recurring: true };
    const compact = lower.match(/\b(mwf|tth|tr|mw|wf)\b/);
    if (compact) {
      const map = { mwf: [1, 3, 5], tth: [2, 4], tr: [2, 4], mw: [1, 3], wf: [3, 5] };
      return { days: map[compact[1]], recurring: true };
    }
    const words = lower.match(DAY_WORD) || [];
    const slashy = lower.match(/\b(?:m|tu|w|th|f|sa|su)(?:\/(?:m|tu|w|th|f|sa|su))+\b/);
    const set = new Set();
    words.forEach((w) => { for (const [d, rx] of Object.entries(DAY_RX)) if (rx.test(w)) set.add(Number(d)); });
    if (slashy) slashy[0].split('/').forEach((w) => { for (const [d, rx] of Object.entries(DAY_RX)) if (rx.test(w)) set.add(Number(d)); });
    if (!set.size) return null;
    const plural = words.some((w) => /s$/.test(w) && !/tues$|thurs$/.test(w));
    return { days: [...set].sort(), recurring: set.size > 1 || plural || /\b(every|each|weekly)\b/.test(lower) };
  }

  function toMin(h, mm, ap, fallbackAp) {
    h = Number(h); mm = Number(mm || 0);
    ap = ap ? ap[0] : fallbackAp;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return h * 60 + mm;
  }
  const guessAp = (h) => (Number(h) <= 6 || Number(h) === 12 ? 'p' : 'a');

  function findTime(lower) {
    let m = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?\b/);
    if (m) {
      const endAp = m[6] ? m[6][0] : guessAp(m[4]);
      let startAp = m[3] ? m[3][0] : endAp;
      if (!m[3] && endAp === 'p' && Number(m[1]) > Number(m[4]) && Number(m[1]) !== 12) startAp = 'a';
      let start = toMin(m[1], m[2], startAp && startAp + 'm', startAp);
      let end = toMin(m[4], m[5], endAp + 'm', endAp);
      if (end <= start) end += 720;
      if (end > 1439) end = 1439;
      return { start, end, rx: m[0] };
    }
    m = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) || lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
    const noon = lower.match(/\b(?:at\s+)?(noon|midnight)\b/);
    let start = null, rx = null;
    if (m) { start = toMin(m[1], m[2], m[3], m[3] ? null : guessAp(m[1])); rx = m[0]; }
    else if (noon) { start = noon[1] === 'noon' ? 720 : 1439; rx = noon[0]; }
    if (start == null) return null;
    let dur = 60;
    const d = lower.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/);
    if (d) dur = /^h/.test(d[2]) ? Number(d[1]) * 60 : Number(d[1]);
    return { start, end: Math.min(1439, start + dur), rx, durRx: d && d[0] };
  }

  function clean(title) {
    return title
      .replace(/\s+/g, ' ')
      .replace(/,\s*(,\s*)+/g, ', ')
      .replace(/^[\s,.;:\-–]+|[\s,.;:\-–]+$/g, '')
      .replace(/\b(every|each|on|from|at|this|next|weekly|and|&)\s*$/i, '')
      .replace(/^(i have|i've got|there's|got|have)\s+/i, '')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  // ---------- events from a sentence ----------
  AI.parseEventLocal = (text, today) => {
    text = text.replace(/\bw\/\s*/gi, 'with ');
    const lower = ' ' + text.toLowerCase() + ' ';
    let rest = lower;
    const time = findTime(lower);
    if (time) { rest = rest.replace(time.rx, ' '); if (time.durRx) rest = rest.replace(time.durRx, ' '); }
    const date = findDate(rest, today);
    if (date) rest = rest.replace(date.rx, ' ');
    const days = date ? null : findDays(rest);
    if (days) {
      rest = rest.replace(/\b(every ?day|daily|weekdays?|weekends?|mwf|tth|mw|wf)\b/g, ' ').replace(DAY_WORD, ' ')
        .replace(/\b(?:m|tu|w|th|f|sa|su)(?:\/(?:m|tu|w|th|f|sa|su))+\b/g, ' ').replace(/\s*\/\s*/g, ' ');
    }
    let location = '';
    const loc = rest.match(/(?:\s@\s*|\s(?:at|in)\s+(?:the\s+)?)([a-z][\w'’.\- ]{2,40}?)(?=\s*(?:,|$|\bfrom\b|\bon\b|\bevery\b))/);
    if (loc && !/^(noon|night|home)$/.test(loc[1].trim())) { location = loc[1].trim(); rest = rest.replace(loc[0], ' '); }
    if (!time) return null;
    const raw = text.slice(0);
    const title = clean(restoreCase(rest, raw).replace(/\b(every|each|weekly)\b/gi, ''));
    const ev = { title: title || 'New event', start: time.start, end: time.end, location: titleCase(location), travel: location ? S().settings.travelDefault : 0 };
    if (date) ev.date = date.date;
    else if (days && days.recurring) ev.days = days.days;
    else if (days) ev.date = nextDow(today, days.days[0]);
    else ev.date = today;
    return ev;
  };

  function restoreCase(lowerFragment, original) {
    // Keep the person's capitalization for words that survived parsing.
    const words = original.split(/\s+/);
    return lowerFragment.split(/\s+/).map((w) => words.find((o) => o.toLowerCase() === w) || w).join(' ');
  }
  const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const S = () => window.App.state;

  // ---------- repeat rules: "every day", "every Mon/Wed", "mondays", "monthly" ----------
  function findRepeat(lower, today) {
    let m = lower.match(/\b(every ?day|each day|daily)\b/);
    if (m) return { rule: { freq: 'daily' }, rx: m[0] };
    m = lower.match(/\b(every weekday|each weekday|weekdays|on weekdays)\b/);
    if (m) return { rule: { freq: 'weekdays' }, rx: m[0] };
    m = lower.match(/\b(every|each) month\b|\bmonthly\b/);
    if (m) return { rule: { freq: 'monthly', dayOfMonth: U.parseKey(today).getDate() }, rx: m[0] };
    const dayList = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*';
    m = lower.match(new RegExp('\\b(?:every|each)\\s+(' + dayList + '(?:\\s*(?:,|/|&|and)\\s*' + dayList + ')*)'));
    if (m) { const d = findDays(m[1]); if (d) return { rule: { freq: 'weekly', days: d.days }, rx: m[0] }; }
    m = lower.match(/\b(?:on\s+)?(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/);
    if (m) { const d = findDays(m[1]); if (d) return { rule: { freq: 'weekly', days: d.days }, rx: m[0] }; }
    m = lower.match(/\b(every|each) week\b|\bweekly\b/);
    if (m) return { rule: { freq: 'weekly', days: [U.dow(today)] }, rx: m[0] };
    return null;
  }
  AI.findRepeat = findRepeat;

  // ---------- live reading for quick add: what it understood, and where ----------
  AI.inspect = (raw, today, force) => {
    const lower = raw.toLowerCase();
    const ranges = [];
    const mark = (str) => {
      const t = (str || '').trim();
      if (!t) return;
      const i = lower.indexOf(t);
      if (i >= 0) ranges.push([i, i + t.length]);
    };
    const time = findTime(lower);
    const kind = force || (time ? 'event' : 'task');
    const out = { kind, ranges, event: null, task: null };
    if (kind === 'event') {
      if (time) { mark(time.rx); if (time.durRx) mark(time.durRx); }
      const date = findDate(lower, today);
      if (date) { const m = lower.match(date.rx); if (m) mark(m[0]); }
      else {
        (lower.match(/\b(every ?day|daily|weekdays?|weekends?|mwf|tth|mw|wf)\b/g) || []).forEach(mark);
        (lower.match(DAY_WORD) || []).forEach(mark);
        const sl = lower.match(/\b(?:m|tu|w|th|f|sa|su)(?:\/(?:m|tu|w|th|f|sa|su))+\b/);
        if (sl) mark(sl[0]);
      }
      const ev = time ? AI.parseEventLocal(raw, today) : null;
      if (ev && ev.location) mark(ev.location.toLowerCase());
      out.event = ev;
    } else {
      let deadline = null;
      const repeat = findRepeat(lower, today);
      const dl = repeat ? null : deadlineIn(lower, today);
      if (repeat) mark(repeat.rx);
      else if (dl) { mark(dl.rx); deadline = dl.date; }
      else {
        const d = findDate(lower, today);
        if (d) { const m = lower.match(d.rx); if (m) mark(m[0]); deadline = d.date; }
        else {
          const w = (lower.match(DAY_WORD) || [])[0];
          const ds = w && findDays(w);
          if (ds) { mark(w); deadline = nextDow(today, ds.days[0]); }
        }
      }
      let title = raw;
      ranges.slice().sort((a, b) => b[0] - a[0]).forEach(([a, b]) => { title = title.slice(0, a) + ' ' + title.slice(b); });
      title = clean(title.replace(PREFIX_RX, '').replace(/\b(by|due|on|before)\s*$/i, ''));
      const est = AI.estimateLocal(title || raw);
      out.task = { title, deadline, repeat: repeat ? repeat.rule : null, minutes: est.minutes, category: est.category, heavy: est.heavy };
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    ranges.forEach((r) => { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); });
    out.ranges = merged;
    return out;
  };

  // ---------- estimates ----------
  const RULES = [
    [/^(email|e-mail|text|call|message|reply to|rsvp|sign up|register|pay)\b/, 'admin', 10, false],
    [/^(buy|return|pick up|drop off|mail|get)\b/, 'errand', 25, false],
    [/\b(outline|brainstorm)\b/, 'writing', 45, true],
    [/\b(essay|paper|statement|write-?up|report|draft|thesis)\b/, 'writing', 180, true],
    [/\b(application|apply|scholarship|resume|résumé|cover letter)\b/, 'writing', 120, true],
    [/\b(problem set|pset|homework|hw|worksheet|exercises)\b/, 'problem-set', 90, true],
    [/\b(midterm|final exam|finals)\b/, 'studying', 180, true],
    [/\b(study|review|quiz|exam|test|flashcards)\b/, 'studying', 100, true],
    [/\b(project|slides|presentation|poster|prototype)\b/, 'project', 120, true],
    [/\b(read|chapter|ch\.|pages|article)\b/, 'reading', 60, false],
    [/\b(email|e-mail|text|call|message|reply|rsvp|sign up|register|pay|book|schedule|remind)\b/, 'admin', 10, false],
    [/\b(laundry|clean|dishes|groceries|tidy|organize|pack|vacuum)\b/, 'chore', 45, false],
    [/\b(return|pick up|drop off|buy|store|mail|post office|pharmacy)\b/, 'errand', 25, false],
    [/\b(practice|rehearse|lesson)\b/, 'practice', 45, false],
    [/\b(watch|lecture|video|recording)\b/, 'studying', 60, false],
  ];
  AI.estimateLocal = (title) => {
    const lower = title.toLowerCase();
    for (const [rx, category, minutes, heavy] of RULES) {
      if (rx.test(lower)) {
        let m = minutes;
        const words = lower.match(/(\d[\d,]*)\s*words?/);
        if (words && category === 'writing') m = Math.max(60, Math.round(Number(words[1].replace(/,/g, '')) / 7));
        const pages = lower.match(/(\d+)\s*pages?/);
        if (pages && category === 'reading') m = Math.max(15, Number(pages[1]) * 2.5);
        return { minutes: U.round5(m), category, heavy };
      }
    }
    return { minutes: 30, category: 'other', heavy: false };
  };

  AI.estimate = async (title) => {
    const local = AI.estimateLocal(title);
    const res = await askJson(
      'Estimate how long a student needs for this to-do, working alone and focused. ' +
      'Reply with only JSON like {"minutes": 90, "category": "writing", "heavy": true}. ' +
      'category is one of writing, problem-set, studying, project, reading, admin, chore, errand, practice, other. ' +
      'heavy is true when it needs real concentration.\n\nTo-do: ' + title,
      { modelTier: 'quick' },
    );
    if (res && Number(res.minutes) > 0) {
      return { minutes: U.round5(Number(res.minutes)), category: RULES.some((r) => r[1] === res.category) || res.category === 'other' ? res.category : local.category, heavy: !!res.heavy, by: 'claude' };
    }
    return { ...local, by: 'local' };
  };

  // ---------- natural-language events ----------
  const EVENT_SHAPE = '{"title": string, "days": ["Tue","Thu"] or [], "date": "YYYY-MM-DD" or null, "start": "HH:MM" (24h), "end": "HH:MM" (24h), "location": string or ""}';
  function normEvent(e, today) {
    if (!e || !e.title || !e.start) return null;
    const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const days = (e.days || []).map((d) => names.indexOf(String(d).slice(0, 3).toLowerCase())).filter((d) => d >= 0);
    const start = U.fromInput(e.start);
    let end = e.end ? U.fromInput(e.end) : start + 60;
    if (end <= start) end = start + 60;
    const ev = { title: String(e.title), start, end: Math.min(end, 1439), location: e.location || '', travel: e.location ? S().settings.travelDefault : 0 };
    if (days.length) ev.days = days; else ev.date = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : today;
    return ev;
  }
  const todayLine = (today) => 'Today is ' + U.fmtDate(today, 'long') + ', ' + today.slice(0, 4) + ' (' + today + ').';

  AI.parseEvents = async (text, today) => {
    const res = await askJson(
      todayLine(today) + ' Turn this calendar note into events. A weekday list means it repeats weekly; a single date means one time. ' +
      'Times like "4–6" for after-school activities are PM. Reply with only JSON: {"events": [' + EVENT_SHAPE + ']}.\n\nNote: ' + text,
      { modelTier: 'quick' },
    );
    if (res && Array.isArray(res.events)) {
      const evs = res.events.map((e) => normEvent(e, today)).filter(Boolean);
      if (evs.length) return { events: evs, by: 'claude' };
    }
    const lines = text.split(/\n|;/).map((l) => l.trim()).filter(Boolean);
    const evs = lines.map((l) => AI.parseEventLocal(l, today)).filter(Boolean);
    return { events: evs, by: 'local' };
  };

  // ---------- brain dump ----------
  const IDEA_RX = /^(idea:?|maybe|someday|what if|could\b|would be (cool|nice|fun)|i want to (start|learn|try|get into)|look into|thinking about|it'?d be)|\bsomeday\b|\bone day\b/i;
  const PREFIX_RX = /^(i\s+)?(really\s+)?(need to|have to|gotta|got to|should|must|remember to|don'?t forget to|to do:?|todo:?)\s+/i;
  function deadlineIn(lower, today) {
    const m = lower.match(/\b(?:by|due|before|until)\s+(today|tonight|tomorrow|(?:this |next )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}|end of (?:the )?week|the weekend)\b/)
      || lower.match(/\b(today|tonight|tomorrow|this weekend)\s*$/);
    if (!m) return null;
    const w = m[1];
    let date = null;
    if (/today|tonight/.test(w)) date = today;
    else if (/tomorrow/.test(w)) date = U.addDays(today, 1);
    else if (/end of (the )?week/.test(w)) date = nextDow(today, 5);
    else if (/weekend/.test(w)) date = nextDow(today, 0);
    else {
      const f = findDate(w, today);
      if (f) date = f.date;
      else { const d = findDays(w); if (d) date = nextDow(today, d.days[0], !/next/.test(w)); }
    }
    return date ? { date, rx: m[0] } : null;
  }

  AI.sortDumpLocal = (text, today) => {
    const parts = text.split(/\n+|;\s*|(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim().replace(/^[-*•\d.)\s]+/, '')).filter((x) => x.length > 2);
    const out = { tasks: [], events: [], ideas: [] };
    for (const p of parts) {
      const lower = p.toLowerCase();
      if (IDEA_RX.test(lower)) { out.ideas.push(p.replace(/^idea:?\s*/i, '').replace(/^./, (c) => c.toUpperCase())); continue; }
      const hasTime = findTime(lower);
      const hasDays = findDays(lower);
      if (hasTime && !/\b(by|due|before)\b/.test(lower)) {
        const ev = AI.parseEventLocal(p, today);
        if (ev) { out.events.push(ev); continue; }
      }
      const dl = deadlineIn(lower, today);
      let title = p;
      if (dl) title = title.replace(new RegExp(dl.rx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
      title = clean(title.replace(PREFIX_RX, '').replace(/[.!]+$/, ''));
      if (!title) continue;
      const est = AI.estimateLocal(title);
      out.tasks.push({ title, deadline: dl ? dl.date : (hasDays && !hasTime ? nextDow(today, hasDays.days[0]) : null), minutes: est.minutes, category: est.category, heavy: est.heavy });
    }
    return out;
  };

  AI.sortDump = async (text, today) => {
    const res = await askJson(
      todayLine(today) + ' A student typed everything on their mind. Sort it. ' +
      'Tasks are things to do (with a due date if one is implied). Events happen at a set time. Ideas are someday thoughts, not commitments. ' +
      'Estimate minutes for each task. Use short, clear titles in the student\'s words. Reply with only JSON: ' +
      '{"tasks": [{"title": string, "deadline": "YYYY-MM-DD" or null, "minutes": number, "category": "writing|problem-set|studying|project|reading|admin|chore|errand|practice|other", "heavy": boolean}], ' +
      '"events": [' + EVENT_SHAPE + '], "ideas": [string]}\n\nBrain dump:\n' + text,
      {},
    );
    if (res && (res.tasks || res.events || res.ideas)) {
      return {
        by: 'claude',
        tasks: (res.tasks || []).filter((t) => t && t.title).map((t) => ({ title: String(t.title), deadline: /^\d{4}-\d{2}-\d{2}$/.test(t.deadline || '') ? t.deadline : null, minutes: U.round5(Number(t.minutes) || 30), category: t.category || 'other', heavy: !!t.heavy })),
        events: (res.events || []).map((e) => normEvent(e, today)).filter(Boolean),
        ideas: (res.ideas || []).map(String),
      };
    }
    return { by: 'local', ...AI.sortDumpLocal(text, today) };
  };

  // ---------- syllabus and flyer extraction ----------
  AI.extractFromText = (text, today) => {
    const items = [];
    text.split(/\n/).forEach((line) => {
      const lower = line.toLowerCase();
      const date = findDate(lower, today);
      if (!date) return;
      let rest = line.replace(new RegExp(date.rx.source, 'i'), ' ');
      const time = findTime(lower);
      if (time) rest = rest.replace(new RegExp(time.rx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
      const title = clean(rest.replace(/[·|]/g, ' ').replace(/,\s*$/, ''));
      if (!title) return;
      const isDeadline = /\b(due|submit|turn in|report|essay|paper|assignment|problem set|homework)\b/i.test(title);
      items.push(isDeadline
        ? { kind: 'deadline', title: title.replace(/\s*\bdue\b\s*/i, ' ').trim(), date: date.date }
        : { kind: 'event', title, date: date.date, start: time ? time.start : null, end: time ? time.end : null });
    });
    return items;
  };

  AI.extractFromImages = async (blobs, hint, today) => {
    if (!AI.sample || !AI.images) return null;
    const res = await askJson(
      todayLine(today) + ' These images are a ' + hint + ' a student uploaded. Find every dated item: exams, quizzes, due dates, events. ' +
      'If a year is missing, use the next upcoming date. Reply with only JSON: {"items": [{"kind": "event" or "deadline", "title": string, "date": "YYYY-MM-DD", "start": "HH:MM" or null, "end": "HH:MM" or null}]}',
      { images: blobs },
    );
    if (!res || !Array.isArray(res.items)) return null;
    return res.items.filter((x) => x && x.title && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map((x) => ({
      kind: x.kind === 'deadline' ? 'deadline' : 'event', title: String(x.title), date: x.date,
      start: x.start ? U.fromInput(x.start) : null, end: x.end ? U.fromInput(x.end) : null,
    }));
  };

  AI.extractFromPdfText = async (text, today) => {
    const res = await askJson(
      todayLine(today) + ' This is text from a syllabus or flyer. Find every dated item: exams, quizzes, due dates, events. ' +
      'Reply with only JSON: {"items": [{"kind": "event" or "deadline", "title": string, "date": "YYYY-MM-DD", "start": "HH:MM" or null, "end": "HH:MM" or null}]}\n\n' + text.slice(0, 20000),
      {},
    );
    if (res && Array.isArray(res.items)) {
      return { by: 'claude', items: res.items.filter((x) => x && x.title && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map((x) => ({
        kind: x.kind === 'deadline' ? 'deadline' : 'event', title: String(x.title), date: x.date,
        start: x.start ? U.fromInput(x.start) : null, end: x.end ? U.fromInput(x.end) : null,
      })) };
    }
    return { by: 'local', items: AI.extractFromText(text, today) };
  };

  let pdfLoading = null;
  AI.pdfText = async (file) => {
    if (!pdfLoading) {
      pdfLoading = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        sc.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        sc.onerror = reject;
        document.head.appendChild(sc);
      });
    }
    const lib = await pdfLoading;
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let lastY = null;
      content.items.forEach((it) => {
        const y = it.transform[5];
        text += (lastY !== null && Math.abs(y - lastY) > 2 ? '\n' : ' ') + it.str;
        lastY = y;
      });
      text += '\n';
    }
    return text;
  };

  // ---------- calendar files (.ics from Google or Apple Calendar) ----------
  AI.parseIcs = (text, today) => {
    const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const unescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
    const when = (prop, value) => {
      if (/VALUE=DATE(?!-TIME)/.test(prop) || /^\d{8}$/.test(value)) return null; // all-day
      const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
      if (!m) return null;
      const d = m[7]
        ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]))
        : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      return { key: U.key(d), min: d.getHours() * 60 + d.getMinutes(), dow: d.getDay() };
    };
    const horizonEnd = U.addDays(today, 180);
    const out = [];
    let skipped = 0, cur = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') {
        if (cur) {
          const ev = icsEvent(cur);
          if (ev) out.push(ev); else skipped++;
        }
        cur = null;
        continue;
      }
      if (!cur) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const prop = line.slice(0, i), value = line.slice(i + 1);
      const name = prop.split(';')[0].toUpperCase();
      if (name === 'DTSTART' || name === 'DTEND') cur[name] = when(prop, value);
      else if (name === 'SUMMARY' || name === 'LOCATION' || name === 'UID' || name === 'RRULE' || name === 'STATUS') cur[name] = unescape(value);
    }
    function icsEvent(c) {
      if (!c.DTSTART || c.STATUS === 'CANCELLED') return null;
      const start = c.DTSTART.min;
      let end = c.DTEND && c.DTEND.key === c.DTSTART.key ? c.DTEND.min : start + 60;
      if (end <= start) end = Math.min(1439, start + 60);
      const base = { title: c.SUMMARY || 'Untitled event', start, end, location: c.LOCATION || '', travel: c.LOCATION ? S().settings.travelDefault : 0, uid: c.UID || null };
      if (c.RRULE) {
        const r = Object.fromEntries(c.RRULE.split(';').map((p) => p.split('=')));
        let until = null;
        if (r.UNTIL) { const u = r.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/); if (u) until = u[1] + '-' + u[2] + '-' + u[3]; }
        if (until && until < today) return null;
        if (r.FREQ === 'WEEKLY' && (!r.INTERVAL || r.INTERVAL === '1')) {
          const days = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]).filter((d) => d != null) : [c.DTSTART.dow];
          return { ...base, days, from: c.DTSTART.key, until };
        }
        if (r.FREQ === 'DAILY' && (!r.INTERVAL || r.INTERVAL === '1')) return { ...base, days: [0, 1, 2, 3, 4, 5, 6], from: c.DTSTART.key, until };
      }
      if (c.DTSTART.key < U.addDays(today, -7) || c.DTSTART.key > horizonEnd) return null;
      return { ...base, date: c.DTSTART.key };
    }
    return { events: out, skipped };
  };

  // ---------- open-window ideas from Claude ----------
  AI.moreIdeas = async (window_, interests) => {
    const res = await askJson(
      'Suggest 3 specific things a student could do in a free window of ' + (window_.end - window_.start) + ' minutes starting at ' + U.clock(window_.start) +
      '. Their interests: ' + interests.join(', ') + '. Keep it realistic for the time of day. Reply with only JSON: {"ideas": [{"title": string, "minutes": number}]}',
      { modelTier: 'quick', cache: false },
    );
    return res && Array.isArray(res.ideas) ? res.ideas.slice(0, 3) : null;
  };

  window.AI = AI;
})();
