// bot/index.js
const TelegramBot = require("node-telegram-bot-api");
const { stkPush } = require("../payments/daraja");
const axios = require("axios");
const { saveUser } = require("../db/models");
const { removeExpiredUsers } = require("../jobs/expiryCheck");
const pool = require("../db/index.js");

let bot;

const PENDING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const pendingSubscriptions = new Map();

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

  function isAdmin(msg) {
    const uid = String(msg.from?.id || "");
    return ADMIN_IDS.includes(uid);
  }

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

  // --- START ---
  bot.onText(/^\/start(?:@\S+)?$/i, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      "👋 Hello! Welcome to D'atrix Subscription bot! Use the buttons below 👇",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📌 Subscribe", callback_data: "subscribe" }],
            [{ text: "ℹ️ Help", callback_data: "help_menu" }],
          ],
        },
      }
    );
  });

  // --- HELP ---
  bot.onText(/^\/help(?:@\S+)?$/i, (msg) => {
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

    helpMessage += "🔹 User Options:\nUse the buttons below 👇";

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📌 Subscribe", callback_data: "subscribe" }],
          [{ text: "ℹ️ Help", callback_data: "help_menu" }],
        ],
      },
    };

    bot.sendMessage(chatId, helpMessage, keyboard);
  });

  // --- CALLBACK HANDLER ---
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const fromId = String(query.from.id);
    const data = query.data;

    if (data === "help_menu") {
      await bot.sendMessage(
        chatId,
        "👋 To subscribe, click *Subscribe* and follow the steps.\n\n" +
          "💳 Payment is done via M-Pesa STK push.\n\n" +
          "Available plans:\n" +
          "• Daily - 30 KES\n" +
          "• Weekly - 50 KES\n" +
          "• Monthly - 100 KES",
        { parse_mode: "Markdown" }
      );
    }

    if (data === "subscribe") {
      pendingSubscriptions.set(fromId, {
        step: "awaiting_plan",
        chatId,
      });

      const planKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "1️⃣ Daily (30 KES)", callback_data: "plan_daily" },
              { text: "2️⃣ Weekly (50 KES)", callback_data: "plan_weekly" },
            ],
            [{ text: "3️⃣ Monthly (100 KES)", callback_data: "plan_monthly" }],
          ],
        },
      };

      await bot.sendMessage(chatId, "📌 Choose a subscription plan:", planKeyboard);
    }

    if (data.startsWith("plan_")) {
      let plan, amount, days;
      if (data === "plan_daily") {
        plan = "daily";
        amount = 30;
        days = 1;
      } else if (data === "plan_weekly") {
        plan = "weekly";
        amount = 50;
        days = 7;
      } else if (data === "plan_monthly") {
        plan = "monthly";
        amount = 100;
        days = 30;
      }

      pendingSubscriptions.set(fromId, {
        step: "awaiting_phone",
        chatId,
        plan,
        amount,
        days,
      });

      await bot.sendMessage(chatId, "📲 Enter your M-Pesa phone number (2547XXXXXXXX):");
    }
  });

  // --- PHONE INPUT ---
  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.trim().startsWith("/")) return;

    const fromId = String(msg.from?.id || "");
    const pending = pendingSubscriptions.get(fromId);
    if (!pending) return;

    const chatId = pending.chatId || msg.chat.id;

    if (pending.step === "awaiting_phone") {
      const phoneNumber = msg.text.replace(/\D/g, "");
      if (!/^2547\d{8}$/.test(phoneNumber)) {
        return bot.sendMessage(chatId, "❌ Invalid phone. Use format 2547XXXXXXXX");
      }

      const { plan, amount, days } = pending;
      pendingSubscriptions.delete(fromId);

      await bot.sendMessage(
        chatId,
        `✅ Phone received!\n💳 Charging ${amount} KES for ${plan} plan...`
      );

      try {
        await saveUser({
          chatId: String(chatId),
          phoneNumber: String(phoneNumber),
          username: msg.from.username || null,
        });

        const response = await stkPush(phoneNumber, amount, process.env.CALLBACK_URL);
        console.log("stkPush response:", response);

        if (response?.ResponseCode === "0" || response?.responseCode === "0") {
          await bot.sendMessage(chatId, "📲 Check your phone for the M-Pesa prompt!");
        } else {
          await bot.sendMessage(chatId, "⚠️ Payment request failed. Try again later.");
        }
      } catch (err) {
        console.error("Subscription error:", err);
        await bot.sendMessage(chatId, "❌ Error processing subscription. Try again later.");
      }
    }
  });

  // --- SIMULATION ---
  bot.onText(/^\/simulate(?:@\S+)?$/i, (msg) => {
    const chatId = msg.chat.id;
    const amount = 100;
    (async () => {
      try {
        const simulateUrl = `${process.env.CALLBACK_URL}/simulate-success/${chatId}/${amount}`;
        await axios.get(simulateUrl);
        await bot.sendMessage(chatId, `✅ Simulated subscription for ${chatId} amount ${amount} KES.`);
      } catch (err) {
        console.error("Simulation error:", err.response?.data || err.message);
        await bot.sendMessage(chatId, "❌ Failed to simulate subscription.");
      }
    })();
  });

  // --- ADMIN COMMANDS ---
  bot.onText(
    /^\/checkExpiry(?:@\S+)?$/i,
    requireAdmin("checkExpiry", async (msg) => {
      const count = await removeExpiredUsers(bot);
      await bot.sendMessage(msg.chat.id, `✅ Expiry check completed. Removed ${count} user(s).`);
    })
  );

  bot.onText(
    /^\/members(?:@\S+)?$/i,
    requireAdmin("members", async (msg) => {
      try {
        const res = await pool.query(
          `SELECT telegram_id, username, expiry_date FROM "Subscription" ORDER BY expiry_date DESC`
        );
        if (!res.rows.length) return bot.sendMessage(msg.chat.id, "No active subscribers found.");

        const list = res.rows
          .map(
            (row) =>
              `• ${row.username ? `@${row.username}` : row.telegram_id} - ${row.telegram_id} (expires: ${row.expiry_date.toISOString().split("T")[0]})`
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
        await pool.query(`DELETE FROM "Subscription" WHERE telegram_id=$1`, [userId]);

        try {
          const member = await bot.getChatMember(CHANNEL_ID, parseInt(userId));
          if (member.status !== "left" && member.status !== "kicked") {
            await bot.banChatMember(CHANNEL_ID, member.user.id);
            await bot.unbanChatMember(CHANNEL_ID, member.user.id);
            console.log(`Removed ${member.user.id} from Telegram group`);
          }
        } catch {
          console.log(`User ${target} not found in group or could not be removed`);
        }

        await bot.sendMessage(msg.chat.id, `✅ User ${target} removed successfully.`);
      } catch (err) {
        console.error(err);
        await bot.sendMessage(msg.chat.id, `❌ Failed to remove user ${target}.`);
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
          await sleep(1000);
        }

        await bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${subscribers.length} subscribers.`);
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
