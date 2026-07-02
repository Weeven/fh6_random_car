# Twitch Channel Points Setup

This connects viewer Channel Points redemptions to your car randomizer. Skip
this whole section if you only want the manual "Spin now" button in the
control panel — that works with zero Twitch setup.

## 1. Create your Channel Points reward(s)

In your Twitch Creator Dashboard → **Viewer Rewards → Channel Points**,
create as many custom rewards as you want, at whatever prices you like —
there's nothing to configure in `.env` for this, the server recognizes them
purely by title:

- **`Change Car`** — no filter, spins for any manufacturer. E.g. price this
  low (your cheapest tier).
- **`Change Car: <word>`** — one filter, using the exact same words as the
  chat commands: a manufacturer (`Change Car: Honda`), country
  (`Change Car: Japan`), class (`Change Car: Class A`), drivetrain
  (`Change Car: RWD`), or decade (`Change Car: 90s`). Price these higher —
  it's up to you per reward.

Titles are matched case-insensitively, and a dash works instead of a colon
too (`Change Car - Honda`). Any other reward you have on your channel for
unrelated purposes is left alone — only titles starting with "Change Car"
trigger a spin. Skip auto-fulfill on any of them if you want to manually
approve redemptions during raids/spam, though for a gameplay gimmick most
streamers set them to auto-fulfill.

If a reward's title doesn't match a recognizable word after "Change Car:"
(e.g. a typo), it still spins — just with no filter — rather than silently
eating a viewer's paid redemption.

## 2. Register a Twitch application

1. Go to https://dev.twitch.tv/console/apps and click **Register Your Application**.
2. Name: anything, e.g. `FH6 Random Car`.
3. OAuth Redirect URL: `http://localhost:3000` (only needed to complete the
   token flow below, not used at runtime).
4. Category: `Application Integration`.
5. Save, then copy the **Client ID** and generate a **Client Secret**.
   Put both into `.env` as `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`.

## 3. Get your Broadcaster user ID

Use a lookup tool such as
https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/
and enter your channel name. Put the numeric ID in `.env` as
`TWITCH_BROADCASTER_ID`.

## 4. Get a User Access Token with the right scope

You need a token with the `channel:read:redemptions` scope, generated while
logged in as the broadcaster account. The simplest way:

1. Build this URL, swapping in your Client ID:
   ```
   https://id.twitch.tv/oauth2/authorize
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=http://localhost:3000
     &response_type=token
     &scope=channel:read:redemptions
   ```
2. Open it in a browser while logged into the broadcaster's Twitch account,
   approve access.
3. You'll be redirected to `http://localhost:3000/#access_token=...&scope=...`.
   The page will fail to load (nothing is running on port 3000) — that's
   fine, just copy the `access_token` value from the URL bar.
4. Put it in `.env` as `TWITCH_USER_ACCESS_TOKEN`.

Note: these implicit-flow tokens typically expire after ~4 hours unless
refreshed. For a "turn it on before stream, restart occasionally" tool
that's usually fine. If you want it to stay connected across long streams
without restarting, look into the Authorization Code flow with refresh
tokens (https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#oauth-authorization-code-flow)
and wire up `TWITCH_REFRESH_TOKEN` — the `.env.example` has a placeholder
for it, but the current server code uses the access token as-is and doesn't
auto-refresh yet.

## 5. (Optional) Set up the !changecar chat bot

This is separate from the Channel Points setup above and uses simpler
Twitch chat (IRC) credentials rather than the app/EventSub flow.

1. Decide whether to use your own Twitch account or a dedicated bot account
   (a separate account named e.g. `yourchannel_bot` is more common, but your
   own account works fine too, especially just to test).
2. Go to https://twitchtokengenerator.com, choose **Bot Chat Token**, and
   authorize with the account from step 1. Copy the generated token
   (starts with `oauth:`).
3. Fill in `.env`:
   ```
   TWITCH_BOT_USERNAME=the_account_username_from_step_1
   TWITCH_BOT_OAUTH_TOKEN=oauth:xxxxxxxxxxxx
   TWITCH_CHANNEL=your_channel_name
   TWITCH_CHAT_REPLY=true
   ```
4. Restart the server (`npm start`). You should see
   `[Chat] connected to #yourchannel chat` in the console.
5. Type `!changecar-honda` (or any manufacturer/country/class/drivetrain/decade)
   in your own chat to test. If `TWITCH_CHAT_REPLY=true`, the bot replies
   with the car it picked; either way, the overlay updates live.

Commands that don't match anything recognizable (e.g. `!changecar-ferrarri`
misspelled) get a chat reply telling the viewer their filter wasn't
recognized, rather than silently doing nothing.

## 6. Run it

```
npm install
cp .env.example .env   # then fill in the values above
npm start
```

Add `http://localhost:8080/overlay.html` as an OBS Browser Source, and open
`http://localhost:8080/control.html` in a normal browser tab to set filters.
Redeem one of your rewards from a viewer account (or a test/mod account) to
confirm it triggers a spin on the overlay.
