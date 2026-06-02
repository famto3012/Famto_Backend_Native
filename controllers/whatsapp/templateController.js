const WhatsappTemplate = require("../../models/WhatsappTemplate");
const appError = require("../../utils/appError");
const {
  fetchMetaTemplates,
  createMetaTemplate,
  updateMetaTemplate,
} = require("../../utils/whatsappApi");
const { formatTemplate } = require("../../utils/whatsappFormatters");

const getTemplates = async (req, res, next) => {
  try {
    const { status, category, search } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.name = { $regex: search, $options: "i" };

    const templates = await WhatsappTemplate.find(filter)
      .sort({ updatedAt: -1 })
      .lean();


    console.log(templates);
    res.status(200).json({ success: true, data: templates.map(formatTemplate) });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const syncTemplates = async (req, res, next) => {
  try {
    const metaTemplates = await fetchMetaTemplates();

    let created = 0;
    let updated = 0;

    for (const tpl of metaTemplates) {
      const existing = await WhatsappTemplate.findOne({
        metaTemplateId: tpl.id,
      });

      const templateData = {
        metaTemplateId: tpl.id,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        status: tpl.status,
        components: tpl.components || [],
        rejectedReason: tpl.rejected_reason || "",
      };

      if (existing) {
        await WhatsappTemplate.findByIdAndUpdate(existing._id, {
          $set: templateData,
        });
        updated++;
      } else {
        await WhatsappTemplate.create(templateData);
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

const createTemplate = async (req, res, next) => {
  try {
    const { name, language = "en_US", category, components = [] } = req.body;

    if (!name || !category) {
      return next(appError("Name and category are required", 400));
    }

    const metaResponse = await createMetaTemplate({
      name,
      language,
      category,
      components,
    });

    const template = await WhatsappTemplate.create({
      metaTemplateId: metaResponse.id,
      name,
      language,
      category,
      status: metaResponse.status || "PENDING",
      components,
    });

    res.status(201).json({ success: true, data: formatTemplate(template) });
  } catch (err) {
    const metaError =
      err.response?.data?.error?.message || err.message;
    next(appError(metaError, err.response?.status || 500));
  }
};

const updateTemplate = async (req, res, next) => {
  try {
    const { templateId } = req.params;
    const { components = [] } = req.body;

    const template = await WhatsappTemplate.findById(templateId);
    if (!template) {
      return next(appError("Template not found", 404));
    }

    if (!template.metaTemplateId) {
      return next(appError("Template has no Meta ID, cannot update", 400));
    }

    await updateMetaTemplate(template.metaTemplateId, { components });

    template.components = components;
    await template.save();

    res.status(200).json({ success: true, data: formatTemplate(template) });
  } catch (err) {
    const metaError =
      err.response?.data?.error?.message || err.message;
    next(appError(metaError, err.response?.status || 500));
  }
};

module.exports = {
  getTemplates,
  syncTemplates,
  createTemplate,
  updateTemplate,
};
