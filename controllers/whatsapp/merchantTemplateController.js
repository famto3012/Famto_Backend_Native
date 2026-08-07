const WhatsappTemplate = require("../../models/WhatsappTemplate");
const WhatsappConnection = require("../../models/WhatsappConnection");
const appError = require("../../utils/appError");
const {
  fetchMetaTemplates,
  createMetaTemplate,
  updateMetaTemplate,
} = require("../../utils/whatsappApi");

const getMerchantTemplates = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const templates = await WhatsappTemplate.find({ merchantId })
      .sort({ updatedAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: templates });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const syncMerchantTemplates = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    // Resolve merchant's connection
    const connection = await WhatsappConnection.findOne({
      merchantId,
      status: "Active",
    }).lean();
    if (!connection) {
      return next(appError("No active WhatsApp connection. Please connect your number first.", 400));
    }

    const metaTemplates = await fetchMetaTemplates(connection);
    let synced = 0;

    for (const metaTpl of metaTemplates) {
      await WhatsappTemplate.findOneAndUpdate(
        { metaTemplateId: metaTpl.id, merchantId },
        {
          $set: {
            name: metaTpl.name,
            language: metaTpl.language,
            category: metaTpl.category,
            status: metaTpl.status,
            components: metaTpl.components,
            rejectedReason: metaTpl.rejected_reason || "",
            merchantId,
          },
        },
        { upsert: true, new: true }
      );
      synced++;
    }

    res.status(200).json({ success: true, message: `Synced ${synced} templates`, data: { synced } });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const createMerchantTemplate = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    // Resolve merchant's connection
    const connection = await WhatsappConnection.findOne({
      merchantId,
      status: "Active",
    }).lean();
    if (!connection) {
      return next(appError("No active WhatsApp connection. Please connect your number first.", 400));
    }

    const { name, language = "en_US", category, components } = req.body;

    if (!name || !category || !components?.length) {
      return next(appError("Name, category, and components are required", 400));
    }

    const metaResponse = await createMetaTemplate(
      { name, language, category, components },
      connection
    );

    const template = await WhatsappTemplate.create({
      metaTemplateId: metaResponse.id,
      name,
      language,
      category,
      status: metaResponse.status || "PENDING",
      components,
      merchantId,
    });

    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateMerchantTemplate = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { templateId } = req.params;
    const { name, language, category, components } = req.body;

    // Resolve merchant's connection
    const connection = await WhatsappConnection.findOne({
      merchantId,
      status: "Active",
    }).lean();
    if (!connection) {
      return next(appError("No active WhatsApp connection. Please connect your number first.", 400));
    }

    const template = await WhatsappTemplate.findOne({ _id: templateId, merchantId });
    if (!template) {
      return next(appError("Template not found", 404));
    }

    if (!template.metaTemplateId) {
      return next(appError("Cannot update locally-created template (no Meta ID)", 400));
    }

    const metaResponse = await updateMetaTemplate(
      template.metaTemplateId,
      { name, language, category, components },
      connection
    );

    template.name = name || template.name;
    template.language = language || template.language;
    template.category = category || template.category;
    template.status = metaResponse.status || template.status;
    template.components = components || template.components;
    template.rejectedReason = metaResponse.rejected_reason || "";
    await template.save();

    res.status(200).json({ success: true, data: template });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantTemplates,
  syncMerchantTemplates,
  createMerchantTemplate,
  updateMerchantTemplate,
};