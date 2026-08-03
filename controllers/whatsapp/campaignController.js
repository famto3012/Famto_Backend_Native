const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappConversation = require("../../models/WhatsappConversation");
const appError = require("../../utils/appError");
const { logCampaignEvent } = require("../../utils/errorLogger");
const { sendMetaMessage } = require("../../utils/whatsappApi");
const { sendSocketData } = require("../../socket/socket");
const { formatCampaign } = require("../../utils/whatsappFormatters");

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
    const {
      name,
      templateId,
      audience,
      recipients,
      templateParams,
      scheduledAt,
      sendNow,
      maxRecipients,
    } = req.body;

    // Validate required fields
    if (!name || !templateId) {
      return next(
        appError("Campaign name and template are required", 400)
      );
    }

    // Find template
    const template = await WhatsappTemplate.findById(templateId);

    if (!template) {
      return next(appError("Template not found", 404));
    }

    if (template.status !== "APPROVED") {
      return next(
        appError(
          "Template must be APPROVED to use in campaigns",
          400
        )
      );
    }

    // Check if template requires body parameters
    const bodyComp = (template.components || []).find(
      (c) => c.type === "BODY"
    );

    const paramCount =
      (bodyComp?.text?.match(/\{\{[^}]+\}\}/g) || []).length;

    if (
      paramCount > 0 &&
      (!templateParams || templateParams.length < paramCount)
    ) {
      return next(
        appError(
          `Template "${template.name}" requires ${paramCount} body parameter(s).`,
          400
        )
      );
    }

    // Resolve recipients from audience if recipients not provided
    let resolvedRecipients = recipients;

    if ((!resolvedRecipients || !resolvedRecipients.length) && audience) {
      resolvedRecipients = await resolveAudience(
        audience,
        maxRecipients
      );
    }

    // Apply recipient limit
    if (
      resolvedRecipients &&
      resolvedRecipients.length &&
      maxRecipients > 0
    ) {
      resolvedRecipients = resolvedRecipients.slice(
        0,
        parseInt(maxRecipients)
      );
    }

    if (!resolvedRecipients || !resolvedRecipients.length) {
      return next(
        appError(
          `No contacts found for audience "${audience || "unknown"}".`,
          400
        )
      );
    }

    // Determine campaign status
    let initialStatus = "draft";

    if (sendNow) {
      initialStatus = "sending";
    } else if (scheduledAt) {
      initialStatus = "scheduled";
    }

    // Create campaign
    const campaign = await WhatsappCampaign.create({
      name,
      templateId,
      templateName: template.name,
      audience: audience || "Custom",
      recipients: resolvedRecipients,
      templateParams: templateParams || [],
      scheduledAt: sendNow ? null : scheduledAt || null,
      sentAt: sendNow ? new Date() : null,
      status: initialStatus,
      stats: {
        total: resolvedRecipients.length,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
      },
      createdBy: req.userAuth,
    });

    // Start sending immediately
    if (sendNow) {
      processCampaignSend(campaign, req.userAuth).catch((err) => {
        console.error(
          `[Campaign ${campaign._id}] Send failed:`,
          err
        );
      });
    }

    return res.status(201).json({
      success: true,
      message: sendNow
        ? `Campaign sending started to ${resolvedRecipients.length} contacts`
        : scheduledAt
        ? `Campaign scheduled for ${new Date(
            scheduledAt
          ).toLocaleString("en-IN")}`
        : "Campaign saved as draft",
      data: formatCampaign(campaign),
    });
  } catch (err) {
    console.error("Create Campaign Error:", err);
    return next(appError(err.message || "Internal Server Error", 500));
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

const isValidWaId = (waId) => {
   // WhatsApp Business API requires waId to be a numeric string
   // Optional country code prefix (e.g., 919876543210 or 9876543210)
   const waIdRegex = /^(?:\d{8,15})$/;
   return waIdRegex.test(String(waId).replace(/^\+/, ''));
};

const buildComponentsFromTemplate = (template) => {
   const components = template?.components || [];
   if (!components.length) return [];

   const sendComponents = [];

   for (const comp of components) {
     if (comp.type === 'HEADER') {
       // Header with image or text
       // CRITICAL: In template messages, header content is sent directly (not as parameters).
       // The image link or text should be part of the header component itself, NOT wrapped in parameters.
       if (comp.format === 'IMAGE') {
         // Prefer the project's env header image (Firebase URL) over Meta's
         // expiring CDN header_handle. Meta silently drops sends whose image.link
         // is a scontent.whatsapp.net URL (its own CDN handle is only valid for
         // the template preview, not for send-time).
         // Explicit per-template map — env names are NOT mechanical
         // (welcome_famto → WHATSAPP_WELCOME_HEADER_IMAGE, not _WELCOME_FAMTO_).
         const templateName = template?.name || "";
         const envKey =
           {
             welcome_famto: "WHATSAPP_WELCOME_HEADER_IMAGE",
             cart_reminder: "WHATSAPP_CART_REMINDER_HEADER_IMAGE",
             order_tracking: "WHATSAPP_ORDER_TRACKING_HEADER_IMAGE",
             medicine_home_delivery: "WHATSAPP_MEDICINE_IMAGE",
           }[templateName] || "";
         const envImage = (envKey && process.env[envKey]) || "";
         const rawHandle =
           (envImage && String(envImage).replace(/^@url:`|`$/g, "").trim()) ||
           comp.example?.header_handle?.[0] ||
           comp.image_url ||
           "";
         const imageLink = rawHandle.replace(/^@url:`|`$/g, "").trim();
         if (imageLink) {
           sendComponents.push({
             type: 'header',
             parameters: [{ type: 'image', image: { link: imageLink } }],
           });
         }
       } else if (comp.format === 'TEXT' || comp.text) {
         // Header text is typically static in the template definition
         // If there are placeholders, they should be in the BODY component instead
       }
     } else if (comp.type === 'BODY') {
       const paramNames = (comp.text?.match(/\{\{([^}]+)\}\}/g) || []).map(m => m.replace(/\{\{|\}\}/g, ''));
       if (paramNames.length > 0) {
         sendComponents.push({
           type: 'body',
           parameters: paramNames.map(name => ({
             type: 'text',
             text: '',
             parameter_name: name,
           })),
         });
       }
     } else if (comp.type === 'FOOTER') {
       const paramNames = (comp.text?.match(/\{\{([^}]+)\}\}/g) || []).map(m => m.replace(/\{\{|\}\}/g, ''));
       if (paramNames.length > 0) {
         sendComponents.push({
           type: 'footer',
           parameters: paramNames.map(name => ({
             type: 'text',
             text: '',
             parameter_name: name,
           })),
         });
       }
     }
     // BUTTONS are not sent as components in template messages - they're defined in the template itself
   }

   return sendComponents;
};

