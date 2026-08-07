const WhatsappConversation = require("../models/WhatsappConversation");
const WhatsappContact = require("../models/WhatsappContact");

// Merchant-scoped contact sync: rebuilds WhatsappContact from a merchant's
// conversations. `connection` must be a WhatsappConnection (used only to
// scope by merchantId; phoneNumber is the contact fallback).
const syncContacts = async (connection) => {
  const merchantId = connection.merchantId;

  const conversations = await WhatsappConversation.find({
    merchantId,
  }).lean();

  let created = 0;
  let updated = 0;

  for (const conv of conversations) {
    const existing = await WhatsappContact.findOne({
      waId: conv.waId,
      merchantId,
    });

    if (existing) {
      existing.name = conv.name || existing.name;
      existing.conversationId = conv._id;
      existing.lastContactedAt = conv.lastMessage?.timestamp;
      await existing.save();
      updated++;
    } else {
      await WhatsappContact.create({
        waId: conv.waId,
        merchantId,
        name: conv.name || "",
        phone: `+${conv.waId}`,
        conversationId: conv._id,
        lastContactedAt: conv.lastMessage?.timestamp,
      });
      created++;
    }
  }

  return { created, updated };
};

module.exports = { syncContacts };
