# Keepclear

A prototype planner that builds a student's day around classes, tasks, and sleep, and keeps a daily minimum of free time that tasks can never take.

## Run it

```bash
python3 build.py && python3 -m http.server 4178 --directory dist
```

Then open http://localhost:4178. There are no dependencies and no build step beyond `build.py`, which puts `src/` into one file.

- `dist/index.html`: full page for local use
- `dist/margin.html`: the same page without the doctype/head wrapper, for publishing as a Claude artifact

## Where things live

| File | What it does |
| --- | --- |
| `src/js/engine.js` | Scheduler: travel and buffers, protected free time, splitting tasks across days, energy-aware placement, reflow, forecast, overcommitment |
| `src/js/ai.js` | Reads language and files: event sentences, brain dumps, estimates, syllabus dates, .ics calendar exports. Uses Claude when the page runs as an artifact with the `sample` capability, and a built-in parser otherwise |
| `src/js/data.js` | Empty starting state and saving to localStorage |
| `src/js/views.js` | Screen renderers |
| `src/js/app.js` | Routing, actions, dialogs, timers |

The app starts empty. Everything you add is saved in the browser's localStorage. Settings > Clear all data starts over.

## Keyboard

| Key | Action |
| --- | --- |
| `C` | New task or event (dates and times you type are highlighted as they're understood) |
| `⌘K` / `Ctrl K` or `/` | Search tasks, events and commands |
| `R` | Reflow the rest of today |
| `T` | Go to Today |
| `←` `→` | Previous or next week in Calendar |
| `?` | Show shortcuts |

Click an empty time in the Calendar grid to add an event there.
