# Daymark

A tiny day tracker for your phone. Each evening you mark the day **green** or **red**. When a
craving hits, you log it with one tap, and you can ride it out with a 3-minute breathing guide.
Daymark shows your streaks, badges and craving patterns (which days, which hours, which
triggers), and money saved if you enter a daily cost.

It's plain HTML, CSS and JavaScript: no framework, no build step, no server, no account.
**All data stays on your device.**

## Install on an iPhone

1. Open the published link (e.g. `https://<user>.github.io/<repo>/`) in **Safari**.
2. Tap **Share → Add to Home Screen**. Give it any name you like.
3. From then on, always open it **from the Home Screen icon**. It runs full screen and works
   offline.

On first launch you can name what you track and enter a daily count and cost. All of it is
optional and can be changed later under **Progress → Settings**.

## Where the data lives

- Everything is stored in the app's own local storage on the phone. Nothing is ever uploaded.
- The Home Screen app's storage is **separate from Safari's**. Opening the link in Safari shows an
  empty app. That's expected; use the icon.
- **Deleting the Home Screen icon deletes the data.** Back up now and then:
  **Progress → Export backup → Save to Files** (or iCloud Drive). **Import backup** restores it.
  After a week of use, Daymark reminds you if you haven't backed up in 30 days.

## Daily reminder

Create a repeating reminder in the iPhone **Reminders** app, or a **Clock** alarm, at about
9:30 pm with a neutral title like "Mark your day". Then open Daymark from its icon.

Don't use a Shortcuts "Open URL" automation. It opens Safari, which has separate (empty)
storage.

## How the numbers work

- Before 4 am, "today" still means the previous day, so marking just after midnight counts for
  the right day.
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
