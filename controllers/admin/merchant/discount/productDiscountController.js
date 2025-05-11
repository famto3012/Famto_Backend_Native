const { validationResult } = require("express-validator");
const ProductDiscount = require("../../../../models/ProductDiscount");
const appError = require("../../../../utils/appError");
const Product = require("../../../../models/Product");
const { formatDate } = require("../../../../utils/formatters");

// =====================================
// ===============Merchant==============
// =====================================
const addProductDiscountController = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.param] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const {
      discountName,
      maxAmount,
      discountType,
      discountValue,
      description,
      productId,
      validFrom,
      validTo,
      geofenceId,
      onAddOn,
    } = req.body;

    const merchantId = req.userAuth;

    const existingDiscounts = await ProductDiscount.find({
      merchantId,
      productId: { $in: productId },
    });

    if (existingDiscounts.length > 0) {
      const conflictingProductIds = existingDiscounts
        .flatMap((discount) => discount.productId)
        .filter((id) => productId.includes(id.toString()));

      const conflictingProducts = await Product.find({
        _id: { $in: conflictingProductIds },
      }).select("productName");

      const conflictingProductNames = conflictingProducts.map(
        (product) => product.productName
      );

      return res.status(400).json({
        success: false,
        message: "Some products are already associated with another discount",
        conflictingProducts: conflictingProductNames,
      });
    }

    const discount = await ProductDiscount.create({
      discountName,
      maxAmount,
      discountType,
      discountValue,
      description,
      validFrom,
      validTo,
      geofenceId,
      merchantId,
      productId,
      onAddOn,
    });

    await Product.updateMany(
      { _id: { $in: productId } },
      { discountId: discount._id }
    );

    const populatedDiscount = await ProductDiscount.findById(discount._id)
      .populate("productId", "productName")
      .populate("geofenceId", "name");

    const formattedResponse = {
      discountId: populatedDiscount._id,
      discountName: populatedDiscount.discountName,
      value:
        discount.discountType === "Percentage-discount"
          ? `${discount.discountValue} %`
          : `₹ ${discount.discountValue}`,
      products: populatedDiscount.productId.map(
        (product) => product.productName
      ),
      validFrom: formatDate(populatedDiscount.validFrom),
      validTo: formatDate(populatedDiscount.validTo),
      geofence: populatedDiscount.geofenceId?.name || null,
      status: populatedDiscount.status,
    };

    res.status(201).json({
      success: true,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editProductDiscountController = async (req, res, next) => {
  try {
    const { id } = req.params;

    let existingDiscount = await ProductDiscount.findById(id);
    if (!existingDiscount) return next(appError("Discount not found", 404));

    const {
      discountName,
      maxAmount,
      discountType,
      discountValue,
      description,
      validFrom,
      validTo,
      geofenceId,
      merchantId,
      productId,
      onAddOn,
    } = req.body;

    // ✅ Check for conflicting product IDs
    const conflictingDiscounts = await ProductDiscount.find({
      _id: { $ne: id }, // Exclude the current discount
      merchantId,
      productId: { $in: productId },
    });

    if (conflictingDiscounts.length > 0) {
      // Extract conflicting product IDs
      const conflictingProductIds = conflictingDiscounts
        .flatMap((discount) => discount.productId)
        .filter((prodId) => productId.includes(prodId.toString()));

      // Fetch product names for conflicting product IDs
      const conflictingProducts = await Product.find({
        _id: { $in: conflictingProductIds },
      }).select("productName");

      const conflictingProductNames = conflictingProducts.map(
        (product) => product.productName
      );

      console.log({ conflictingProductNames });

      return res.status(400).json({
        success: false,
        message: "Some products are already associated with another discount",
        conflictingProducts: conflictingProductNames,
      });
    }

    const removedProductIds = existingDiscount.productId.filter(
      (prodId) => !productId.includes(prodId.toString())
    );

    if (removedProductIds.length > 0) {
      await Product.updateMany(
        { _id: { $in: removedProductIds } },
        { $set: { discountId: null } }
      );
    }

    existingDiscount = await ProductDiscount.findByIdAndUpdate(
      id,
      {
        discountName,
        maxAmount,
        discountType,
        discountValue,
        description,
        validFrom,
        validTo,
        geofenceId,
        merchantId,
        productId,
        onAddOn,
      },
      { new: true }
    )
      .populate("geofenceId", "name")
      .populate("productId", "productName");

    await Product.updateMany(
      { _id: { $in: productId } },
      { discountId: existingDiscount._id }
    );

    const formattedResponse = {
      discountId: existingDiscount._id,
      discountName: existingDiscount.discountName,
      value:
        existingDiscount.discountType === "Percentage-discount"
          ? `${existingDiscount.discountValue} %`
          : `₹ ${existingDiscount.discountValue}`,
      products: existingDiscount.productId.map(
        (product) => product.productName
      ),
      validFrom: formatDate(existingDiscount.validFrom),
      validTo: formatDate(existingDiscount.validTo),
      geofence: existingDiscount.geofenceId?.name || null,
      status: existingDiscount.status,
    };

    res.status(200).json({
      success: true,
      message: "Product Discount updated successfully",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const deleteProductDiscountController = async (req, res, next) => {
  try {
    const { id } = req.params;

    const discount = await ProductDiscount.findById(id);
    if (!discount) return next(appError("Discount not found", 404));

    await Promise.all([
      Product.updateMany({ discountId: id }, { discountId: null }),
      ProductDiscount.findByIdAndDelete(id),
    ]);

    res.status(200).json({
      success: "Product Discount deleted successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAllProductDiscountController = async (req, res, next) => {
  try {
    const merchantId = req.userAuth;

    const discounts = await ProductDiscount.find({ merchantId })
      .populate("geofenceId", "name")
      .populate("productId", "productName");

    const formattedResponse = discounts?.map((discount) => ({
      discountId: discount._id,
      discountName: discount.discountName,
      value:
        discount.discountType === "Percentage-discount"
          ? `${discount.discountValue} %`
          : `₹ ${discount.discountValue}`,
      products: discount.productId.map((product) => product.productName),
      validFrom: formatDate(discount.validFrom),
      validTo: formatDate(discount.validTo),
      geofence: discount.geofenceId?.name || null,
      status: discount.status,
      onAddOn: discount.onAddOn,
      productId: discount.productId.map((product) => product._id),
      geofenceId: discount.geofenceId?._id || null,
      maxAmount: discount.maxAmount,
      discountType: discount.discountType,
    }));

    res.status(200).json({
      success: "true",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateProductDiscountStatusController = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updateDiscount = await ProductDiscount.findOne({ _id: id });

    if (!updateDiscount) return next(appError("Discount not found", 404));

    updateDiscount.status = !updateDiscount.status;

    await updateDiscount.save();

    res.status(200).json({
      success: true,
      message: "Product Discount status updated successfully!",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getProductDiscountByIdController = async (req, res, next) => {
  try {
    const { id } = req.params;

    const discount = await ProductDiscount.findById(id);

    if (!discount) return next(appError("Discount not found", 404));

    const formattedResponse = {
      discountId: discount._id,
      discountName: discount.discountName,
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      maxAmount: discount.maxAmount,
      productId: discount.productId.map((product) => product._id),
      validFrom: discount.validFrom,
      validTo: discount.validTo,
      geofenceId: discount.geofenceId?._id || null,
      status: discount.status,
      onAddOn: discount.onAddOn,
      merchantId: discount.merchantId,
    };

    res.status(200).json({
      success: true,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// =======================================
// =================Admin=================
// =======================================
const addProductDiscountAdminController = async (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.param] = error.msg;
      return acc;
    }, {});
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const {
      discountName,
      maxAmount,
      discountType,
      discountValue,
      description,
      validFrom,
      validTo,
      geofenceId,
      merchantId,
      productId,
      onAddOn,
    } = req.body;

    const existingDiscounts = await ProductDiscount.find({
      merchantId,
      productId: { $in: productId },
    });

    if (existingDiscounts.length > 0) {
      const conflictingProductIds = existingDiscounts
        .flatMap((discount) => discount.productId)
        .filter((id) => productId.includes(id.toString()));

      const conflictingProducts = await Product.find({
        _id: { $in: conflictingProductIds },
      }).select("productName");

      const conflictingProductNames = conflictingProducts.map(
        (product) => product.productName
      );

      return res.status(400).json({
        success: false,
        message: "Some products are already associated with another discount",
        conflictingProducts: conflictingProductNames,
      });
    }

    const discount = await ProductDiscount.create({
      discountName,
      maxAmount,
      discountType,
      discountValue,
      description,
      validFrom,
      validTo,
      geofenceId,
      merchantId,
      productId,
      onAddOn,
    });

    await Product.updateMany(
      { _id: { $in: productId } },
      { discountId: discount._id }
    );

    const populatedDiscount = await ProductDiscount.findById(discount._id)
      .populate("productId", "productName")
      .populate("geofenceId", "name");

    const formattedResponse = {
      discountId: populatedDiscount._id,
      discountName: populatedDiscount.discountName,
      value:
        discount.discountType === "Percentage-discount"
          ? `${discount.discountValue} %`
          : `₹ ${discount.discountValue}`,
      products: populatedDiscount.productId.map(
        (product) => product.productName
      ),
      validFrom: formatDate(populatedDiscount.validFrom),
      validTo: formatDate(populatedDiscount.validTo),
      geofence: populatedDiscount.geofenceId?.name || null,
      status: populatedDiscount.status,
    };

    res.status(201).json({
      success: true,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAllProductDiscountAdminController = async (req, res, next) => {
  try {
    const { id } = req.params;

    const discounts = await ProductDiscount.find({
      merchantId: id,
    })
      .populate("geofenceId", "name")
      .populate("productId", "productName");

    const formattedResponse = discounts?.map((discount) => ({
      discountId: discount._id,
      discountName: discount.discountName,
      value:
        discount.discountType === "Percentage-discount"
          ? `${discount.discountValue} %`
          : `₹ ${discount.discountValue}`,
      products: discount.productId.map((product) => product.productName),
      validFrom: formatDate(discount.validFrom),
      validTo: formatDate(discount.validTo),
      geofence: discount.geofenceId?.name || null,
      status: discount.status,
      onAddOn: discount.onAddOn,
    }));

    res.status(200).json({
      success: true,
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addProductDiscountController,
  editProductDiscountController,
  deleteProductDiscountController,
  getAllProductDiscountController,
  updateProductDiscountStatusController,
  addProductDiscountAdminController,
  getProductDiscountByIdController,
  getAllProductDiscountAdminController,
};
