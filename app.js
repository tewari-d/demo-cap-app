// Daymark – mark each day green or red, and log cravings when they hit.
// All data lives in this device's local storage; nothing is ever sent anywhere.

const STORE_KEY = 'daymark.v1';
const DAY_STARTS_AT_HOUR = 4;          // before 4 am still counts as the previous day
const RIDE_OUT_SECONDS = 180;          // most cravings pass within a few minutes
const LEVELS = ['Mild', 'Strong', 'Intense'];
const TRIGGERS = ['Coffee', 'Stress', 'After meal', 'Alcohol', 'Boredom', 'Social', 'Other'];
const BADGES = [
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];
const CELEBRATE_AT = [7, 30, 100, 365];
const SLIP_MESSAGES = [
  'One red day doesn’t undo your progress. Tomorrow is a fresh green day.',
  'Be kind to yourself. Every green day you had still counts.',
  'Slips are part of the road. Notice what set it off, and go again tomorrow.',
];

let state = load();
let tab = 'today';
let calendarMonth = todayKey().slice(0, 7);   // 'YYYY-MM'
let editingCraving = null;                     // index of the craving open in the sheet
let breatheTimer = null;
let renderedFor = null;                        // the day the screen was last drawn for


// ---------- storage ----------

function freshState() {
  return { settings: {}, days: {}, cravings: [], startDay: todayKey(), setupDone: false, lastExport: null };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) return { ...freshState(), ...saved };
  } catch (e) { /* unreadable storage: start fresh */ }
  return freshState();
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save on this device');
  }
}


// ---------- dates (days are 'YYYY-MM-DD' strings in local time) ----------

function keyOf(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);   // noon keeps daylight-saving shifts from changing the day
}

function addDays(key, n) {
  const date = dateOf(key);
  date.setDate(date.getDate() + n);
  return keyOf(date);
}

function daysBetween(fromKey, toKey) {
  return Math.round((dateOf(toKey) - dateOf(fromKey)) / 86400000);
}

function todayKey() {
  const now = new Date();
  return now.getHours() < DAY_STARTS_AT_HOUR ? addDays(keyOf(now), -1) : keyOf(now);
}

