const formatConversation = (conv) => {
  if (!conv) return null;
  const c = conv.toObject ? conv.toObject() : { ...conv };

  return {
    id: c._id,
    _id: c._id,
    waId: c.waId,
    name: c.name || "",
    phone: c.waId ? `+${c.waId}` : "",
    avatar: c.profilePicUrl || "",
    status: c.status || "open",
    unreadCount: c.unreadCount || 0,
    tags: c.tags || [],
    assignedTo: c.assignee
      ? { id: c.assignee._id || c.assignee, name: c.assignee.fullName || "" }
      : null,
    lastMessage: c.lastMessage?.text || "",
    lastMessageAt: c.lastMessage?.timestamp || c.updatedAt,
    lastMessageType: "text",
    contactId: c.contactId,
    notes: [],
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

const formatMessage = (msg) => {
  if (!msg) return null;
  const m = msg.toObject ? msg.toObject() : { ...msg };

  const media = m.media?.link
    ? {
        url: m.media.link,
        mimeType: m.media.mimeType || "",
        fileName: m.media.fileName || "",
        caption: m.media.caption || "",
      }
    : null;

  return {
    id: m._id,
    _id: m._id,
    conversationId: m.conversationId,
    waId: m.waId,
    direction: m.direction,
    type: m.messageType,
    content: m.body || "",
    messageBody: m.body || "",
    createdAt: m.timestamp || m.createdAt,
    timestamp: m.timestamp || m.createdAt,
    status: m.deliveryStatus || "sent",
    media,
    location: m.location || null,
    contact: m.contact || null,
    template: m.templateName
      ? { name: m.templateName, status: m.deliveryStatus || "sent" }
      : null,
    senderName: m.senderName || "",
    metaMessageId: m.metaMessageId,
  };
};

const formatNote = (note) => {
  if (!note) return null;
  const n = note.toObject ? note.toObject() : { ...note };

  return {
    id: n._id,
    _id: n._id,
    author: n.createdByName || "",
    content: n.content,
    createdAt: n.createdAt,
  };
};

const formatTemplate = (tpl) => {
  if (!tpl) return null;
  const t = tpl.toObject ? tpl.toObject() : { ...tpl };

  const bodyComponent = (t.components || []).find(
    (c) => c.type === "BODY" || c.type === "body"
  );

  return {
    id: t._id,
    _id: t._id,
    metaTemplateId: t.metaTemplateId,
    name: t.name,
    category: t.category,
    language: t.language,
    status: t.status,
    body: bodyComponent?.text || "",
    components: t.components || [],
    variables: extractVariables(bodyComponent?.text || ""),
    lastSyncedAt: t.updatedAt,
  };
};

const extractVariables = (text) => {
  const matches = text.match(/\{\{\d+\}\}/g) || [];
  return matches.map((_, i) => `Variable ${i + 1}`);
};

const formatCampaign = (camp) => {
  if (!camp) return null;
  const c = camp.toObject ? camp.toObject() : { ...camp };

  return {
    id: c._id,
    _id: c._id,
    name: c.name,
    templateName: c.templateName,
    status: c.status,
    audience: c.audience || `${c.recipients?.length || 0} recipients`,
    scheduledAt: c.scheduledAt,
    sent: c.stats?.sent || 0,
    delivered: c.stats?.delivered || 0,
    read: c.stats?.read || 0,
    replied: 0,
    failed: c.stats?.failed || 0,
    spend: 0,
    createdAt: c.createdAt,
    recipients: c.recipients,
    templateId: c.templateId,
  };
};

const formatOverview = (overview) => ({
  inbox: {
    open: overview.totalOpen || 0,
    unread: overview.totalUnread || 0,
    resolvedToday: overview.totalClosed || 0,
    avgFirstResponse: "-",
  },
  campaigns: {
    running: 0,
    scheduled: 0,
    deliveredRate: 0,
  },
  templates: {
    approved: 0,
    pending: 0,
  },
  wallet: {
    balance: 0,
    threshold: 5000,
  },
  totalConversations: overview.totalConversations || 0,
  recentConversations: (overview.recentConversations || []).map(formatConversation),
});

module.exports = {
  formatConversation,
  formatMessage,
  formatNote,
  formatTemplate,
  formatCampaign,
  formatOverview,
};
