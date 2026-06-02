const express = require("express");
const isAuthenticated = require("../../middlewares/isAuthenticated");
const isAdmin = require("../../middlewares/isAdmin");
const { upload } = require("../../utils/imageOperation");

// Controllers
const {
  verifyWebhook,
  handleWebhook,
} = require("../../controllers/whatsapp/webhookController");

const {
  getOverview,
  getConversations,
  updateConversation,
  getMessages,
  sendMessage,
  sendTemplateMessage,
  addNote,
} = require("../../controllers/whatsapp/inboxController");

const {
  getContacts,
  syncContacts,
  updateContact,
} = require("../../controllers/whatsapp/contactController");

const {
  getCampaigns,
  createCampaign,
  sendCampaign,
  getCampaignEvents,
} = require("../../controllers/whatsapp/campaignController");

const {
  getTemplates,
  syncTemplates,
  createTemplate,
  updateTemplate,
} = require("../../controllers/whatsapp/templateController");

const {
  getWallet,
  rechargeWallet,
  getBusinessProfile,
  updateBusinessProfile,
  verifyPhoneNumber,
} = require("../../controllers/whatsapp/billingController");

const { getAnalytics } = require("../../controllers/whatsapp/analyticsController");

const whatsappRoute = express.Router();

// ─── Webhooks (no auth — called by Meta) ─────────────────
whatsappRoute.get("/webhook", verifyWebhook);
whatsappRoute.post("/webhook", handleWebhook);

// ─── Inbox ───────────────────────────────────────────────
whatsappRoute.get("/overview", isAuthenticated, isAdmin, getOverview);
whatsappRoute.get("/conversations", isAuthenticated, isAdmin, getConversations);
whatsappRoute.patch(
  "/conversations/:conversationId",
  isAuthenticated,
  isAdmin,
  updateConversation
);
whatsappRoute.get(
  "/conversations/:conversationId/messages",
  isAuthenticated,
  isAdmin,
  getMessages
);
whatsappRoute.post(
  "/conversations/:conversationId/messages",
  isAuthenticated,
  isAdmin,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "document", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  sendMessage
);
whatsappRoute.post(
  "/conversations/:conversationId/templates",
  isAuthenticated,
  isAdmin,
  sendTemplateMessage
);
whatsappRoute.post(
  "/conversations/:conversationId/notes",
  isAuthenticated,
  isAdmin,
  addNote
);

// ─── Contacts ────────────────────────────────────────────
whatsappRoute.get("/contacts", isAuthenticated, isAdmin, getContacts);
whatsappRoute.post("/contacts/sync", isAuthenticated, isAdmin, syncContacts);
whatsappRoute.patch(
  "/contacts/:contactId",
  isAuthenticated,
  isAdmin,
  updateContact
);

// ─── Campaigns ───────────────────────────────────────────
whatsappRoute.get("/campaigns", isAuthenticated, isAdmin, getCampaigns);
whatsappRoute.post("/campaigns", isAuthenticated, isAdmin, createCampaign);
whatsappRoute.post(
  "/campaigns/:campaignId/send",
  isAuthenticated,
  isAdmin,
  sendCampaign
);
whatsappRoute.get(
  "/campaigns/:campaignId/events",
  isAuthenticated,
  isAdmin,
  getCampaignEvents
);

// ─── Templates ───────────────────────────────────────────
whatsappRoute.get("/templates", isAuthenticated, isAdmin, getTemplates);
whatsappRoute.post("/templates/sync", isAuthenticated, isAdmin, syncTemplates);
whatsappRoute.post("/templates", isAuthenticated, isAdmin, createTemplate);
whatsappRoute.patch(
  "/templates/:templateId",
  isAuthenticated,
  isAdmin,
  updateTemplate
);

// ─── Analytics ──────────────────────────────────────────
whatsappRoute.get("/analytics", isAuthenticated, isAdmin, getAnalytics);

// ─── Billing & Profile ──────────────────────────────────
whatsappRoute.get("/wallet", isAuthenticated, isAdmin, getWallet);
whatsappRoute.post("/wallet/recharge", isAuthenticated, isAdmin, rechargeWallet);
whatsappRoute.get(
  "/business-profile",
  isAuthenticated,
  isAdmin,
  getBusinessProfile
);
whatsappRoute.patch(
  "/business-profile",
  isAuthenticated,
  isAdmin,
  updateBusinessProfile
);
whatsappRoute.post(
  "/phone-numbers/verify",
  isAuthenticated,
  isAdmin,
  verifyPhoneNumber
);

module.exports = whatsappRoute;
