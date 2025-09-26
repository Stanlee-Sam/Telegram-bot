const cron = require("node-cron");
const pool = require("../db"); // DB connection

const CHANNEL_ID = process.env.GROUP_ID; // from .env

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeExpiredUsers(bot) {
  if (!bot) {
    console.error("Bot instance not provided to removeExpiredUsers");
    return 0;
  }

  try {
    const result = await pool.query(`
      SELECT telegram_id
      FROM "Subscription"
      WHERE expiry_date < NOW()
    `);

    const expiredUsers = result.rows.map((u) => u.telegram_id).filter(Boolean);

    if (!expiredUsers.length) {
      console.log("No expired users found.");
      return 0;
    }

    await pool.query(`
      DELETE FROM "Subscription"
      WHERE expiry_date < NOW()
    `);
    console.log(`Deleted ${expiredUsers.length} expired users from DB`);

    for (let i = 0; i < expiredUsers.length; i++) {
      const id = expiredUsers[i];
      try {
        await sleep(i * 100);
        const member = await bot.getChatMember(CHANNEL_ID, id);
        if (member.status !== "left" && member.status !== "kicked") {
          await bot.banChatMember(CHANNEL_ID, id);
          await bot.unbanChatMember(CHANNEL_ID, id);
          console.log(`Removed from Telegram group: ${id}`);
        }

        try {
          await bot.sendMessage(
            id,
            "⚠️ Your subscription has expired. Please /subscribe again."
          );
        } catch {}
      } catch (err) {
        console.error(`Telegram removal failed for ${id}:`, err.message);
      }
    }

    return expiredUsers.length;
  } catch (err) {
    console.error("Error checking expired users:", err.message);
    return 0;
  }
}

function startExpiryCron(bot) {
  cron.schedule(
    "50 23 * * *",
    async () => {
      const count = await removeExpiredUsers(bot);
      console.log(`⏰ Daily expiry check ran. Removed ${count} expired users.`);
    },
    {
      timezone: "Africa/Nairobi",
    }
  );
}

// function startExpiryCron(bot) {
//   // Runs every 20 seconds: */20 * * * * *
//   cron.schedule("*/20 * * * * *", async () => {
//     const count = await removeExpiredUsers(bot);
//     console.log(`⏰ Cron test ran. Removed ${count} expired users.`);
//   });
// }

module.exports = { removeExpiredUsers, startExpiryCron };
