const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappContact = require("../../models/WhatsappContact");
const appError = require("../../utils/appError");

const BUILTIN_AUDIENCES = [
  "All opted-in customers",
  "VIP customers",
  "Inactive customers",
  "Delayed orders",
  "CSV import segment",
];

// Resolve an audience string to an array of waIds from the contacts collection
const resolveAudience = async (audience, maxRecipients) => {
  let filter = {};

  switch (audience) {
    case "All opted-in customers":
      filter = {};
      break;
    case "VIP customers":
      filter = { tags: { $in: ["vip", "VIP"] } };
      break;
    case "Inactive customers":
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
      filter = { tags: { $in: [audience] } };
  }

  let query = WhatsappContact.find(filter).select("waId").lean();
  if (maxRecipients && maxRecipients > 0) {
    query = query.limit(parseInt(maxRecipients));
  }

  const contacts = await query;
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
    const { name, templateId, audience, recipients, templateParams, scheduledAt, sendNow, maxRecipients } = req.body;

    if (!name || !templateId) {
      return next(appError("Campaign name and template are required", 400));
    }

    const template = await WhatsappTemplate.findById(templateId);
    if (!template) return next(appError("Template not found", 404));
    if (template.status !== "APPROVED") {
      return next(appError("Template must be APPROVED to use in campaigns", 400));
    }

    // Check if template body has parameters that need values
    const bodyComp = (template.components || []).find((c) => c.type === "BODY");
    const paramCount = (bodyComp?.text?.match(/\{\{[^}]+\}\}/g) || []).length;
    if (paramCount > 0 && (!templateParams || templateParams.length === 0)) {
      return next(
        appError(
          `Template "${template.name}" requires ${paramCount} body parameter(s). Provide templateParams in the request.`,
          400
        )
      );
    }

    // Resolve recipients
    let resolvedRecipients = recipients;
    if (!resolvedRecipients?.length && audience) {
      resolvedRecipients = await resolveAudience(audience, maxRecipients);
    }
    if (resolvedRecipients?.length && maxRecipients > 0) {
      resolvedRecipients = resolvedRecipients.slice(0, parseInt(maxRecipients));
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

const buildComponentsFromTemplate = (template) => {
  return [];
};

const processCampaignSend = async (campaign, userId) => {
  const template = await WhatsappTemplate.findById(campaign.templateId);
  if (!template) return;

  // Build components from template definition when campaign has no explicit templateParams
  let sendComponents = campaign.templateParams?.length > 0
    ? campaign.templateParams
    : buildComponentsFromTemplate(template);

  console.log("[Campaign] Template:", JSON.stringify({
    name: template.name,
    language: template.language,
    status: template.status,
    category: template.category,
  }));
  console.log("[Campaign] Recipients count:", campaign.recipients.length);
  console.log("[Campaign] sendComponents:", JSON.stringify(sendComponents));

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
          ...(sendComponents.length > 0 && {
            components: sendComponents,
          }),
        },
      };

      const metaResponse = await sendMetaMessage(payload);
      const metaMessageId = metaResponse.messages?.[0]?.id;
      console.log(`[Campaign] Success for ${waId}:`, metaMessageId);

      campaign.events.push({
        waId,
        status: "sent",
        metaMessageId,
        timestamp: new Date(),
      });
      sentCount++;
    } catch (err) {
      const fullError = err.response?.data || err.message;
      const reason =
        err.response?.data?.error?.message || err.message;
      console.error(`[Campaign] Failed to send to ${waId}:`, JSON.stringify(fullError));
      console.error(`[Campaign] Status:`, err.response?.status, `Code:`, err.response?.data?.error?.code, `Subcode:`, err.response?.data?.error?.error_subcode);

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

// GET /campaigns/audience-preview?audience=VIP+customers&maxRecipients=100
const getAudiencePreview = async (req, res, next) => {
  try {
    const { audience = "All opted-in customers", maxRecipients } = req.query;
    const waIds = await resolveAudience(audience, maxRecipients);
    res.status(200).json({
      success: true,
      data: { audience, count: waIds.length, limited: !!maxRecipients },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// GET /campaigns/audience-options — returns built-in segments + all custom tags
const getAudienceOptions = async (req, res, next) => {
  try {
    const builtIn = [];
    for (const label of BUILTIN_AUDIENCES) {
      const count = (await resolveAudience(label)).length;
      builtIn.push({ label, type: "built-in", count });
    }

    const tagAgg = await WhatsappContact.aggregate([
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const builtInTags = new Set([
      "vip", "VIP", "delayed", "Delayed", "order-issue", "Order Issue",
      "csv-import", "imported", "famto-customer",
    ]);

    const customTags = tagAgg
      .filter((t) => !builtInTags.has(t._id))
      .map((t) => ({ label: t._id, type: "tag", count: t.count }));

    res.status(200).json({
      success: true,
      data: [...builtIn, ...customTags],
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
  getAudienceOptions,
  processCampaignSend,
};
