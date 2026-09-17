/* Screen renderers. Each returns an HTML string built from App.state and App.sim. */
(function () {
  const V = {};
  const { esc, icon, dur, clock, range } = U;
  const st = () => App.state;
  const sim = () => App.sim;
  const hrs = (m) => (m / 60).toFixed(m % 60 === 0 ? 0 : 1) + 'h';
  const byMode = (by) => by === 'claude' ? 'Read by Claude' : 'Read by the built-in parser';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  V.mod = IS_MAC ? '⌘' : 'Ctrl ';
  const kbd = (k) => '<kbd>' + k + '</kbd>';
  V.kbd = kbd;
  const skel = (label) => '<div class="skel" role="status" aria-label="' + label + '"><i></i><i></i></div>';
  V.skel = skel;
  // One text box that highlights the dates and times it understands as you type.
  V.smartInput = (id, mode, placeholder) =>
    '<div class="smart"><div class="smart-field"><div class="smart-mirror" aria-hidden="true"></div><input class="input smart-input" id="' + id + '" data-smart="' + mode + '" autocomplete="off" spellcheck="false" placeholder="' + esc(placeholder) + '"></div><p class="smart-hint" aria-live="polite"></p></div>';
  const head = (title, actions = '', sub = '') =>
    '<header class="page-head"><div><h1>' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</header>';

  // ======================= Today =======================
  function blockText(b) {
    const len = b.end - b.start;
    switch (b.type) {
      case 'event': return { t: esc(b.title), m: range(b.start, b.end) + (b.location ? ' · ' + esc(b.location) : '') };
      case 'task': return {
        t: (b.status === 'done' ? icon('check') : '') + '<span>' + esc(b.title) + '</span>',
        m: (b.status === 'skipped' ? 'Skipped · ' : b.status === 'running' ? 'In progress · ' : '') + range(b.start, b.end) + (b.parts > 1 ? ' · part ' + b.part + ' of ' + b.parts : ''),
      };
      case 'free': return { t: '<span>Free time</span>', m: range(b.start, b.end) };
      case 'habit': return { t: (b.status === 'done' ? icon('check') : '') + '<span>' + esc(b.title) + '</span>', m: 'Optional · ' + range(b.start, b.end) };
      case 'open': return { t: '<span>Open</span>', m: dur(len) };
      case 'winddown': return { t: '<span>Wind down</span>', m: '' };
      case 'routine': return { t: '<span>' + esc(b.title) + '</span>', m: '' };
      case 'travel': return { t: dur(len) + ' travel', m: '' };
      default: return { t: esc(b.title), m: '' };
    }
  }

  V.timeline = (plan, k) => {
    const s = st().settings;
    const px = 1.2;
    const y = (m) => ((m - s.wake) * px).toFixed(1) + 'px';
    const isToday = k === sim().today;
    const now = isToday ? E.now() : -1;
    let html = '<div class="tl" style="height:' + (s.bed - s.wake) * px + 'px"><div class="tl-hours" aria-hidden="true">';
    for (let h = Math.ceil(s.wake / 60); h * 60 <= s.bed; h++) html += '<span class="mono" style="top:' + y(h * 60) + '">' + clock(h * 60, { short: true }) + '</span>';
    html += '</div><div class="tl-track">';
    for (let h = Math.ceil(s.wake / 60); h * 60 <= s.bed; h++) html += '<div class="tl-grid" style="top:' + y(h * 60) + '"></div>';
    const seen = {};
    plan.blocks.forEach((b) => {
      if (b.ghost || b.type === 'buffer' || b.type === 'break') return;
      const h = (b.end - b.start) * px;
      const L = blockText(b);
      const cls = ['blk', b.type];
      if (b.type === 'task') cls.push(b.heavy ? 'heavy' : 'light');
      if (b.status === 'done') cls.push('is-done');
      if (b.status === 'skipped') cls.push('is-skipped');
      if (b.status === 'running') cls.push('is-running');
      if (isToday && b.end <= now) cls.push('is-past');
      if (h < 44) cls.push('compact');
      if (h < 21) cls.push('tiny');
      const flipKey = b.taskId ? 'task:' + b.taskId + ':' + (seen[b.taskId] = (seen[b.taskId] || 0) + 1) : b.key;
      const clickable = ['task', 'habit', 'free', 'open', 'event'].includes(b.type);
      const attrs = clickable
        ? ' type="button" data-action="block" data-key="' + esc(b.key) + '" data-date="' + k + '" aria-label="' + esc(b.title + ', ' + range(b.start, b.end)) + '"'
        : ' aria-hidden="true"';
      const tag = clickable ? 'button' : 'div';
      html += '<' + tag + ' class="' + cls.join(' ') + '" data-flip="' + esc(flipKey) + '" style="top:' + y(b.start) + ';height:' + Math.max(h - 2, 3).toFixed(1) + 'px"' + attrs + '>';
      html += '<span class="t">' + L.t + '</span>' + (L.m ? '<span class="m">' + L.m + '</span>' : '');
      if (b.status === 'running') html += '<span class="m timer" data-timer="' + esc(b.taskId || '') + '"></span>';
      html += '</' + tag + '>';
    });
    if (isToday && now >= s.wake && now <= s.bed) html += '<div class="now-line" style="top:' + y(now) + '"><span>' + clock(now, { noAp: true }) + '</span></div>';
    return html + '</div></div>';
  };

  V.today = () => {
    const S = st(), s = S.settings, X = sim(), T = X.today, plan = X.days[T], stats = X.stats[T], now = E.now();
    const oc = E.overcommit(X);
    let actions = '';
    if (s.clockMode === 'demo') actions += '<label class="demo-clock" for="demoNow">Test clock <span class="mono">' + clock(now) + '</span><input id="demoNow" type="range" min="' + s.wake + '" max="' + (s.bed - 15) + '" step="5" value="' + now + '"></label>';
    actions += '<button class="btn btn-primary" data-action="reflow" title="Rebuild the rest of today (R)">Reflow ' + kbd('R') + '</button>';
    let html = head(U.fmtDate(T, 'long'), actions);

    const nextTask = plan.blocks.find((b) => b.type === 'task' && b.start >= now && b.status === 'planned');
    html += '<div class="today"><div class="today-side today-first">';
    html += '<section class="summary o1"><div class="big">' + dur(stats.freeLeft) + '</div><p class="muted">free time left today</p>';
    if (nextTask) html += '<p class="next">Next: ' + esc(nextTask.title) + ' at <span class="mono">' + clock(nextTask.start) + '</span></p>';
    html += '</section>';

    const skipped = plan.blocks.filter((b) => b.type === 'task' && b.status === 'skipped' && !b.ghost && !b.handled);
    const unmarked = plan.blocks.filter((b) => b.type === 'task' && b.status === 'planned' && b.end <= now);
    if (!S.events.length && !S.tasks.length) {
      html += '<div class="empty-cta o2"><p>Nothing planned yet. Add a class, event or task and Keepclear builds your day around it.</p><button class="btn" data-action="quick-add">New task or event ' + kbd('C') + '</button></div>';
    } else if (skipped.length || unmarked.length) {
      html += '<p class="note o2">' + (skipped.length ? esc(skipped[0].title) + ' was skipped.' : 'Some earlier blocks aren’t marked done.') + ' <button class="link" data-action="reflow">Reflow</button></p>';
    }
    if (oc) html += V.overcommit(oc);
    html += '</div>';

    html += '<section class="tl-wrap o3" aria-label="Today’s plan">' + V.timeline(plan, T) + '</section>';

    html += '<div class="today-side"><section class="o4" aria-labelledby="fch"><h2 id="fch">This week</h2>' + V.forecast(E.forecast(X)) + '</section></div></div>';
    return html;
  };

  V.overcommit = (oc) => {
    let html = '<section class="alert o2" role="alert"><h2>Too much due by ' + U.DAY_LONG[U.dow(oc.crunch)] + '</h2>';
    html += '<p>You’re about ' + dur(oc.total) + ' short without using your free time.</p><ul class="recs">';
    oc.recs.slice(0, 2).forEach((r) => {
      const verb = r.action === 'drop' ? 'Drop' : 'Postpone';
      html += '<li><span>' + verb + ' <b>' + esc(r.title) + '</b></span><button class="btn btn-sm" data-action="rec" data-task="' + r.taskId + '" data-kind="' + r.action + '" data-until="' + r.until + '">' + verb + '</button></li>';
    });
    if (oc.extension && oc.freed < oc.total) {
      html += '<li><span>Get an extension on <b>' + esc(oc.extension.title) + '</b></span><button class="btn btn-sm" data-action="extend" data-task="' + oc.extension.taskId + '">+2 days</button></li>';
    }
    return html + '</ul></section>';
  };

  V.forecast = (fc) => {
    const s = st().settings;
    const max = Math.max(600, ...fc.days.map((d) => d.free));
    let html = '<div class="forecast">';
    fc.days.forEach((d, i) => {
      html += '<button class="fc-day' + (d.packed ? ' packed' : '') + (i === 0 ? ' is-today' : '') + '" data-action="goto-cal" data-date="' + d.k + '" aria-label="' + esc(U.fmtDate(d.k) + ': ' + dur(d.free) + ' free' + (d.packed ? ', packed' : '')) + '">';
      html += '<span class="fc-bar"><span class="fc-fill" style="height:' + (d.free / max * 100).toFixed(1) + '%"></span><span class="fc-floor" style="bottom:' + (s.minFree / max * 100).toFixed(1) + '%"></span></span>';
      html += '<span class="fc-lab">' + (i === 0 ? 'Today' : U.DAY_SHORT[U.dow(d.k)]) + '</span><span class="fc-val">' + hrs(d.free) + '</span></button>';
    });
    html += '</div>';
    const m = fc.moves[0];
    if (m) html += '<div class="move"><span>' + U.DAY_LONG[U.dow(m.from)] + ' is packed. Move <b>' + esc(m.title) + '</b> to ' + U.DAY_LONG[U.dow(m.to)] + '?</span><button class="btn btn-sm" data-action="move" data-task="' + m.taskId + '" data-from="' + m.from + '" data-to="' + m.to + '">Move</button></div>';
    return html;
  };

  // ======================= Calendar =======================
  V.calendar = () => {
    const S = st(), s = S.settings, X = sim(), ui = App.ui;
    const narrow = window.matchMedia('(max-width: 860px)').matches;
    const ws = ui.calWeek;
    const weekDays = Array.from({ length: 7 }, (_, i) => U.addDays(ws, i));
    let days = weekDays;
    if (narrow) {
      const idx = Math.max(0, Math.min(4, weekDays.indexOf(ui.calDay) >= 0 ? weekDays.indexOf(ui.calDay) : 0));
      days = weekDays.slice(idx, idx + 3);
    }
    const nav = '<button class="btn btn-quiet btn-sm" data-action="cal-week" data-dir="-1" aria-label="Previous week">' + icon('chevL') + '</button><button class="btn btn-quiet btn-sm" data-action="cal-week" data-dir="0">' + U.fmtDate(ws, 'md') + ' – ' + U.fmtDate(U.addDays(ws, 6), 'md') + '</button><button class="btn btn-quiet btn-sm" data-action="cal-week" data-dir="1" aria-label="Next week">' + icon('chevR') + '</button>';
    let html = head('Calendar', nav + '<span class="faint small hide-sm">' + kbd('←') + ' ' + kbd('→') + ' weeks</span>');

    html += '<form class="addrow" data-form="smart">' + V.smartInput('eventText', 'event', 'Add an event, like “soccer Tue/Thu 4–6pm at North Field”') + '<button class="btn btn-primary" type="submit">Add</button></form>';

    const imported = S.events.filter((e) => e.source === 'ics').length;
    html += '<details class="disclose"' + (ui.upload || ui.uploadBusy ? ' open' : '') + '><summary>Import from a calendar or syllabus</summary><div class="disclose-body">';
    html += '<div class="field"><span>Calendar file (.ics)</span><label class="btn btn-sm file">Choose file<input id="icsFile" type="file" accept=".ics,text/calendar"></label><small class="faint">Export it from Google Calendar (Settings, Import and export) or Apple Calendar (File, Export).</small></div>';
    if (imported) html += '<p class="small">' + imported + ' imported event' + (imported === 1 ? '' : 's') + ' · <button class="link" data-action="remove-ics">Remove</button></p>';
    html += '<div class="field" id="dropzone"><span>Syllabus or flyer (photo or PDF)</span><label class="btn btn-sm file">Choose file<input id="uploadFile" type="file" accept="image/*,.pdf,application/pdf"></label></div>';
    if (ui.uploadBusy) html += skel(ui.uploadBusy);
    if (ui.upload) {
      if (!ui.upload.items.length) html += '<p class="note">' + esc(ui.upload.error || 'No dates found in that file.') + '</p>';
      else {
        html += '<div class="checklist">';
        ui.upload.items.forEach((it, i) => {
          html += '<label><input type="checkbox" data-upload-i="' + i + '" checked><span>' + esc(it.title) + ' <span class="faint">' + U.fmtDate(it.date) + (it.start != null ? ', ' + range(it.start, it.end || it.start + 60) : '') + '</span></span></label>';
        });
        html += '<div class="row"><button class="btn btn-primary btn-sm" data-action="upload-add">Add selected</button><span class="faint small">' + byMode(ui.upload.by) + '</span></div></div>';
      }
    }
    html += '</div></details>';

    const px = 0.75;
    const H = (s.bed - s.wake) * px;
    const y = (m) => ((m - s.wake) * px).toFixed(1) + 'px';
    if (narrow) html += '<div class="daypills">' + weekDays.map((k) => '<button class="btn btn-sm' + (days.includes(k) ? ' is-on' : ' btn-quiet') + '" data-action="cal-day" data-date="' + k + '">' + U.DAY_SHORT[U.dow(k)].slice(0, 2) + ' ' + U.parseKey(k).getDate() + '</button>').join('') + '</div>';
    html += '<div class="calgrid-wrap" style="--cols:' + days.length + '"><div class="cal-heads"><div></div>';
    days.forEach((k) => { html += '<div class="' + (k === X.today ? 'is-today' : '') + '">' + U.DAY_SHORT[U.dow(k)] + ' ' + U.parseKey(k).getDate() + '</div>'; });
    html += '</div><div class="cal-body"><div class="cal-hours" style="height:' + H + 'px">';
    for (let h = Math.ceil(s.wake / 60); h * 60 <= s.bed; h += 2) html += '<span class="mono" style="top:' + y(h * 60) + '">' + clock(h * 60, { short: true }) + '</span>';
    html += '</div>';
    days.forEach((k) => {
      html += '<div class="cal-col' + (k === X.today ? ' is-today' : '') + '" style="height:' + H + 'px" data-action="slot" data-date="' + k + '" data-px="' + px + '" title="Click a time to add an event">';
      if (k === X.today && E.now() >= s.wake && E.now() <= s.bed) html += '<div class="cal-now" style="top:' + y(E.now()) + '"></div>';
      const blocks = X.days[k] ? X.days[k].blocks : E.fixedBlocks(k);
      blocks.forEach((b) => {
        if (b.type !== 'event') return;
        const h = (b.end - b.start) * px;
        html += '<button type="button" data-action="block" data-key="' + esc(b.key) + '" data-date="' + k + '" class="cblk" style="top:' + y(b.start) + ';height:' + Math.max(h - 1, 12).toFixed(1) + 'px" title="' + esc(b.title + ', ' + range(b.start, b.end)) + '"><b>' + esc(b.title) + '</b>' + (h > 28 ? '<span class="mono">' + clock(b.start) + '</span>' : '') + '</button>';
      });
      html += '</div>';
    });
    html += '</div></div>';
    if (!S.events.length) html += '<p class="note">No events yet. Click a time in the grid, type one above, or import a calendar.</p>';
    return html;
  };

  // ======================= Tasks =======================
  V.tasks = () => {
    const S = st(), X = sim(), ui = App.ui, T = X.today;
    const active = S.tasks.filter((t) => !t.done && !t.dropped);
    let html = head('Tasks', '', active.length ? active.length + ' open · ' + dur(active.reduce((a, t) => a + E.remaining(t), 0)) + ' of work' : '');

    html += '<form class="addrow" data-form="smart">' + V.smartInput('taskText', 'task', 'Add a task, like “history essay due Friday”') + '<button class="btn btn-primary" type="submit">Add</button></form>';

    html += '<details class="disclose"' + (ui.dump || ui.dumpBusy ? ' open' : '') + '><summary>Brain dump</summary><div class="disclose-body">';
    html += '<label class="sr" for="dumpText">Brain dump</label><textarea class="input" id="dumpText" rows="5" placeholder="Type everything on your mind, one thing per line.">' + esc(ui.dumpDraft) + '</textarea>';
    html += '<div class="row"><button class="btn btn-sm" data-action="sort-dump">Sort into tasks, events and ideas</button></div>';
    if (ui.dumpBusy) html += skel('Sorting');
    if (ui.dump) {
      const d = ui.dump;
      const group = (title, items, kind, fmt) => !items.length ? '' :
        '<h3>' + title + '</h3>' + items.map((it, i) => '<label><input type="checkbox" checked data-dump="' + kind + ':' + i + '"><span>' + fmt(it) + '</span></label>').join('');
      html += '<div class="checklist">';
      html += group('Tasks', d.tasks, 'task', (t) => esc(t.title) + ' <span class="faint">' + (t.deadline ? 'due ' + U.relDay(t.deadline, T) + ', ' : '') + dur(t.minutes) + '</span>');
      html += group('Events', d.events, 'event', (e) => esc(e.title) + ' <span class="faint">' + (e.days ? e.days.map((x) => U.DAY_SHORT[x]).join(', ') : U.fmtDate(e.date)) + ', ' + range(e.start, e.end) + '</span>');
      html += group('Ideas', d.ideas, 'idea', (x) => esc(x));
      html += '<div class="row"><button class="btn btn-primary btn-sm" data-action="dump-add">Add selected</button><button class="btn btn-quiet btn-sm" data-action="dump-clear">Cancel</button></div></div>';
    }
    html += '</div></details>';

    const next = {};
    X.order.forEach((k) => X.days[k].blocks.forEach((b) => {
      if (b.type === 'task' && !b.ghost && b.status === 'planned' && !next[b.taskId] && !(k === T && b.end <= E.now())) next[b.taskId] = { k, b };
    }));
    const short = {};
    X.shortfalls.forEach((x) => { short[x.taskId] = x; });
    if (!active.length) html += '<p class="empty">No open tasks. Type one above, or press ' + kbd('C') + ' from any page.</p>';
    const groups = [
      ['Due soon', (t) => t.deadline && U.diffDays(T, t.deadline) <= 1],
      ['This week', (t) => t.deadline && U.diffDays(T, t.deadline) > 1 && U.diffDays(T, t.deadline) <= 7],
      ['Later', (t) => !t.deadline || U.diffDays(T, t.deadline) > 7],
    ];
    const ordered = active.slice().sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    groups.forEach(([name, fn]) => {
      const list = ordered.filter(fn);
      if (!list.length) return;
      html += '<section class="group"><h2>' + name + '</h2>' + list.map((t) => taskRow(t, next[t.id], short[t.id], T)).join('') + '</section>';
    });
    const done = S.tasks.filter((t) => t.done || t.dropped);
    if (done.length) html += '<section class="group"><h2>Done</h2>' + done.slice(-5).reverse().map((t) => taskRow(t, null, null, T)).join('') + '</section>';

    if (S.ideas.length) {
      html += '<section class="group"><h2>Ideas</h2>';
      S.ideas.forEach((i) => { html += '<div class="line"><span>' + esc(i.text) + '</span><span class="row"><button class="btn btn-quiet btn-sm" data-action="idea-task" data-id="' + i.id + '">Make task</button><button class="btn btn-quiet btn-sm" data-action="idea-del" data-id="' + i.id + '" aria-label="Remove idea">' + icon('close') + '</button></span></div>'; });
      html += '</section>';
    }
    return html;
  };

  function taskRow(t, next, short, T) {
    const isDone = t.done || t.dropped;
    let html = '<article class="trow' + (isDone ? ' is-done' : '') + (t.timer ? ' is-running' : '') + '" data-task="' + t.id + '">';
    html += '<button class="finish" data-action="finish-task" data-id="' + t.id + '" aria-label="' + (isDone ? 'Mark not done' : 'Mark done') + ': ' + esc(t.title) + '">' + icon('check') + '</button>';
    html += '<div class="body"><div class="title">' + esc(t.title) + '</div><div class="meta">';
    const bits = [];
    if (isDone) bits.push(t.dropped ? 'Dropped' : 'Took ' + dur(t.spent));
    else {
      if (t.deadline) {
        const n = U.diffDays(T, t.deadline);
        bits.push('<span class="' + (n <= 1 ? 'urgent' : '') + '">' + (n < 0 ? 'Overdue' : 'Due ' + U.relDay(t.deadline, T)) + '</span>');
      }
      bits.push(dur(E.remaining(t)) + ' left');
      if (short) bits.push('<span class="urgent">' + dur(short.short) + ' won’t fit in time</span>');
      else if (next) bits.push('Next ' + (next.k === T ? 'today' : U.DAY_SHORT[U.dow(next.k)]) + ' ' + clock(next.b.start, { short: true }));
      else if (t.postponeUntil) bits.push('Postponed');
    }
    html += bits.join(' · ') + '</div></div><div class="actions">';
    if (!isDone) {
      if (t.timer) html += '<span class="timer small" data-timer="' + t.id + '"></span><button class="btn btn-sm" data-action="stop-task" data-id="' + t.id + '">Stop</button>';
      else html += '<button class="btn btn-quiet btn-sm" data-action="start-task" data-id="' + t.id + '" title="Track time on this task">Start</button>';
    }
    html += '<button class="btn btn-quiet btn-sm" data-action="task-menu" data-id="' + t.id + '" aria-label="Options for ' + esc(t.title) + '">' + icon('more') + '</button></div></article>';
    return html;
  }

  // ======================= Habits =======================
  V.habits = () => {
    const S = st(), X = sim(), T = X.today, ws = U.weekStart(T);
    let html = head('Goals and habits');
    html += '<form class="addrow" data-form="habit"><label class="sr" for="habitText">New goal</label><input class="input" id="habitText" placeholder="Practice guitar 3x a week for 30 min" autocomplete="off"><button class="btn btn-primary" type="submit">Add</button></form>';
    if (!S.habits.length) html += '<p class="empty">No goals yet. They’re scheduled into your free time as optional blocks.</p>';
    S.habits.forEach((h) => {
      const days = Array.from({ length: 7 }, (_, i) => U.addDays(ws, i));
      const doneToday = h.doneDates.includes(T);
      html += '<article class="habit"><div><div class="name">' + esc(h.title) + '</div><div class="meta">' + h.perWeek + '× a week · ' + dur(h.minutes) + '</div></div><div class="weekdots">';
      days.forEach((k) => {
        const isDone = h.doneDates.includes(k);
        const planned = !isDone && k >= T && X.days[k] && X.days[k].blocks.some((b) => b.type === 'habit' && b.habitId === h.id && !b.ghost);
        html += '<span class="wd' + (isDone ? ' done' : '') + (planned ? ' planned' : '') + (k === T ? ' today' : '') + '" title="' + U.fmtDate(k) + (isDone ? ', done' : planned ? ', planned' : '') + '">' + U.DAY_SHORT[U.dow(k)][0] + '</span>';
      });
      html += '</div><div class="actions"><button class="btn btn-sm' + (doneToday ? ' btn-quiet' : '') + '" data-action="habit-today" data-id="' + h.id + '">' + (doneToday ? 'Undo' : 'Done today') + '</button><button class="btn btn-quiet btn-sm" data-action="habit-del" data-id="' + h.id + '" aria-label="Remove ' + esc(h.title) + '">' + icon('close') + '</button></div></article>';
    });
    return html;
  };

  // ======================= Friends =======================
  V.friends = () => {
    const S = st(), X = sim(), ui = App.ui;
    let html = head('Friends', '<button class="btn" data-action="add-friend">Add friend</button>');
    if (!S.friends.length) return html + '<p class="empty">Add a friend and their usual busy times to see when you’re both free.</p>';
    html += '<div class="friend-chips">';
    S.friends.forEach((f) => {
      html += '<span class="fchip"><label for="fr-' + f.id + '"><input type="checkbox" id="fr-' + f.id + '" data-action="friend-sel" data-id="' + f.id + '"' + (ui.friendSel.has(f.id) ? ' checked' : '') + '>' + esc(f.name) + '</label><button class="btn btn-quiet btn-sm" data-action="friend-del" data-id="' + f.id + '" aria-label="Remove ' + esc(f.name) + '">' + icon('close') + '</button></span>';
    });
    html += '</div>';
    const ids = S.friends.filter((f) => ui.friendSel.has(f.id)).map((f) => f.id);
    html += '<section class="group"><h2>Best time each day</h2>';
    if (!ids.length) return html + '<p class="empty">Select a friend above.</p></section>';
    const wins = E.together(X, ids);
    if (!wins.length) return html + '<p class="empty">No shared hour this week. Try fewer people.</p></section>';
    const best = {};
    wins.forEach((w) => { if (!best[w.k] || w.end - w.start > best[w.k].end - best[w.k].start) best[w.k] = w; });
    Object.values(best).forEach((w) => {
      html += '<div class="line"><span><b>' + (w.k === X.today ? 'Today' : U.fmtDate(w.k)) + '</b> <span class="mono">' + range(w.start, w.end) + '</span> <span class="faint">' + dur(w.end - w.start) + '</span></span><button class="btn btn-quiet btn-sm" data-action="hangout" data-date="' + w.k + '" data-start="' + w.start + '" data-end="' + w.end + '">Add to calendar</button></div>';
    });
    return html + '</section>';
  };

  // ======================= Recap =======================
  V.recap = () => {
    const S = st(), ui = App.ui, T = sim().today;
    const floor = S.settings.minFree;
    const weekStart = U.addDays(U.weekStart(T), ui.recapIdx === 1 ? -7 : 0);
    const days = Array.from({ length: 7 }, (_, i) => U.addDays(weekStart, i));
    const logs = days.map((k) => (k <= T ? S.log[k] : null));
    const have = logs.filter(Boolean);
    const toggle = ['This week', 'Last week'].map((l, i) => '<button class="btn btn-sm' + (i === ui.recapIdx ? ' is-on' : ' btn-quiet') + '" data-action="recap-week" data-i="' + i + '">' + l + '</button>').join('');
    let html = head('Weekly recap', toggle);
    if (!have.length) return html + '<p class="empty">Nothing recorded ' + (ui.recapIdx === 1 ? 'last week' : 'yet this week') + '. Each day you use Keepclear adds to this page.</p>';

    const sum = (fn) => have.reduce((a, l) => a + fn(l), 0);
    const protectedTotal = sum((l) => Math.min(l.protected, l.floor));
    const keptDays = have.filter((l) => l.protected >= l.floor - 1).length;
    html += '<p class="lede"><b>' + dur(sum((l) => l.planned.free)) + '</b> of free time, <b>' + dur(protectedTotal) + '</b> of it protected. ' + keptDays + ' of ' + have.length + ' days kept your ' + dur(floor) + ' minimum.</p>';

    html += '<section class="group"><h2>Planned and done</h2><div class="pva">';
    const rows = [['heavy', 'Focused work'], ['light', 'Light tasks'], ['habit', 'Habits']].map(([key, label]) => ({ key, label, planned: sum((l) => l.planned[key]), actual: sum((l) => l.actual[key]) }));
    const max = Math.max(1, ...rows.map((c) => Math.max(c.planned, c.actual)));
    rows.forEach((c) => {
      html += '<div class="pva-row"><span>' + c.label + '</span><div class="pva-bars"><span class="pva-bar" style="width:' + (c.planned / max * 100).toFixed(1) + '%"></span><span class="pva-bar actual c-' + c.key + '" style="width:' + (c.actual / max * 100).toFixed(1) + '%"></span></div><span class="mono small">' + dur(c.actual) + ' / ' + dur(c.planned) + '</span></div>';
    });
    html += '</div></section>';

    html += '<section class="group"><h2>Free time by day</h2><div class="freechart">' + freeChart(logs.map((l) => (l ? l.planned.free : null)), floor) + '</div></section>';

    const run = (test) => {
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const l = S.log[U.addDays(T, -i)];
        if (i === 0 && (!l || !test(l))) continue;
        if (!l || !test(l)) break;
        n++;
      }
      return n;
    };
    html += '<section class="group"><h2>Streaks</h2>';
    html += '<div class="line"><span>Days on plan</span><b class="mono">' + run((l) => l.blocks > 0 && l.done / l.blocks >= 0.8) + '</b></div>';
    html += '<div class="line"><span>Days with your free-time minimum</span><b class="mono">' + run((l) => l.protected >= l.floor - 1) + '</b></div>';
    S.habits.forEach((h) => {
      let n = 0;
      for (let i = 0; i < 52; i++) {
        const w = U.addDays(U.weekStart(T), -7 * i);
        if (h.doneDates.filter((d) => d >= w && d <= U.addDays(w, 6)).length >= h.perWeek) n++;
        else if (i > 0) break;
      }
      html += '<div class="line"><span>Weeks of ' + esc(h.title.toLowerCase()) + '</span><b class="mono">' + n + '</b></div>';
    });
    html += '</section>';

    const cats = [...new Set(S.history.map((h) => h.category))];
    if (cats.length) {
      html += '<section class="group"><h2>Estimate adjustments</h2>';
      cats.forEach((c) => {
        const pct = Math.round((E.factor(c).f - 1) * 100);
        html += '<div class="line"><span>' + esc(c.replace('-', ' ').replace(/^./, (x) => x.toUpperCase())) + '</span><b class="mono">' + (pct > 0 ? '+' : '') + pct + '%</b></div>';
      });
      html += '</section>';
    }
    return html;
  };

  function freeChart(vals, floor) {
    const W = 420, H = 150, padL = 30, padB = 20, padT = 10;
    const max = Math.max(360, ...vals.filter((v) => v != null));
    const bw = (W - padL) / 7;
    const yy = (m) => padT + (H - padT - padB) * (1 - m / max);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Free time per day">';
    for (let t = 0; t <= max; t += 240) svg += '<text x="' + (padL - 6) + '" y="' + (yy(t) + 4) + '" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="var(--f-mono)">' + t / 60 + 'h</text>';
    vals.forEach((v, i) => {
      const x = padL + i * bw + bw * 0.22, w = bw * 0.56;
      if (v != null) svg += '<rect x="' + x + '" y="' + yy(v) + '" width="' + w + '" height="' + (yy(0) - yy(v)) + '" rx="2" fill="' + (v < floor ? 'var(--alarm)' : 'var(--sun)') + '"><title>' + dur(v) + '</title></rect>';
      svg += '<text x="' + (x + w / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" fill="var(--ink-3)">' + 'MTWTFSS'[i] + '</text>';
    });
    svg += '<line x1="' + padL + '" x2="' + W + '" y1="' + yy(floor) + '" y2="' + yy(floor) + '" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="4 4"/>';
    return svg + '</svg>';
  }

  // ======================= Settings =======================
  V.settings = () => {
    const S = st(), s = S.settings;
    const sel = (id, key, opts, fmt) => '<select class="input" id="' + id + '" data-set="' + key + '">' + opts.map((v) => '<option value="' + v + '"' + (s[key] === v ? ' selected' : '') + '>' + fmt(v) + '</option>').join('') + '</select>';
    let html = head('Settings');
    html += '<div class="settings">';

    html += '<section class="group"><h2>Sleep</h2><div class="two">';
    html += '<label class="field" for="setWake"><span>Wake up</span><input class="input" type="time" id="setWake" data-set="wake" value="' + U.toInput(s.wake) + '"></label>';
    html += '<label class="field" for="setBed"><span>Bedtime</span><input class="input" type="time" id="setBed" data-set="bed" value="' + U.toInput(s.bed) + '"></label></div></section>';

    html += '<section class="group"><h2>Focus hours</h2>';
    s.focus.forEach((f, i) => {
      html += '<div class="two"><label class="field" for="focusS' + i + '"><span>From</span><input class="input" type="time" id="focusS' + i + '" data-focus="' + i + ':start" value="' + U.toInput(f.start) + '"></label><label class="field" for="focusE' + i + '"><span>To</span><input class="input" type="time" id="focusE' + i + '" data-focus="' + i + ':end" value="' + U.toInput(f.end) + '"></label></div>';
    });
    html += '</section>';

    html += '<section class="group"><h2>Daily free time</h2><div class="range-row"><label class="sr" for="setFloor">Minimum free time per day</label><input type="range" id="setFloor" data-set="minFree" min="30" max="240" step="15" value="' + s.minFree + '"><output class="mono" for="setFloor">' + dur(s.minFree) + '</output></div><p class="faint small">Tasks never go into this time.</p></section>';

    html += '<section class="group"><h2>Spacing</h2><div class="two">';
    html += '<label class="field" for="setBuffer"><span>After events</span>' + sel('setBuffer', 'buffer', [0, 5, 10, 15], (v) => (v ? v + ' min' : 'None')) + '</label>';
    html += '<label class="field" for="setBreak"><span>Between work blocks</span>' + sel('setBreak', 'breakLen', [5, 10, 15], (v) => v + ' min') + '</label>';
    html += '<label class="field" for="setTravel"><span>Travel time</span>' + sel('setTravel', 'travelDefault', [5, 10, 15, 20, 30], (v) => v + ' min') + '</label>';
    html += '<label class="field" for="setMorning"><span>Getting ready</span>' + sel('setMorning', 'morning', [0, 20, 30, 40, 60], (v) => (v ? v + ' min' : 'None')) + '</label>';
    html += '</div></section>';

    html += '<section class="group"><h2>Interests</h2><div class="chips">';
    Data.INTERESTS.forEach((i) => { html += '<button class="chip" aria-pressed="' + s.interests.includes(i) + '" data-action="interest" data-i="' + i + '">' + esc(i) + '</button>'; });
    html += '</div></section>';

    html += '<section class="group"><h2>Clock</h2><div class="radio-row"><label><input type="radio" name="clockMode" value="real" data-set="clockMode"' + (s.clockMode === 'real' ? ' checked' : '') + '> Real time</label><label><input type="radio" name="clockMode" value="demo" data-set="clockMode"' + (s.clockMode === 'demo' ? ' checked' : '') + '> Test clock</label></div></section>';

    html += '<section class="group"><h2>Data</h2><p class="faint small">Saved in this browser. ' + (AI.mode === 'claude' ? 'Claude reads what you type and upload.' : 'Typing is read by the built-in parser.') + '</p><div class="row"><button class="btn btn-danger btn-sm" data-action="reset">Clear all data</button></div></section>';
    return html + '</div>';
  };

  window.V = V;
})();