const processCampaignSend = async (campaign, userId) => {
  const template = await WhatsappTemplate.findById(campaign.templateId);
  if (!template) return;

  // Build components from template definition when campaign has no explicit templateParams
  let sendComponents = campaign.templateParams?.length > 0
    ? campaign.templateParams
    : buildComponentsFromTemplate(template);

  logCampaignEvent("START", `Starting campaign ${campaign._id} to ${campaign.recipients.length} recipients`, {
    template: template.name,
    recipients: campaign.recipients.length,
  });

  let sentCount = 0;
  let failedCount = 0;

  for (const waId of campaign.recipients) {
    // Validate waId format before attempting to send
    if (!isValidWaId(waId)) {
      logCampaignEvent("INVALID_WAID", `Invalid waId format, skipping: ${waId}`, {
        waId,
        template: template.name,
      });
      campaign.events.push({
        waId,
        status: "failed",
        failureReason: "Invalid waId format",
        timestamp: new Date(),
      });
      failedCount++;
      continue;
    }

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
      logCampaignEvent("SUCCESS", `Successfully sent template to ${waId}`, {
        waId,
        template: template.name,
        metaMessageId,
        status: "sent",
      });

      // Find or create the conversation for this recipient.
      // WhatsappMessage.conversationId is required, so a campaign message
      // cannot be stored without a conversation. Mirror webhookController's
      // find-or-create pattern so campaign sends also show up in the inbox.
      let conversation = await WhatsappConversation.findOne({ waId });
      if (!conversation) {
        conversation = await WhatsappConversation.create({
          waId,
          status: "open",
          lastMessage: {
            text: `[Template: ${template.name}]`,
            timestamp: new Date(),
            direction: "outbound",
          },
        });
      }

      // Create a message record so analytics/billing can count this campaign message
      await WhatsappMessage.create({
        conversationId: conversation._id,
        waId,
        metaMessageId,
        direction: "outbound",
        messageType: "template",
        body: `[Template: ${template.name}]`,
        templateName: template.name,
        deliveryStatus: "sent",
        senderName: "Campaign",
        campaignId: campaign._id,
        timestamp: new Date(),
      }).catch((err) => {
        logCampaignEvent("MESSAGE_SAVE_FAILED", `Failed to save message record for ${waId}: ${err.message}`, {
          waId,
          template: template.name,
          error: err.message,
        });
      });

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
      logCampaignEvent("SEND_FAILED", `Failed to send template to ${waId}: ${JSON.stringify(fullError)}`, {
        waId,
        template: template.name,
        status: "failed",
        error: reason,
      });

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

  logCampaignEvent("COMPLETED", `Campaign ${campaign._id} completed with ${sentCount} sent, ${failedCount} failed`, {
    template: template.name,
    recipients: campaign.recipients.length,
    sent: sentCount,
    failed: failedCount,
    status: campaign.status,
  });

  sendSocketData(userId, "whatsapp:campaign:event", {
    campaignId: campaign._id,
    status: campaign.status,
    stats: campaign.stats,
  });
};

const getCampaignEvents = async (req, res, next) => {
  try {
    const { campaignId } = req.params;

    const campaign = await WhatsappCampaign.findOne({
      _id: campaignId,
      createdBy: req.userAuth,
    })
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
