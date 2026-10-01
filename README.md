# Daymark

A tiny day tracker for your phone, for one habit or several. Each habit has a card on one page:
every evening you mark the day **green** or **red**, and when a craving hits you log it with one
tap, then ride it out with a 3-minute breathing guide. Daymark shows each habit's streaks, badges
and craving patterns (which days, which hours, which triggers), and money saved if you enter a
daily cost.

It's plain HTML, CSS and JavaScript: no framework, no build step, no server, no account.
**All data stays on your device.**

## Install on an iPhone

1. Open the published link (e.g. `https://<user>.github.io/<repo>/`) in **Safari**.
2. Tap **Share → Add to Home Screen**. Keep **Open as Web App** switched on, and give it any name
   you like.
3. From then on, always open it **from the Home Screen icon**. It runs full screen and works
   offline.

On first launch you name your first habit. Add more with **+ Add a habit** on Today. Edit or
delete them under **Progress → Habits**.

## How it works

- **Today**: one card per habit with **Clean day / Slipped** and a **Craving** button.
- **Evening check-in**: today can only be marked from **7 PM until midnight**, so a day is never
  marked before it's over. Cravings can be logged at any time.
- **Forgot a day?** Yesterday shows up on the card until you mark it, and any past day can be
  marked from the **Calendar**, at any time.
- **Calendar** and **Progress** have a switcher at the top to choose the habit.

## Where the data lives

- Everything is stored in the app's own local storage on the phone. Nothing is ever uploaded.
- The Home Screen app's storage is **separate from Safari's**. Opening the link in Safari shows an
  empty app. That's expected; use the icon.
- **Deleting the Home Screen icon deletes the data.** Back up now and then:
  **Progress → Export backup → Save to Files** (or iCloud Drive). **Import backup** restores it,
  including backups from the first, single-habit version.
- Updates to the app never touch the data. A new version shows up on the second launch after it
  is published.

## Daily reminder

Create a repeating reminder in the iPhone **Reminders** app, or a **Clock** alarm, at about
9:30 pm with a neutral title like "Mark your day". Then open Daymark from its icon.

Don't use a Shortcuts "Open URL" automation. It opens Safari, which has separate (empty)
storage.

## How the numbers work (per habit)

- **Current streak:** consecutive green days ending today, or yesterday if today isn't marked
  yet.
- **Money saved:** green days × daily cost. **Avoided:** green days × daily count.
- **Badges** are earned from your best streak, so a red day never takes one away.

## Run it locally

```
npx serve .
```

Open the printed address. For an iPhone-sized view, use the browser's device toolbar
(390 × 844).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, tab bar, iOS Home Screen tags |
| `style.css` | Look and feel, light and dark mode |
| `app.js` | Storage, dates, screens, actions |
| `sw.js` | Offline cache |
| `manifest.webmanifest` | App name and icons |
