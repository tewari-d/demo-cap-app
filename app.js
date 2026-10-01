// Daymark – mark each day green or red for every habit you track, and log cravings when they hit.
// All data lives in this device's local storage; nothing is ever sent anywhere.

const STORE_KEY = 'daymark.v1';        // name kept from the first version so existing data is found
const CHECK_IN_FROM_HOUR = 19;         // today can only be marked from 7 pm until midnight
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
  'One red day doesn’t undo your progress. Tomorrow is a fresh start.',
  'Be kind to yourself. Every green day still counts.',
  'Notice what set it off, and go again tomorrow.',
];

let state = load();
let tab = 'today';
let viewHabitId = null;                        // habit shown on Calendar and Progress (null = the first)
let calendarMonth = todayKey().slice(0, 7);    // 'YYYY-MM'
let editing = null;                            // { habitId, index } of the craving open in the sheet
let breatheTimer = null;
let renderedFor = null;                        // day and check-in state the screen was last drawn for


// ---------- storage ----------

function freshState() {
  return { version: 2, habits: [], setupDone: false, lastExport: null };
}

function newHabit(fields) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: 'My habit', unit: '', unitsPerDay: 0, dailyCost: 0, currency: '',
    days: {}, cravings: [], startDay: todayKey(),
    ...fields,
  };
}

// Data from the first, single-habit version (and its backups) becomes the first habit.
function upgrade(data) {
  if (Array.isArray(data.habits)) return { ...freshState(), ...data };
  if (!data.setupDone) return freshState();     // never got past the welcome screen
  const s = data.settings || {};
  const habit = newHabit({
    name: s.habit || 'My habit',
    unit: s.unit || '',
    unitsPerDay: s.unitsPerDay || 0,
    dailyCost: s.dailyCost || 0,
    currency: s.currency || '',
    days: data.days || {},
    cravings: data.cravings || [],
    startDay: data.startDay || todayKey(),
  });
  return { ...freshState(), setupDone: true, lastExport: data.lastExport || null, habits: [habit] };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) return upgrade(saved);
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

function habitById(id) {
  return state.habits.find(h => h.id === id);
}

function viewHabit() {
  return habitById(viewHabitId) || state.habits[0];
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
  return keyOf(new Date());
}

function checkInOpen() {
  return new Date().getHours() >= CHECK_IN_FROM_HOUR;
}

// Past days can always be marked (for days you forgot); today only during the evening check-in.
function canMark(key) {
  return key < todayKey() || (key === todayKey() && checkInOpen());
}

