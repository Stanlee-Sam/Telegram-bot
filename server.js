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
async function ensureTelegramWebhook() {
  try {
    const url = process.env.TELEGRAM_WEBHOOK_URL;

    // Delete any existing webhook first
    await axios.get(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteWebhook`);
    console.log("✅ Old webhook deleted (if any)");

    // Set new webhook
    const response = await axios.get(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook?url=${url}`
    );

    if (response.data.ok) {
      console.log("✅ New webhook set successfully:", url);
    } else {
      console.error("⚠️ Failed to set webhook:", response.data);
    }
  } catch (err) {
    console.error("❌ Error ensuring webhook:", err.message);
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
    await ensureTelegramWebhook(); // 🔹 Set or verify webhook automatically
  });
})();
