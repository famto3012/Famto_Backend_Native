const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappConnection = require("../../models/WhatsappConnection");
const appError = require("../../utils/appError");
const {
  sendTemplateMessage,
  resolveMerchantConnection,
} = require("../../utils/whatsappApi");
const { sendSocketData } = require("../../socket/socket");
const { buildComponentsFromTemplate } = require("../../utils/whatsappFormatters");

const getMerchantCampaigns = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [campaigns, total] = await Promise.all([
      WhatsappCampaign.find({ merchantId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("templateId", "name language category")
        .lean(),
      WhatsappCampaign.countDocuments({ merchantId }),
    ]);

    const nextPage = skip + parseInt(limit) < total ? parseInt(page) + 1 : null;

    res.status(200).json({
      success: true,
      data: { items: campaigns, nextPage, total },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const createMerchantCampaign = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { name, templateId, audience, recipients, templateParams } = req.body;

    if (!name || !templateId) {
      return next(appError("Name and templateId are required", 400));
    }

    const template = await WhatsappTemplate.findOne({ _id: templateId, merchantId });
    if (!template) {
      return next(appError("Template not found", 404));
    }

    let finalRecipients = recipients || [];
    if (audience === "all_contacts") {
      const contacts = await WhatsappContact.find({ merchantId }).select("waId").lean();
      finalRecipients = contacts.map((c) => c.waId);
    }

    const campaign = await WhatsappCampaign.create({
      name,
      templateId,
      templateName: template.name,
      audience: audience || "Custom",
      recipients: finalRecipients,
      templateParams: templateParams || [],
      status: "draft",
      merchantId,
      createdBy: req.userAuth,
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const sendMerchantCampaign = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { campaignId } = req.params;

    const campaign = await WhatsappCampaign.findOne({ _id: campaignId, merchantId });
    if (!campaign) {
      return next(appError("Campaign not found", 404));
    }
    if (campaign.status === "sending" || campaign.status === "completed") {
      return next(appError("Campaign already sent or in progress", 400));
    }

    // Resolve merchant's connection
    const connection = await resolveMerchantConnection(merchantId);
    if (!connection) {
      return next(appError("No active WhatsApp connection. Please connect your number first.", 400));
    }

    campaign.status = "sending";
    campaign.sentAt = new Date();
    campaign.stats.total = campaign.recipients.length;
    await campaign.save();

    const template = await WhatsappTemplate.findById(campaign.templateId);
    if (!template) {
      campaign.status = "failed";
      await campaign.save();
      return next(appError("Template not found", 404));
    }

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < campaign.recipients.length; i++) {
      const waId = campaign.recipients[i];
      const bodyParams = campaign.templateParams.map((p) => (Array.isArray(p) ? p[i] : p));

      const components = buildComponentsFromTemplate(template, bodyParams);

      try {
        await sendTemplateMessage(
          waId,
          template.name,
          bodyParams,
          template.language,
          null,
          connection
        );

        campaign.events.push({
          waId,
          status: "sent",
          metaMessageId: `pending-${Date.now()}-${i}`,
          timestamp: new Date(),
        });
        sent++;
      } catch (err) {
        campaign.events.push({
          waId,
          status: "failed",
          failureReason: err.message,
          timestamp: new Date(),
        });
        failed++;
      }

      // Update campaign progress every 10 messages
      if ((i + 1) % 10 === 0) {
        campaign.stats.sent = sent;
        campaign.stats.failed = failed;
        await campaign.save();
      }
    }

    campaign.status = failed === campaign.recipients.length ? "failed" : "completed";
    campaign.stats.sent = sent;
    campaign.stats.failed = failed;
    await campaign.save();

    sendSocketData(String(merchantId), "whatsapp:campaign:updated", { campaignId, status: campaign.status });

    res.status(200).json({ success: true, data: campaign });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const getMerchantCampaignEvents = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { campaignId } = req.params;

    const campaign = await WhatsappCampaign.findOne({ _id: campaignId, merchantId }).lean();
    if (!campaign) {
      return next(appError("Campaign not found", 404));
    }

    res.status(200).json({ success: true, data: campaign.events });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantCampaigns,
  createMerchantCampaign,
  sendMerchantCampaign,
  getMerchantCampaignEvents,
};