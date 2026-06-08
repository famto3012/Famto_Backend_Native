const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappConversation = require("../../models/WhatsappConversation");
const Customer = require("../../models/Customer");
const appError = require("../../utils/appError");
const csvParser = require("csv-parser");
const stream = require("stream");

const getContacts = async (req, res, next) => {
  try {
    const { search = "", tag, page = 1, limit = 50 } = req.query;

    const filter = {};

    // Fix: "all" means no tag filter
    if (tag && tag !== "all") filter.tags = { $in: tag.split(",") };
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

// ─── New Functions ────────────────────────────────────────

const getContactTags = async (req, res, next) => {
  try {
    const tags = await WhatsappContact.aggregate([
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, id: "$_id", label: "$_id", count: 1 } },
    ]);
    res.status(200).json({ success: true, data: tags });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const syncFromFamtoCustomers = async (req, res, next) => {
  try {
    const customers = await Customer.find({ isBlocked: false })
      .select("_id fullName phoneNumber")
      .lean();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const cust of customers) {
      const phone = String(cust.phoneNumber || "").replace(/\D/g, "");
      if (!phone) {
        skipped++;
        continue;
      }
      const waId = phone.startsWith("91") ? phone : `91${phone}`;

      const result = await WhatsappContact.findOneAndUpdate(
        { waId },
        {
          $setOnInsert: {
            waId,
            phone: `+${waId}`,
            tags: ["famto-customer"],
          },
          $set: {
            name: cust.fullName || "",
            customFields: { famtoId: cust._id.toString() },
          },
        },
        { upsert: true, new: true, rawResult: true }
      );

      result.lastErrorObject?.updatedExisting ? updated++ : created++;
    }

    res.status(200).json({
      success: true,
      message: `Sync done. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`,
      data: { created, updated, skipped },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const downloadSampleCsv = (req, res) => {
  const content = [
    "name,phone,email,tags",
    'John Doe,919876543210,john@example.com,"vip,new"',
    "Jane Smith,919812345678,,regular",
    "Ravi Kumar,917890123456,ravi@example.com,famto-customer",
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="whatsapp_contacts_sample.csv"'
  );
  res.send(content);
};

const importContactsCsv = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(appError("No CSV file uploaded", 400));
    }

    const rows = [];
    await new Promise((resolve, reject) => {
      const readable = new stream.PassThrough();
      readable.end(req.file.buffer);
      readable
        .pipe(csvParser())
        .on("data", (row) => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    let created = 0;
    let updated = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const phone = String(row.phone || row.Phone || "").replace(/\D/g, "");
        if (!phone) {
          errors.push(`Row skipped: missing phone (name: ${row.name || row.Name || "unknown"})`);
          continue;
        }

        const waId = phone.startsWith("91") ? phone : `91${phone}`;
        const tags = (row.tags || row.Tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        const result = await WhatsappContact.findOneAndUpdate(
          { waId },
          {
            $setOnInsert: { waId, phone: `+${waId}` },
            $set: {
              name: row.name || row.Name || "",
              email: row.email || row.Email || "",
              ...(tags.length ? { tags } : {}),
            },
          },
          { upsert: true, new: true, rawResult: true }
        );

        result.lastErrorObject?.updatedExisting ? updated++ : created++;
      } catch (e) {
        errors.push(e.message);
      }
    }

    res.status(200).json({
      success: true,
      message: `Import done. Created: ${created}, Updated: ${updated}`,
      data: { created, updated, errors },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getContacts,
  syncContacts,
  updateContact,
  getContactTags,
  syncFromFamtoCustomers,
  downloadSampleCsv,
  importContactsCsv,
};
