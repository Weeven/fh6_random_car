require("dotenv").config();
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const { computeSpinResult, getFacetOptions } = require("./carPicker");
const { getFilters, setFilters } = require("./state");
const { connectTwitchEventSub } = require("./twitchEventSub");
const { connectTwitchChat } = require("./twitchChat");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---- HTTP API used by the control panel ----

app.get("/api/facets", (req, res) => {
  res.json(getFacetOptions());
});

app.get("/api/filters", (req, res) => {
  res.json(getFilters());
});

app.post("/api/filters", (req, res) => {
  const updated = setFilters(req.body || {});
  res.json(updated);
});

// Returns how many cars currently match the active filters, without spinning.
app.get("/api/pool-count", (req, res) => {
  const { applyFilters } = require("./carPicker");
  res.json({ count: applyFilters(getFilters()).length });
});

// Manual spin trigger (from the control panel "Spin now" button, or curl/OBS hotkey via a tool like Hotkey Server)
app.post("/api/spin", (req, res) => {
  const result = computeSpinResult(getFilters());
  broadcastToOverlay(result);
  res.json(result);
});

const server = app.listen(PORT, () => {
  console.log(`FH6 Random Car server running at http://localhost:${PORT}`);
  console.log(`  Overlay (add as OBS Browser Source): http://localhost:${PORT}/overlay.html`);
  console.log(`  Control panel (open in your own browser): http://localhost:${PORT}/control.html`);
});

// ---- WebSocket server: pushes spin results to the overlay page in real time ----

const wss = new WebSocketServer({ server, path: "/ws" });
const overlayClients = new Set();

wss.on("connection", (ws) => {
  overlayClients.add(ws);
  ws.on("close", () => overlayClients.delete(ws));
});

function broadcastToOverlay(payload) {
  const message = JSON.stringify({ type: "spin_result", ...payload });
  for (const client of overlayClients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

// ---- Twitch EventSub: trigger a spin whenever the configured reward is redeemed ----

const {
  TWITCH_CLIENT_ID,
  TWITCH_USER_ACCESS_TOKEN,
  TWITCH_BROADCASTER_ID,
  TWITCH_REWARD_TITLE,
} = process.env;

if (TWITCH_CLIENT_ID && TWITCH_USER_ACCESS_TOKEN && TWITCH_BROADCASTER_ID) {
  connectTwitchEventSub({
    clientId: TWITCH_CLIENT_ID,
    accessToken: TWITCH_USER_ACCESS_TOKEN,
    broadcasterId: TWITCH_BROADCASTER_ID,
    rewardTitle: TWITCH_REWARD_TITLE || null,
    onStatus: (msg) => console.log(`[Twitch] ${msg}`),
    onRedemption: (event) => {
      console.log(`[Twitch] Redemption by ${event.user_name}: ${event.reward.title}`);
      const result = computeSpinResult(getFilters());
      broadcastToOverlay({ ...result, redeemedBy: event.user_name });
    },
  });
} else {
  console.log(
    "[Twitch] Skipping EventSub connection — TWITCH_CLIENT_ID / TWITCH_USER_ACCESS_TOKEN / " +
      "TWITCH_BROADCASTER_ID not set in .env. Manual spin from the control panel still works. " +
      "See setup/twitch_setup.md to enable channel-points integration."
  );
}

// ---- Twitch chat: !changecar / !changecar-<filter> commands ----

const { TWITCH_BOT_USERNAME, TWITCH_BOT_OAUTH_TOKEN, TWITCH_CHANNEL, TWITCH_CHAT_REPLY } = process.env;

if (TWITCH_BOT_USERNAME && TWITCH_BOT_OAUTH_TOKEN && TWITCH_CHANNEL) {
  connectTwitchChat({
    botUsername: TWITCH_BOT_USERNAME,
    oauthToken: TWITCH_BOT_OAUTH_TOKEN,
    channel: TWITCH_CHANNEL,
    replyInChat: TWITCH_CHAT_REPLY === "true",
    onStatus: (msg) => console.log(`[Chat] ${msg}`),
    onSpin: (result) => {
      console.log(
        `[Chat] ${result.redeemedBy} triggered !changecar${result.matchedValue ? `-${result.matchedValue}` : ""}`
      );
      broadcastToOverlay(result);
    },
  });
} else {
  console.log(
    "[Chat] Skipping chat bot connection — TWITCH_BOT_USERNAME / TWITCH_BOT_OAUTH_TOKEN / " +
      "TWITCH_CHANNEL not set in .env. See setup/twitch_setup.md for the chat bot setup steps."
  );
}
