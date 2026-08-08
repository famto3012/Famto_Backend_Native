const express = require("express");
const isAuthenticated = require("../../middlewares/isAuthenticated");
const isMerchant = require("../../middlewares/isMerchant");
const { requireFeature } = require("../../utils/featureConfig");
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
  saveMerchantConnection,
  testMerchantConnection,
} = require("../../controllers/whatsapp/merchantConnectionController");

const merchantWhatsappRoute = express.Router();

// Every merchant WhatsApp endpoint requires the WhatsApp feature to be enabled
// (global default, or this merchant's override). requireFeature must run after
// isMerchant so it can read req.merchantId.
const merchantAuth = [isAuthenticated, isMerchant, requireFeature("whatsapp")];

// ─── Connection (OwnWABA) ────────────────────────────────────
// Save the merchant's own Meta credentials, then test them against Meta.
merchantWhatsappRoute.get(
  "/connection",
  ...merchantAuth,
  getMerchantConnection
);
merchantWhatsappRoute.put(
  "/connection",
  ...merchantAuth,
  saveMerchantConnection
);
merchantWhatsappRoute.post(
  "/connection/test",
  ...merchantAuth,
  testMerchantConnection
);

// ─── Inbox ────────────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/overview",
  ...merchantAuth,
  getMerchantOverview
);
merchantWhatsappRoute.get(
  "/conversations",
  ...merchantAuth,
  getMerchantConversations
);
merchantWhatsappRoute.patch(
  "/conversations/:conversationId",
  ...merchantAuth,
  updateMerchantConversation
);
merchantWhatsappRoute.get(
  "/conversations/:conversationId/messages",
  ...merchantAuth,
  getMerchantMessages
);
merchantWhatsappRoute.post(
  "/conversations/:conversationId/messages",
  ...merchantAuth,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "document", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  sendMerchantMessage
);
merchantWhatsappRoute.post(
  "/conversations/:conversationId/templates",
  ...merchantAuth,
  sendMerchantTemplateMessage
);
merchantWhatsappRoute.get(
  "/conversations/:conversationId/notes",
  ...merchantAuth,
  getMerchantNotes
);
merchantWhatsappRoute.post(
  "/conversations/:conversationId/notes",
  ...merchantAuth,
  addMerchantNote
);
merchantWhatsappRoute.delete(
  "/conversations/:conversationId/notes/:noteId",
  ...merchantAuth,
  deleteMerchantNote
);

// ─── Contacts ────────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/contacts",
  ...merchantAuth,
  getMerchantContacts
);
merchantWhatsappRoute.post(
  "/contacts/sync",
  ...merchantAuth,
  syncMerchantContacts
);
merchantWhatsappRoute.patch(
  "/contacts/:contactId",
  ...merchantAuth,
  updateMerchantContact
);

// ─── Campaigns ───────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/campaigns",
  ...merchantAuth,
  getMerchantCampaigns
);
merchantWhatsappRoute.post(
  "/campaigns",
  ...merchantAuth,
  createMerchantCampaign
);
merchantWhatsappRoute.post(
  "/campaigns/:campaignId/send",
  ...merchantAuth,
  sendMerchantCampaign
);
merchantWhatsappRoute.get(
  "/campaigns/:campaignId/events",
  ...merchantAuth,
  getMerchantCampaignEvents
);

// ─── Templates ───────────────────────────────────────────────
merchantWhatsappRoute.get(
  "/templates",
  ...merchantAuth,
  getMerchantTemplates
);
merchantWhatsappRoute.post(
  "/templates/sync",
  ...merchantAuth,
  syncMerchantTemplates
);
merchantWhatsappRoute.post(
  "/templates",
  ...merchantAuth,
  createMerchantTemplate
);
merchantWhatsappRoute.patch(
  "/templates/:templateId",
  ...merchantAuth,
  updateMerchantTemplate
);

module.exports = merchantWhatsappRoute;
