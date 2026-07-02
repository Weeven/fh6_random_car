const tmi = require("tmi.js");
const { pickRandomCar, resolveCommandToken, isFilterEmpty } = require("./carPicker");

/**
 * Connects to Twitch chat and listens for:
 *   !changecar            -> no filter (manufacturer-first random, see carPicker.js)
 *   !changecar-japan      -> matches country "Japan"
 *   !changecar-honda      -> matches manufacturer "Honda"
 *   !changecar-s1         -> matches class "S1"
 *   !changecar-rwd        -> matches drivetrain "RWD"
 *   !changecar-90s        -> matches decade 1990s
 *
 * Chat-triggered spins are one-off: they use ONLY the filter parsed from the
 * command (ignoring whatever the streamer currently has set in the control
 * panel), so chat always gets exactly what they asked for. Channel Points
 * redemptions and the manual "Spin now" button still use the control panel's
 * saved filters.
 */
function connectTwitchChat({ botUsername, oauthToken, channel, onSpin, onStatus, replyInChat }) {
  const client = new tmi.Client({
    identity: { username: botUsername, password: oauthToken },
    channels: [channel],
  });

  client.on("connected", () => onStatus?.(`connected to #${channel} chat`));
  client.on("disconnected", (reason) => onStatus?.(`chat disconnected: ${reason}`));

  client.on("message", (chatChannel, tags, message, self) => {
    if (self) return;
    const trimmed = message.trim();
    if (!trimmed.toLowerCase().startsWith("!changecar")) return;

    const rest = trimmed.slice("!changecar".length); // "" or "-honda"
    const token = rest.startsWith("-") ? rest.slice(1).trim() : "";

    let filters = {};
    let matchedType = null;
    let matchedValue = null;

    if (token) {
      const resolved = resolveCommandToken(token);
      filters = resolved.filters;
      matchedType = resolved.matchedType;
      matchedValue = resolved.matchedValue;

      if (!matchedType) {
        onStatus?.(`"${token}" didn't match any country/manufacturer/class/drivetrain/decade`);
        if (replyInChat) {
          client
            .say(chatChannel, `@${tags["display-name"] || tags.username} I don't recognize "${token}" — try a manufacturer, country, class (e.g. s1), drivetrain (rwd/fwd/awd), or decade (e.g. 90s).`)
            .catch(() => {});
        }
        return;
      }
    }

    const result = pickRandomCar(filters);
    onSpin?.({ ...result, redeemedBy: tags["display-name"] || tags.username, matchedType, matchedValue });

    if (replyInChat) {
      const name = result.car ? result.car.name : `no car matched "${token}"`;
      client.say(chatChannel, `🎲 ${name}`).catch(() => {});
    }
  });

  client.connect().catch((err) => onStatus?.(`chat connect failed: ${err.message || err}`));

  return client;
}

module.exports = { connectTwitchChat };
