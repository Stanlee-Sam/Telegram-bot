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
// replace your existing ensureTelegramWebhook with this
async function ensureTelegramWebhook() {
  const botToken = process.env.BOT_TOKEN;
  const desiredUrl = process.env.TELEGRAM_WEBHOOK_URL;

  if (!botToken) {
    console.error("❌ BOT_TOKEN not set. Skipping webhook setup.");
    return;
  }
  if (!desiredUrl) {
    console.error("❌ TELEGRAM_WEBHOOK_URL not set. Skipping webhook setup.");
    return;
  }

  const apiBase = `https://api.telegram.org/bot${botToken}`;

  try {
    // 1) Check current webhook info
    const infoResp = await axios.get(`${apiBase}/getWebhookInfo`);
    console.log("getWebhookInfo:", JSON.stringify(infoResp.data, null, 2));

    const currentUrl = infoResp.data?.result?.url || "";

    if (currentUrl === desiredUrl) {
      console.log("✅ Webhook already set to desired URL. No action needed.");
      return;
    }

    // 2) Attempt to set webhook, but handle 429 with retry_after
    const maxAttempts = 5;
    let attempt = 0;
    let backoffMs = 1000; // base backoff

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const params = new URLSearchParams({ url: desiredUrl });
        const setResp = await axios.post(
          `${apiBase}/setWebhook`,
          params.toString(),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
        );

        console.log("setWebhook response:", JSON.stringify(setResp.data, null, 2));
        if (setResp.data?.ok) {
          console.log("✅ New webhook set successfully:", desiredUrl);
          return;
        } else {
          console.error("⚠️ setWebhook returned non-ok body:", setResp.data);
          // don't retry for non-429 non-transient errors
          break;
        }
      } catch (err) {
        const status = err.response?.status;
        const body = err.response?.data;
        console.error(`setWebhook attempt ${attempt} failed:`, { status, body, message: err.message });

        if (status === 429) {
          // Telegram tells us how long to wait
          const retryAfter = body?.parameters?.retry_after ?? 1;
          const waitMs = Math.max(retryAfter * 1000, backoffMs);
          console.log(`🔁 Received 429. Respecting retry_after ${retryAfter}s. Waiting ${waitMs}ms before retry.`);
          // sleep (this is startup-time waiting — safe and short if retry_after small)
          await new Promise((r) => setTimeout(r, waitMs));
          backoffMs *= 2;
          continue;
        } else {
          // Non-rate-limit error (400, 401, etc.) — break and surface it
          console.error("❌ Non-retryable error setting webhook:", body || err.message);
          break;
        }
      }
    }

    console.error("⚠️ Failed to set webhook after retries. You can call /webhook/set-webhook manually to try again once rate-limit eases.");
  } catch (err) {
    console.error("❌ Error ensuring webhook (getWebhookInfo failed):", err.response?.data || err.message);
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
