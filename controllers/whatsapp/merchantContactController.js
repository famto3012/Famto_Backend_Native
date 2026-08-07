const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappConversation = require("../../models/WhatsappConversation");
const appError = require("../../utils/appError");
const {
  syncContacts,
} = require("../../utils/whatsappContactSync");

const getMerchantContacts = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { search = "", tag, page = 1, limit = 50 } = req.query;

    const filter = { merchantId };
    if (tag && tag !== "all") filter.tags = { $in: tag.split(",") };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { waId: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [contacts, total] = await Promise.all([
      WhatsappContact.find(filter)
        .sort({ lastContactedAt: -1, name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      WhatsappContact.countDocuments(filter),
    ]);

    const nextPage = skip + parseInt(limit) < total ? parseInt(page) + 1 : null;

    res.status(200).json({
      success: true,
      data: { items: contacts, nextPage, total },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const syncMerchantContacts = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    // Resolve merchant's connection
    const WhatsappConnection = require("../../models/WhatsappConnection");
    const connection = await WhatsappConnection.findOne({
      merchantId,
      status: "Active",
    }).lean();
    if (!connection) {
      return next(appError("No active WhatsApp connection. Please connect your number first.", 400));
    }

    const { syncContacts } = require("../../utils/whatsappContactSync");
    const result = await syncContacts(connection);

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateMerchantContact = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { contactId } = req.params;
    const { name, tags, notes, customFields } = req.body;

    const update = {};
    if (name !== undefined) update.name = name;
    if (tags !== undefined) update.tags = tags;
    if (notes !== undefined) update.notes = notes;
    if (customFields !== undefined) update.customFields = customFields;

    const contact = await WhatsappContact.findOneAndUpdate(
      { _id: contactId, merchantId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!contact) {
      return next(appError("Contact not found", 404));
    }

    res.status(200).json({ success: true, data: contact });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantContacts,
  syncMerchantContacts,
  updateMerchantContact,
};