const axios = require("axios");

const getWhatsappConfig = () => ({
  token: process.env.WHATSAPP_API_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
});

const getHeaders = () => {
  const { token } = getWhatsappConfig();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
};

const getBaseUrl = () => {
  const { apiVersion, phoneNumberId } = getWhatsappConfig();
  return `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
};

const sendMetaMessage = async (payload) => {
  const response = await axios.post(`${getBaseUrl()}/messages`, payload, {
    headers: getHeaders(),
  });
  return response.data;
};

const getMediaUrl = async (mediaId) => {
  const { token, apiVersion } = getWhatsappConfig();
  const response = await axios.get(
    `https://graph.facebook.com/${apiVersion}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.url;
};

const downloadMedia = async (url) => {
  const { token } = getWhatsappConfig();
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });
  return response.data;
};

const fetchBusinessProfile = async () => {
  const response = await axios.get(
    `${getBaseUrl()}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
    { headers: getHeaders() }
  );
  return response.data.data?.[0] || {};
};

const updateMetaBusinessProfile = async (profileData) => {
  const response = await axios.post(
    `${getBaseUrl()}/whatsapp_business_profile`,
    { messaging_product: "whatsapp", ...profileData },
    { headers: getHeaders() }
  );
  return response.data;
};

const fetchMetaTemplates = async () => {
  const { token, apiVersion, businessAccountId } = getWhatsappConfig();
  const response = await axios.get(
    `https://graph.facebook.com/${apiVersion}/${businessAccountId}/message_templates`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.data || [];
};

const createMetaTemplate = async (templateData) => {
  const { token, apiVersion, businessAccountId } = getWhatsappConfig();
  const response = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${businessAccountId}/message_templates`,
    templateData,
    { headers: getHeaders() }
  );
  return response.data;
};

const updateMetaTemplate = async (templateId, templateData) => {
  const { token, apiVersion } = getWhatsappConfig();
  const response = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${templateId}`,
    templateData,
    { headers: getHeaders() }
  );
  return response.data;
};

// ── Template message helpers ──

const sendTemplateMessage = async (
  phoneNumber,
  templateName,
  bodyParams = [],
  languageCode = "en",
  headerImageUrl = null
) => {
  if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log("[WhatsApp] Credentials not set – skipping message.");
    return;
  }

  const cleanPhone = String(phoneNumber).replace(/^\+/, "");

  const components = [];

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
  }
};

const sendWelcomeMessage = async (phoneNumber, name = "") => {
  const templateName =
    process.env.WHATSAPP_WELCOME_TEMPLATE || "customer_welcome";
  const headerImageUrl =
    process.env.WHATSAPP_WELCOME_HEADER_IMAGE || null;
  const bodyParams = name ? [name] : [];
  await sendTemplateMessage(
    phoneNumber,
    templateName,
    bodyParams,
    "en",
    headerImageUrl
  );
};

const sendCartReminderMessage = async (
  phoneNumber,
  customerName,
  merchantName,
  productList
) => {
  const templateName =
    process.env.WHATSAPP_CART_REMINDER_TEMPLATE || "cart_reminder";
  await sendTemplateMessage(phoneNumber, templateName, [
    customerName,
    merchantName,
    productList,
  ]);
};

const sendOrderTrackingMessage = async (
  phoneNumber,
  customerName,
  merchantName
) => {
  const templateName =
    process.env.WHATSAPP_ORDER_TRACKING_TEMPLATE || "order_tracking";
  await sendTemplateMessage(phoneNumber, templateName, [
    customerName,
    merchantName,
  ]);
};

module.exports = {
  getWhatsappConfig,
  sendMetaMessage,
  getMediaUrl,
  downloadMedia,
  fetchBusinessProfile,
  updateMetaBusinessProfile,
  fetchMetaTemplates,
  createMetaTemplate,
  updateMetaTemplate,
  sendTemplateMessage,
  sendWelcomeMessage,
  sendCartReminderMessage,
  sendOrderTrackingMessage,
};
