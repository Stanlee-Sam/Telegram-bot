require("dotenv").config();
const express = require("express");
const { startBot } = require("./bot");
const mpesaWebhook = require("./payments/webhook");
const app = express();
const { startExpiryCron } = require("./jobs/expiryCheck");

// Middleware to parse JSON and keep rawBody for M-Pesa verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

(async () => {
  // Start Telegram bot (webhook mode)
  const bot = await startBot({ useWebhook: true }); // pass flag to bot

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
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
