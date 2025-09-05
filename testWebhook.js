const axios = require("axios");

async function setWebhook() {
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook?url=${process.env.TELEGRAM_WEBHOOK_URL}`
    );
    console.log(res.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

setWebhook();
