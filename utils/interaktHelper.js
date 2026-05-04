const axios = require("axios");

const INTERAKT_API_URL = "https://api.interakt.ai/v1/public/message/";
const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;

/**
 * Send a WhatsApp template message via Interakt.
 *
 * @param {string} phoneNumber  - E.164 format without leading '+', e.g. "919876543210"
 * @param {string} templateName - Template name registered in Interakt / Meta
 * @param {string} languageCode - Template language code (default: "en")
 * @param {Array}  bodyParams   - Array of strings for {{1}}, {{2}}, … body variables
 * @param {string} [countryCode] - Country code without '+' (default: "91")
 */
const sendInteraktMessage = async (
  phoneNumber,
  templateName,
  bodyParams = [],
  languageCode = "en",
  countryCode = "91"
) => {
  if (!INTERAKT_API_KEY) {
    console.warn("[Interakt] INTERAKT_API_KEY is not set – skipping message.");
    return;
  }

  // Strip any leading '+' or country code duplicates; keep only the local number
  const cleanPhone = String(phoneNumber).replace(/^\+/, "");

  const payload = {
    countryCode: `+${countryCode}`,
    phoneNumber: cleanPhone,
    callbackData: "famto_whatsapp",
    type: "Template",
    template: {
      name: templateName,
      languageCode,
      ...(bodyParams.length > 0 && {
        bodyValues: bodyParams,
      }),
    },
  };

  try {
    const response = await axios.post(INTERAKT_API_URL, payload, {
      headers: {
        Authorization: `Basic ${INTERAKT_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    console.log(
      `[Interakt] Message sent to ${cleanPhone} (template: ${templateName}):`,
      response.data
    );
    return response.data;
  } catch (err) {
    console.error(
      `[Interakt] Failed to send message to ${cleanPhone}:`,
      err?.response?.data || err.message
    );
    // Non-fatal – do not propagate so the main flow is not broken
  }
};

/**
 * Send welcome WhatsApp message to a newly registered customer.
 *
 * @param {string} phoneNumber - Customer's phone number
 * @param {string} [name]      - Customer's name (optional, used as {{1}} if template expects it)
 */
const sendWelcomeMessage = async (phoneNumber, name = "") => {
  // Template name must match exactly what is approved in your Meta / Interakt account
  const templateName = process.env.INTERAKT_WELCOME_TEMPLATE || "customer_welcome";
  const bodyParams = name ? [name] : [];
  await sendInteraktMessage(phoneNumber, templateName, bodyParams);
};

/**
 * Send a daily cart-reminder WhatsApp message to a customer.
 *
 * @param {string} phoneNumber   - Customer's phone number
 * @param {string} merchantName  - Name of the merchant whose items are in the cart
 * @param {string} productList   - Comma-separated product names
 */
const sendCartReminderMessage = async (phoneNumber, merchantName, productList) => {
  const templateName =
    process.env.INTERAKT_CART_REMINDER_TEMPLATE || "cart_reminder";
  // Template body: "Don't miss your products from {{1}} with {{2}}"
  const bodyParams = [merchantName, productList];
  await sendInteraktMessage(phoneNumber, templateName, bodyParams);
};

module.exports = {
  sendInteraktMessage,
  sendWelcomeMessage,
  sendCartReminderMessage,
};
