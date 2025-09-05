const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function saveSubscription({ telegram_id, username, expiry_date, amount, checkout_id }) {
  const subscription = await prisma.subscription.create({
    data: {
      telegram_id: String(telegram_id),
      username: username || null,   // <-- add this
      expiry_date,
      amount,
      checkout_id
    }
  });
  console.log("📦 Subscription saved:", subscription);
  return subscription;
}



// Save a user (phone <-> Telegram chat ID mapping)
async function saveUser({ chatId, phoneNumber, username }) {
  try {
    const user = await prisma.user.upsert({
      where: { phone: phoneNumber },
      update: {
        chatId: String(chatId),
        username: username || null, // update username if provided
      },
      create: {
        phone: phoneNumber,
        chatId: String(chatId),
        username: username || null, // store username on creation
      },
    });
    console.log("👤 User saved:", user);
    return user;
  } catch (err) {
    console.error("❌ Error saving user:", err);
    throw err;
  }
}


// Get user by phone number
async function getUserByPhone(phoneNumber) {
  try {
    return await prisma.user.findUnique({
      where: { phone: phoneNumber }
    });
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    throw err;
  }
}

module.exports = {
  saveSubscription,
  saveUser,
  getUserByPhone,
  prisma
};