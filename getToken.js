require("dotenv").config();
const axios = require("axios");

const DARJA_ENV = process.env.DARAJA_BASE_URL || "https://sandbox.safaricom.co.ke";
const CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET;

async function getAccessToken() {
  try {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
    const response = await axios.get(`${DARJA_ENV}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` }
    });
    console.log("✅ Access token:", response.data.access_token);
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Failed to get access token:", error.response?.data || error.message);
  }
}

getAccessToken();
