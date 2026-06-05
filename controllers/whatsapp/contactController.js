const WhatsappContact = require("../../models/WhatsappContact");
const WhatsappConversation = require("../../models/WhatsappConversation");
const Customer = require("../../models/Customer");
const appError = require("../../utils/appError");
const csv = require("csv-parser");
const { Readable } = require("stream");

const getContacts = async (req, res, next) => {
  try {
    const { search = "", tag, page = 1, limit = 50 } = req.query;

    const filter = {};

    // Only apply tag filter when a specific tag is requested (not "all")
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

// ─── Get all distinct tags used by contacts ───────────────
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

// ─── Sync from Famto customers ───────────────────────────
const syncFromFamtoCustomers = async (req, res, next) => {
  try {
    // Fetch all Famto customers who have a phone number
    const customers = await Customer.find(
      { phoneNumber: { $exists: true, $ne: "" } },
      { fullName: 1, phoneNumber: 1, email: 1, _id: 0 }
    ).lean();

    if (!customers.length) {
      return res.status(200).json({
        success: true,
        message: "No Famto customers with phone numbers found",
        data: { created: 0, updated: 0, skipped: 0 },
      });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const customer of customers) {
      try {
        // Normalize phone: strip non-digits, add 91 prefix if 10 digits
        const raw = String(customer.phoneNumber).replace(/\D/g, "");
        if (!raw || raw.length < 10) { skipped++; continue; }
        const waId = raw.length === 10 ? `91${raw}` : raw;

        const name = (customer.fullName || "").trim();
        const email = (customer.email || "").trim() || undefined;

        const existing = await WhatsappContact.findOne({ waId });

        if (existing) {
          // Only update name/email if blank in WhatsApp contact
          const updates = {};
          if (!existing.name && name) updates.name = name;
          if (!existing.email && email) updates.email = email;
          if (Object.keys(updates).length) {
            await WhatsappContact.findByIdAndUpdate(existing._id, { $set: updates });
          }
          updated++;
        } else {
          await WhatsappContact.create({
            waId,
            name,
            phone: `+${waId}`,
            ...(email && { email }),
            tags: [],
          });
          created++;
        }
      } catch (rowErr) {
        skipped++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Sync complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`,
      data: { created, updated, skipped, total: customers.length },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// ─── Download sample CSV template ────────────────────────
const downloadSampleCsv = (req, res) => {
  const sample = [
    "name,phone,email,tags,notes",
    "Rahul Sharma,919876543210,rahul@example.com,vip;new,Premium customer",
    "Priya Patel,919876543211,priya@example.com,new,",
    "Amit Kumar,919876543212,,vip,",
  ].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="whatsapp_contacts_sample.csv"'
  );
  res.send(sample);
};

// ─── Import contacts from CSV ─────────────────────────────
const importContactsCsv = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(appError("CSV file is required", 400));
    }

    const results = [];
    const errors = [];

    await new Promise((resolve, reject) => {
      const readable = Readable.from(req.file.buffer);
      readable
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on("data", (row) => results.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    if (!results.length) {
      return next(appError("CSV file is empty or has no valid rows", 400));
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of results) {
      try {
        // phone is required — strip everything except digits
        const rawPhone = String(row.phone || row.phonenumber || row.mobile || "").replace(/\D/g, "");
        if (!rawPhone || rawPhone.length < 10) {
          errors.push({ row, reason: "Invalid or missing phone number" });
          skipped++;
          continue;
        }

        // Ensure country code — if 10 digits assume India (+91)
        const waId = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;

        const name = String(row.name || row.fullname || row.customer_name || "").trim();
        const email = String(row.email || "").trim() || undefined;
        const notes = String(row.notes || row.note || "").trim() || undefined;

        // tags column supports semicolon-separated values e.g. "vip;new"
        const tags = row.tags
          ? String(row.tags)
              .split(";")
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean)
          : [];

        // customFields: any extra columns beyond the known ones
        const knownKeys = ["name", "phone", "phonenumber", "mobile", "email", "tags", "notes", "note", "fullname", "customer_name"];
        const customFields = {};
        Object.entries(row).forEach(([key, value]) => {
          if (!knownKeys.includes(key) && value) {
            customFields[key.trim()] = String(value).trim();
          }
        });

        const existing = await WhatsappContact.findOne({ waId });

        if (existing) {
          // Update — merge tags, keep existing name if new one is blank
          const mergedTags = [...new Set([...existing.tags, ...tags])];
          await WhatsappContact.findByIdAndUpdate(existing._id, {
            $set: {
              name: name || existing.name,
              ...(email && { email }),
              ...(notes && { notes }),
              tags: mergedTags,
              ...(Object.keys(customFields).length && { customFields }),
            },
          });
          updated++;
        } else {
          await WhatsappContact.create({
            waId,
            name,
            phone: `+${waId}`,
            ...(email && { email }),
            ...(notes && { notes }),
            tags,
            ...(Object.keys(customFields).length && { customFields }),
          });
          created++;
        }
      } catch (rowErr) {
        errors.push({ row, reason: rowErr.message });
        skipped++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Import complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`,
      data: { created, updated, skipped, errors: errors.slice(0, 20) },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getContacts,
  getContactTags,
  syncContacts,
  syncFromFamtoCustomers,
  updateContact,
  downloadSampleCsv,
  importContactsCsv,
};
