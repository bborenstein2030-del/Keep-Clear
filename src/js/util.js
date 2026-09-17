/* Time, date and DOM helpers shared by every module. */
(function () {
  const U = {};

  U.DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  U.DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  U.MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  U.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

  // ---- dates (local, keyed YYYY-MM-DD) ----
  U.key = (d) => {
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  };
  U.parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  U.addDays = (k, n) => { const d = U.parseKey(k); d.setDate(d.getDate() + n); return U.key(d); };
  U.todayKey = () => U.key(new Date());
  U.dow = (k) => U.parseKey(k).getDay();
  U.diffDays = (a, b) => Math.round((U.parseKey(b) - U.parseKey(a)) / 86400000);
  U.weekStart = (k) => { const w = U.dow(k); return U.addDays(k, w === 0 ? -6 : 1 - w); };
  U.fmtDate = (k, style = 'short') => {
    const d = U.parseKey(k);
    if (style === 'long') return U.DAY_LONG[d.getDay()] + ', ' + U.MONTH_LONG[d.getMonth()] + ' ' + d.getDate();
    if (style === 'md') return U.MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
    return U.DAY_SHORT[d.getDay()] + ' ' + U.MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
  };
  U.relDay = (k, today) => {
    const n = U.diffDays(today, k);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n > 1 && n < 7) return U.DAY_SHORT[U.dow(k)];
    if (n < 0) return Math.abs(n) + 'd ago';
    return U.fmtDate(k, 'md');
  };

  // ---- minutes of day ----
  U.clock = (min, opts = {}) => {
    min = Math.round(min);
    let h = Math.floor(min / 60) % 24, m = min % 60;
    const ap = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    const mm = m === 0 && opts.short ? '' : ':' + String(m).padStart(2, '0');
    return h12 + mm + (opts.noAp ? '' : ' ' + ap);
  };
  U.range = (s, e) => {
    const sameAp = (s < 720) === (e < 720);
    return U.clock(s, { short: true, noAp: sameAp }) + '–' + U.clock(e, { short: true });
  };
  U.dur = (min) => {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + 'm';
    if (!m) return h + 'h';
    return h + 'h ' + m + 'm';
  };
  U.toInput = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  U.fromInput = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  U.round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  U.clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // ---- interval math on [start, end) pairs ----
  U.subtract = (free, busy) => {
    let out = free.map((x) => [x[0], x[1]]);
    for (const [bs, be] of busy) {
      const next = [];
      for (const [s, e] of out) {
        if (be <= s || bs >= e) { next.push([s, e]); continue; }
        if (bs > s) next.push([s, bs]);
        if (be < e) next.push([be, e]);
      }
      out = next;
    }
    return out.filter(([s, e]) => e - s > 0);
  };
  U.overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

  // ---- DOM ----
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  // Small line icons, one stroke weight, drawn for this app.
  const P = {
    today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    tasks: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.5 6.3 1.4 1.4 2.3-2.6M3.5 11.8l1.4 1.4 2.3-2.6"/><circle cx="5.2" cy="17.5" r="1.2"/>',
    habits: '<path d="M4 18c3-1 4.5-4 5-7 .6 3 2 6 5 7"/><path d="M14 18c1.8-.7 3.3-2.6 4-5"/><circle cx="9" cy="6.5" r="2.2"/>',
    recap: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    reflow: '<path d="M4 8h11a4 4 0 0 1 0 8H8"/><path d="m11 13-3 3 3 3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    skip: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    car: '<path d="M5 16.5V12l2-5h10l2 5v4.5M3.5 16.5h17M7.5 16.5v2M16.5 16.5v2"/><circle cx="8" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.2"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevL: '<path d="m15 5-7 7 7 7"/>',
    chevR: '<path d="m9 5 7 7-7 7"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12h3.5"/>',
    pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    long: '<path d="M4 12h12M12 8l4 4-4 4M20 6v12"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  };
  U.icon = (name, cls = '') =>
    '<svg class="ic ' + cls + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';

  window.U = U;
})();
