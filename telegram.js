// telegram.js
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = "1251668368"; // 👈 replace with your test chatId

async function testSend() {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: "✅ Bot test successful!",
      }
    );
    console.log("Message sent:", res.data);
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

testSend();
