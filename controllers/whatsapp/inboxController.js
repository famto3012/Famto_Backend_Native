const WhatsappConversation = require("../../models/WhatsappConversation");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappNote = require("../../models/WhatsappNote");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappWallet = require("../../models/WhatsappWallet");
const appError = require("../../utils/appError");
const {
  sendMetaMessage,
} = require("../../utils/whatsappApi");
const {
  uploadFileToFirebaseForWhatsapp,
} = require("../../utils/imageOperation");
const { sendSocketData } = require("../../socket/socket");
const {
  formatConversation,
  formatMessage,
  formatNote,
  formatOverview,
} = require("../../utils/whatsappFormatters");

const getOverview = async (req, res, next) => {
  try {
    const [overview] = await WhatsappConversation.aggregate([
      {
        $facet: {
          totalOpen: [
            { $match: { status: "open" } },
            { $count: "count" },
          ],
          totalClosed: [
            { $match: { status: "closed" } },
            { $count: "count" },
          ],
          totalUnread: [
            { $match: { unreadCount: { $gt: 0 } } },
            { $count: "count" },
          ],
          totalConversations: [{ $count: "count" }],
          recentConversations: [
            { $sort: { "lastMessage.timestamp": -1 } },
            { $limit: 5 },
            {
              $project: {
                waId: 1,
                name: 1,
                lastMessage: 1,
                unreadCount: 1,
                status: 1,
                profilePicUrl: 1,
                tags: 1,
                updatedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const templateCounts = await WhatsappTemplate.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const wallet = await WhatsappWallet.findOne().lean();

    const formatted = formatOverview({
      totalOpen: overview.totalOpen[0]?.count || 0,
      totalClosed: overview.totalClosed[0]?.count || 0,
      totalUnread: overview.totalUnread[0]?.count || 0,
      totalConversations: overview.totalConversations[0]?.count || 0,
      recentConversations: overview.recentConversations,
    });

    const tplMap = {};
    templateCounts.forEach((t) => { tplMap[t._id] = t.count; });
    formatted.templates = {
      approved: tplMap["APPROVED"] || 0,
      pending: tplMap["PENDING"] || 0,
    };

    if (wallet) {
      formatted.wallet = {
        balance: wallet.balance || 0,
        threshold: 5000,
      };
    }

    res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const getConversations = async (req, res, next) => {
  try {
    const {
      search = "",
      status,
      tag,
      assignee,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (status && status !== "all") {
      if (status === "unread") {
        filter.unreadCount = { $gt: 0 };
      } else {
        filter.status = status;
      }
    }
    if (tag && tag !== "all") filter.tags = { $in: tag.split(",") };
    if (assignee && assignee !== "all") {
      if (assignee === "unassigned") {
        filter.assignee = null;
      } else {
        filter.assignee = assignee;
      }
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { waId: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [conversations, total] = await Promise.all([
      WhatsappConversation.find(filter)
        .sort({ "lastMessage.timestamp": -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("assignee", "fullName email")
        .lean(),
      WhatsappConversation.countDocuments(filter),
    ]);

    const nextPage = skip + parseInt(limit) < total ? parseInt(page) + 1 : null;

    res.status(200).json({
      success: true,
      data: {
        items: conversations.map(formatConversation),
        nextPage,
        total,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { status, tags, assignee } = req.body;

    const update = {};
    if (status !== undefined) update.status = status;
    if (tags !== undefined) update.tags = tags;
    if (assignee !== undefined) update.assignee = assignee || null;

    const conversation = await WhatsappConversation.findByIdAndUpdate(
      conversationId,
      { $set: update },
      { new: true, runValidators: true }
    ).populate("assignee", "fullName email");

    if (!conversation) {
      return next(appError("Conversation not found", 404));
    }

    const formatted = formatConversation(conversation);
    sendSocketData(req.userAuth, "whatsapp:conversation:updated", formatted);

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const getMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 25 } = req.query;

    const conversation = await WhatsappConversation.findById(conversationId);
    if (!conversation) {
      return next(appError("Conversation not found", 404));
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [messages, total] = await Promise.all([
      WhatsappMessage.find({ conversationId })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      WhatsappMessage.countDocuments({ conversationId }),
    ]);

    if (conversation.unreadCount > 0) {
      await WhatsappConversation.findByIdAndUpdate(conversationId, {
        $set: { unreadCount: 0 },
      });
    }

    const nextPage = skip + parseInt(limit) < total ? parseInt(page) + 1 : null;

    res.status(200).json({
      success: true,
      data: {
        items: messages.reverse().map(formatMessage),
        nextPage,
        total,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { messageType, content } = req.body;

    const conversation = await WhatsappConversation.findById(conversationId);
    if (!conversation) {
      return next(appError("Conversation not found", 404));
    }

    const to = conversation.waId;
    let metaPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
    };

    let messageBody = content || "";
    let mediaData = {};

    switch (messageType) {
      case "text":
        metaPayload.type = "text";
        metaPayload.text = { preview_url: true, body: content };
        break;

      case "image": {
        if (!req.files?.image?.[0]) {
          return next(appError("No image file uploaded", 400));
        }
        const file = req.files.image[0];
        const imageUrl = await uploadFileToFirebaseForWhatsapp(
          file.buffer,
          "whatsapp_images",
          file.mimetype
        );
        metaPayload.type = "image";
        metaPayload.image = { link: imageUrl, caption: content || "" };
        messageBody = content || "[Image]";
        mediaData = { link: imageUrl, mimeType: file.mimetype, caption: content };
        break;
      }

      case "document": {
        if (!req.files?.document?.[0]) {
          return next(appError("No document file uploaded", 400));
        }
        const file = req.files.document[0];
        const docUrl = await uploadFileToFirebaseForWhatsapp(
          file.buffer,
          "whatsapp_documents",
          file.mimetype
        );
        metaPayload.type = "document";
        metaPayload.document = {
          link: docUrl,
          filename: file.originalname,
        };
        messageBody = file.originalname || "[Document]";
        mediaData = {
          link: docUrl,
          mimeType: file.mimetype,
          fileName: file.originalname,
        };
        break;
      }

      case "audio": {
        if (!req.files?.audio?.[0]) {
          return next(appError("No audio file uploaded", 400));
        }
        const file = req.files.audio[0];
        const audioUrl = await uploadFileToFirebaseForWhatsapp(
          file.buffer,
          "whatsapp_audio",
          file.mimetype
        );
        metaPayload.type = "audio";
        metaPayload.audio = { link: audioUrl };
        messageBody = "[Audio]";
        mediaData = { link: audioUrl, mimeType: file.mimetype };
        break;
      }

      default:
        return next(appError("Invalid message type", 400));
    }

    const metaResponse = await sendMetaMessage(metaPayload);
    const metaMessageId = metaResponse.messages?.[0]?.id;

    const message = await WhatsappMessage.create({
      conversationId,
      waId: to,
      metaMessageId,
      direction: "outbound",
      messageType,
      body: messageBody,
      media: mediaData.link ? mediaData : undefined,
      deliveryStatus: "sent",
      senderName: req.userName || "Admin",
      timestamp: new Date(),
    });

    await WhatsappConversation.findByIdAndUpdate(conversationId, {
      $set: {
        lastMessage: {
          text: messageBody,
          timestamp: new Date(),
          direction: "outbound",
        },
      },
    });

    const formatted = formatMessage(message);
    sendSocketData(req.userAuth, "whatsapp:message", formatted);

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const sendTemplateMessage = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { templateName, language = "en_US", components = [] } = req.body;

    if (!templateName) {
      return next(appError("Template name is required", 400));
    }

    const conversation = await WhatsappConversation.findById(conversationId);
    if (!conversation) {
      return next(appError("Conversation not found", 404));
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: conversation.waId,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components,
      },
    };

    const metaResponse = await sendMetaMessage(payload);
    const metaMessageId = metaResponse.messages?.[0]?.id;

    const message = await WhatsappMessage.create({
      conversationId,
      waId: conversation.waId,
      metaMessageId,
      direction: "outbound",
      messageType: "template",
      body: `[Template: ${templateName}]`,
      templateName,
      deliveryStatus: "sent",
      senderName: req.userName || "Admin",
      timestamp: new Date(),
    });

    await WhatsappConversation.findByIdAndUpdate(conversationId, {
      $set: {
        lastMessage: {
          text: `[Template: ${templateName}]`,
          timestamp: new Date(),
          direction: "outbound",
        },
        status: "open",
      },
    });

    const formatted = formatMessage(message);
    sendSocketData(req.userAuth, "whatsapp:message", formatted);

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const getNotes = async (req, res, next) => {
  try {
    const { conversationId } = req.params;

    const notes = await WhatsappNote.find({ conversationId })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: notes.map(formatNote) });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const addNote = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content) {
      return next(appError("Note content is required", 400));
    }

    const conversation = await WhatsappConversation.findById(conversationId);
    if (!conversation) {
      return next(appError("Conversation not found", 404));
    }

    const note = await WhatsappNote.create({
      conversationId,
      content,
      createdBy: req.userAuth,
      createdByName: req.userName || "Admin",
    });

    res.status(201).json({ success: true, data: formatNote(note) });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const deleteNote = async (req, res, next) => {
  try {
    const { noteId } = req.params;

    const note = await WhatsappNote.findByIdAndDelete(noteId);
    if (!note) return next(appError("Note not found", 404));

    res.status(200).json({ success: true, message: "Note deleted" });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getOverview,
  getConversations,
  updateConversation,
  getMessages,
  sendMessage,
  sendTemplateMessage,
  getNotes,
  addNote,
  deleteNote,
};
