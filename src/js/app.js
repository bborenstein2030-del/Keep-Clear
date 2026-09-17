/* App controller: routing, actions, dialogs, keyboard, quick add. */
(function () {
  const { $, $$, esc, icon, dur, clock, range } = U;

  const App = {
    state: null,
    sim: null,
    route: 'today',
    ui: {
      calWeek: null, calDay: null, calScrolled: null,
      upload: null, uploadBusy: '',
      dumpDraft: '', dump: null, dumpBusy: false,
      friendSel: new Set(), recapIdx: 0,
    },
  };
  window.App = App;

  const ROUTES = ['today', 'calendar', 'tasks', 'habits', 'friends', 'recap', 'settings'];
  const NAV = [['today', 'Today'], ['calendar', 'Calendar'], ['tasks', 'Tasks'], ['habits', 'Goals'], ['friends', 'Friends'], ['recap', 'Weekly recap'], ['settings', 'Settings']];
  // A day with a gap in the middle that nothing is allowed to fill.
  const LOGO = '<svg class="logo" viewBox="0 0 34 34" aria-hidden="true"><rect x="1.25" y="1.25" width="31.5" height="31.5" rx="6" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="6" y="7" width="22" height="5" rx="1.5" fill="var(--pine)"/><rect x="6" y="14.5" width="22" height="5" rx="1.5" fill="var(--sun)"/><rect x="6" y="22" width="22" height="5" rx="1.5" fill="var(--pine)"/></svg>';
  const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- state ----------------
  function save() { Data.save(App.state); }
  function recompute() {
    App.sim = E.simulate();
    App.state.log[App.sim.today] = E.snapshot(App.sim);
  }
  function commit(opts = {}) {
    if (opts.replan) E.replan();
    recompute();
    save();
    render(opts);
  }

  // ---------------- rendering ----------------
  function renderShell() {
    $('#rail').innerHTML =
      '<a class="wordmark" href="#today" aria-label="Keepclear, go to Today">' + LOGO + '<b>Keepclear</b></a>' +
      '<div class="rail-actions"><button class="rail-btn" data-action="quick-add"><span>New</span>' + V.kbd('C') + '</button>' +
      '<button class="rail-btn" data-action="command"><span>Search</span>' + V.kbd(V.mod + 'K') + '</button></div>' +
      '<nav class="nav" aria-label="Main">' + NAV.map(([r, l]) => '<a href="#' + r + '" data-route="' + r + '"><span>' + l + '</span><span class="count" data-count="' + r + '"></span></a>').join('') + '</nav>' +
      '<button class="rail-help" data-action="shortcuts">Keyboard shortcuts ' + V.kbd('?') + '</button>';
    $('#tabbar').innerHTML =
      '<a href="#today" data-route="today">Today</a><a href="#calendar" data-route="calendar">Calendar</a>' +
      '<button type="button" class="tab-new" data-action="quick-add" aria-label="New task or event">New</button>' +
      '<a href="#tasks" data-route="tasks">Tasks</a><button type="button" data-action="more-menu" data-route="more">More</button>';
  }

  function render(opts = {}) {
    const main = $('#main');
    const active = document.activeElement;
    const focusId = active && active.id && main.contains(active) ? active.id : null;
    const sel = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const drafts = {};
    $$('[data-smart]', main).forEach((el) => { drafts[el.id] = el.value; });

    const first = {};
    if (opts.flip) $$('[data-flip]', main).forEach((el) => { first[el.dataset.flip] = el.getBoundingClientRect(); });

    main.dataset.route = App.route;
    main.innerHTML = V[App.route]();
    $$('[data-route]').forEach((a) => {
      const cur = a.dataset.route === App.route || (a.dataset.route === 'more' && ['habits', 'friends', 'recap', 'settings'].includes(App.route));
      if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const open = App.state.tasks.filter((t) => !t.done && !t.dropped).length;
    const c = $('[data-count="tasks"]');
    if (c) c.textContent = open || '';

    $$('[data-smart]', main).forEach((el) => { if (drafts[el.id]) el.value = drafts[el.id]; updateSmart(el); });
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
    }
    tickTimers();

    if (App.route === 'calendar') {
      const body = $('.cal-body');
      const key = App.ui.calWeek;
      if (body && App.ui.calScrolled !== key) {
        const s = App.state.settings;
        const target = key === U.weekStart(App.sim.today) ? E.now() - 90 : 480;
        body.scrollTop = Math.max(0, (target - s.wake) * 0.75);
        App.ui.calScrolled = key;
      }
    }

    if (opts.flip && !REDUCED()) {
      $$('[data-flip]', main).forEach((el) => {
        const f = first[el.dataset.flip];
        const l = el.getBoundingClientRect();
        if (!f) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }); return; }
        const dy = f.top - l.top;
        if (Math.abs(dy) > 1) el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      });
    }
  }

  function go(route) {
    if (!ROUTES.includes(route)) route = 'today';
    const changed = App.route !== route;
    App.route = route;
    render();
    if (changed) window.scrollTo(0, 0);
  }

  // ---------------- smart input: highlight what was understood ----------------
  function updateSmart(input) {
    const wrap = input.closest('.smart');
    if (!wrap) return;
    const mirror = wrap.querySelector('.smart-mirror');
    const hint = wrap.querySelector('.smart-hint');
    const text = input.value;
    const mode = input.dataset.force || (input.dataset.smart === 'auto' ? null : input.dataset.smart);
    if (!text.trim()) {
      mirror.innerHTML = ''; hint.textContent = ''; input._parsed = null;
      syncSeg(input, null);
      return;
    }
    const r = AI.inspect(text, T(), mode);
    input._parsed = r;
    let html = '', at = 0;
    r.ranges.forEach(([a, b]) => { html += esc(text.slice(at, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; at = b; });
    mirror.innerHTML = html + esc(text.slice(at));
    mirror.scrollLeft = input.scrollLeft;
    if (r.kind === 'event') {
      const e = r.event;
      hint.innerHTML = e
        ? '<b>Event</b> ' + esc(e.title) + ' · ' + (e.days ? 'every ' + e.days.map((d) => U.DAY_SHORT[d]).join(', ') : U.relDay(e.date, T()) === 'today' ? 'today' : U.fmtDate(e.date)) + ' · ' + range(e.start, e.end) + (e.location ? ' · ' + esc(e.location) : '')
        : '<b>Event</b> needs a time, like “4–6pm” or “at 7pm”';
    } else {
      const t = r.task;
      hint.innerHTML = '<b>Task</b> ' + esc(t.title || '…') + ' · ' + (t.deadline ? 'due ' + U.fmtDate(t.deadline) : 'no due date') + ' · about ' + dur(E.estimate({ base: t.minutes, category: t.category }));
    }
    syncSeg(input, r.kind);
  }
  function syncSeg(input, kind) {
    const form = input.closest('form');
    if (!form) return;
    $$('.seg-btn', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  }

  async function addFromSmart(input) {
    const r = input._parsed;
    if (!r) return false;
    if (r.kind === 'task') {
      if (!r.task.title) return false;
      const t = newTask({ title: r.task.title, deadline: r.task.deadline, base: r.task.minutes, category: r.task.category, heavy: r.task.heavy });
      commit({ replan: true });
      toast('Added ' + esc(t.title) + (t.deadline ? ', due ' + U.relDay(t.deadline, T()) : '') + ', about ' + dur(E.estimate(t)) + '.', undoRemove('tasks', t));
      if (AI.mode === 'claude') {
        AI.estimate(t.title).then((est) => {
          if (est.by === 'claude' && App.state.tasks.includes(t) && !t.manual) {
            Object.assign(t, { base: est.minutes, category: est.category, heavy: est.heavy, aiSource: 'claude' });
            commit({ replan: true });
          }
        });
      }
      return true;
    }
    let events = r.event ? [r.event] : [];
    if (!events.length && AI.mode === 'claude') {
      const res = await AI.parseEvents(input.value, T());
      events = res.events;
    }
    if (!events.length) { input.focus(); return false; }
    const added = events.map((e) => addEvent(e, 'typed'));
    const ev = added[0];
    if (ev.date) { App.ui.calWeek = U.weekStart(ev.date); App.ui.calDay = ev.date; }
    commit({ replan: added.some(touchesToday) });
    toast('Added ' + esc(ev.title) + (ev.days ? ', every ' + ev.days.map((d) => U.DAY_SHORT[d]).join(', ') : ', ' + U.fmtDate(ev.date)) + ' ' + range(ev.start, ev.end) + '.', {
      label: 'Undo', run: () => { App.state.events = App.state.events.filter((x) => !added.includes(x)); commit({ replan: true }); },
    });
    return true;
  }
  const undoRemove = (listKey, item) => ({
    label: 'Undo', run: () => { App.state[listKey] = App.state[listKey].filter((x) => x !== item); commit({ replan: true }); },
  });

  function quickAdd(prefill = '', caret = 0) {
    openDialog(
      '<form data-form="quick" class="quick"><label class="sr" for="quickText">New task or event</label>' +
      V.smartInput('quickText', 'auto', 'Try “essay due Friday” or “soccer Tue/Thu 4–6pm”') +
      '<div class="quick-foot"><span class="seg" role="group" aria-label="Add as"><button type="button" class="seg-btn" data-action="seg" data-kind="task" aria-pressed="false">Task</button><button type="button" class="seg-btn" data-action="seg" data-kind="event" aria-pressed="false">Event</button></span>' +
      '<span class="row"><span class="faint small hide-sm">' + V.kbd('Enter') + ' to add</span><button class="btn btn-primary btn-sm" type="submit">Add</button></span></div></form>',
      () => {}, 'dlg-quick');
    const input = $('#quickText');
    input.value = prefill;
    input.focus();
    try { input.setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
    updateSmart(input);
  }

  // ---------------- command menu ----------------
  let cmdItems = [], cmdIndex = 0;
  function commandList(q) {
    const S = App.state;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (label) => words.every((w) => label.toLowerCase().includes(w));
    const nav = (route, label, key) => ({ label, group: 'Go to', key, run: () => { location.hash = route; } });
    const commands = [
      { label: 'New task or event', group: 'Actions', key: 'C', run: () => quickAdd() },
      { label: 'Reflow the rest of today', group: 'Actions', key: 'R', run: reflow },
      { label: 'Brain dump', group: 'Actions', run: () => { location.hash = 'tasks'; setTimeout(() => { const d = $('.disclose'); if (d) { d.open = true; $('#dumpText').focus(); } }, 30); } },
      { label: 'Import a calendar file', group: 'Actions', run: () => { location.hash = 'calendar'; setTimeout(() => { const d = $('.disclose'); if (d) d.open = true; }, 30); } },
      nav('today', 'Today', 'T'), nav('calendar', 'Calendar'), nav('tasks', 'Tasks'), nav('habits', 'Goals'), nav('friends', 'Friends'), nav('recap', 'Weekly recap'), nav('settings', 'Settings'),
      { label: 'Keyboard shortcuts', group: 'Help', key: '?', run: shortcutsHelp },
    ];
    let items = commands.filter((c) => !words.length || hit(c.label));
    if (words.length) {
      const found = [];
      S.tasks.filter((t) => !t.dropped && hit(t.title)).slice(0, 6).forEach((t) => found.push({
        label: t.title, group: 'Tasks', sub: t.done ? 'Done' : t.deadline ? 'Due ' + U.relDay(t.deadline, T()) : '',
        run: () => { location.hash = 'tasks'; setTimeout(() => taskMenu(t), 30); },
      }));
      S.events.filter((e) => hit(e.title)).slice(0, 6).forEach((e) => {
        const k = App.sim.order.find((d) => E.eventsOn(d).some((x) => x.id === e.id));
        found.push({
          label: e.title, group: 'Events', sub: e.days ? 'Every ' + e.days.map((d) => U.DAY_SHORT[d]).join(', ') : U.fmtDate(e.date),
          run: () => { const date = k || e.date || T(); App.ui.calWeek = U.weekStart(date); App.ui.calDay = date; location.hash = 'calendar'; if (k) setTimeout(() => blockDialog('ev:' + e.id, k), 30); },
        });
      });
      S.habits.filter((h) => hit(h.title)).forEach((h) => found.push({ label: h.title, group: 'Goals', run: () => { location.hash = 'habits'; } }));
      items = found.concat(items);
    }
    return items;
  }
  function renderCommand() {
    const q = $('#cmdInput').value;
    cmdItems = commandList(q);
    cmdIndex = Math.min(cmdIndex, Math.max(0, cmdItems.length - 1));
    let html = '', group = '';
    cmdItems.forEach((it, i) => {
      if (it.group !== group) { group = it.group; html += '<div class="cmd-group">' + esc(group) + '</div>'; }
      html += '<button type="button" class="cmd-item" role="option" id="cmd-' + i + '" data-cmd="' + i + '" aria-selected="' + (i === cmdIndex) + '"><span>' + esc(it.label) + (it.sub ? ' <span class="faint">' + esc(it.sub) + '</span>' : '') + '</span>' + (it.key ? V.kbd(it.key) : '') + '</button>';
    });
    $('#cmdList').innerHTML = html || '<p class="cmd-empty">No matches</p>';
    $('#cmdInput').setAttribute('aria-activedescendant', cmdItems.length ? 'cmd-' + cmdIndex : '');
    const selEl = $('#cmd-' + cmdIndex);
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }
  function openCommand() {
    cmdIndex = 0;
    openDialog('<div class="cmd"><label class="sr" for="cmdInput">Search tasks, events and commands</label><input class="cmd-input" id="cmdInput" role="combobox" aria-controls="cmdList" aria-expanded="true" autocomplete="off" placeholder="Search tasks, events and commands"><div class="cmd-list" id="cmdList" role="listbox"></div></div>', () => {}, 'dlg-cmd');
    renderCommand();
  }
  function runCommand(i) {
    const it = cmdItems[i];
    if (!it) return;
    closeDialog();
    it.run();
  }
  function shortcutsHelp() {
    const rows = [['C', 'New task or event'], [V.mod + 'K', 'Search and commands'], ['/', 'Search and commands'], ['R', 'Reflow the rest of today'], ['T', 'Go to Today'], ['← →', 'Previous or next week in Calendar'], ['?', 'Show this list'], ['Esc', 'Close']];
    openDialog(dlgHead('Keyboard shortcuts') + '<div class="keys">' + rows.map(([k, l]) => '<div class="line"><span>' + l + '</span>' + k.split(' ').map((x) => V.kbd(x)).join(' ') + '</div>').join('') + '</div>', () => {});
  }

  // ---------------- toasts and dialogs ----------------
  function toast(msg, action) {
    const host = $('#toasts');
    host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + msg + '</span>' + (action ? '<button type="button">' + esc(action.label) + '</button>' : '');
    if (action) el.querySelector('button').onclick = () => { el.remove(); action.run(); };
    host.appendChild(el);
    setTimeout(() => el.remove(), action ? 6500 : 3500);
  }
  App.toast = toast;

  const dlg = () => $('#dlg');
  function openDialog(html, onAction, variant = '') {
    const d = dlg();
    d.className = variant;
    d.innerHTML = '<div class="dlg">' + html + '</div>';
    d._onAction = onAction;
    if (!d.open) d.showModal();
    const firstInput = d.querySelector('input:not([type="checkbox"]), select, textarea');
    if (firstInput) firstInput.focus();
  }
  function closeDialog() { const d = dlg(); if (d.open) d.close(); }
  function dlgHead(title, sub) {
    return '<div class="dlg-head"><div><h2>' + title + '</h2>' + (sub ? '<p class="muted small" style="margin-top:4px">' + sub + '</p>' : '') + '</div><button class="btn btn-quiet btn-sm" data-dlg="close" aria-label="Close">' + icon('close') + '</button></div>';
  }
  function askMinutes(title, sub, value, onOk) {
    openDialog(dlgHead(esc(title), sub) +
      '<form data-dlg-form="minutes" class="row"><label class="field" for="dlgMinutes" style="flex:1"><span>Minutes</span><input class="input" id="dlgMinutes" type="number" min="1" max="900" value="' + value + '"></label></form>' +
      '<div class="dlg-actions"><button class="btn btn-primary" data-dlg="ok">Save</button><button class="btn btn-quiet" data-dlg="close">Cancel</button></div>',
      (act) => { if (act === 'ok') { const v = Number($('#dlgMinutes').value); if (v > 0) { closeDialog(); onOk(Math.round(v)); } } });
  }

  // ---------------- helpers ----------------
  const T = () => App.sim.today;
  const task = (id) => App.state.tasks.find((t) => t.id === id);
  const todayPlan = () => App.state.plans[T()];
  function addEvent(ev, source) {
    const e = { id: U.uid('ev'), kind: 'other', travel: 0, location: '', source, ...ev };
    App.state.events.push(e);
    return e;
  }
  const touchesToday = (ev) => (ev.date ? ev.date === T() : (ev.days || []).includes(U.dow(T())));
  function newTask(fields) {
    const t = {
      id: U.uid('t'), done: false, dropped: false, spent: 0, priority: 'normal', optional: false, avoidDays: [], postponeUntil: null, timer: null,
      createdAt: T(), aiSource: 'local', deadline: null, base: 30, category: 'other', heavy: false, ...fields,
    };
    App.state.tasks.push(t);
    return t;
  }

  // One click completes. Tracked time teaches the estimator; Undo reverses both.
  function completeTask(t, rowEl) {
    const before = { spent: t.spent, timer: t.timer };
    let spent = t.spent;
    if (t.timer) spent += Math.max(1, Math.round((Date.now() - t.timer.startedAt) / 60000));
    t.spent = spent; t.done = true; t.doneOn = T(); t.timer = null;
    let entry = null;
    if (!t.manual && t.base > 0 && spent >= 5) { entry = { category: t.category, estimate: t.base, actual: spent }; App.state.history.push(entry); }
    const finish = () => {
      commit({ replan: true });
      toast('Completed ' + esc(t.title) + (spent >= 5 ? ' in ' + dur(spent) : '') + '.', {
        label: 'Undo', run: () => {
          Object.assign(t, before, { done: false, doneOn: null });
          if (entry) App.state.history = App.state.history.filter((h) => h !== entry);
          commit({ replan: true });
        },
      });
    };
    if (rowEl && !REDUCED()) { rowEl.classList.add('is-completing'); setTimeout(finish, 220); } else finish();
  }

  function taskMenu(t) {
    const isDone = t.done || t.dropped;
    let body = dlgHead(esc(t.title), isDone ? (t.dropped ? 'Dropped' : 'Completed') : 'Estimate ' + dur(E.estimate(t)) + (t.deadline ? ' · due ' + U.fmtDate(t.deadline) : ''));
    if (!isDone) {
      body += '<form data-dlg-form="edit" class="two"><label class="field" for="editDue"><span>Due</span><input class="input" id="editDue" type="date" value="' + (t.deadline || '') + '"></label><label class="field" for="editEst"><span>Time needed (min)</span><input class="input" id="editEst" type="number" min="5" step="5" value="' + E.estimate(t) + '"></label><label class="field" for="editSpent"><span>Time spent so far (min)</span><input class="input" id="editSpent" type="number" min="0" step="5" value="' + t.spent + '"></label></form>';
      body += '<label class="row small" for="editHeavy"><input type="checkbox" id="editHeavy"' + (t.heavy ? ' checked' : '') + '> Needs focus, so schedule it in focus hours</label>';
      body += '<div class="dlg-actions"><button class="btn btn-primary" data-dlg="save">Save</button><button class="btn" data-dlg="postpone">Postpone a week</button><button class="btn" data-dlg="drop">Drop</button><button class="btn btn-quiet btn-danger" data-dlg="delete">Delete</button></div>';
    } else {
      body += '<div class="dlg-actions"><button class="btn" data-dlg="restore">Move back to open tasks</button><button class="btn btn-quiet btn-danger" data-dlg="delete">Delete</button></div>';
    }
    openDialog(body, (act) => {
      const snapshot = { ...t };
      const idx = App.state.tasks.indexOf(t);
      if (act === 'save') {
        const est = Number($('#editEst').value);
        if (est > 0 && est !== E.estimate(t)) { t.base = est; t.manual = true; }
        t.deadline = $('#editDue').value || null;
        t.spent = Math.max(0, Number($('#editSpent').value) || 0);
        t.heavy = $('#editHeavy').checked;
      }
      if (act === 'postpone') t.postponeUntil = U.addDays(T(), 7);
      if (act === 'drop') t.dropped = true;
      if (act === 'restore') { t.done = false; t.dropped = false; }
      if (act === 'delete') App.state.tasks = App.state.tasks.filter((x) => x !== t);
      closeDialog();
      commit({ replan: true, flip: App.route === 'today' });
      const msg = { save: 'Saved.', postpone: 'Postponed until ' + U.fmtDate(U.addDays(T(), 7)) + '.', drop: 'Dropped ' + esc(t.title) + '.', restore: 'Moved back to open tasks.', delete: 'Deleted ' + esc(t.title) + '.' }[act];
      if (!msg) return;
      toast(msg, act === 'save' ? null : {
        label: 'Undo', run: () => {
          if (act === 'delete') App.state.tasks.splice(Math.max(0, idx), 0, t);
          Object.assign(t, snapshot);
          commit({ replan: true });
        },
      });
    });
  }

  // ---------------- block dialog ----------------
  function blockDialog(key, date) {
    const plan = App.sim.days[date];
    // Days outside the planning window (past days, far weeks) still show their events.
    const b = (plan ? plan.blocks : E.fixedBlocks(date)).find((x) => x.key === key);
    if (!b) return;
    const isToday = date === T();
    const now = E.now();
    const when = (isToday ? 'Today' : U.fmtDate(date)) + ', <span class="mono">' + range(b.start, b.end) + '</span>';
    if (b.type === 'task') {
      const t = task(b.taskId);
      let body = dlgHead(esc(b.title), when + (b.parts > 1 ? ' · part ' + b.part + ' of ' + b.parts : ''));
      body += '<dl><dt>Type</dt><dd>' + (b.heavy ? 'Needs focus, placed in focus hours' : 'Light, placed in a lower-energy stretch') + '</dd>';
      if (t) body += '<dt>Due</dt><dd>' + (t.deadline ? U.fmtDate(t.deadline) : 'No deadline') + '</dd><dt>Progress</dt><dd>' + dur(t.spent) + ' of ' + dur(E.estimate(t)) + '</dd>';
      body += '</dl>';
      if (isToday) {
        body += '<div class="dlg-actions">';
        if (b.status === 'planned') body += '<button class="btn btn-primary" data-dlg="blk-start">Start</button><button class="btn" data-dlg="blk-done">Done</button><button class="btn" data-dlg="blk-skip">Skip</button>';
        if (b.status === 'running') body += '<button class="btn btn-primary" data-dlg="blk-done">Done</button>';
        if (b.status === 'running' || (b.status === 'planned' && b.start <= now)) body += '<button class="btn" data-dlg="blk-long">Ran long, add 15 min</button>';
        if (b.status === 'done' || b.status === 'skipped') body += '<button class="btn" data-dlg="blk-undo">Undo ' + (b.status === 'done' ? 'done' : 'skip') + '</button>';
        body += '</div>';
      } else {
        body += '<p class="small faint">Future days rebuild when something changes, so this block may move.</p>';
      }
      openDialog(body, (act) => blockAction(act, b, t));
    } else if (b.type === 'habit') {
      const h = App.state.habits.find((x) => x.id === b.habitId);
      let body = dlgHead(esc(b.title), when + ' · optional');
      if (isToday) body += '<div class="dlg-actions"><button class="btn btn-primary" data-dlg="habit-done">' + (h && h.doneDates.includes(date) ? 'Undo' : 'Did it') + '</button><button class="btn" data-dlg="habit-skip">Not today</button></div>';
      openDialog(body, (act) => {
        if (!h) return;
        if (act === 'habit-done') {
          if (h.doneDates.includes(date)) { h.doneDates = h.doneDates.filter((x) => x !== date); b.status = 'planned'; }
          else { h.doneDates.push(date); b.status = 'done'; }
          closeDialog(); commit();
        }
        if (act === 'habit-skip') { b.status = 'skipped'; b.type = 'free'; b.title = 'Free time'; b.protected = !!b.inProtected; closeDialog(); commit(); toast('Skipped. That time stays free.'); }
      });
    } else if (b.type === 'free' || b.type === 'open') {
      const ideas = E.suggest(Math.max(b.start, isToday ? now : 0), b.end, 3);
      const S = App.state;
      const friendsFree = S.friends.filter((f) => U.subtract([[b.start, b.end]], U.subtract([[0, 1440]], E.friendFree(f, date))).some(([x, y]) => y - x >= 30)).map((f) => f.name);
      let body = dlgHead(b.type === 'free' ? 'Protected free time' : 'Open time', when + ' · ' + dur(b.end - b.start));
      if (b.type === 'free') body += '<p class="small muted">Part of your daily ' + dur(S.settings.minFree) + ' minimum. Tasks never go here.</p>';
      body += '<ul class="notes">' + ideas.map((i) => '<li>' + esc(i.t) + ' <span class="faint">' + dur(i.min) + '</span></li>').join('') + '</ul>';
      if (!S.settings.interests.length) body += '<p class="small faint">Pick interests in <a href="#settings" data-dlg="close">Settings</a> for better ideas.</p>';
      if (friendsFree.length) body += '<p class="small muted">Also free: ' + esc(friendsFree.join(', ')) + '</p>';
      openDialog(body, () => {});
    } else if (b.type === 'event') {
      const ev = App.state.events.find((e) => e.id === b.eventId);
      if (!ev) return;
      const recurring = !!ev.days;
      const WEEK = [1, 2, 3, 4, 5, 6, 0];
      let body = dlgHead('Edit event', when);
      body += '<form class="evform" data-dlg-form="event" novalidate>';
      body += '<label class="field" for="evTitle"><span>Name</span><input class="input" id="evTitle" value="' + esc(ev.title) + '" autocomplete="off" required></label>';
      if (recurring) {
        body += '<fieldset class="scope"><legend class="sr">Apply changes to</legend>' +
          '<label><input type="radio" name="evScope" value="one" checked> Only ' + esc(U.fmtDate(date)) + '</label>' +
          '<label><input type="radio" name="evScope" value="all"> Every week</label></fieldset>';
        body += '<fieldset class="daypick" id="evDays" hidden><legend>Repeats on</legend><div>' +
          WEEK.map((d) => '<label><input type="checkbox" name="evDay" value="' + d + '"' + (ev.days.includes(d) ? ' checked' : '') + '><span>' + U.DAY_SHORT[d] + '</span></label>').join('') + '</div></fieldset>';
      } else {
        body += '<label class="field" for="evDate"><span>Date</span><input class="input" type="date" id="evDate" value="' + (ev.date || date) + '" required></label>';
      }
      body += '<div class="two"><label class="field" for="evStart"><span>Starts</span><input class="input" type="time" id="evStart" step="300" value="' + U.toInput(b.start) + '" required></label>' +
        '<label class="field" for="evEnd"><span>Ends</span><input class="input" type="time" id="evEnd" step="300" value="' + U.toInput(b.end) + '" required></label></div>';
      body += '<label class="field" for="evLoc"><span>Location <span class="faint">(adds travel time)</span></span><input class="input" id="evLoc" value="' + esc(ev.location || '') + '" autocomplete="off"></label>';
      if (ev.source === 'ics' || ev.source === 'upload') body += '<p class="small faint">Changes stay in Keepclear. The calendar or file it came from isn’t updated.</p>';
      body += '<p class="form-error" id="evError" role="alert" hidden></p>';
      body += '<div class="dlg-actions"><button class="btn btn-primary" type="submit">Save</button>' +
        (recurring ? '<button class="btn" type="button" data-dlg="ev-skipday">Skip this day</button>' : '') +
        '<button class="btn btn-quiet btn-danger" type="button" data-dlg="ev-delete">Delete' + (recurring ? ' every week' : '') + '</button></div></form>';

      openDialog(body, (act) => {
        const idx = App.state.events.indexOf(ev);
        if (act === 'save') return saveEvent(ev, date, recurring);
        if (act === 'ev-skipday') ev.skipDates = (ev.skipDates || []).concat(date);
        if (act === 'ev-delete') App.state.events = App.state.events.filter((e) => e !== ev);
        if (act !== 'ev-skipday' && act !== 'ev-delete') return;
        closeDialog();
        commit({ replan: true, flip: true });
        toast((act === 'ev-delete' ? 'Deleted ' : 'Skipped ') + esc(ev.title) + (act === 'ev-delete' ? '.' : ' on ' + U.fmtDate(date) + '.'), {
          label: 'Undo', run: () => {
            if (act === 'ev-delete') App.state.events.splice(Math.max(0, idx), 0, ev);
            else ev.skipDates = ev.skipDates.filter((x) => x !== date);
            commit({ replan: true });
          },
        });
      });
      const title = $('#evTitle');
      if (title) { title.focus(); title.select(); }
    }
  }

  function saveEvent(ev, date, recurring) {
    const err = $('#evError');
    const fail = (msg, fieldId) => {
      err.textContent = msg; err.hidden = false;
      const f = fieldId && $('#' + fieldId);
      if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
    };
    $$('.evform [aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
    const title = $('#evTitle').value.trim();
    const startVal = $('#evStart').value, endVal = $('#evEnd').value;
    if (!title) return fail('Give the event a name.', 'evTitle');
    if (!startVal) return fail('Add a start time.', 'evStart');
    if (!endVal) return fail('Add an end time.', 'evEnd');
    const start = U.fromInput(startVal), end = U.fromInput(endVal);
    if (end <= start) return fail('The end time has to be after the start time.', 'evEnd');
    const location = $('#evLoc').value.trim();
    const travel = location ? (ev.location ? ev.travel || App.state.settings.travelDefault : App.state.settings.travelDefault) : 0;
    const before = { ...ev, days: ev.days ? ev.days.slice() : undefined, skipDates: (ev.skipDates || []).slice() };
    const scope = recurring ? ($('input[name="evScope"]:checked') || {}).value : 'all';
    let summary, undo;

    if (recurring && scope === 'one') {
      // Pull this one day out of the series and give it its own event.
      ev.skipDates = (ev.skipDates || []).concat(date);
      const single = addEvent({ title, date, start, end, location, travel, kind: ev.kind }, ev.source);
      summary = esc(title) + ' on ' + U.fmtDate(date) + ' is now ' + range(start, end) + '.';
      undo = () => { App.state.events = App.state.events.filter((x) => x !== single); ev.skipDates = before.skipDates; };
    } else {
      let when;
      if (recurring) {
        const days = $$('input[name="evDay"]:checked').map((c) => Number(c.value));
        if (!days.length) return fail('Pick at least one day.', null);
        ev.days = days;
        when = 'every ' + [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => U.DAY_SHORT[d]).join(', ');
      } else {
        const newDate = $('#evDate').value;
        if (!newDate) return fail('Pick a date.', 'evDate');
        ev.date = newDate;
        when = U.fmtDate(newDate);
        App.ui.calWeek = U.weekStart(newDate); App.ui.calDay = newDate;
      }
      Object.assign(ev, { title, start, end, location, travel });
      summary = esc(title) + ' is now ' + when + ', ' + range(start, end) + '.';
      undo = () => { Object.keys(ev).forEach((k) => { if (!(k in before)) delete ev[k]; }); Object.assign(ev, before); };
    }
    closeDialog();
    commit({ replan: true, flip: true });
    toast(summary, { label: 'Undo', run: () => { undo(); commit({ replan: true, flip: true }); } });
  }

  function blockAction(act, b, t) {
    const now = E.now();
    if (act === 'blk-start') {
      b.status = 'running';
      if (t) t.timer = { startedAt: Date.now(), blockKey: b.key };
      closeDialog(); commit();
      toast('Timer started.');
    }
    if (act === 'blk-done') {
      let minutes = b.end - b.start;
      if (t && t.timer) { const el = Math.round((Date.now() - t.timer.startedAt) / 60000); if (el >= 2) minutes = el; }
      b.status = 'done'; b.actual = minutes;
      if (t) { t.spent += minutes; t.timer = null; }
      closeDialog(); commit();
      if (t && t.spent >= E.estimate(t)) toast('That covers the estimate for ' + esc(t.title) + '.', { label: 'Complete task', run: () => completeTask(t) });
      else toast('Logged ' + dur(minutes) + '.', { label: 'Undo', run: () => { b.status = 'planned'; if (t) t.spent = Math.max(0, t.spent - minutes); commit(); } });
    }
    if (act === 'blk-skip') {
      b.status = 'skipped'; b.handled = false;
      closeDialog(); commit();
      toast('Skipped.', { label: 'Reflow', run: reflow });
    }
    if (act === 'blk-undo') {
      if (b.status === 'done' && t) t.spent = Math.max(0, t.spent - (b.actual || b.end - b.start));
      b.status = 'planned';
      closeDialog(); commit();
    }
    if (act === 'blk-long') {
      const fixed = E.fixedBlocks(T()).filter((x) => x.start >= b.end).sort((a, c) => a.start - c.start)[0];
      const limit = fixed ? fixed.start : App.state.settings.bed - 60;
      const newEnd = Math.min(b.end + 15, limit);
      if (newEnd <= b.end) { toast('No room: ' + esc(fixed ? fixed.title : 'wind-down time') + ' starts at ' + clock(limit) + '.'); return; }
      const added = newEnd - b.end;
      b.end = newEnd;
      b.status = 'running';
      if (t && !t.timer) t.timer = { startedAt: Date.now() - (now - b.start) * 60000, blockKey: b.key };
      closeDialog();
      E.replan({ from: newEnd });
      save(); recompute(); render({ flip: true });
      toast('Added ' + added + ' minutes and rebuilt the rest of today.');
    }
  }

  function reflow() {
    const r = E.replan();
    save(); recompute();
    if (App.route !== 'today') { App.route = 'today'; location.hash = 'today'; }
    render({ flip: true });
    const changed = r.moved + r.removed;
    toast('Rebuilt from ' + clock(r.from) + (changed ? ', ' + changed + ' block' + (changed > 1 ? 's' : '') + ' moved' : ', nothing needed to move') + '.');
  }

  // ---------------- uploads ----------------
  async function runExtraction(kind, payload) {
    const ui = App.ui;
    ui.upload = null;
    ui.uploadBusy = kind === 'pdf' ? 'Reading the PDF' : 'Looking for dates';
    render();
    let result = null;
    try {
      if (kind === 'image') {
        const items = await AI.extractFromImages([payload], 'syllabus or flyer photo', T());
        result = items ? { items, by: 'claude' } : { items: [], by: 'local', error: 'Reading photos needs Claude, which isn’t available here. Try a PDF with selectable text.' };
      } else {
        const text = await AI.pdfText(payload);
        const r = await AI.extractFromPdfText(text, T());
        result = { ...r, error: text.trim() ? null : 'This PDF has no selectable text. Try a photo of it.' };
      }
    } catch (e) {
      result = { items: [], by: 'local', error: 'Couldn’t read that file. Try a clear photo or a text PDF.' };
    }
    ui.uploadBusy = '';
    ui.upload = result;
    render();
  }

  // ---------------- click actions ----------------
  const actions = {
    'quick-add': () => quickAdd(),
    command: () => openCommand(),
    shortcuts: () => shortcutsHelp(),
    seg: (el) => {
      const input = $('#quickText');
      if (!input) return;
      input.dataset.force = el.dataset.kind;
      updateSmart(input);
      input.focus();
    },
    slot: (el, e) => {
      const s = App.state.settings;
      const rect = el.getBoundingClientRect();
      const minute = Math.round((s.wake + (e.clientY - rect.top) / Number(el.dataset.px)) / 30) * 30;
      const date = el.dataset.date;
      const d = U.parseKey(date);
      quickAdd(' ' + U.MONTH_SHORT[d.getMonth()] + ' ' + d.getDate() + ' at ' + clock(Math.min(minute, s.bed - 60)).toLowerCase(), 0);
      const input = $('#quickText');
      input.dataset.force = 'event';
      updateSmart(input);
    },
    'more-menu': () => {
      openDialog(dlgHead('More') + '<nav class="nav" aria-label="More">' +
        [['habits', 'Goals'], ['friends', 'Friends'], ['recap', 'Weekly recap'], ['settings', 'Settings']].map(([r, l]) => '<a href="#' + r + '" data-dlg="close">' + l + '</a>').join('') +
        '</nav><button class="btn" data-action="command">Search</button>', () => {});
    },
    reflow,
    block: (el) => blockDialog(el.dataset.key, el.dataset.date),
    rec: (el) => {
      const t = task(el.dataset.task);
      if (!t) return;
      const prev = { dropped: t.dropped, postponeUntil: t.postponeUntil };
      if (el.dataset.kind === 'drop') t.dropped = true; else t.postponeUntil = el.dataset.until;
      commit({ replan: true, flip: true });
      toast((el.dataset.kind === 'drop' ? 'Dropped ' : 'Postponed ') + esc(t.title) + (el.dataset.kind === 'drop' ? '.' : ' until ' + U.fmtDate(el.dataset.until) + '.'), {
        label: 'Undo', run: () => { Object.assign(t, prev); commit({ replan: true, flip: true }); },
      });
    },
    extend: (el) => {
      const t = task(el.dataset.task);
      if (!t || !t.deadline) return;
      const old = t.deadline;
      t.deadline = U.addDays(t.deadline, 2);
      commit({ replan: true, flip: true });
      toast(esc(t.title) + ' is now due ' + U.fmtDate(t.deadline) + '.', { label: 'Undo', run: () => { t.deadline = old; commit({ replan: true }); } });
    },
    move: (el) => {
      const t = task(el.dataset.task);
      if (!t) return;
      t.avoidDays = (t.avoidDays || []).concat(el.dataset.from);
      commit({ replan: el.dataset.from === T(), flip: true });
      toast('Moved ' + esc(t.title) + ' off ' + U.DAY_LONG[U.dow(el.dataset.from)] + '.', {
        label: 'Undo', run: () => { t.avoidDays = t.avoidDays.filter((x) => x !== el.dataset.from); commit({ replan: true }); },
      });
    },
    'goto-cal': (el) => { App.ui.calWeek = U.weekStart(el.dataset.date); App.ui.calDay = el.dataset.date; location.hash = 'calendar'; },
    'cal-week': (el) => weekNav(Number(el.dataset.dir)),
    'cal-day': (el) => { App.ui.calDay = el.dataset.date; render(); },
    'remove-ics': () => {
      const removed = App.state.events.filter((e) => e.source === 'ics');
      App.state.events = App.state.events.filter((e) => e.source !== 'ics');
      commit({ replan: true });
      toast('Removed ' + removed.length + ' imported event' + (removed.length === 1 ? '' : 's') + '.', { label: 'Undo', run: () => { App.state.events.push(...removed); commit({ replan: true }); } });
    },
    'upload-add': () => {
      const items = App.ui.upload.items;
      let events = 0, tasks = 0;
      $$('[data-upload-i]').forEach((cb) => {
        if (!cb.checked) return;
        const it = items[Number(cb.dataset.uploadI)];
        if (it.kind === 'event' && it.start != null) {
          addEvent({ title: it.title, date: it.date, start: it.start, end: it.end || it.start + 60, kind: 'class' }, 'upload');
          events++;
        } else {
          const title = it.kind === 'deadline' ? it.title : 'Prepare for ' + it.title.replace(/,.*$/, '');
          const est = AI.estimateLocal(it.kind === 'deadline' ? it.title : 'study ' + it.title);
          newTask({ title, deadline: it.kind === 'deadline' ? it.date : U.addDays(it.date, -1), base: est.minutes, category: est.category, heavy: est.heavy, aiSource: 'upload' });
          tasks++;
        }
      });
      App.ui.upload = null;
      commit({ replan: true });
      toast('Added ' + events + ' event' + (events === 1 ? '' : 's') + ' and ' + tasks + ' task' + (tasks === 1 ? '' : 's') + '.');
    },
    'sort-dump': async () => {
      const text = $('#dumpText').value.trim();
      App.ui.dumpDraft = $('#dumpText').value;
      if (!text) { $('#dumpText').focus(); return; }
      App.ui.dumpBusy = true; App.ui.dump = null; render();
      App.ui.dump = await AI.sortDump(text, T());
      App.ui.dumpBusy = false; render();
    },
    'dump-add': () => {
      const d = App.ui.dump;
      let n = 0;
      $$('[data-dump]').forEach((cb) => {
        if (!cb.checked) return;
        const [kind, i] = cb.dataset.dump.split(':');
        const it = (kind === 'task' ? d.tasks : kind === 'event' ? d.events : d.ideas)[Number(i)];
        if (kind === 'task') newTask({ title: it.title, deadline: it.deadline, base: it.minutes, category: it.category, heavy: it.heavy, aiSource: d.by });
        if (kind === 'event') addEvent(it, 'typed');
        if (kind === 'idea') App.state.ideas.push({ id: U.uid('i'), text: it, from: 'brain dump' });
        n++;
      });
      App.ui.dump = null; App.ui.dumpDraft = '';
      commit({ replan: true });
      toast('Added ' + n + ' item' + (n === 1 ? '' : 's') + '.');
    },
    'dump-clear': () => { App.ui.dump = null; render(); },
    'idea-task': (el) => {
      const idea = App.state.ideas.find((i) => i.id === el.dataset.id);
      if (!idea) return;
      const est = AI.estimateLocal(idea.text);
      newTask({ title: idea.text, base: est.minutes, category: est.category, heavy: est.heavy });
      App.state.ideas = App.state.ideas.filter((i) => i !== idea);
      commit({ replan: true });
      toast('Moved to tasks.');
    },
    'idea-del': (el) => {
      const idea = App.state.ideas.find((i) => i.id === el.dataset.id);
      App.state.ideas = App.state.ideas.filter((i) => i !== idea);
      commit();
      if (idea) toast('Removed idea.', { label: 'Undo', run: () => { App.state.ideas.push(idea); commit(); } });
    },
    'finish-task': (el) => {
      const t = task(el.dataset.id);
      if (!t) return;
      if (t.done || t.dropped) { t.done = false; t.dropped = false; commit({ replan: true }); return; }
      completeTask(t, el.closest('.trow'));
    },
    'start-task': (el) => {
      const t = task(el.dataset.id);
      if (!t) return;
      t.timer = { startedAt: Date.now() };
      commit();
    },
    'stop-task': (el) => {
      const t = task(el.dataset.id);
      if (!t || !t.timer) return;
      const elapsed = Math.max(1, Math.round((Date.now() - t.timer.startedAt) / 60000));
      askMinutes('How long did you work?', 'The timer tracked ' + dur(elapsed) + '.', elapsed, (m) => {
        t.spent += m; t.timer = null;
        commit({ replan: true });
        toast('Logged ' + dur(m) + '. ' + dur(E.remaining(t)) + ' left.');
      });
    },
    'task-menu': (el) => { const t = task(el.dataset.id); if (t) taskMenu(t); },
    'habit-today': (el) => {
      const h = App.state.habits.find((x) => x.id === el.dataset.id);
      if (!h) return;
      const today = T();
      if (h.doneDates.includes(today)) h.doneDates = h.doneDates.filter((x) => x !== today); else h.doneDates.push(today);
      const pb = todayPlan().blocks.find((b) => b.type === 'habit' && b.habitId === h.id);
      if (pb) pb.status = h.doneDates.includes(today) ? 'done' : 'planned';
      commit();
    },
    'habit-del': (el) => {
      const h = App.state.habits.find((x) => x.id === el.dataset.id);
      App.state.habits = App.state.habits.filter((x) => x !== h);
      commit({ replan: true });
      if (h) toast('Removed ' + esc(h.title) + '.', undoRestore('habits', h));
    },
    interest: (el) => {
      const s = App.state.settings;
      const i = el.dataset.i;
      s.interests = s.interests.includes(i) ? s.interests.filter((x) => x !== i) : s.interests.concat(i);
      commit();
    },
    'friend-del': (el) => {
      const f = App.state.friends.find((x) => x.id === el.dataset.id);
      App.state.friends = App.state.friends.filter((x) => x !== f);
      App.ui.friendSel.delete(el.dataset.id);
      commit();
      if (f) toast('Removed ' + esc(f.name) + '.', { label: 'Undo', run: () => { App.state.friends.push(f); App.ui.friendSel.add(f.id); commit(); } });
    },
    'add-friend': () => {
      openDialog(dlgHead('Add a friend') +
        '<form data-form="friend" style="display:flex;flex-direction:column;gap:12px"><label class="field" for="friendName"><span>Name</span><input class="input" id="friendName" autocomplete="off" required></label>' +
        '<label class="field" for="friendBusy"><span>When are they usually busy?</span><textarea class="input" id="friendBusy" rows="3" placeholder="classes MWF 9–2, work Tue/Thu 6–9pm"></textarea></label>' +
        '<div class="dlg-actions"><button class="btn btn-primary" type="submit">Add friend</button><button class="btn btn-quiet" type="button" data-dlg="close">Cancel</button></div></form>', () => {});
    },
    hangout: (el) => {
      const ids = [...App.ui.friendSel].filter((id) => App.state.friends.some((f) => f.id === id));
      const names = ids.map((id) => App.state.friends.find((f) => f.id === id).name);
      const start = Number(el.dataset.start), end = Math.min(Number(el.dataset.end), start + 120);
      const date = el.dataset.date;
      const ev = addEvent({ title: 'Hang out with ' + names.join(', '), date, start, end, kind: 'social' }, 'typed');
      commit({ replan: date === T() });
      toast('Added to your calendar, ' + U.fmtDate(date) + ' ' + range(start, end) + '.', undoRemove('events', ev));
    },
    'recap-week': (el) => { App.ui.recapIdx = Number(el.dataset.i); render(); },
    reset: () => {
      openDialog(dlgHead('Clear all data?', 'Your events, tasks, goals, friends and history in this browser will be deleted. This can’t be undone.') + '<div class="dlg-actions"><button class="btn btn-danger" data-dlg="ok">Clear everything</button><button class="btn btn-quiet" data-dlg="close">Cancel</button></div>', (act) => {
        if (act !== 'ok') return;
        App.state = Data.clear();
        E.bind(App.state);
        App.ui.friendSel = new Set();
        App.ui.dumpDraft = ''; App.ui.dump = null; App.ui.upload = null;
        closeDialog();
        recompute(); save(); render();
        toast('All data cleared.');
      });
    },
  };
  const undoRestore = (listKey, item) => ({ label: 'Undo', run: () => { App.state[listKey].push(item); commit({ replan: true }); } });

  function weekNav(dir) {
    App.ui.calWeek = dir === 0 ? U.weekStart(T()) : U.addDays(App.ui.calWeek, 7 * dir);
    App.ui.calDay = dir === 0 ? T() : App.ui.calWeek;
    render();
  }

  function parseHabit(text) {
    const lower = text.toLowerCase();
    let per = 3;
    const m1 = lower.match(/(\d+)\s*(?:x|times)\b/) || lower.match(/\b(once|twice)\b/);
    if (m1) per = m1[1] === 'once' ? 1 : m1[1] === 'twice' ? 2 : Number(m1[1]);
    if (/\b(daily|every ?day)\b/.test(lower)) per = 7;
    let minutes = 30;
    const m2 = lower.match(/(\d+)\s*(min|minutes|m)\b/) || lower.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)\b/);
    if (m2) minutes = /^h/.test(m2[2]) ? Math.round(Number(m2[1]) * 60) : Number(m2[1]);
    const title = text.replace(/\b\d+\s*(x|times)\b.*?(a|per)\s+week\b/i, '').replace(/\b(once|twice)\s+(a|per)\s+week\b/i, '').replace(/\b(daily|every ?day)\b/i, '')
      .replace(/\bfor\s+\d+(?:\.\d+)?\s*(min|minutes|m|h|hr|hrs|hours?)\b/i, '').replace(/\b\d+\s*(min|minutes)\b/i, '').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
    const interest = Data.INTERESTS.find((i) => lower.includes(i.replace(/ing$/, '')) || (i === 'running' && /\brun/.test(lower))) || 'other';
    return { title: title || 'New habit', perWeek: U.clamp(per, 1, 7), minutes: U.clamp(minutes, 5, 240), interest };
  }

  // ---------------- wiring ----------------
  function wire() {
    document.addEventListener('click', (e) => {
      const cmd = e.target.closest('[data-cmd]');
      if (cmd) { runCommand(Number(cmd.dataset.cmd)); return; }
      const dlgBtn = e.target.closest('[data-dlg]');
      if (dlgBtn) {
        const act = dlgBtn.dataset.dlg;
        if (act === 'close') { closeDialog(); return; }
        const d = dlg();
        if (d._onAction) d._onAction(act);
        return;
      }
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const fn = actions[el.dataset.action];
      if (!fn || el.tagName === 'INPUT') return;
      e.preventDefault();
      fn(el, e);
    });
    dlg().addEventListener('click', (e) => { if (e.target === dlg()) closeDialog(); });
    dlg().addEventListener('submit', (e) => {
      if (e.target.dataset.form) return;
      e.preventDefault();
      const d = dlg();
      if (d._onAction) d._onAction(e.target.dataset.dlgForm === 'minutes' ? 'ok' : 'save');
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dlg().open && dlg().classList.contains('dlg-cmd')) closeDialog(); else openCommand(); return; }
      if (e.key === 'Enter' && !e.isComposing && e.target.dataset && e.target.dataset.smart) {
        e.preventDefault();
        const form = e.target.closest('form');
        if (form) form.requestSubmit();
        return;
      }
      if (e.target.id === 'cmdInput') {
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdIndex = Math.min(cmdItems.length - 1, cmdIndex + 1); renderCommand(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); cmdIndex = Math.max(0, cmdIndex - 1); renderCommand(); }
        if (e.key === 'Enter') { e.preventDefault(); runCommand(cmdIndex); }
        return;
      }
      if (dlg().open || mod || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      const k = e.key;
      if (k === 'c' || k === 'n') { e.preventDefault(); quickAdd(); }
      else if (k === '/') { e.preventDefault(); openCommand(); }
      else if (k === '?') { e.preventDefault(); shortcutsHelp(); }
      else if (k === 'r') { e.preventDefault(); reflow(); }
      else if (k === 't') { e.preventDefault(); if (App.route === 'calendar') weekNav(0); else location.hash = 'today'; }
      else if ((k === 'ArrowLeft' || k === 'ArrowRight') && App.route === 'calendar') { e.preventDefault(); weekNav(k === 'ArrowLeft' ? -1 : 1); }
    });

    document.addEventListener('change', (e) => {
      const el = e.target;
      const S = App.state, s = S.settings;
      if (el.name === 'evScope') { const days = $('#evDays'); if (days) days.hidden = el.value !== 'all'; return; }
      if (el.dataset.action === 'friend-sel') {
        if (el.checked) App.ui.friendSel.add(el.dataset.id); else App.ui.friendSel.delete(el.dataset.id);
        return render();
      }
      if (el.id === 'icsFile' && el.files && el.files[0]) {
        el.files[0].text().then((text) => {
          const { events, skipped } = AI.parseIcs(text, T());
          if (!events.length) { toast('No usable events in that file. Keepclear reads timed events from the past week onward.'); return render(); }
          const uids = new Set(events.map((x) => x.uid).filter(Boolean));
          App.state.events = App.state.events.filter((x) => !(x.source === 'ics' && uids.has(x.uid)));
          events.forEach((x) => addEvent(x, 'ics'));
          commit({ replan: true });
          toast('Imported ' + events.length + ' event' + (events.length === 1 ? '' : 's') + (skipped ? ', skipped ' + skipped + ' all-day or older ones' : '') + '.');
        }).catch(() => toast('Couldn’t read that file. Use an .ics export.'));
        return;
      }
      if (el.id === 'uploadFile' && el.files && el.files[0]) {
        const f = el.files[0];
        return runExtraction(/pdf/i.test(f.type) || /\.pdf$/i.test(f.name) ? 'pdf' : 'image', f);
      }
      if (el.id === 'demoNow') { s.demoNow = Number(el.value); save(); recompute(); render(); return; }
      if (el.dataset.set) {
        const key = el.dataset.set;
        let v = el.value;
        if (key === 'wake' || key === 'bed') v = U.fromInput(v);
        else if (key !== 'clockMode') v = Number(v);
        if (key === 'bed' && v <= s.wake + 240) { toast('Bedtime has to be at least 4 hours after waking.'); return render(); }
        if (key === 'wake' && v >= s.bed - 240) { toast('Wake-up has to be at least 4 hours before bed.'); return render(); }
        s[key] = v;
        if (['wake', 'bed', 'morning'].includes(key)) delete S.plans[T()];
        commit({ replan: !['wake', 'bed', 'morning'].includes(key) });
        return toast('Saved.');
      }
      if (el.dataset.focus) {
        const [i, part] = el.dataset.focus.split(':');
        s.focus[Number(i)][part] = U.fromInput(el.value);
        if (s.focus[Number(i)].end <= s.focus[Number(i)].start) { toast('Focus hours have to end after they start.'); s.focus[Number(i)].end = s.focus[Number(i)].start + 60; }
        commit({ replan: true });
        return toast('Saved.');
      }
    });

    document.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.smart) updateSmart(el);
      if (el.id === 'cmdInput') { cmdIndex = 0; renderCommand(); }
      if (el.id === 'dumpText') App.ui.dumpDraft = el.value;
      if (el.id === 'demoNow') { const lab = el.parentElement.querySelector('.mono'); if (lab) lab.textContent = clock(Number(el.value)); }
      if (el.id === 'setFloor') { const o = el.parentElement.querySelector('output'); if (o) o.textContent = dur(Number(el.value)); }
    });
    document.addEventListener('scroll', (e) => {
      const el = e.target;
      if (el.dataset && el.dataset.smart) { const m = el.closest('.smart').querySelector('.smart-mirror'); if (m) m.scrollLeft = el.scrollLeft; }
    }, true);
    document.addEventListener('selectionchange', () => {
      const el = document.activeElement;
      if (el && el.dataset && el.dataset.smart) { const m = el.closest('.smart').querySelector('.smart-mirror'); if (m) m.scrollLeft = el.scrollLeft; }
    });

    document.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-form]');
      if (!form) return;
      e.preventDefault();
      const kind = form.dataset.form;
      if (kind === 'smart' || kind === 'quick') {
        const input = form.querySelector('[data-smart]');
        if (!input.value.trim()) { input.focus(); return; }
        const ok = await addFromSmart(input);
        if (!ok) { input.classList.add('is-invalid'); setTimeout(() => input.classList.remove('is-invalid'), 400); return; }
        if (kind === 'quick') closeDialog();
        else { const fresh = document.getElementById(input.id); if (fresh) { fresh.value = ''; updateSmart(fresh); fresh.focus(); } }
        return;
      }
      if (kind === 'habit') {
        const text = $('#habitText').value.trim();
        if (!text) return;
        const h = { id: U.uid('h'), doneDates: [], ...parseHabit(text) };
        App.state.habits.push(h);
        commit({ replan: true });
        toast('Added ' + esc(h.title) + ', ' + h.perWeek + '× a week for ' + dur(h.minutes) + '.', undoRemove('habits', h));
        return;
      }
      if (kind === 'friend') {
        const name = $('#friendName').value.trim();
        const busyText = $('#friendBusy').value.trim();
        if (!name) return;
        const busy = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        let unread = 0;
        if (busyText) {
          const parsed = await AI.parseEvents(busyText.replace(/,\s*/g, '\n'), T());
          parsed.events.forEach((ev) => {
            const days = ev.days || (ev.date ? [U.dow(ev.date)] : []);
            days.forEach((d) => busy[d].push([ev.start, ev.end]));
          });
          unread = busyText.split(/\n|,|;/).filter((x) => x.trim()).length - parsed.events.length;
        }
        const f = { id: U.uid('f'), name, shared: true, wake: 450, bed: 1410, busy };
        App.state.friends.push(f);
        App.ui.friendSel.add(f.id);
        closeDialog();
        commit();
        toast('Added ' + esc(name) + '.' + (unread > 0 ? ' Couldn’t read ' + unread + ' part' + (unread === 1 ? '' : 's') + ' of their week. Include days and times, like “Tue/Thu 6–9pm”.' : ''));
      }
    });

    document.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('#dropzone'); if (z) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      const z = e.target.closest && e.target.closest('#dropzone');
      if (!z) return;
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) runExtraction(/pdf/i.test(f.type) ? 'pdf' : 'image', f);
    });

    window.addEventListener('hashchange', () => go(location.hash.slice(1)));
    window.matchMedia('(max-width: 860px)').addEventListener('change', () => { if (App.route === 'calendar') render(); });
    AI.onChange(() => render());
  }

  function tickTimers() {
    $$('[data-timer]').forEach((el) => {
      const t = task(el.dataset.timer);
      if (!t || !t.timer) { el.textContent = ''; return; }
      const s = Math.floor((Date.now() - t.timer.startedAt) / 1000);
      el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    });
  }

  function start() {
    App.state = Data.load();
    E.bind(App.state);
    App.ui.calWeek = U.weekStart(U.todayKey());
    App.ui.calDay = U.todayKey();
    App.ui.friendSel = new Set(App.state.friends.map((f) => f.id));
    recompute();
    save();
    renderShell();
    wire();
    const initial = location.hash.slice(1);
    App.route = ROUTES.includes(initial) ? initial : 'today';
    render();
    setInterval(tickTimers, 1000);
    setInterval(() => {
      if (App.state.settings.clockMode === 'real' && (App.route === 'today' || App.route === 'calendar') && !dlg().open) { recompute(); render(); }
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
