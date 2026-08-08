const axios = require("axios");
const { decrypt } = require("./crypto");

const getWhatsappConfig = () => ({
  token: process.env.WHATSAPP_API_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
});

// ── Connection override ──
//
// `connection` (optional) overrides the platform env defaults for one call.
// Pass `{ phoneNumberId, token, businessAccountId }` from a WhatsappConnection
// doc to send/receive through a merchant's own WhatsApp number.
//
// Falls back to platform env when not provided — all existing callers unchanged.

const resolveConfig = (connection) => {
  if (connection && connection.phoneNumberId && connection.token) {
    return {
      token: connection.token,
      phoneNumberId: connection.phoneNumberId,
      businessAccountId:
        connection.businessAccountId ||
        connection.wabaId ||
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
    };
  }
  return getWhatsappConfig();
};

const getHeaders = (connection) => {
  const { token } = resolveConfig(connection);
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
};

const getBaseUrl = (connection) => {
  const { apiVersion, phoneNumberId } = resolveConfig(connection);
  return `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
};

const sendMetaMessage = async (payload, connection) => {
  const response = await axios.post(`${getBaseUrl(connection)}/messages`, payload, {
    headers: getHeaders(connection),
  });
  return response.data;
};

const getMediaUrl = async (mediaId, connection) => {
  const { token, apiVersion } = resolveConfig(connection);
  const response = await axios.get(
    `https://graph.facebook.com/${apiVersion}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.url;
};

const downloadMedia = async (url, connection) => {
  const { token } = resolveConfig(connection);
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });
  return response.data;
};

const fetchBusinessProfile = async (connection) => {
  const response = await axios.get(
    `${getBaseUrl(connection)}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
    { headers: getHeaders(connection) }
  );
  return response.data.data?.[0] || {};
};

const updateMetaBusinessProfile = async (profileData, connection) => {
  const response = await axios.post(
    `${getBaseUrl(connection)}/whatsapp_business_profile`,
    { messaging_product: "whatsapp", ...profileData },
    { headers: getHeaders(connection) }
  );
  return response.data;
};

const fetchMetaTemplates = async (connection) => {
  const { token, apiVersion, businessAccountId } = resolveConfig(connection);
  const response = await axios.get(
    `https://graph.facebook.com/${apiVersion}/${businessAccountId}/message_templates`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.data || [];
};

const createMetaTemplate = async (templateData, connection) => {
  const { apiVersion, businessAccountId } = resolveConfig(connection);
  const response = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${businessAccountId}/message_templates`,
    templateData,
    { headers: getHeaders(connection) }
  );
  return response.data;
};

const updateMetaTemplate = async (templateId, templateData, connection) => {
  const { apiVersion } = resolveConfig(connection);
  const response = await axios.post(
    `https://graph.facebook.com/${apiVersion}/${templateId}`,
    templateData,
    { headers: getHeaders(connection) }
  );
  return response.data;
};

// ── Template message helpers ──

const WhatsappTemplate = require("../models/WhatsappTemplate");

// Look up a merchant's active connection (cached per-process via simple Map).
// Returns plain config or null when not configured.
const _connectionCache = new Map();
const resolveMerchantConnection = async (merchantId) => {
  if (!merchantId) return null;
  const key = String(merchantId);
  if (_connectionCache.has(key)) {
    const cached = _connectionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.connection;
    _connectionCache.delete(key);
  }
  const WhatsappConnection = require("../models/WhatsappConnection");
  const conn = await WhatsappConnection.findOne({
    merchantId,
    status: "Active",
  })
    .select("+token")
    .lean();
  if (!conn) return null;
  // Token is encrypted at rest — decrypt so the cached doc can be passed
  // straight into resolveConfig()/sendMetaMessage(). The cache holds the
  // decrypted token in-memory for up to 60s; the DB keeps only ciphertext.
  if (conn.token) conn.token = decrypt(conn.token);
  _connectionCache.set(key, { connection: conn, expiresAt: Date.now() + 60_000 });
  return conn;
};

