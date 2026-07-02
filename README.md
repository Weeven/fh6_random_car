# FH6 Random Car

A random car picker for **Forza Horizon 6**, built for streamers. Viewers
spend Channel Points to trigger a random car change; the result appears as
an animated card on an OBS overlay. You control which cars are in the pool
(class, drivetrain, manufacturer, country, year range) from a simple control
panel.

## What's in here

- `public/overlay.html` — add this as an **OBS Browser Source**. Transparent
  background, animates in when a spin happens, auto-hides after a few
  seconds.
- `public/control.html` — open in a regular browser tab (on your stream PC,
  not visible to viewers). Set filters (e.g. "Japan only", "RWD only",
  "1990–2005") and hit **Save filters**. Also has a manual **Spin now**
  button if you want to trigger changes yourself instead of/alongside
  Channel Points.
- `server/` — a small Node/Express server that ties it together and (if
  configured) listens for Twitch Channel Points redemptions via EventSub.
- `data/cars.sample.json` — a small hand-written sample dataset (10 cars) so
  the app works out of the box.
- `scripts/scrape_cars.js` — pulls the real, full FH6 car list (600+ cars)
  from a community database into `data/cars.json`. See below.

## Quickstart

```bash
npm install
cp .env.example .env
npm start
```

Then:
- Add `http://localhost:8080/overlay.html` as a **Browser Source** in OBS
  (set width/height to your canvas size, background stays transparent).
- Open `http://localhost:8080/control.html` in a normal browser to set
  filters and try the manual **Spin now** button — this works immediately,
  no Twitch setup required.

## Getting the full car list

The repo ships with just 10 sample cars so you can test right away. To pull
the real, full FH6 roster:

```bash
npm run scrape
```

This fetches and parses a community-maintained FH6 database
(kudosprime.com) into `data/cars.json`, which the server prefers over the
sample file automatically once it exists. **This needs to be run somewhere
with real internet access** — it won't work in a sandboxed CI runner.

Websites restructure their pages sometimes, so if the scraper comes back
with 0 cars, open `scripts/scrape_cars.js` — the comments explain which
selectors to check and update against the live page.

Alternative: if you'd rather hand-curate or you find a cleaner data source
(the Forza Fandom wiki's car list is another good one), you can skip the
scraper entirely and just add rows directly to `data/cars.json` following
the schema in `data/cars.sample.json`:

```json
{
  "id": "unique-slug",
  "name": "1999 Nissan Skyline GT-R V-Spec (R34)",
  "manufacturer": "Nissan",
  "country": "Japan",
  "year": 1999,
  "class": "S1",
  "drivetrain": "AWD",
  "rarity": "Rare",
  "source": "Autoshow"
}
```

## Wiring up Channel Points

See [`setup/twitch_setup.md`](setup/twitch_setup.md) for the full walkthrough
(registering a Twitch app, creating the reward, getting a token). Once
`.env` is filled in, redemptions of your configured reward automatically
trigger a spin using whatever filters are currently active in the control
panel.

## How filtering works

A spin never reveals a specific car model — it reveals exactly as much as
the active filters pin down, and no more:

- **No filters at all** — reveals a random manufacturer. Every manufacturer
  gets equal odds regardless of how many cars they have in the game, so a
  30-car manufacturer (e.g. Ford) doesn't drown out a 1-car one (e.g. Volvo).
- **Exactly one filter** — shown as-is, however narrow. Filter to just
  `Volvo` and it shows "Volvo", even though they only have 1 car — you
  picked it on purpose.
- **Two or more filters** — shown combined, e.g. `Nissan` + `Class A` shows
  "Nissan · Class A". If that exact combination matches 5 or fewer cars, the
  reveal automatically drops the most-specific filter in the combo and
  rechecks, repeating until the pool is bigger than that (or only one filter
  is left). E.g. `Nissan` + `Japan` + `Class D` might only match a couple
  cars, so it'd back off to "Japan · Class D" instead. This keeps every
  reveal at more than 5 matching cars, so there's a decent chance whoever's
  playing actually owns one.

Each filter group (class, drivetrain, manufacturer, country, region, decade)
is OR'd internally and AND'd across groups — e.g. selecting `RWD` + `AWD`
for drivetrain and `Japan` for country matches anything Japanese that's RWD
*or* AWD.

**Refreshing/loading `overlay.html`** on its own (e.g. re-adding the OBS
Browser Source) also reveals something random — independent of the control
panel's saved filters, chat, and Channel Points. It's a random 0-2 filter
combo each time (sometimes just a manufacturer, sometimes "Region · Decade",
sometimes "Drivetrain · Country", etc.), broadened the same way if too
narrow.

## Chat commands

Independent of whatever's set in the control panel, viewers (or you) can
type in chat:

- `!changecar` — any manufacturer.
- `!changecar-asia` — matches a region/continent.
- `!changecar-japan` — matches a country.
- `!changecar-honda` — matches a manufacturer.
- `!changecar-s1` — matches a class.
- `!changecar-rwd` — matches a drivetrain.
- `!changecar-90s` — matches a decade.

Each command applies *only* the one filter it matched — it doesn't combine
with the control panel's saved filters, and follows the same reveal rules
above. If the word after the dash doesn't match anything, the bot (if
`TWITCH_CHAT_REPLY=true`) replies saying so instead of silently failing. See
`setup/twitch_setup.md` for how to connect the chat bot.

## Notes & limitations

- Filter state lives in server memory — restarting the server resets it to
  "no restrictions." Fine for a lightweight stream tool; let me know if you
  want it persisted to disk.
- The Twitch token flow in `setup/twitch_setup.md` uses a short-lived
  implicit-grant token for simplicity. It'll need refreshing every few
  hours; see that doc for notes on upgrading to a refreshable token if you
  want it to run unattended for long streams.
- Car `rarity`/`source` fields are included for future features (e.g.
  "only Wheelspin-exclusive cars") but aren't required for filtering today.
