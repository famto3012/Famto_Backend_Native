const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappConversation = require("../../models/WhatsappConversation");
const appError = require("../../utils/appError");

const getContacts = async (req, res, next) => {
  try {
    const { search = "", tag, page = 1, limit = 50 } = req.query;

    const filter = {};

    if (tag) filter.tags = { $in: tag.split(",") };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { waId: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [contacts, total] = await Promise.all([
      WhatsappContact.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      WhatsappContact.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: contacts,
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

const syncContacts = async (req, res, next) => {
  try {
    const conversations = await WhatsappConversation.find().lean();

    let created = 0;
    let updated = 0;

    for (const conv of conversations) {
      const existing = await WhatsappContact.findOne({ waId: conv.waId });

      if (existing) {
        existing.name = conv.name || existing.name;
        existing.conversationId = conv._id;
        existing.lastContactedAt = conv.lastMessage?.timestamp;
        await existing.save();
        updated++;
      } else {
        await WhatsappContact.create({
          waId: conv.waId,
          name: conv.name || "",
          phone: `+${conv.waId}`,
          conversationId: conv._id,
          lastContactedAt: conv.lastMessage?.timestamp,
        });
        created++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Sync complete. Created: ${created}, Updated: ${updated}`,
      data: { created, updated },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateContact = async (req, res, next) => {
  try {
    const { contactId } = req.params;
    const { name, email, tags, notes, customFields } = req.body;

    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (tags !== undefined) update.tags = tags;
    if (notes !== undefined) update.notes = notes;
    if (customFields !== undefined) update.customFields = customFields;

    const contact = await WhatsappContact.findByIdAndUpdate(
      contactId,
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!contact) {
      return next(appError("Contact not found", 404));
    }

    // Keep conversation name in sync
    if (name !== undefined && contact.conversationId) {
      await WhatsappConversation.findByIdAndUpdate(contact.conversationId, {
        $set: { name },
      });
    }

    res.status(200).json({ success: true, data: contact });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getContacts,
  syncContacts,
  updateContact,
};
