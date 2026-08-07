const express = require("express");
const isAuthenticated = require("../../middlewares/isAuthenticated");
const isMerchant = require("../../middlewares/isMerchant");
const { upload } = require("../../utils/imageOperation");

const {
  getMerchantOverview,
  getMerchantConversations,
  updateMerchantConversation,
  getMerchantMessages,
  sendMerchantMessage,
  sendMerchantTemplateMessage,
  getMerchantNotes,
  addMerchantNote,
  deleteMerchantNote,
} = require("../../controllers/whatsapp/merchantInboxController");

const {
  getMerchantContacts,
  syncMerchantContacts,
  updateMerchantContact,
} = require("../../controllers/whatsapp/merchantContactController");

const {
  getMerchantCampaigns,
  createMerchantCampaign,
  sendMerchantCampaign,
  getMerchantCampaignEvents,
} = require("../../controllers/whatsapp/merchantCampaignController");

const {
  getMerchantTemplates,
  syncMerchantTemplates,
  createMerchantTemplate,
  updateMerchantTemplate,
} = require("../../controllers/whatsapp/merchantTemplateController");

const {
  getMerchantConnection,
  requestMerchantConnection,
  verifyMerchantConnectionOtp,
} = require("../../controllers/whatsapp/merchantConnectionController");

const merchantWhatsappRoute = express.Router();

// ─── Connection Onboarding ────────────────────────────────────
merchantWhatsappRoute.get(
  "/connection",
  isAuthenticated,
  isMerchant,
  getMerchantConnection
);
merchantWhatsappRoute.post(
  "/connection/request",
  isAuthenticated,
  isMerchant,
  requestMerchantConnection
);
merchantWhatsappRoute.post(
  "/connection/verify-otp",
  isAuthenticated,
  isMerchant,
  verifyMerchantConnectionOtp
);

// ─── Inbox ────────────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/overview",
  isAuthenticated,
  isMerchant,
  getMerchantOverview
);
merchantWhatsappRoute.get(
  "/conversations",
  isAuthenticated,
  isMerchant,
  getMerchantConversations
);
merchantWhatsappRoute.patch(
  "/conversations/:conversationId",
  isAuthenticated,
  isMerchant,
  updateMerchantConversation
);
merchantWhatsappRoute.get(
  "/conversations/:conversationId/messages",
  isAuthenticated,
  isMerchant,
  getMerchantMessages
);
merchantWhatsappRoute.post(
  "/conversations/:conversationId/messages",
  isAuthenticated,
  isMerchant,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "document", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  sendMerchantMessage
);
merchantWhatsappRoute.post(
  "/conversations/:conversationId/templates",
  isAuthenticated,
  isMerchant,
  sendMerchantTemplateMessage
);
merchantWhatsappRoute.get(
  "/conversations/:conversationId/notes",
  isAuthenticated,
  isMerchant,
  getMerchantNotes
);
merchantWhatsappRoute.post(
  "/conversations/:conversationId/notes",
  isAuthenticated,
  isMerchant,
  addMerchantNote
);
merchantWhatsappRoute.delete(
  "/conversations/:conversationId/notes/:noteId",
  isAuthenticated,
  isMerchant,
  deleteMerchantNote
);

// ─── Contacts ────────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/contacts",
  isAuthenticated,
  isMerchant,
  getMerchantContacts
);
merchantWhatsappRoute.post(
  "/contacts/sync",
  isAuthenticated,
  isMerchant,
  syncMerchantContacts
);
merchantWhatsappRoute.patch(
  "/contacts/:contactId",
  isAuthenticated,
  isMerchant,
  updateMerchantContact
);

// ─── Campaigns ───────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/campaigns",
  isAuthenticated,
  isMerchant,
  getMerchantCampaigns
);
merchantWhatsappRoute.post(
  "/campaigns",
  isAuthenticated,
  isMerchant,
  createMerchantCampaign
);
merchantWhatsappRoute.post(
  "/campaigns/:campaignId/send",
  isAuthenticated,
  isMerchant,
  sendMerchantCampaign
);
merchantWhatsappRoute.get(
  "/campaigns/:campaignId/events",
  isAuthenticated,
  isMerchant,
  getMerchantCampaignEvents
);

// ─── Templates ───────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/templates",
  isAuthenticated,
  isMerchant,
  getMerchantTemplates
);
merchantWhatsappRoute.post(
  "/templates/sync",
  isAuthenticated,
  isMerchant,
  syncMerchantTemplates
);
merchantWhatsappRoute.post(
  "/templates",
  isAuthenticated,
  isMerchant,
  createMerchantTemplate
);
merchantWhatsappRoute.patch(
  "/templates/:templateId",
  isAuthenticated,
  isMerchant,
  updateMerchantTemplate
);

module.exports = merchantWhatsappRoute;