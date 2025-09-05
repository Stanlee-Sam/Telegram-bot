require("dotenv").config();
const express = require("express");
const { startBot } = require("./bot");
const mpesaWebhook = require("./payments/webhook");
const app = express();
const { startExpiryCron } = require("./jobs/expiryCheck");

//Middleware
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

(async () => {
  // Start Telegram bot
  const bot = await startBot();

  startExpiryCron(bot)


  // Webhook routes
  app.use("/webhook", mpesaWebhook(bot));

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();


//paste to terminal to start
//nodemon server.js
//ngrok http http://localhost:5000 