function nowStamp() {   // e.g. '2026-09-30T16:42', local time
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${keyOf(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function cravingDay(craving) {
  return craving.t.slice(0, 10);
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

function formatHour(hour) {   // 19 -> '7 PM' (or '19' on a 24-hour phone)
  return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' });
}

function money(habit, amount) {
  return `${habit.currency || ''}${Math.round(amount).toLocaleString()}`;
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


// ---------- numbers (per habit) ----------

function greenDays(habit) {
  return Object.values(habit.days).filter(mark => mark === 'green').length;
}

function currentStreak(habit) {
  let day = todayKey();
  if (habit.days[day] === 'red') return 0;
  if (!habit.days[day]) day = addDays(day, -1);   // today not marked yet: the streak runs to yesterday
  let streak = 0;
  while (habit.days[day] === 'green') {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

function bestStreak(habit) {
  const greens = Object.keys(habit.days).filter(key => habit.days[key] === 'green').sort();
  let best = 0, run = 0, previous = null;
  for (const key of greens) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

function cravingsByDay(habit) {
  const counts = {};
  for (const craving of habit.cravings) {
    const day = cravingDay(craving);
    counts[day] = (counts[day] || 0) + 1;
  }
  return counts;
}

function countCravings(habit, fromKey, toKey) {
  return habit.cravings.filter(c => cravingDay(c) >= fromKey && cravingDay(c) <= toKey).length;
}


// ---------- actions ----------

function markDay(habit, key, mark) {
  if (!canMark(key)) return;
  const before = currentStreak(habit);
  if (mark) habit.days[key] = mark;
  else delete habit.days[key];
  if (mark && key < habit.startDay) habit.startDay = key;
  save();
  const after = currentStreak(habit);
  if (mark === 'green' && after > before && CELEBRATE_AT.includes(after)) celebrate(habit, after);
}

function logCraving(habit) {
  habit.cravings.push({ t: nowStamp(), level: null, trigger: null });
  save();
  render();
  openCravingSheet(habit, habit.cravings.length - 1);
}

function editingCraving() {
  return habitById(editing.habitId).cravings[editing.index];
}

function setCravingDetail(field, value, chip) {
  const craving = editingCraving();
  craving[field] = craving[field] === value ? null : value;   // tapping again clears it
  save();
  chip.parentElement.querySelectorAll('.chip').forEach(el => {
    el.classList.toggle('selected', el.dataset.value === craving[field]);
  });
}

function readHabitFields(form) {
  const f = new FormData(form);
  return {
    name: f.get('name').trim() || 'My habit',
    unit: f.get('unit').trim(),
    unitsPerDay: Number(f.get('unitsPerDay')) || 0,
    dailyCost: Number(f.get('dailyCost')) || 0,
    currency: f.get('currency').trim(),
  };
}

function deleteHabit(habit) {
  if (!confirm(`Delete “${habit.name}” with all its days and cravings? This cannot be undone.`)) return;
  state.habits = state.habits.filter(h => h !== habit);
  if (viewHabitId === habit.id) viewHabitId = null;
  save();
  closeSheet();
  render();
  toast('Habit deleted');
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
  let incoming;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.habits) && !(data.days && Array.isArray(data.cravings))) throw new Error();
    incoming = upgrade({ ...data, setupDone: true });
  } catch (e) {
    toast('That file is not a Daymark backup');
    return;
  }
  if (!confirm(`Replace everything on this phone with the backup (${plural(incoming.habits.length, 'habit')})?`)) return;
  state = incoming;
  viewHabitId = null;
  save();
  render();
  toast('Backup restored');
}

function resetAll() {
  if (!confirm('Delete all habits, marked days and cravings from this phone? This cannot be undone.')) return;
  state = freshState();
  tab = 'today';
  viewHabitId = null;
  save();
  render();
}


// ---------- screens ----------

function screenKey() {
  return `${todayKey()} ${checkInOpen()}`;
}

function render() {
  renderedFor = screenKey();
  const setup = !state.setupDone;
  document.querySelector('.tabbar').hidden = setup;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  const screens = { today: renderToday, calendar: renderCalendar, progress: renderProgress };
  document.getElementById('screen').innerHTML = setup ? renderSetup() : screens[tab]();
}

function habitFields(h = {}) {
  const value = v => (v ? `value="${escapeHtml(v)}"` : '');
  return `
    <label class="field"><span>Habit name</span>
      <input name="name" required placeholder="e.g. Sugar-free" autocomplete="off" ${value(h.name)}></label>
    <label class="field"><span>What do you count? <em>optional</em></span>
      <input name="unit" placeholder="e.g. snacks" autocomplete="off" ${value(h.unit)}></label>
    <div class="row2">
      <label class="field"><span>How many a day, before?</span>
        <input name="unitsPerDay" type="number" inputmode="decimal" step="any" min="0" placeholder="0" ${value(h.unitsPerDay)}></label>
      <label class="field"><span>What it cost a day</span>
        <input name="dailyCost" type="number" inputmode="decimal" step="any" min="0" placeholder="0" ${value(h.dailyCost)}></label>
    </div>
    <label class="field"><span>Currency symbol</span>
      <input name="currency" maxlength="3" placeholder="e.g. $, €, ₹" autocomplete="off" ${value(h.currency)}></label>`;
}

function renderSetup() {
  return `
    <div class="setup">
      <div class="logo"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.4l2.6 2.6 4.9-5.4"/></svg></div>
      <h1>Welcome to Daymark</h1>
      <p class="lead">Track one habit or several. Each evening from ${formatHour(CHECK_IN_FROM_HOUR)}, mark the day
        green or red. When a craving hits, log it with one tap. Everything stays on this phone.</p>
      <form id="setup-form" class="card">
        <h2>Your first habit</h2>
        <div class="spacer"></div>
        ${habitFields()}
        <p class="hint">Only the name is needed. You can add more habits later.</p>
        <button class="primary" type="submit">Start</button>
      </form>
    </div>`;
}

function renderToday() {
  const today = todayKey();
  const open = checkInOpen();
  const allMarked = state.habits.length > 0 && state.habits.every(h => h.days[today]);
  let status = `🔒 You can mark today from ${formatHour(CHECK_IN_FROM_HOUR)}. Cravings can be logged any time.`;
  if (open) status = 'Check-in is open until midnight.';
  if (allMarked) status = '✓ All marked for today. See you tomorrow evening.';

  const cards = state.habits.length
    ? state.habits.map(h => habitCard(h, today, open)).join('')
    : '<section class="card"><h2>No habits yet</h2><p class="muted">Add one to start tracking.</p></section>';

  return `
    ${backupBanner()}
    <header class="today-head">
      <h1>${formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
      <p class="status ${open && !allMarked ? 'open' : ''}">${status}</p>
    </header>
    ${cards}
    <button class="add-habit" data-action="add-habit">+ Add a habit</button>`;
}

function habitCard(habit, today, open) {
  const mark = habit.days[today];
  const streak = currentStreak(habit);
  const yesterday = addDays(today, -1);
  const cravingsToday = cravingsByDay(habit)[today] || 0;
  return `
    <section class="card habit">
      <header class="habit-head">
        <h2>${escapeHtml(habit.name)}</h2>
        <span class="streak ${streak ? '' : 'zero'}">${streak ? `${streak}-day streak` : 'No streak yet'}</span>
      </header>
      ${mark ? markedRow(habit, mark, open) : markButtons('mark', habit.id, !open)}
      ${!habit.days[yesterday] && yesterday >= habit.startDay ? `
        <div class="yesterday">
          <p>Yesterday isn’t marked yet:</p>
          ${markButtons('mark-yesterday', habit.id, false, true)}
        </div>` : ''}
      <button class="craving-row" data-action="craving" data-habit="${habit.id}">
        <span class="craving-icon">🌊</span>
        <span class="craving-text"><strong>Craving</strong>
          <small>${cravingsToday ? `${plural(cravingsToday, 'craving')} today` : 'Tap when one hits'}</small></span>
        <span class="plus">+</span>
      </button>
      ${motivator(habit)}
    </section>`;
}

function markButtons(action, habitId, locked, mini = false) {
  const attrs = value => `data-action="${action}" data-habit="${habitId}" data-value="${value}" ${locked ? 'disabled' : ''}`;
  return `
    <div class="mark-buttons ${mini ? 'mini' : ''}">
      <button class="mark green" ${attrs('green')}><span class="dot"></span>Clean day</button>
      <button class="mark red" ${attrs('red')}><span class="dot"></span>Slipped</button>
    </div>`;
}

function markedRow(habit, mark, open) {
  const text = mark === 'green'
    ? 'Nice work. One day at a time.'
    : SLIP_MESSAGES[dateOf(todayKey()).getDate() % SLIP_MESSAGES.length];
  return `
    <div class="marked ${mark}">
      <span class="dot"></span>
      <div class="marked-text"><strong>${mark === 'green' ? 'Clean day' : 'Slipped'}</strong><p>${text}</p></div>
      ${open ? `<button class="link" data-action="unmark" data-habit="${habit.id}">Change</button>` : ''}
    </div>`;
}

function motivator(habit) {
  const greens = greenDays(habit);
  const parts = [];
  if (greens && habit.dailyCost > 0) parts.push(`<strong>${money(habit, greens * habit.dailyCost)}</strong> saved`);
  if (greens && habit.unitsPerDay > 0) {
    parts.push(`<strong>${Math.round(greens * habit.unitsPerDay).toLocaleString()}</strong> ${escapeHtml(habit.unit || 'units')} avoided`);
  }
  return parts.length ? `<p class="motivator">${parts.join(' · ')}</p>` : '';
}

function backupBanner() {
  const marked = state.habits.reduce((sum, h) => sum + Object.keys(h.days).length, 0);
  const due = !state.lastExport || daysBetween(state.lastExport, todayKey()) >= 30;
  if (!due || marked < 7) return '';
  return `
    <div class="banner">
      <span>Your data lives only on this phone. Save a backup to Files.</span>
      <button data-action="export">Back up</button>
    </div>`;
}

// Switcher for Calendar and Progress; with a single habit it is just its name.
function habitTabs(current) {
  if (state.habits.length < 2) return `<p class="page-sub">${escapeHtml(current.name)}</p>`;
  return `<div class="habit-tabs">${state.habits.map(h =>
    `<button class="habit-tab ${h.id === current.id ? 'active' : ''}" data-action="view-habit" data-habit="${h.id}">${escapeHtml(h.name)}</button>`).join('')}</div>`;
}

function renderCalendar() {
  const habit = viewHabit();
  if (!habit) return '<h1 class="page-title">Calendar</h1><p class="muted">Add a habit on Today first.</p>';

  const [y, m] = calendarMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // weeks start on Monday
  const today = todayKey();
  const cravings = cravingsByDay(habit);
  const totals = { green: 0, red: 0, cravings: 0 };

  const weekdays = [...Array(7)].map((_, i) =>
    `<div class="cal-weekday">${formatDay(addDays('2024-01-01', i), { weekday: 'narrow' })}</div>`).join('');

  let cells = '<div></div>'.repeat(offset);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calendarMonth}-${String(d).padStart(2, '0')}`;
    const mark = habit.days[key];
    const count = cravings[key] || 0;
    const future = key > today;
    const missed = !mark && !future && key >= habit.startDay && key < today;
    if (mark) totals[mark]++;
    totals.cravings += count;
    const classes = [mark, missed && 'missed', future && 'future', key === today && 'today'].filter(Boolean).join(' ');
    const dots = count ? `<span class="dots">${'<i></i>'.repeat(Math.min(count, 4))}</span>` : '';
    cells += `<button class="cal-cell ${classes}" data-action="open-day" data-day="${key}" ${future ? 'disabled' : ''}>${d}${dots}</button>`;
  }

  const monthName = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const atCurrentMonth = calendarMonth >= today.slice(0, 7);
  return `
    ${habitTabs(habit)}
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
    <p class="hint center">Tap a day to mark a day you forgot, or to see its cravings.</p>`;
}

function renderProgress() {
  const habit = viewHabit();
  return `
    <h1 class="page-title">Progress</h1>
    ${habit ? habitTabs(habit) + habitProgress(habit) : ''}

    <section class="card">
      <h2>Habits</h2>
      <ul class="habit-list">${state.habits.map(h => `
        <li>
          <div><strong>${escapeHtml(h.name)}</strong>
            <span class="muted">${plural(greenDays(h), 'green day')} · since ${formatDay(h.startDay)}</span></div>
          <button class="small-btn" data-action="edit-habit" data-habit="${h.id}">Edit</button>
        </li>`).join('')}</ul>
      <button class="secondary" data-action="add-habit">+ Add a habit</button>
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted">Your data lives only on this phone. Last backup: ${state.lastExport ? formatDay(state.lastExport) : 'never'}.</p>
      <button class="secondary" data-action="export">Export backup</button>
      <button class="secondary" data-action="import">Import backup</button>
    </section>

    <button class="link danger center" data-action="reset">Reset all data</button>`;
}

function habitProgress(habit) {
  const greens = greenDays(habit);
  const current = currentStreak(habit);
  const best = bestStreak(habit);

  const tiles = [
    [plural(current, 'day'), 'Current streak'],
    [plural(best, 'day'), 'Best streak'],
    [greens.toLocaleString(), 'Green days'],
  ];
  if (habit.dailyCost > 0) tiles.push([money(habit, greens * habit.dailyCost), 'Money saved']);
  if (habit.unitsPerDay > 0) {
    tiles.push([Math.round(greens * habit.unitsPerDay).toLocaleString(), `${capitalize(escapeHtml(habit.unit || 'units'))} avoided`]);
  }

  const next = BADGES.find(b => b.days > current);
  const badges = BADGES.map(b =>
    `<div class="badge ${best >= b.days ? 'reached' : ''}"><span class="medal"></span>${b.label}</div>`).join('');

  return `
    <div class="tiles">${tiles.map(([value, label]) =>
      `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${label}</div></div>`).join('')}</div>

    ${renderCravingInsights(habit)}

    <section class="card">
      <h2>Streak badges</h2>
      <p class="muted">${next ? `Next: ${next.label}, ${plural(next.days - current, 'day')} to go` : 'You’ve earned every badge. Amazing.'}</p>
      <div class="badges">${badges}</div>
    </section>`;
}

function renderCravingInsights(habit) {
  if (!habit.cravings.length) {
    return `
      <section class="card">
        <h2>Cravings</h2>
        <p class="muted">None logged yet. When one hits, tap “Craving” on this habit’s card on Today.</p>
      </section>`;
  }

  const today = todayKey();
  const perDay = cravingsByDay(habit);
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

  const thisWeek = countCravings(habit, addDays(today, -6), today);
  const lastWeek = countCravings(habit, addDays(today, -13), addDays(today, -7));
  let trend = '';
  if (lastWeek && thisWeek < lastWeek) trend = ` · down ${Math.round((1 - thisWeek / lastWeek) * 100)}%, well done`;
  if (lastWeek && thisWeek > lastWeek) trend = ' · a tougher week, keep riding them out';

  const triggerCounts = {};
  for (const c of habit.cravings) if (c.trigger) triggerCounts[c.trigger] = (triggerCounts[c.trigger] || 0) + 1;
  const topTriggers = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const triggerRows = topTriggers.map(([name, n]) => `
    <div class="hbar"><span>${escapeHtml(name)}</span>
      <div class="hbar-track"><div style="width:${(n / topTriggers[0][1]) * 100}%"></div></div>
      <b>${n}</b></div>`).join('');

  const windows = {};   // two-hour windows: 0 = midnight–2 am, 8 = 4–6 pm, ...
  for (const c of habit.cravings) {
    const w = Math.floor(Number(c.t.slice(11, 13)) / 2);
    windows[w] = (windows[w] || 0) + 1;
  }
  const [peak] = Object.entries(windows).sort((a, b) => b[1] - a[1])[0];
  const peakText = habit.cravings.length >= 3
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

function openCravingSheet(habit, index) {
  editing = { habitId: habit.id, index };
  const craving = habit.cravings[index];
  openSheet(`
    <h2>Craving logged</h2>
    <p class="muted">${escapeHtml(habit.name)} · ${formatTime(craving.t)}. It usually passes within a few minutes.</p>
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

function openDaySheet(habit, key) {
  const mark = habit.days[key];
  const locked = !canMark(key);
  const rows = habit.cravings
    .map((c, index) => ({ ...c, index }))
    .filter(c => cravingDay(c) === key)
    .map(c => `
      <li><span>${formatTime(c.t)}</span>
        <span class="muted">${[c.level, c.trigger].filter(Boolean).join(' · ') || 'No details'}</span>
        <button class="remove" data-action="delete-craving" data-index="${c.index}" data-day="${key}" aria-label="Remove">×</button></li>`)
    .join('');
  const dayButton = (value, label) => `
    <button class="mark ${value} ${mark === value ? 'selected' : ''}" data-action="set-day" data-day="${key}" data-value="${value}" ${locked ? 'disabled' : ''}>
      <span class="dot"></span>${label}</button>`;

  openSheet(`
    <h2>${formatDay(key, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    <p class="muted">${escapeHtml(habit.name)}</p>
    <div class="mark-buttons">${dayButton('green', 'Clean day')}${dayButton('red', 'Slipped')}</div>
    ${locked ? `<p class="hint">You can mark today from ${formatHour(CHECK_IN_FROM_HOUR)}.</p>` : ''}
    ${mark && !locked ? `<button class="link" data-action="set-day" data-day="${key}" data-value="">Clear mark</button>` : ''}
    <h3>Cravings</h3>
    ${rows ? `<ul class="craving-list">${rows}</ul>` : '<p class="muted">No cravings logged.</p>'}
    <button class="primary" data-action="close-sheet">Done</button>`);
}

function openHabitSheet(habit) {
  openSheet(`
    <h2>${habit ? 'Edit habit' : 'New habit'}</h2>
    <form id="habit-form" data-habit="${habit ? habit.id : ''}">
      <div class="spacer"></div>
      ${habitFields(habit || { currency: state.habits[0]?.currency })}
      <button class="primary" type="submit">${habit ? 'Save' : 'Add habit'}</button>
    </form>
    ${habit ? `<button class="link danger center" data-action="delete-habit" data-habit="${habit.id}">Delete this habit</button>` : ''}`);
}

function celebrate(habit, days) {
  const el = document.getElementById('celebrate');
  const confetti = [...Array(18)].map((_, i) => `<i style="--angle:${i * 20}deg"></i>`).join('');
  el.innerHTML = `
    <div class="burst">${confetti}</div>
    <div class="celebrate-card"><div class="celebrate-emoji">🎉</div>
      <strong>${plural(days, 'day')} in a row!</strong><span>${escapeHtml(habit.name)} · keep going.</span></div>`;
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
  const habit = el.dataset.habit ? habitById(el.dataset.habit) : viewHabit();
  switch (action) {
    case 'tab': tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'view-habit': viewHabitId = habit.id; render(); break;
    case 'mark': markDay(habit, todayKey(), value); render(); break;
    case 'mark-yesterday': markDay(habit, addDays(todayKey(), -1), value); render(); break;
    case 'unmark': markDay(habit, todayKey(), null); render(); break;
    case 'craving': logCraving(habit); break;
    case 'level': case 'trigger': setCravingDetail(action, value, el); break;
    case 'breathe': startBreathing(); break;
    case 'stop-breathe': stopBreathing(); document.getElementById('breathe').innerHTML = rideOutButton(); break;
    case 'undo-craving':
      habitById(editing.habitId).cravings.splice(editing.index, 1);
      save(); closeSheet(); render(); toast('Craving removed');
      break;
    case 'open-day': openDaySheet(habit, day); break;
    case 'set-day': markDay(habit, day, value || null); closeSheet(); render(); break;
    case 'delete-craving':
      habit.cravings.splice(Number(el.dataset.index), 1);
      save(); render(); openDaySheet(habit, day);
      break;
    case 'month': calendarMonth = shiftMonth(calendarMonth, Number(value)); render(); break;
    case 'close-sheet': closeSheet(); break;
    case 'add-habit': openHabitSheet(null); break;
    case 'edit-habit': openHabitSheet(habit); break;
    case 'delete-habit': deleteHabit(habit); break;
    case 'export': exportBackup(); break;
    case 'import': document.getElementById('import-file').click(); break;
    case 'reset': resetAll(); break;
  }
});

document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  const fields = readHabitFields(form);
  if (form.id === 'setup-form') {
    state.habits = [newHabit(fields)];
    state.setupDone = true;
    toast(`All set. Come back after ${formatHour(CHECK_IN_FROM_HOUR)} to mark your day.`);
  } else {
    const habit = habitById(form.dataset.habit);
    if (habit) {
      Object.assign(habit, fields);
      toast('Habit saved');
    } else {
      const added = newHabit(fields);
      state.habits.push(added);
      viewHabitId = added.id;
      toast('Habit added');
    }
    closeSheet();
  }
  save();
  render();
});

document.getElementById('import-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) importBackup(file);
});

// The app may stay open across 7 pm or midnight: redraw when the day or the check-in window changes.
function refreshIfStale() {
  if (!document.hidden && renderedFor !== screenKey()) render();
}
document.addEventListener('visibilitychange', refreshIfStale);
setInterval(refreshIfStale, 30000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.();   // ask iOS to keep this app's data

render();
