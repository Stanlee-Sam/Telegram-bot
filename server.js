require("dotenv").config();
const express = require("express");
const { startBot } = require("./bot");
const mpesaWebhook = require("./payments/webhook");
const { startExpiryCron } = require("./jobs/expiryCheck");
const axios = require("axios");

const app = express();

// Middleware to parse JSON and keep rawBody for M-Pesa verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// --- Helper: Set Telegram Webhook if not already set ---
// replace existing ensureTelegramWebhook function with this
async function ensureTelegramWebhook() {
  try {
    const url = process.env.TELEGRAM_WEBHOOK_URL;
    if (!url) {
      console.error("❌ TELEGRAM_WEBHOOK_URL not set!");
      return;
    }
    if (!process.env.BOT_TOKEN) {
      console.error("❌ BOT_TOKEN not set!");
      return;
    }

    // Delete any existing webhook first
    await axios.get(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteWebhook`
    );
    console.log("✅ Old webhook deleted (if any)");

    // Use POST with form params -- it's more explicit
    const params = new URLSearchParams({ url });
    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`,
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log(
      "setWebhook raw response:",
      JSON.stringify(response.data, null, 2)
    );

    if (response.data && response.data.ok) {
      console.log("✅ New webhook set successfully:", url);
    } else {
      console.error("⚠️ Failed to set webhook (body):", response.data);
    }
  } catch (err) {
    // Print full axios response body when available
    console.error(
      "❌ Error ensuring webhook:",
      err.response?.status,
      err.response?.data || err.message
    );
  }
}

(async () => {
  // Start Telegram bot (webhook mode)
  const bot = await startBot({ useWebhook: true });

  // Start expiry cron job
  startExpiryCron(bot);

  // M-Pesa webhook route
  app.use("/webhook", mpesaWebhook(bot));

  // Telegram webhook route
  app.post("/webhook/telegram", (req, res) => {
    bot.processUpdate(req.body); // Telegram sends POST updates here
    res.sendStatus(200);
  });

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log("NODE_ENV:", process.env.NODE_ENV);
    console.log("PORT env:", process.env.PORT);
    console.log(
      "TELEGRAM_WEBHOOK_URL:",
      process.env.TELEGRAM_WEBHOOK_URL ? "[set]" : "[NOT SET]"
    );
    console.log(
      "DARAJA_ENV override:",
      process.env.DARAJA_BASE_URL || "[none]"
    );

    await ensureTelegramWebhook(); // 🔹 Set or verify webhook automatically
  });
})();
