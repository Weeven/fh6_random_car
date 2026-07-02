const WebSocket = require("ws");
const fetch = require("node-fetch");

const EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";
const HELIX_SUBSCRIPTIONS_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";

/**
 * Connects to Twitch EventSub over WebSocket and subscribes to
 * channel_points_custom_reward_redemption.add for the given reward title.
 * Calls onRedemption(redemptionEvent) whenever that specific reward is redeemed.
 *
 * Docs: https://dev.twitch.tv/docs/eventsub/handling-eventsub-events/#subscribing-to-events
 */
function connectTwitchEventSub({ clientId, accessToken, broadcasterId, rewardTitle, onRedemption, onStatus }) {
  function connect(url = EVENTSUB_WS_URL) {
    const ws = new WebSocket(url);

    ws.on("open", () => onStatus?.("connected to EventSub WebSocket"));

    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw.toString());
      const type = msg.metadata?.message_type;

      if (type === "session_welcome") {
        const sessionId = msg.payload.session.id;
        onStatus?.(`session established (${sessionId}), subscribing to redemptions...`);
        await subscribeToRedemptions({ clientId, accessToken, broadcasterId, sessionId });
      }

      if (type === "session_reconnect") {
        const reconnectUrl = msg.payload.session.reconnect_url;
        onStatus?.("Twitch requested reconnect, reconnecting...");
        ws.close();
        connect(reconnectUrl);
      }

      if (type === "notification") {
        const subType = msg.payload.subscription.type;
        if (subType === "channel.channel_points_custom_reward_redemption.add") {
          const event = msg.payload.event;
          if (!rewardTitle || event.reward.title === rewardTitle) {
            onRedemption?.(event);
          }
        }
      }

      if (type === "session_keepalive") {
        // no-op, connection is alive
      }
    });

    ws.on("close", () => {
      onStatus?.("EventSub WebSocket closed, reconnecting in 5s...");
      setTimeout(() => connect(), 5000);
    });

    ws.on("error", (err) => onStatus?.(`EventSub WebSocket error: ${err.message}`));

    return ws;
  }

  async function subscribeToRedemptions({ clientId, accessToken, broadcasterId, sessionId }) {
    const res = await fetch(HELIX_SUBSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.channel_points_custom_reward_redemption.add",
        version: "1",
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: "websocket", session_id: sessionId },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      onStatus?.(`Failed to subscribe to redemptions: ${res.status} ${body}`);
      return;
    }
    onStatus?.("Subscribed to channel point redemptions.");
  }

  return connect();
}

module.exports = { connectTwitchEventSub };