const sendTemplateMessage = async (
  phoneNumber,
  templateName,
  bodyParams = [],
  languageCode = "en",
  headerImageUrl = null,
  connection = null
) => {
  // Skip if no platform creds AND no override
  if (!connection && (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID)) {
    console.log("[WhatsApp] Credentials not set – skipping message.");
    return;
  }

  let cleanPhone = String(phoneNumber).replace(/^\+/, "");
  if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

  // Load template once for header + body param names
  const template = await WhatsappTemplate.findOne({ name: templateName }).select("components language").lean();
  const components = template?.components || [];
  const headerComp = components.find((c) => c.type === "HEADER");
  const bodyComp = components.find((c) => c.type === "BODY");
  const paramNames = (bodyComp?.text?.match(/\{\{([^}]+)\}\}/g) || []).map(
    (m) => m.replace(/\{\{|\}\}/g, "").trim()
  );

  // Meta requires the EXACT language the template was created with.
  // Default to the template's synced language, then the caller's, then "en".
  const effectiveLanguage = template?.language || languageCode || "en";

  const sendComponents = [];

  // 1. Header component - use provided headerImageUrl, or auto-populate from template.
  //    CRITICAL: BOTH the env header URLs (WHATSAPP_*_HEADER_IMAGE) and Meta's
  //    header_handle use the "@url:`https://...`" wrapper (backticks + prefix).
  //    That wrapper is NOT a valid image.link — Meta silently drops the message
  //    (200 OK + message ID, but nothing delivered). Strip it from whatever source.
  let finalHeaderImageUrl = headerImageUrl
    ? String(headerImageUrl).replace(/^@url:`|`$/g, "").trim() || null
    : null;
  if (!finalHeaderImageUrl && headerComp && headerComp.format === "IMAGE") {
    const rawHandle = headerComp.example?.header_handle?.[0] || headerComp.image_url || "";
    finalHeaderImageUrl = rawHandle.replace(/^@url:`|`$/g, "").trim() || null;
  }
  if (finalHeaderImageUrl) {
    sendComponents.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: { link: finalHeaderImageUrl },
        },
      ],
    });
  }

  // 2. Body component - use param names from template.
  //    Named params ({{customer_name}}) require parameter_name to match the template's
  //    declared names AND the exact template language. With the effective language now
  //    aligned, Meta resolves named params correctly.
  if (bodyParams.length > 0) {
    sendComponents.push({
      type: "body",
      parameters: bodyParams.map((value, i) => ({
        type: "text",
        text: String(value),
        ...(paramNames[i] && { parameter_name: paramNames[i] }),
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
      language: { code: effectiveLanguage },
      ...(sendComponents.length > 0 && { components: sendComponents }),
    },
  };

  try {
    console.log(`[WhatsApp] Sending template payload:`, JSON.stringify(payload));
    const response = await sendMetaMessage(payload, connection);
    console.log(
      `[WhatsApp] Template sent to ${cleanPhone} (${templateName}):`,
      response.messages?.[0]?.id || "ok"
    );
    return response;
  } catch (err) {
    console.error(`[WhatsApp] Full error:`, JSON.stringify(err.response?.data));
    console.error(
      `[WhatsApp] Failed to send template to ${cleanPhone}:`,
      err?.response?.data?.error?.message || err.message
    );
  }
};

const getTemplateLanguage = async (templateName) => {
  const template = await WhatsappTemplate.findOne({ name: templateName }).select("language").lean();
  return template?.language || "en";
};

const sendWelcomeMessage = async (phoneNumber, name = "", connection = null) => {
  const templateName =
    process.env.WHATSAPP_WELCOME_TEMPLATE || "welcome_famto";
  const lang = await getTemplateLanguage(templateName);
  // welcome_famto is a static template with no body placeholders
  const bodyParams = [];
  const headerImage = process.env.WHATSAPP_WELCOME_HEADER_IMAGE || null;
  await sendTemplateMessage(phoneNumber, templateName, bodyParams, lang, headerImage, connection);
};

const sendCartReminderMessage = async ({
  phoneNumber,
  customerName,
  merchantName,
  productList,
  connection = null,
}) => {
  const templateName =
    process.env.WHATSAPP_CART_REMINDER_TEMPLATE || "cart_reminder";
  const lang = await getTemplateLanguage(templateName);
  const headerImage = process.env.WHATSAPP_CART_REMINDER_HEADER_IMAGE || null;
  await sendTemplateMessage(phoneNumber, templateName, [
    customerName,
    merchantName,
    productList,
  ], lang, headerImage, connection);
};

const sendOrderTrackingMessage = async ({
  phoneNumber,
  customerName,
  merchantName,
  connection = null,
}) => {
  const templateName =
    process.env.WHATSAPP_ORDER_TRACKING_TEMPLATE || "order_tracking";
  const lang = await getTemplateLanguage(templateName);
  const headerImage = process.env.WHATSAPP_ORDER_TRACKING_HEADER_IMAGE || null;
  await sendTemplateMessage(phoneNumber, templateName, [customerName, merchantName], lang, headerImage, connection);
};

module.exports = {
  getWhatsappConfig,
  resolveMerchantConnection,
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
