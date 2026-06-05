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

const fetchConversationAnalytics = async (startTimestamp, endTimestamp) => {
  const { token, apiVersion, businessAccountId } = getWhatsappConfig();
  const params = new URLSearchParams({
    start: startTimestamp.toString(),
    end: endTimestamp.toString(),
    granularity: "DAILY",
    phone_numbers: "[]",
    conversation_types: '["REGULAR"]',
    dimensions: '["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"]',
  });

  const response = await axios.get(
    `https://graph.facebook.com/${apiVersion}/${businessAccountId}?fields=analytics.${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data?.analytics || {};
};

const fetchAccountInfo = async () => {
  const { token, apiVersion, businessAccountId } = getWhatsappConfig();
  const response = await axios.get(
    `https://graph.facebook.com/${apiVersion}/${businessAccountId}?fields=currency,name,timezone_id,message_template_namespace,account_review_status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data || {};
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
  fetchConversationAnalytics,
  fetchAccountInfo,
};
