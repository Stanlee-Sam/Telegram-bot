const express = require("express");
const { saveSubscription, getUserByPhone } = require("../db/models");
const CHANNEL_ID = process.env.GROUP_ID;
const axios = require("axios");

module.exports = (bot) => {
  const router = express.Router();

  // Parse JSON bodies
  router.use(express.json());

  // Endpoint for Daraja STK Push callbacks
  router.post("/mpesa", async (req, res) => {
    try {
      console.log("📥 Webhook called:", JSON.stringify(req.body, null, 2));

      const stkCallback = req.body.Body?.stkCallback;
      if (!stkCallback) {
        return res.status(400).send("Invalid callback structure");
      }

      const { ResultCode, ResultDesc, CallbackMetadata, CheckoutRequestID } =
        stkCallback;

      if (ResultCode === 0) {
        const amount = CallbackMetadata.Item.find(
          (i) => i.Name === "Amount"
        )?.Value;
        const phone = String(
          CallbackMetadata.Item.find((i) => i.Name === "PhoneNumber")?.Value
        );
        const receiptNumber = CallbackMetadata.Item.find(
          (i) => i.Name === "MpesaReceiptNumber"
        )?.Value;

        const user = await getUserByPhone(phone);
        const username = user?.username || null;

        if (!user) {
          console.error("No Telegram chat ID found for this phone");
          return res.status(400).send("User not found");
        }

        const chatId = user.chatId;
        console.log(`✅ Payment successful: ${amount} KES from ${phone}`);

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);

        const sub = await saveSubscription({
          telegram_id: chatId,
          username, // <-- include here too
          expiry_date: expiryDate,
          amount,
          checkout_id: receiptNumber || CheckoutRequestID,
        });

        // Generate Telegram invite link
        try {
          const response = await axios.post(
            `https://api.telegram.org/bot${process.env.BOT_TOKEN}/createChatInviteLink`,
            {
              chat_id: CHANNEL_ID,
              expire_date: Math.floor(Date.now() / 1000) + 3600,
              member_limit: 1, // one-time use
            }
          );

          if (response.data.ok) {
            const inviteLink = response.data.result.invite_link;
            await bot.sendMessage(
              chatId,
              `🎉 Subscription successful!\nHere’s your personal invite link (valid for 1 hour):\n${inviteLink}`
            );
            console.log("✅ Invite sent:", inviteLink);
          } else {
            console.error("⚠️ Telegram API error:", response.data);
            await bot.sendMessage(
              chatId,
              "⚠️ Could not generate invite link. Please contact support."
            );
          }
        } catch (err) {
          console.error("Error creating invite link:", err.message);
          await bot.sendMessage(
            chatId,
            "⚠️ Could not create invite link. Please contact support."
          );
        }

        return res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      } else {
        console.log(`❌ Payment failed: ${ResultDesc}`);
        return res.status(200).send({ ResultCode, ResultDesc });
      }
    } catch (err) {
      console.error("⚠️ Error handling webhook:", err);
      res.status(500).send("Server error");
    }
  });

  // Test saving subscription manually
  router.get("/test-save", async (req, res) => {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      const sub = await saveSubscription({
        telegram_id: "254708374149", // fake test user
        expiry_date: expiryDate,
        amount: 100,
        checkout_id: "test_checkout_123",
      });

      res.json({ success: true, sub });
    } catch (err) {
      console.error("⚠️ Test save error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Sandbox simulation endpoint
  router.get("/simulate-success/:chatId/:amount", async (req, res) => {
    try {
      const { chatId, amount } = req.params;
      const amountValue = parseInt(amount);
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      // fetch username from the message sender
      let username = null;
      try {
        const member = await bot.getChat(chatId);
        username = member.username || null;
      } catch (err) {
        console.log("⚠️ Could not fetch username:", err.message);
      }

      const sub = await saveSubscription({
        telegram_id: chatId,
        username, // <-- pass username here
        expiry_date: expiryDate,
        amount: amountValue,
        checkout_id: "SIMULATED_CHECKOUT_123",
      });

      console.log(`📦 Simulated subscription saved:`, sub);

      try {
        const response = await axios.post(
          `https://api.telegram.org/bot${process.env.BOT_TOKEN}/createChatInviteLink`,
          {
            chat_id: CHANNEL_ID,
            expire_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
            member_limit: 1,
          }
        );

        if (response.data.ok) {
          const inviteLink = response.data.result.invite_link;
          await bot.sendMessage(
            chatId,
            `🎉 Simulated subscription created for ${amountValue} KES!\nHere’s your personal invite link (valid for 1 hour):\n${inviteLink}`
          );
          console.log("✅ Simulated invite sent:", inviteLink);
        } else {
          console.error("⚠️ Telegram API error:", response.data);
          await bot.sendMessage(chatId, "⚠️ Could not generate invite link.");
        }
      } catch (err) {
        console.error("Error creating simulated invite link:", err.message);
        await bot.sendMessage(
          chatId,
          "⚠️ Could not create invite link. Please contact support."
        );
      }

      res.json({ success: true, sub });
    } catch (err) {
      console.error("⚠️ Simulation error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Add this inside your router file
  router.get("/set-webhook", async (req, res) => {
    try {
      const url = `${process.env.TELEGRAM_WEBHOOK_URL}`;
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook?url=${url}`
      );

      if (response.data.ok) {
        console.log("✅ Webhook set successfully:", url);
        return res.json({ success: true, url, result: response.data });
      } else {
        console.error("⚠️ Failed to set webhook:", response.data);
        return res.status(500).json({ success: false, error: response.data });
      }
    } catch (err) {
      console.error("❌ Error setting webhook:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get("/delete-webhook", async (req, res) => {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteWebhook`
      );
      return res.json(response.data);
    } catch (err) {
      console.error("❌ Error deleting webhook:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
