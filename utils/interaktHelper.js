const { sendMetaMessage } = require("./whatsappApi");

/**
 * Send a WhatsApp template message via Meta Cloud API.
 * Drop-in replacement for the old Interakt helper — same function signature.
 *
 * @param {string} phoneNumber   - E.164 format without leading '+', e.g. "919876543210"
 * @param {string} templateName  - Template name registered in Meta Business Manager
 * @param {Array}  bodyParams    - Array of strings for {{1}}, {{2}}, … body variables
 * @param {string} languageCode  - Template language code (default: "en")
 * @param {string} [countryCode] - Ignored (kept for backward compat)
 * @param {string} [headerImageUrl] - Optional header image URL
 */
const sendInteraktMessage = async (
  phoneNumber,
  templateName,
  bodyParams = [],
  languageCode = "en",
  countryCode = "91",
  headerImageUrl = null
) => {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log("[WhatsApp] Credentials not set – skipping message.");
    return;
  }

  // Strip any leading '+'; Meta expects plain digits e.g. "919876543210"
  const cleanPhone = String(phoneNumber).replace(/^\+/, "");

  // Build template components
  const components = [];

  // Header component (image)
  if (headerImageUrl) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: { link: headerImageUrl },
        },
      ],
    });
  }

  // Body component (text variables)
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((value) => ({
        type: "text",
        text: String(value),
      })),
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 && { components }),
    },
  };

  try {
    const response = await sendMetaMessage(payload);
    console.log(
      `[WhatsApp] Template sent to ${cleanPhone} (${templateName}):`,
      response.messages?.[0]?.id || "ok"
    );
    return response;
  } catch (err) {
    console.error(
      `[WhatsApp] Failed to send template to ${cleanPhone}:`,
      err?.response?.data?.error?.message || err.message
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
  console.log("Welcome Message initialized");
  const templateName = process.env.INTERAKT_WELCOME_TEMPLATE || "customer_welcome";
  const headerImageUrl = process.env.INTERAKT_WELCOME_HEADER_IMAGE || null;
  const bodyParams = name ? [name] : [];
  await sendInteraktMessage(phoneNumber, templateName, bodyParams, "en", "91", headerImageUrl);
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
  const bodyParams = [merchantName, productList];
  await sendInteraktMessage(phoneNumber, templateName, bodyParams);
};

module.exports = {
  sendInteraktMessage,
  sendWelcomeMessage,
  sendCartReminderMessage,
};
