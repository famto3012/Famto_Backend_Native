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
  getNotes,
  addNote,
  deleteNote,
} = require("../../controllers/whatsapp/inboxController");

const {
  getContacts,
  syncContacts,
  updateContact,
  getContactTags,
  syncFromFamtoCustomers,
  downloadSampleCsv,
  importContactsCsv,
} = require("../../controllers/whatsapp/contactController");

const {
  getCampaigns,
  createCampaign,
  sendCampaign,
  getCampaignEvents,
  getAudiencePreview,
  getAudienceOptions,
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
whatsappRoute.get(
  "/conversations/:conversationId/notes",
  isAuthenticated,
  isAdmin,
  getNotes
);
whatsappRoute.post(
  "/conversations/:conversationId/notes",
  isAuthenticated,
  isAdmin,
  addNote
);
whatsappRoute.delete(
  "/conversations/:conversationId/notes/:noteId",
  isAuthenticated,
  isAdmin,
  deleteNote
);

// ─── Contacts ────────────────────────────────────────────
whatsappRoute.get("/contacts", isAuthenticated, isAdmin, getContacts);
// Specific routes BEFORE parameterised :contactId
whatsappRoute.get("/contacts/tags", isAuthenticated, isAdmin, getContactTags);
whatsappRoute.post("/contacts/sync", isAuthenticated, isAdmin, syncContacts);
whatsappRoute.post("/contacts/sync-famto", isAuthenticated, isAdmin, syncFromFamtoCustomers);
whatsappRoute.get("/contacts/sample-csv", isAuthenticated, isAdmin, downloadSampleCsv);
whatsappRoute.post(
  "/contacts/import-csv",
  isAuthenticated,
  isAdmin,
  upload.single("csv"),
  importContactsCsv
);
whatsappRoute.patch(
  "/contacts/:contactId",
  isAuthenticated,
  isAdmin,
  updateContact
);

// ─── Campaigns ───────────────────────────────────────────
whatsappRoute.get("/campaigns/audience-options", isAuthenticated, isAdmin, getAudienceOptions);
whatsappRoute.get("/campaigns/audience-preview", isAuthenticated, isAdmin, getAudiencePreview);
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
