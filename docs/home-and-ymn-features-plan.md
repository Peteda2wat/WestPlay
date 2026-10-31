# Plan: Home customization and the YMN One features (trimmed)

Cut down from the first plan (6–7 days) to what the need justifies: about 2–3 days. The player plays two
ATS profiles, so profiles stay in.

| # | Feature | Cut from the first plan |
|---|---------|-------------------------|
| 1 | Hide and reorder Home apps (Settings › Home) | nothing |
| 2 | Widgets on Home: Now Playing, trip card, Weather, one size (2×2) | no small/XL sizes, no new widgets, no press-and-hold edit mode |
| 3 | Map marker: arrow (today's) or truck | no puck |
| 4 | Average speed and distance driven on the trip card | no last-trip history, no separate screen |
| 5 | Each ATS profile keeps its own Home, widgets, look and wallpaper | no welcome card, no profile icons, no manual switching |

Every new label goes into `ui/src/cabin/state/strings.ts` in both languages (`en`, `tr`).

## 1. Hide and reorder Home apps

- `state/store.ts`: `home: HomeItem[]` (persisted; `sanitize` drops unknown or unreleased entries and
  duplicates, and always keeps Settings so the player can't lock themselves out). Persist version 4.
- `home/Home.tsx` pages through `home`.
- Settings › Home: one switch per item, with up/down buttons. Settings' own switch can't be turned off.

## 2. Widgets on Home

- `HomeItem` also takes `{ kind: 'widget', widget: 'nowPlaying' | 'destination' | 'weather' }`. Each widget
  is 2×2 grid cells (half a 4×2 page), placed by `packPages` in `home/pages.ts` (tested).
- The widget bodies are the Dashboard's, unchanged; only the `widget-slot` wrapper differs on Home.
- Widgets are added and removed in Settings › Home, which shows the widgets after the apps.

## 3. Map marker

- `marker: 'arrow' | 'truck'` in the cabin store (persisted), picked in Settings › Appearance.
- `maps/liveMap.ts` swaps the marker's SVG when it changes.

## 4. Trip computer

- `dashboard/tripComputer.ts`: a pure step `(trip, telemetry, ms) → trip`. It sums distance and driving time
  while unpaused and skips steps over 2 s. Average = distance ÷ driving time. The trip restarts when a job is
  taken or ends. Tested.
- Two rows on the trip card: *Driven* and *Avg speed*.

## 5. Profiles that follow the game's profile

- Host: `Player.profile` from `westplay_setup::profiles::selected`, posted to the page as
  `{"type":"profile","name":…}` when it changes.
- Host settings: `looks` by profile name in `settings.json`. A profile change saves the current look under
  the old name and loads the new one's (the first time a profile is seen, it keeps the current look).
- Page: the cabin store's localStorage key becomes `westplay.cabin.<profile>` (`persist.setOptions` +
  `rehydrate`). The first time a profile is seen, it copies the current choices.
- Sound (equalizer, voice) stays shared: it's the PC's speakers, not the profile's.

## Research notes (from the first plan)

- **Press-and-hold** would work: the in-game cursor and iPad taps both send real mouse down/up
  (`pointer.rs`, `remote.rs`). It isn't used now that edit mode is cut.
- **Game trip figures**: `truck.odometer` and `truck.fuel.consumption.average` exist in the SCS SDK, but
  adding them means bridge v29 and a plugin reinstall, so the page sums its own figures instead.
- **CarPlay widgets** (iOS 26) come in stacks, with no sizes, and are edited only on the phone:
  [9to5Mac](https://9to5mac.com/2026/05/15/carplay-in-ios-26-adds-five-new-ways-to-customize-your-setup/).
