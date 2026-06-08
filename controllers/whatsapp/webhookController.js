const WhatsappConversation = require("../../models/WhatsappConversation");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappCampaign = require("../../models/WhatsappCampaign");
const Admin = require("../../models/Admin");
const Manager = require("../../models/Manager");
const { sendSocketData, sendNotification } = require("../../socket/socket");
const {
  getMediaUrl,
  downloadMedia,
} = require("../../utils/whatsappApi");
const {
  uploadFileToFirebaseForWhatsapp,
} = require("../../utils/imageOperation");
const { formatMessage } = require("../../utils/whatsappFormatters");

const verifyWebhook = (req, res) => {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "token";
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === verifyToken
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
};

const handleWebhook = async (req, res) => {
  // Always respond 200 immediately to Meta
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value;
        if (!value) continue;

        // Handle incoming messages
        if (value.messages?.length) {
          for (const msg of value.messages) {
            await handleIncomingMessage(value, msg);
          }
        }

        // Handle message status updates
        if (value.statuses?.length) {
          for (const status of value.statuses) {
            await handleStatusUpdate(status);
          }
        }

        // Handle template status updates (via message_template_status_update)
        if (change.field === "message_template_status_update") {
          await handleTemplateStatusUpdate(value);
        }
      }
    }
  } catch (err) {
    console.error("[WhatsApp Webhook] Processing error:", err.message);
  }
};

// ─── Incoming Message Handler ────────────────────────────

