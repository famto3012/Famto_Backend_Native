const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappContact = require("../../models/WhatsappContact");
const appError = require("../../utils/appError");

// Resolve an audience string to an array of waIds from the contacts collection
const resolveAudience = async (audience) => {
  let filter = {};

  switch (audience) {
    case "All opted-in customers":
      filter = {};
      break;
    case "VIP customers":
      filter = { tags: { $in: ["vip", "VIP"] } };
      break;
    case "Inactive customers":
      // contacted more than 30 days ago or never
      filter = {
        $or: [
          { lastContactedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          { lastContactedAt: null },
        ],
      };
      break;
    case "Delayed orders":
      filter = { tags: { $in: ["delayed", "Delayed", "order-issue", "Order Issue"] } };
      break;
    case "CSV import segment":
      filter = { tags: { $in: ["csv-import", "imported"] } };
      break;
    default:
      // treat as a tag name if nothing matched
      filter = { tags: { $in: [audience] } };
  }

  const contacts = await WhatsappContact.find(filter).select("waId").lean();
  return contacts.map((c) => c.waId).filter(Boolean);
};
const { sendMetaMessage } = require("../../utils/whatsappApi");
const { sendSocketData } = require("../../socket/socket");
const { formatCampaign } = require("../../utils/whatsappFormatters");

const getCampaigns = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [campaigns, total] = await Promise.all([
      WhatsappCampaign.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("templateId", "name category status")
        .populate("createdBy", "fullName")
        .lean(),
      WhatsappCampaign.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: campaigns.map(formatCampaign),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const createCampaign = async (req, res, next) => {
  try {
    const { name, templateId, audience, recipients, templateParams, scheduledAt, sendNow } = req.body;

    if (!name || !templateId) {
      return next(appError("Campaign name and template are required", 400));
    }

    const template = await WhatsappTemplate.findById(templateId);
    if (!template) return next(appError("Template not found", 404));
    if (template.status !== "APPROVED") {
      return next(appError("Template must be APPROVED to use in campaigns", 400));
    }

    // Resolve recipients
    let resolvedRecipients = recipients;
    if (!resolvedRecipients?.length && audience) {
      resolvedRecipients = await resolveAudience(audience);
    }
    if (!resolvedRecipients?.length) {
      return next(appError(`No contacts found for audience "${audience || "unknown"}". Add contacts first.`, 400));
    }

    // Determine initial status
    const initialStatus = sendNow ? "sending" : scheduledAt ? "scheduled" : "draft";

    const campaign = await WhatsappCampaign.create({
      name,
      templateId,
      templateName: template.name,
      audience: audience || "Custom",
      recipients: resolvedRecipients,
      templateParams: templateParams || [],
      scheduledAt: sendNow ? null : (scheduledAt || null),
      sentAt: sendNow ? new Date() : null,
      status: initialStatus,
      stats: { total: resolvedRecipients.length },
      createdBy: req.userAuth,
    });

    // If sendNow, kick off immediately in background
    if (sendNow) {
      processCampaignSend(campaign, req.userAuth).catch((err) =>
        console.error(`[Campaign] Send error for ${campaign._id}:`, err.message)
      );
    }

    res.status(201).json({
      success: true,
      data: formatCampaign(campaign),
      message: sendNow
        ? `Campaign sending started to ${resolvedRecipients.length} contacts`
        : scheduledAt
          ? `Campaign scheduled for ${new Date(scheduledAt).toLocaleString("en-IN")}`
          : "Campaign saved as draft",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const sendCampaign = async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    const campaign = await WhatsappCampaign.findById(campaignId);
    if (!campaign) {
      return next(appError("Campaign not found", 404));
    }

    if (campaign.status === "sending" || campaign.status === "completed") {
      return next(appError(`Campaign is already ${campaign.status}`, 400));
    }

    campaign.status = "sending";
    campaign.sentAt = new Date();
    await campaign.save();

    // Send in background — respond immediately
    res.status(200).json({
      success: true,
      message: "Campaign sending started",
      data: { campaignId: campaign._id, status: "sending" },
    });

    processCampaignSend(campaign, req.userAuth).catch((err) => {
      console.error(`[Campaign] Error processing campaign ${campaignId}:`, err.message);
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const processCampaignSend = async (campaign, userId) => {
  const template = await WhatsappTemplate.findById(campaign.templateId);
  if (!template) return;

  let sentCount = 0;
  let failedCount = 0;

  for (const waId of campaign.recipients) {
    try {
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: waId,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language || "en_US" },
          components: campaign.templateParams,
        },
      };

      const metaResponse = await sendMetaMessage(payload);
      const metaMessageId = metaResponse.messages?.[0]?.id;

      campaign.events.push({
        waId,
        status: "sent",
        metaMessageId,
        timestamp: new Date(),
      });
      sentCount++;
    } catch (err) {
      const reason =
        err.response?.data?.error?.message || err.message;

      campaign.events.push({
        waId,
        status: "failed",
        failureReason: reason,
        timestamp: new Date(),
      });
      failedCount++;
    }

    // Throttle to avoid Meta rate limits (80 msg/sec for business tier)
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  campaign.stats.sent = sentCount;
  campaign.stats.failed = failedCount;
  campaign.status =
    failedCount === campaign.recipients.length
      ? "failed"
      : failedCount > 0
        ? "partial"
        : "completed";

  await campaign.save();

  sendSocketData(userId, "whatsapp:campaign:event", {
    campaignId: campaign._id,
    status: campaign.status,
    stats: campaign.stats,
  });
};

const getCampaignEvents = async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    const campaign = await WhatsappCampaign.findById(campaignId)
      .select("name status stats events sentAt")
      .lean();

    if (!campaign) {
      return next(appError("Campaign not found", 404));
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// GET /campaigns/audience-preview?audience=VIP+customers
const getAudiencePreview = async (req, res, next) => {
  try {
    const { audience = "All opted-in customers" } = req.query;
    const waIds = await resolveAudience(audience);
    res.status(200).json({
      success: true,
      data: { audience, count: waIds.length },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getCampaigns,
  createCampaign,
  sendCampaign,
  getCampaignEvents,
  getAudiencePreview,
  processCampaignSend,   // exported for cron use
};
