require("dotenv").config();
const axios = require("axios");
//const base64 = require("base-64");

// Environment-aware API base
const DARJA_ENV =
  process.env.NODE_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

// Daraja credentials
const CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET;
const BUSINESS_SHORTCODE = process.env.BUSINESS_SHORTCODE;
const PASSKEY = process.env.PASSKEY;
const CALLBACK_URL = process.env.CALLBACK_URL;

// Generate OAuth access token
async function getAccessToken() {
const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  try {
    const response = await axios.get(
      `${DARJA_ENV}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    return response.data.access_token;
  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error("❌ Error getting access token:", msg);
    return { error: true, message: "Failed to get access token", details: msg };
  }
}

// Helper: timestamp YYYYMMDDHHMMSS
function getTimestamp() {
  const date = new Date();
  return date.toISOString().replace(/[-:TZ]/g, "").slice(0, 14);
}

// Helper: generate password
function generatePassword(timestamp) {
  return Buffer.from(BUSINESS_SHORTCODE + PASSKEY + timestamp).toString(
    "base64"
  );
}



// Send STK Push request
async function stkPush(phoneNumber, amount) {
  const tokenData = await getAccessToken();
  if (!tokenData || tokenData.error) return tokenData;

  const token = tokenData;
  const timestamp = getTimestamp();
  const password = generatePassword(timestamp);

  
  let callbackUrl = CALLBACK_URL;

  const payload = {
    BusinessShortCode: BUSINESS_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phoneNumber,
    PartyB: BUSINESS_SHORTCODE,
    PhoneNumber: phoneNumber,
    CallBackURL: callbackUrl,
    AccountReference: "Telegram Subscription",
    TransactionDesc: "Monthly subscription for Telegram bot",
  };

  try {
    const response = await axios.post(
      `${DARJA_ENV}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Check for specific error codes
    if (response.data?.errorCode) {
      const errMsg = response.data.errorMessage || "STK Push failed";
      console.error(`❌ STK Push error: ${errMsg}`);
      return { success: false, message: errMsg, code: response.data.errorCode };
    }

    return response.data;
  } catch (error) {
    const errData = error.response?.data || error.message;
    // Look for common live errors
    if (
      errData?.errorCode === "500.001.1001" ||
      errData?.errorMessage?.includes("Merchant does not exist")
    ) {
      return { success: false, message: "❌ Merchant does not exist. Check shortcode/passkey." };
    }
    if (errData?.errorCode === "401" || errData?.errorMessage?.includes("Invalid credentials")) {
      return { success: false, message: "❌ Invalid Consumer Key or Secret" };
    }

    return { success: false, message: "STK Push failed", details: errData };
  }
}

module.exports = { stkPush };
