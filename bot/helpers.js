// bot/helpers.js
const axios = require("axios");

const CHANNEL_ID = process.env.CHANNEL_ID; // must be your private channel ID
const BOT_TOKEN = process.env.BOT_TOKEN;

async function addUserToChannel(bot, chatId) {
  try {
    const inviteLink = "https://t.me/+J46cTSKzmiFkZWY0"; // replace with your channel's invite link
    await bot.sendMessage(
      chatId,
      `🎉 Subscription successful!\n\nJoin our channel here: ${inviteLink}`
    );
  } catch (err) {
    console.error("Error sending channel invite:", err.message);
    await bot.sendMessage(
      chatId,
      "⚠️ Could not send the channel invite link. Please join manually."
    );
  }
}

async function generateInviteLink() {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`,
      {
        chat_id: CHANNEL_ID,
        expire_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        member_limit: 1, // one-time use
      }
    );

    if (res.data.ok) {
      return res.data.result.invite_link;
    } else {
      throw new Error(JSON.stringify(res.data));
    }
  } catch (err) {
    console.error("Error generating invite link:", err.message);
    return null;
  }
}


module.exports = { addUserToChannel, generateInviteLink };