const handleIncomingMessage = async (event, msg) => {
  const phoneNumberId = event.metadata?.phone_number_id;
  const waId = msg.from;
  const contactName =
    event.contacts?.[0]?.profile?.name || "";

  // Idempotency: skip if we already stored this Meta message
  const existingMsg = await WhatsappMessage.findOne({
    metaMessageId: msg.id,
  });
  if (existingMsg) return;

  // Find or create conversation
  let conversation = await WhatsappConversation.findOne({ waId });
  if (!conversation) {
    conversation = await WhatsappConversation.create({
      waId,
      name: contactName,
      status: "open",
      lastMessage: {
        text: extractMessagePreview(msg),
        timestamp: new Date(parseInt(msg.timestamp) * 1000),
        direction: "inbound",
      },
      unreadCount: 1,
    });

    // Auto-create contact
    await WhatsappContact.findOneAndUpdate(
      { waId },
      {
        $setOnInsert: {
          waId,
          name: contactName,
          phone: `+${waId}`,
        },
        $set: {
          conversationId: conversation._id,
          lastContactedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } else {
    // Update conversation name if we got a new one from Meta
    const updates = {
      lastMessage: {
        text: extractMessagePreview(msg),
        timestamp: new Date(parseInt(msg.timestamp) * 1000),
        direction: "inbound",
      },
      $inc: { unreadCount: 1 },
    };
    if (contactName && !conversation.name) {
      updates.name = contactName;
    }
    if (conversation.status === "closed") {
      updates.status = "open";
    }
    await WhatsappConversation.findByIdAndUpdate(conversation._id, updates);
  }

  // Build message document
  const messageData = {
    conversationId: conversation._id,
    waId,
    metaMessageId: msg.id,
    direction: "inbound",
    messageType: mapMetaType(msg.type),
    body: "",
    senderName: contactName,
    timestamp: new Date(parseInt(msg.timestamp) * 1000),
    deliveryStatus: "delivered",
  };

  // Extract content based on type
  switch (msg.type) {
    case "text":
      messageData.body = msg.text?.body || "";
      break;

    case "image":
      messageData.body = msg.image?.caption || "[Image]";
      messageData.media = {
        caption: msg.image?.caption,
        mimeType: msg.image?.mime_type,
        link: await downloadAndStoreMedia(
          msg.image?.id,
          phoneNumberId,
          msg.image?.mime_type
        ),
      };
      break;

    case "audio":
      messageData.body = "[Audio]";
      messageData.media = {
        mimeType: msg.audio?.mime_type,
        link: await downloadAndStoreMedia(
          msg.audio?.id,
          phoneNumberId,
          msg.audio?.mime_type
        ),
      };
      break;

    case "video":
      messageData.body = msg.video?.caption || "[Video]";
      messageData.media = {
        caption: msg.video?.caption,
        mimeType: msg.video?.mime_type,
        link: await downloadAndStoreMedia(
          msg.video?.id,
          phoneNumberId,
          msg.video?.mime_type
        ),
      };
      break;

    case "document":
      messageData.body = msg.document?.filename || "[Document]";
      messageData.media = {
        mimeType: msg.document?.mime_type,
        fileName: msg.document?.filename,
        link: await downloadAndStoreMedia(
          msg.document?.id,
          phoneNumberId,
          msg.document?.mime_type
        ),
      };
      break;

    case "location":
      messageData.body = "[Location]";
      messageData.location = {
        latitude: msg.location?.latitude,
        longitude: msg.location?.longitude,
        name: msg.location?.name,
        address: msg.location?.address,
      };
      break;

    case "contacts":
      messageData.body = "[Contact]";
      if (msg.contacts?.[0]) {
        const c = msg.contacts[0];
        messageData.contact = {
          firstName: c.name?.first_name,
          lastName: c.name?.last_name,
          fullName: c.name?.formatted_name,
          phone: c.phones?.[0]?.phone,
          waId: c.phones?.[0]?.wa_id,
        };
      }
      break;

    case "sticker":
      messageData.body = "[Sticker]";
      messageData.media = {
        mimeType: msg.sticker?.mime_type,
        link: await downloadAndStoreMedia(
          msg.sticker?.id,
          phoneNumberId,
          msg.sticker?.mime_type
        ),
      };
      break;

    case "reaction":
      messageData.body = msg.reaction?.emoji || "[Reaction]";
      messageData.messageType = "reaction";
      break;

    default:
      messageData.body = `[${msg.type}]`;
  }

  const savedMessage = await WhatsappMessage.create(messageData);

  // Broadcast to all admins and managers with properly formatted message
  await broadcastToStaff("whatsapp:message", formatMessage(savedMessage));
};

// ─── Status Update Handler ───────────────────────────────

const handleStatusUpdate = async (status) => {
  const metaMessageId = status.id;
  const newStatus = status.status; // sent, delivered, read, failed

  const mapped = mapStatusToDelivery(newStatus);
  if (!mapped) return;

  const message = await WhatsappMessage.findOneAndUpdate(
    { metaMessageId },
    { $set: { deliveryStatus: mapped } },
    { new: true }
  );

  if (message) {
    await broadcastToStaff("whatsapp:message:status", {
      messageId: message._id,
      metaMessageId,
      conversationId: message.conversationId,
      deliveryStatus: mapped,
    });
  }

  // Also update campaign events if this message belongs to one
  if (mapped === "delivered" || mapped === "read" || mapped === "failed") {
    await WhatsappCampaign.updateOne(
      { "events.metaMessageId": metaMessageId },
      {
        $set: { "events.$.status": mapped },
        $inc: {
          [`stats.${mapped}`]: 1,
          ...(mapped !== "failed" ? {} : {}),
        },
      }
    );
  }

  // Handle failure reason
  if (status.errors?.length) {
    await WhatsappMessage.findOneAndUpdate(
      { metaMessageId },
      { $set: { failureReason: status.errors[0]?.title || "Unknown error" } }
    );
  }
};

// ─── Template Status Update Handler ──────────────────────

const handleTemplateStatusUpdate = async (value) => {
  const event = value.message_template_status_update || value;
  const templateName = event.message_template_name;
  const newStatus = event.event; // APPROVED, REJECTED, DISABLED, etc.

  if (!templateName || !newStatus) return;

  const template = await WhatsappTemplate.findOneAndUpdate(
    { name: templateName },
    {
      $set: {
        status: newStatus,
        rejectedReason: event.reject_reason || "",
      },
    },
    { new: true }
  );

  if (template) {
    await broadcastToStaff("whatsapp:template:status", {
      templateId: template._id,
      name: template.name,
      status: newStatus,
    });
  }
};

// ─── Helpers ─────────────────────────────────────────────

const downloadAndStoreMedia = async (mediaId, phoneNumberId, mimeType) => {
  try {
    if (!mediaId) return null;

    const mediaUrl = await getMediaUrl(mediaId);
    if (!mediaUrl) return null;
    const fileBuffer = await downloadMedia(mediaUrl);
    return await uploadFileToFirebaseForWhatsapp(
      fileBuffer,
      "whatsapp_media",
      mimeType
    );
  } catch (err) {
    console.error("[WhatsApp] Media download failed:", err.message);
    return null;
  }
};

const extractMessagePreview = (msg) => {
  switch (msg.type) {
    case "text":
      return msg.text?.body || "";
    case "image":
      return msg.image?.caption || "[Image]";
    case "video":
      return msg.video?.caption || "[Video]";
    case "audio":
      return "[Audio]";
    case "document":
      return msg.document?.filename || "[Document]";
    case "location":
      return "[Location]";
    case "contacts":
      return "[Contact]";
    case "sticker":
      return "[Sticker]";
    case "reaction":
      return msg.reaction?.emoji || "[Reaction]";
    default:
      return `[${msg.type}]`;
  }
};

const mapMetaType = (type) => {
  const typeMap = {
    text: "text",
    image: "image",
    audio: "audio",
    video: "video",
    document: "document",
    location: "location",
    contacts: "contacts",
    sticker: "sticker",
    reaction: "reaction",
    interactive: "interactive",
  };
  return typeMap[type] || "text";
};

const mapStatusToDelivery = (metaStatus) => {
  const statusMap = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };
  return statusMap[metaStatus] || null;
};

const broadcastToStaff = async (eventName, data) => {
  try {
    const [admins, managers] = await Promise.all([
      Admin.find({}, "_id").lean(),
      Manager.find({}, "_id").lean(),
    ]);

    const userIds = [
      ...admins.map((a) => a._id.toString()),
      ...managers.map((m) => m._id.toString()),
    ];

    for (const userId of userIds) {
      sendSocketData(userId, eventName, data);
    }
  } catch (err) {
    console.error("[WhatsApp] Broadcast error:", err.message);
  }
};

module.exports = {
  verifyWebhook,
  handleWebhook,
};