function nowStamp() {   // e.g. '2026-09-30T16:42', local time
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${keyOf(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function cravingDay(craving) {
  const [key, time] = craving.t.split('T');
  return Number(time.slice(0, 2)) < DAY_STARTS_AT_HOUR ? addDays(key, -1) : key;
}

function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  return keyOf(new Date(y, m - 1 + n, 1, 12)).slice(0, 7);
}


// ---------- formatting ----------

function formatDay(key, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return dateOf(key).toLocaleDateString(undefined, options);
}

function formatTime(stamp) {
  const [h, m] = stamp.slice(11).split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatHour(hour) {   // 16 -> '4 pm'
  return `${hour % 12 || 12} ${hour < 12 || hour === 24 ? 'am' : 'pm'}`;
}

function money(amount) {
  return `${state.settings.currency || ''}${Math.round(amount).toLocaleString()}`;
}

function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text ?? '').replace(/[&<>"']/g, ch => entities[ch]);
}


// ---------- numbers ----------

function greenDays() {
  return Object.values(state.days).filter(mark => mark === 'green').length;
}

function currentStreak() {
  let day = todayKey();
  if (state.days[day] === 'red') return 0;
  if (!state.days[day]) day = addDays(day, -1);   // today not marked yet: the streak runs to yesterday
  let streak = 0;
  while (state.days[day] === 'green') {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

function bestStreak() {
  const greens = Object.keys(state.days).filter(key => state.days[key] === 'green').sort();
  let best = 0, run = 0, previous = null;
  for (const key of greens) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

function cravingsByDay() {
  const counts = {};
  for (const craving of state.cravings) {
    const day = cravingDay(craving);
    counts[day] = (counts[day] || 0) + 1;
  }
  return counts;
}

function countCravings(fromKey, toKey) {
  return state.cravings.filter(c => cravingDay(c) >= fromKey && cravingDay(c) <= toKey).length;
}


// ---------- actions ----------

function markDay(key, mark) {
  const before = currentStreak();
  if (mark) state.days[key] = mark;
  else delete state.days[key];
  if (mark && key < state.startDay) state.startDay = key;
  save();
  const after = currentStreak();
  if (mark === 'green' && after > before && CELEBRATE_AT.includes(after)) celebrate(after);
}

function logCraving() {
  state.cravings.push({ t: nowStamp(), level: null, trigger: null });
  save();
  render();
  openCravingSheet(state.cravings.length - 1);
}

function setCravingDetail(field, value, chip) {
  const craving = state.cravings[editingCraving];
  craving[field] = craving[field] === value ? null : value;   // tapping again clears it
  save();
  chip.parentElement.querySelectorAll('.chip').forEach(el => {
    el.classList.toggle('selected', el.dataset.value === craving[field]);
  });
}

async function exportBackup() {
  const today = todayKey();
  const name = `daymark-${today}.json`;
  const file = new File([JSON.stringify({ ...state, lastExport: today }, null, 2)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });   // iOS share sheet: "Save to Files"
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast('Export failed');
    return;
  }
  state.lastExport = today;
  save();
  render();
  toast('Backup saved');
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!data.days || typeof data.days !== 'object' || !Array.isArray(data.cravings)) throw new Error();
  } catch (e) {
    toast('That file is not a Daymark backup');
    return;
  }
  const summary = `${plural(Object.keys(data.days).length, 'marked day')} and ${plural(data.cravings.length, 'craving')}`;
  if (!confirm(`Replace everything on this phone with the backup (${summary})?`)) return;
  state = { ...freshState(), ...data, setupDone: true };
  save();
  render();
  toast('Backup restored');
}

function resetAll() {
  if (!confirm('Delete all marked days, cravings and settings from this phone? This cannot be undone.')) return;
  state = freshState();
  tab = 'today';
  save();
  render();
}


// ---------- screens ----------

function render() {
  renderedFor = todayKey();
  const setup = !state.setupDone;
  document.querySelector('.tabbar').hidden = setup;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  const screens = { today: renderToday, calendar: renderCalendar, progress: renderProgress };
  document.getElementById('screen').innerHTML = setup ? renderSetup() : screens[tab]();
}

function settingsFields() {
  const s = state.settings;
  const value = v => (v ? `value="${escapeHtml(v)}"` : '');
  return `
    <label class="field"><span>What are you tracking?</span>
      <input name="habit" placeholder="e.g. Sugar-free" autocomplete="off" ${value(s.habit)}></label>
    <label class="field"><span>What do you count?</span>
      <input name="unit" placeholder="e.g. snacks" autocomplete="off" ${value(s.unit)}></label>
    <div class="row2">
      <label class="field"><span>How many a day, before?</span>
        <input name="unitsPerDay" type="number" inputmode="decimal" step="any" min="0" placeholder="0" ${value(s.unitsPerDay)}></label>
      <label class="field"><span>What it cost a day</span>
        <input name="dailyCost" type="number" inputmode="decimal" step="any" min="0" placeholder="0" ${value(s.dailyCost)}></label>
    </div>
    <label class="field"><span>Currency symbol</span>
      <input name="currency" maxlength="3" placeholder="e.g. $, €, ₹" autocomplete="off" ${value(s.currency)}></label>`;
}

function readSettings(form) {
  const f = new FormData(form);
  return {
    habit: f.get('habit').trim(),
    unit: f.get('unit').trim(),
    unitsPerDay: Number(f.get('unitsPerDay')) || 0,
    dailyCost: Number(f.get('dailyCost')) || 0,
    currency: f.get('currency').trim(),
  };
}

function renderSetup() {
  return `
    <div class="setup">
      <div class="logo"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.4l2.6 2.6 4.9-5.4"/></svg></div>
      <h1>Welcome to Daymark</h1>
      <p class="lead">Each evening, mark your day green or red. When a craving hits, log it with one tap.
        Everything stays on this phone.</p>
      <form id="setup-form" class="card">
        ${settingsFields()}
        <p class="hint">All optional. You can change these later under Progress.</p>
        <button class="primary" type="submit">Start</button>
      </form>
      <button class="link center" data-action="skip-setup">Skip for now</button>
    </div>`;
}

function renderToday() {
  const today = todayKey();
  const mark = state.days[today];
  const streak = currentStreak();
  const best = bestStreak();
  const yesterday = addDays(today, -1);
  const todaysCravings = cravingsByDay()[today] || 0;

  let sub = best > streak ? `Best: ${plural(best, 'day')}` : '';
  if (!best) sub = 'Your first green day starts today';

  return `
    ${backupBanner()}
    <header class="hero">
      ${state.settings.habit ? `<div class="eyebrow">${escapeHtml(state.settings.habit)}</div>` : ''}
      <div class="hero-number">${streak}</div>
      <div class="hero-label">${streak === 1 ? 'day' : 'days'} in a row</div>
      ${sub ? `<div class="hero-sub">${sub}</div>` : ''}
    </header>

    <section class="card">
      <h2>How was today?</h2>
      <p class="muted">${formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      ${mark ? markedToday(mark, today, streak) : markButtons('mark')}
    </section>

    ${!state.days[yesterday] && yesterday >= state.startDay ? `
      <section class="card soft">
        <p><strong>Yesterday isn’t marked.</strong> How did it go?</p>
        ${markButtons('mark-yesterday', true)}
      </section>` : ''}

    <button class="craving-btn" data-action="craving">
      <span class="craving-icon">🌊</span>
      <span><strong>I’m having a craving</strong>
        <small>${todaysCravings ? `${plural(todaysCravings, 'craving')} today · tap to log another` : 'Tap to log it, then ride it out'}</small></span>
    </button>

    ${motivator()}`;
}

function markButtons(action, small = false) {
  return `
    <div class="mark-buttons ${small ? 'small' : ''}">
      <button class="mark green" data-action="${action}" data-value="green"><span class="dot"></span>Clean day</button>
      <button class="mark red" data-action="${action}" data-value="red"><span class="dot"></span>Slipped</button>
    </div>`;
}

function markedToday(mark, today, streak) {
  const text = mark === 'green'
    ? (streak > 1 ? `Nice work. That’s ${plural(streak, 'day')} in a row.` : 'Nice work. One day at a time.')
    : SLIP_MESSAGES[dateOf(today).getDate() % SLIP_MESSAGES.length];
  return `
    <div class="marked ${mark}">
      <span class="dot"></span>
      <div><strong>${mark === 'green' ? 'Clean day' : 'Slipped'}</strong><p>${text}</p></div>
    </div>
    <button class="link" data-action="unmark">Change</button>`;
}

function motivator() {
  const s = state.settings;
  const greens = greenDays();
  if (!greens) return '';
  const parts = [];
  if (s.dailyCost > 0) parts.push(`<strong>${money(greens * s.dailyCost)}</strong> saved`);
  if (s.unitsPerDay > 0) parts.push(`<strong>${Math.round(greens * s.unitsPerDay).toLocaleString()}</strong> ${escapeHtml(s.unit || 'units')} avoided`);
  if (!parts.length) parts.push(`<strong>${plural(greens, 'green day')}</strong> so far`);
  return `<p class="motivator">${parts.join(' · ')}</p>`;
}

function backupBanner() {
  const due = !state.lastExport || daysBetween(state.lastExport, todayKey()) >= 30;
  if (!due || Object.keys(state.days).length < 7) return '';
  return `
    <div class="banner">
      <span>Your data lives only on this phone. Save a backup to Files.</span>
      <button data-action="export">Back up</button>
    </div>`;
}

function renderCalendar() {
  const [y, m] = calendarMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // weeks start on Monday
  const today = todayKey();
  const cravings = cravingsByDay();
  const totals = { green: 0, red: 0, cravings: 0 };

  const weekdays = [...Array(7)].map((_, i) =>
    `<div class="cal-weekday">${formatDay(addDays('2024-01-01', i), { weekday: 'narrow' })}</div>`).join('');

  let cells = '<div></div>'.repeat(offset);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calendarMonth}-${String(d).padStart(2, '0')}`;
    const mark = state.days[key];
    const count = cravings[key] || 0;
    const future = key > today;
    const missed = !mark && !future && key >= state.startDay && key < today;
    if (mark) totals[mark]++;
    totals.cravings += count;
    const classes = [mark, missed && 'missed', future && 'future', key === today && 'today'].filter(Boolean).join(' ');
    const dots = count ? `<span class="dots">${'<i></i>'.repeat(Math.min(count, 4))}</span>` : '';
    cells += `<button class="cal-cell ${classes}" data-action="open-day" data-day="${key}" ${future ? 'disabled' : ''}>${d}${dots}</button>`;
  }

  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const atCurrentMonth = calendarMonth >= today.slice(0, 7);
  return `
    <header class="cal-head">
      <button class="icon-btn" data-action="month" data-value="-1" aria-label="Previous month">‹</button>
      <h1>${monthName}</h1>
      <button class="icon-btn" data-action="month" data-value="1" aria-label="Next month" ${atCurrentMonth ? 'disabled' : ''}>›</button>
    </header>
    <div class="cal-grid">${weekdays}${cells}</div>
    <div class="legend">
      <span><i class="green"></i>Clean</span><span><i class="red"></i>Slipped</span>
      <span><i class="missed"></i>Not marked</span><span><i class="craving"></i>Craving</span>
    </div>
    <section class="card month-summary">
      <div><strong>${totals.green}</strong><span>green</span></div>
      <div><strong>${totals.red}</strong><span>red</span></div>
      <div><strong>${totals.cravings}</strong><span>cravings</span></div>
    </section>
    <p class="hint center">Tap a day to mark it or see its cravings.</p>`;
}

function renderProgress() {
  const s = state.settings;
  const greens = greenDays();
  const current = currentStreak();
  const best = bestStreak();

  const tiles = [
    [plural(current, 'day'), 'Current streak'],
    [plural(best, 'day'), 'Best streak'],
    [greens.toLocaleString(), 'Green days'],
  ];
  if (s.dailyCost > 0) tiles.push([money(greens * s.dailyCost), 'Money saved']);
  if (s.unitsPerDay > 0) tiles.push([Math.round(greens * s.unitsPerDay).toLocaleString(), `${capitalize(escapeHtml(s.unit || 'units'))} avoided`]);

  const next = BADGES.find(b => b.days > current);
  const badges = BADGES.map(b =>
    `<div class="badge ${best >= b.days ? 'reached' : ''}"><span class="medal"></span>${b.label}</div>`).join('');

  return `
    <h1 class="page-title">Progress</h1>
    <div class="tiles">${tiles.map(([value, label]) =>
      `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${label}</div></div>`).join('')}</div>

    ${renderCravingInsights()}

    <section class="card">
      <h2>Streak badges</h2>
      <p class="muted">${next ? `Next: ${next.label}, ${plural(next.days - current, 'day')} to go` : 'You’ve earned every badge. Amazing.'}</p>
      <div class="badges">${badges}</div>
    </section>

    <form id="settings-form" class="card">
      <h2>Settings</h2>
      <div class="spacer"></div>
      ${settingsFields()}
      <button class="primary" type="submit">Save settings</button>
    </form>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted">Your data lives only on this phone. Last backup: ${state.lastExport ? formatDay(state.lastExport) : 'never'}.</p>
      <button class="secondary" data-action="export">Export backup</button>
      <button class="secondary" data-action="import">Import backup</button>
    </section>

    <button class="link danger center" data-action="reset">Reset all data</button>`;
}

function renderCravingInsights() {
  if (!state.cravings.length) {
    return `
      <section class="card">
        <h2>Cravings</h2>
        <p class="muted">None logged yet. When one hits, tap “I’m having a craving” on Today.</p>
      </section>`;
  }

  const today = todayKey();
  const perDay = cravingsByDay();
  const last14 = [...Array(14)].map((_, i) => addDays(today, i - 13));
  const max = Math.max(1, ...last14.map(key => perDay[key] || 0));
  const bars = last14.map(key => {
    const n = perDay[key] || 0;
    return `
      <div class="bar-col ${key === today ? 'is-today' : ''}">
        <span class="bar-count">${n || ''}</span>
        <div class="bar" style="height:${Math.max(4, (n / max) * 100)}%"></div>
        <span class="bar-day">${formatDay(key, { weekday: 'narrow' })}</span>
      </div>`;
  }).join('');

  const thisWeek = countCravings(addDays(today, -6), today);
  const lastWeek = countCravings(addDays(today, -13), addDays(today, -7));
  let trend = '';
  if (lastWeek && thisWeek < lastWeek) trend = ` · down ${Math.round((1 - thisWeek / lastWeek) * 100)}%, well done`;
  if (lastWeek && thisWeek > lastWeek) trend = ' · a tougher week, keep riding them out';

  const triggerCounts = {};
  for (const c of state.cravings) if (c.trigger) triggerCounts[c.trigger] = (triggerCounts[c.trigger] || 0) + 1;
  const topTriggers = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const triggerRows = topTriggers.map(([name, n]) => `
    <div class="hbar"><span>${escapeHtml(name)}</span>
      <div class="hbar-track"><div style="width:${(n / topTriggers[0][1]) * 100}%"></div></div>
      <b>${n}</b></div>`).join('');

  const windows = {};   // two-hour windows: 0 = midnight–2 am, 8 = 4–6 pm, ...
  for (const c of state.cravings) {
    const w = Math.floor(Number(c.t.slice(11, 13)) / 2);
    windows[w] = (windows[w] || 0) + 1;
  }
  const [peak] = Object.entries(windows).sort((a, b) => b[1] - a[1])[0];
  const peakText = state.cravings.length >= 3
    ? `Most cravings hit between <strong>${formatHour(peak * 2)} and ${formatHour(peak * 2 + 2)}</strong>.` : '';

  return `
    <section class="card">
      <h2>Cravings</h2>
      <p class="muted">${thisWeek} this week, ${lastWeek} last week${trend}</p>
      <div class="bars">${bars}</div>
      ${peakText ? `<p class="insight">${peakText}</p>` : ''}
      ${triggerRows ? `<h3>Top triggers</h3>${triggerRows}` : ''}
    </section>`;
}


// ---------- sheets and overlays ----------

function openSheet(html) {
  document.getElementById('sheet-body').innerHTML = `<div class="handle"></div>${html}`;
  document.getElementById('sheet').hidden = false;
}

function closeSheet() {
  stopBreathing();
  document.getElementById('sheet').hidden = true;
}

function chips(field, options, selected) {
  return `<div class="chips">${options.map(o =>
    `<button class="chip ${o === selected ? 'selected' : ''}" data-action="${field}" data-value="${o}">${o}</button>`).join('')}</div>`;
}

function openCravingSheet(index) {
  editingCraving = index;
  const craving = state.cravings[index];
  openSheet(`
    <h2>Craving logged</h2>
    <p class="muted">At ${formatTime(craving.t)}. It usually passes within a few minutes.</p>
    <h3>How strong? <em>optional</em></h3>
    ${chips('level', LEVELS, craving.level)}
    <h3>What set it off? <em>optional</em></h3>
    ${chips('trigger', TRIGGERS, craving.trigger)}
    <div id="breathe" class="breathe">${rideOutButton()}</div>
    <div class="sheet-actions">
      <button class="link danger" data-action="undo-craving">Remove</button>
      <button class="primary" data-action="close-sheet">Done</button>
    </div>`);
}

function rideOutButton() {
  return `<button class="ride-btn" data-action="breathe">Ride it out · 3 minute breathing</button>`;
}

function startBreathing() {
  const box = document.getElementById('breathe');
  box.innerHTML = `
    <div class="breath-circle"></div>
    <p class="breath-label">Breathe in</p>
    <p class="breath-time">3:00</p>
    <button class="link" data-action="stop-breathe">Stop</button>`;
  const started = Date.now();
  const tick = () => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const left = RIDE_OUT_SECONDS - elapsed;
    if (left <= 0) {
      stopBreathing();
      box.innerHTML = '<p class="breath-done">It passed. Well done 💪</p>';
      return;
    }
    box.querySelector('.breath-label').textContent = elapsed % 10 < 4 ? 'Breathe in' : 'Breathe out';
    box.querySelector('.breath-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  breatheTimer = setInterval(tick, 250);
}

function stopBreathing() {
  clearInterval(breatheTimer);
  breatheTimer = null;
}

function openDaySheet(key) {
  const mark = state.days[key];
  const list = state.cravings
    .map((c, index) => ({ ...c, index }))
    .filter(c => cravingDay(c) === key);
  const rows = list.map(c => `
    <li><span>${formatTime(c.t)}</span>
      <span class="muted">${[c.level, c.trigger].filter(Boolean).join(' · ') || 'No details'}</span>
      <button class="remove" data-action="delete-craving" data-index="${c.index}" data-day="${key}" aria-label="Remove">×</button></li>`).join('');

  openSheet(`
    <h2>${formatDay(key, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    <div class="mark-buttons">
      <button class="mark green ${mark === 'green' ? 'selected' : ''}" data-action="set-day" data-day="${key}" data-value="green"><span class="dot"></span>Clean day</button>
      <button class="mark red ${mark === 'red' ? 'selected' : ''}" data-action="set-day" data-day="${key}" data-value="red"><span class="dot"></span>Slipped</button>
    </div>
    ${mark ? `<button class="link" data-action="set-day" data-day="${key}" data-value="">Clear mark</button>` : ''}
    <h3>Cravings</h3>
    ${rows ? `<ul class="craving-list">${rows}</ul>` : '<p class="muted">No cravings logged.</p>'}
    <button class="primary" data-action="close-sheet">Done</button>`);
}

function celebrate(days) {
  const el = document.getElementById('celebrate');
  const confetti = [...Array(18)].map((_, i) => `<i style="--angle:${i * 20}deg"></i>`).join('');
  el.innerHTML = `
    <div class="burst">${confetti}</div>
    <div class="celebrate-card"><div class="celebrate-emoji">🎉</div>
      <strong>${plural(days, 'day')} in a row!</strong><span>Keep going.</span></div>`;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2800);
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2400);
}


// ---------- wiring ----------

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el) {
    if (event.target.id === 'sheet') closeSheet();         // tap outside the sheet
    if (event.target.closest('#celebrate')) document.getElementById('celebrate').hidden = true;
    return;
  }
  const { action, value, day } = el.dataset;
  switch (action) {
    case 'tab': tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'mark': markDay(todayKey(), value); render(); break;
    case 'mark-yesterday': markDay(addDays(todayKey(), -1), value); render(); break;
    case 'unmark': markDay(todayKey(), null); render(); break;
    case 'craving': logCraving(); break;
    case 'level': case 'trigger': setCravingDetail(action, value, el); break;
    case 'breathe': startBreathing(); break;
    case 'stop-breathe': stopBreathing(); document.getElementById('breathe').innerHTML = rideOutButton(); break;
    case 'undo-craving':
      state.cravings.splice(editingCraving, 1);
      save(); closeSheet(); render(); toast('Craving removed');
      break;
    case 'open-day': openDaySheet(day); break;
    case 'set-day': markDay(day, value || null); closeSheet(); render(); break;
    case 'delete-craving':
      state.cravings.splice(Number(el.dataset.index), 1);
      save(); render(); openDaySheet(day);
      break;
    case 'month': calendarMonth = shiftMonth(calendarMonth, Number(value)); render(); break;
    case 'close-sheet': closeSheet(); break;
    case 'export': exportBackup(); break;
    case 'import': document.getElementById('import-file').click(); break;
    case 'reset': resetAll(); break;
    case 'skip-setup': state.setupDone = true; save(); render(); break;
  }
});

document.addEventListener('submit', event => {
  event.preventDefault();
  const firstTime = event.target.id === 'setup-form';
  state.settings = readSettings(event.target);
  state.setupDone = true;
  save();
  render();
  toast(firstTime ? 'All set. Come back tonight to mark your day.' : 'Settings saved');
});

document.getElementById('import-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) importBackup(file);
});

// The app may stay open overnight: when it comes back on a new day, redraw "today".
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && renderedFor !== todayKey()) render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.();   // ask iOS to keep this app's data

render();
