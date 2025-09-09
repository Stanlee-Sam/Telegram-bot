// bot/index.js
const TelegramBot = require("node-telegram-bot-api");
const { stkPush } = require("../payments/daraja");
const axios = require("axios");
const { saveUser } = require("../db/models");
const { removeExpiredUsers } = require("../jobs/expiryCheck");
const pool = require("../db/index.js");

let bot;

// Fetch ngrok URL if running locally

const PENDING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const startBot = async ({ useWebhook = false } = {}) => {
  const token = process.env.BOT_TOKEN;

  if (useWebhook) {
    bot = new TelegramBot(token); // no polling
    await bot.setWebHook(process.env.TELEGRAM_WEBHOOK_URL);
    console.log("🤖 Telegram bot started in webhook mode");
  } else {
    bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram bot started in polling mode");
  }

  const CHANNEL_ID = process.env.GROUP_ID;
  const ADMIN_IDS =
    process.env.ADMIN_ID?.split(",").map((id) => id.trim()) || [];

  // pendingSubscriptions keyed by Telegram user id (String)
  const pendingSubscriptions = new Map();

  function isAdmin(msg) {
    const uid = String(msg.from?.id || "");
    const allowed = ADMIN_IDS.includes(uid);
    // useful debug line: console.log(`isAdmin(${uid}) => ${allowed}`);
    return allowed;
  }

  // wrapper to enforce admin-only commands with consistent messaging and logging
  function requireAdmin(cmdName, handler) {
    return async (msg, match) => {
      console.log(`COMMAND: ${cmdName} called by ${msg.from?.id}`);
      if (!isAdmin(msg)) {
        await bot.sendMessage(
          msg.chat.id,
          `❌ Unauthorized — admin-only command: ${cmdName}`
        );
        return;
      }
      try {
        await handler(msg, match);
      } catch (err) {
        console.error(`Error in ${cmdName}:`, err);
        await bot.sendMessage(msg.chat.id, `❌ Error running ${cmdName}`);
      }
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Basic commands ---
  bot.onText(/^\/start(?:@\S+)?$/i, (msg) => {
    console.log(`/start from ${msg.from?.id}`);
    bot.sendMessage(
      msg.chat.id,
      "👋 Hello! Welcome to D'atrix Subscription bot! Use /help for navigation"
    );
  });

  bot.onText(/^\/help(?:@\S+)?$/i, (msg) => {
    console.log(`/help from ${msg.from?.id}`);
    const chatId = msg.chat.id;
    const isAdminUser = isAdmin(msg);

    let helpMessage = "👋 Welcome to D'atrix Subscription Bot!\n\n";

    if (isAdminUser) {
      helpMessage += "🛠 Admin Commands:\n";
      helpMessage += "• /members - List active subscribers\n";
      helpMessage += "• /remove @username - Remove a subscriber\n";
      helpMessage +=
        "• /broadcast Your Message - Send message to all subscribers\n";
      helpMessage += "• /checkExpiry - Remove expired subscriptions\n\n";
    }

    helpMessage += "🔹 User Commands:\n";
    helpMessage += "• /subscribe - Start subscription\n";
    helpMessage += "• /help - Show this menu\n";

    bot.sendMessage(chatId, helpMessage);
  });

  // --- Subscription flow (command starts it) ---
  bot.onText(/^\/subscribe(?:@\S+)?$/i, (msg) => {
    console.log(`/subscribe from ${msg.from?.id}`);
    const fromId = String(msg.from?.id);
    const chatId = msg.chat.id;

    if (pendingSubscriptions.has(fromId)) {
      bot.sendMessage(
        chatId,
        "⚠️ You already have a pending subscription request. Please send your phone number or wait."
      );
      return;
    }

    const timeoutId = setTimeout(() => {
      pendingSubscriptions.delete(fromId);
      try {
        bot.sendMessage(
          chatId,
          "⏳ Subscription request timed out. Please run /subscribe again when ready."
        );
      } catch (e) {}
    }, PENDING_TIMEOUT_MS);

    pendingSubscriptions.set(fromId, {
      step: "awaiting_phone",
      chatId,
      timeoutId,
    });

    bot.sendMessage(
      chatId,
      "📲 Enter your M-Pesa phone number (format: 2547XXXXXXXX):"
    );
  });

  // --- single centralized message handler for phone input ---
  bot.on("message", async (msg) => {
    // ignore non-text and commands
    if (!msg.text) return;
    if (msg.text.trim().startsWith("/")) return;

    const fromId = String(msg.from?.id || "");
    const pending = pendingSubscriptions.get(fromId);
    if (!pending || pending.step !== "awaiting_phone") return;

    const chatId = pending.chatId || msg.chat.id;
    const phoneNumber = msg.text.replace(/\D/g, ""); // sanitize digits only
    console.log(
      `Pending phone input from ${fromId}: raw='${msg.text}' sanitized='${phoneNumber}'`
    );

    if (!/^2547\d{8}$/.test(phoneNumber)) {
      await bot.sendMessage(
        chatId,
        "❌ Invalid phone number. Use format 2547XXXXXXXX"
      );
      return;
    }

    clearTimeout(pending.timeoutId);
    await bot.sendMessage(
      chatId,
      "✅ Phone number received! Processing your subscription..."
    );

    const amount = 100;
    const callbackUrl = process.env.CALLBACK_URL;

    try {
      // save user mapping (phone <-> chatId)
      await saveUser({
        chatId: String(chatId),
        phoneNumber: String(phoneNumber),
        username: msg.from.username || null,
      });

      // trigger STK Push
      const response = await stkPush(phoneNumber, amount, callbackUrl);
      console.log("stkPush response:", response);

      if (response?.ResponseCode === "0" || response?.responseCode === "0") {
        await bot.sendMessage(
          chatId,
          "✅ Payment request sent! Check your phone for the M-Pesa prompt."
        );
      } else {
        await bot.sendMessage(
          chatId,
          "⚠️ Payment request failed. Please try again later."
        );
      }
    } catch (err) {
      console.error("Subscription error:", err);
      await bot.sendMessage(
        chatId,
        "❌ Something went wrong while processing your subscription. Please try again or contact support."
      );
    } finally {
      pendingSubscriptions.delete(fromId);
    }
  });

  // --- Simulation ---
  bot.onText(/^\/simulate(?:@\S+)?$/i, (msg) => {
    console.log(`/simulate from ${msg.from?.id}`);
    const chatId = msg.chat.id;
    const amount = 100;

    (async () => {
      try {
        const simulateUrl = `${process.env.CALLBACK_URL}/simulate-success/${chatId}/${amount}`;
        await axios.get(simulateUrl);

        await bot.sendMessage(
          chatId,
          `✅ Simulated subscription created for ${chatId} amount ${amount} KES.`
        );
      } catch (err) {
        console.error("Simulation error:", err.response?.data || err.message);
        await bot.sendMessage(chatId, "❌ Failed to simulate subscription.");
      }
    })();
  });

  // --- Admin-only commands (wrapped) ---
  bot.onText(
    /^\/checkExpiry(?:@\S+)?$/i,
    requireAdmin("checkExpiry", async (msg) => {
      const count = await removeExpiredUsers(bot);
      await bot.sendMessage(
        msg.chat.id,
        `✅ Expiry check completed. Removed ${count} user(s).`
      );
    })
  );

  bot.onText(
    /^\/members(?:@\S+)?$/i,
    requireAdmin("members", async (msg) => {
      try {
        const res = await pool.query(
          `SELECT telegram_id, username, expiry_date FROM "Subscription" ORDER BY expiry_date DESC`
        );
        if (!res.rows.length)
          return bot.sendMessage(msg.chat.id, "No active subscribers found.");

        const list = res.rows
          .map(
            (row) =>
              `• ${row.username ? `@${row.username}` : row.telegram_id} - ${
                row.telegram_id
              } (expires: ${row.expiry_date.toISOString().split("T")[0]})`
          )
          .join("\n");

        await bot.sendMessage(msg.chat.id, `📋 Active Subscribers:\n${list}`);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(msg.chat.id, "❌ Failed to fetch subscribers.");
      }
    })
  );

  bot.onText(
    /^\/remove\s+(.+)(?:@\S+)?$/i,
    requireAdmin("remove", async (msg, match) => {
      const target = match[1].replace("@", "").trim();
      try {
        const res = await pool.query(
          `SELECT telegram_id FROM "Subscription" WHERE telegram_id=$1 OR username=$2`,
          [target, target]
        );
        if (!res.rows.length)
          return bot.sendMessage(msg.chat.id, `❌ User ${target} not found.`);

        const userId = res.rows[0].telegram_id;
        await pool.query(`DELETE FROM "Subscription" WHERE telegram_id=$1`, [
          userId,
        ]);

        // Try to remove from Telegram group (if present)
        try {
          const member = await bot.getChatMember(CHANNEL_ID, parseInt(userId));
          if (member.status !== "left" && member.status !== "kicked") {
            await bot.banChatMember(CHANNEL_ID, member.user.id);
            await bot.unbanChatMember(CHANNEL_ID, member.user.id);
            console.log(`Removed ${member.user.id} from Telegram group`);
          }
        } catch {
          console.log(
            `User ${target} not found in group or could not be removed`
          );
        }

        await bot.sendMessage(
          msg.chat.id,
          `✅ User ${target} removed successfully.`
        );
      } catch (err) {
        console.error(err);
        await bot.sendMessage(
          msg.chat.id,
          `❌ Failed to remove user ${target}.`
        );
      }
    })
  );

  bot.onText(
    /^\/broadcast\s+(.+)(?:@\S+)?$/i,
    requireAdmin("broadcast", async (msg, match) => {
      const message = match[1];
      try {
        const res = await pool.query(`SELECT telegram_id FROM "Subscription"`);
        const subscribers = res.rows.map((r) => r.telegram_id).filter(Boolean);

        for (let id of subscribers) {
          try {
            await bot.sendMessage(id, `📢 Broadcast message:\n\n${message}`);
          } catch {
            console.log(`Cannot DM user ${id}`);
          }
          await sleep(1000); // rate limiting cushion
        }

        await bot.sendMessage(
          msg.chat.id,
          `✅ Broadcast sent to ${subscribers.length} subscribers.`
        );
      } catch (err) {
        console.error(err);
        await bot.sendMessage(msg.chat.id, "❌ Failed to broadcast.");
      }
    })
  );

  console.log("🤖 Telegram bot started");
  return bot;
};

module.exports = { startBot, bot };
