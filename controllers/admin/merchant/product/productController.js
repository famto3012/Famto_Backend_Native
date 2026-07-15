const { validationResult } = require("express-validator");
const axios = require("axios");
const { Readable } = require("stream");
const csvParser = require("csv-parser");
const path = require("path");
const csvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");

const Product = require("../../../../models/Product");
const Category = require("../../../../models/Category");
const BusinessCategory = require("../../../../models/BusinessCategory");
const ActivityLog = require("../../../../models/ActivityLog");
const Merchant = require("../../../../models/Merchant");

const appError = require("../../../../utils/appError");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../../../utils/imageOperation");

// ------------------------------------------------------
// ----------------For Merchant and Admin----------------
// ------------------------------------------------------

const addProductController = async (req, res, next) => {
  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.param] = error.msg;
    });

    return res.status(400).json({ errors: formattedErrors });
  }

  const {
    categoryId,
    productName,
    price: initialPrice,
    minQuantityToOrder,
    maxQuantityPerOrder,
    costPrice,
    sku,
    discountId,
    oftenBoughtTogetherId = [],
    preparationTime,
    searchTags,
    description,
    longDescription,
    type,
    availableQuantity,
    alert,
  } = req.body;

  try {
    const existingProduct = await Product.findOne({ productName, categoryId }).lean();
    const category = await Category.findById(categoryId)
      .populate("businessCategoryId")
      .lean();
    const increasedPercentage =
      category?.businessCategoryId?.increasedPercentage || 5;

    if (existingProduct) {
      formattedErrors.productName = "Product already exists";
      return res.status(409).json({ errors: formattedErrors });
    }

    // Find the highest order number
    const lastCategory = await Product.findOne().sort({ order: -1 }).lean();
    const newOrder = lastCategory ? lastCategory.order + 1 : 1;

    // Determine the price based on user role
    let price = Math.round(initialPrice);
    req.userRole === "Merchant"
      ? (price = Math.round(costPrice * (1 + increasedPercentage / 100)))
      : price != 0
      ? price
      : (price = Math.round(costPrice * (1 + increasedPercentage / 100)));

    let productImageURL = "";
    if (req.file)
      productImageURL = await uploadToFirebase(req.file, "ProductImages");

    const newProduct = await Product.create({
      categoryId,
      productName,
      price,
      minQuantityToOrder,
      maxQuantityPerOrder,
      costPrice,
      sku,
      discountId: discountId || null,
      oftenBoughtTogetherId,
      preparationTime,
      searchTags,
      description,
      longDescription,
      type,
      availableQuantity,
      alert,
      productImageURL,
      order: newOrder,
    });

    if (!newProduct)
      return next(appError("Error in creating new Product", 500));

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `New product (${productName}) is created by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(201).json({
      message: "Product added successfully",
      data: newProduct,
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const getAllProductsByMerchant = async (req, res) => {
  try {
    const { merchantId } = req.params;

    const categories = await Category.find({ merchantId }).select("_id").lean();

    const categoryIds = categories.map((category) => category._id);

    const products = await Product.find({
      categoryId: { $in: categoryIds },
    })
      .select("productName")
      .sort({ order: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(appError(err.message));
  }
};

const getProductController = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const productFound = await Product.findById(productId).lean();

    if (!productFound) return next(appError("Product not found", 404));

    res.status(200).json({ message: "Product data", data: productFound });
  } catch (err) {
    next(appError(err.message));
  }
};

const editProductController = async (req, res, next) => {
  const {
    productName,
    productStatus,
    price: initialPrice,
    minQuantityToOrder,
    maxQuantityPerOrder,
    costPrice,
    sku,
    discountId,
    oftenBoughtTogetherId = [],
    preparationTime,
    searchTags,
    description,
    longDescription,
    type,
    variantStatus,
    availableQuantity,
    alert,
  } = req.body;

  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(400).json({ errors: formattedErrors });
  }

  try {
    const { productId } = req.params;
    const productToUpdate = await Product.findById(productId).lean();
    const category = await Category.findById(productToUpdate.categoryId)
      .populate("businessCategoryId")
      .lean();
    const increasedPercentage =
      category?.businessCategoryId?.increasedPercentage || 5;

    if (!productToUpdate) {
      return next(appError("Product not found", 404));
    }

    let productImageURL = productToUpdate?.productImageURL;
    if (req.file) {
      if (productImageURL) {
        await deleteFromFirebase(productImageURL);
      }
      productImageURL = await uploadToFirebase(req.file, "ProductImages");
    }

    // Determine the price based on user role
    let price = Math.round(initialPrice);
    if (costPrice) {
      if (req.userRole === "Merchant") {
        price = Math.round(costPrice * (1 + increasedPercentage / 100));
      } else {
        // If role is not Merchant, check if price is non-zero; otherwise, apply the same logic
        price =
          productToUpdate?.price != price
            ? price
            : Math.round(costPrice * (1 + increasedPercentage / 100));
      }
    }

    const product = await Product.findByIdAndUpdate(
      productId,
      {
        productName: productName || null,
        productStatus: productStatus || null,
        price: price || null,
        minQuantityToOrder: minQuantityToOrder || null,
        maxQuantityPerOrder: maxQuantityPerOrder || null,
        costPrice: costPrice || null,
        sku: sku || null,
        discountId: discountId === "null" ? null : discountId,
        oftenBoughtTogetherId: oftenBoughtTogetherId || null,
        preparationTime: preparationTime || null,
        searchTags: searchTags || null,
        description: description || null,
        longDescription: longDescription || null,
        type: type || null,
        productImageURL: productImageURL || null,
        variantStatus: variantStatus || null,
        availableQuantity: availableQuantity || null,
        alert: alert || null,
      },
      { new: true }
    );

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Product (${productName}) is updated by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({
      message: "Product updated successfully",
      data: product,
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const deleteProductController = async (req, res, next) => {
  try {
    const productToDelete = await Product.findById(req.params.productId).lean();

    if (!productToDelete) {
      return next(appError("Product not found", 404));
    }

    let productImageURL = productToDelete.productImageURL;

    if (productImageURL) {
      await deleteFromFirebase(productImageURL);
    }

    await Product.findByIdAndDelete(req.params.productId);

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Product (${productToDelete.productName}) is deleted by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const searchProductController = async (req, res, next) => {
  try {
    const { query } = req.query;

    const searchTerm = query.trim();

    const searchResults = await Product.find({
      $or: [
        { productName: { $regex: searchTerm, $options: "i" } },
        { searchTags: { $regex: searchTerm, $options: "i" } },
      ],
    }).lean();

    res.status(200).json({
      message: "Searched product results",
      data: searchResults,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getProductByCategoryController = async (req, res, next) => {
  try {
    const categoryId = req.params.categoryId;

    const productsByCategory = await Product.find({
      categoryId: categoryId,
    })
      .select("productName inventory")
      .sort({ order: 1 })
      .lean();

    res.status(200).json({
      message: "Products By category",
      data: productsByCategory,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const changeProductCategoryController = async (req, res, next) => {
  try {
    const { categoryId, productId } = req.params;

    const productFound = await Product.findById(productId);

    if (!productFound) {
      return next(appError("Product not found", 404));
    }

    productFound.categoryId = categoryId;
    await productFound.save();

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Changed category of product (${productFound.productName}) by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({ message: "Product category changed" });
  } catch (err) {
    next(appError(err.message));
  }
};

const changeInventoryStatusController = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const productFound = await Product.findById(productId);

    if (!productFound) {
      return next(appError("Product not found", 404));
    }

    productFound.inventory = !productFound.inventory;
    await productFound.save();

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Changed inventory status of product (${productFound.productName}) by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({ message: "Product inventory status changed" });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateProductOrderController = async (req, res, next) => {
  const { products } = req.body;

  try {
    for (const product of products) {
      await Product.findByIdAndUpdate(product.id, {
        order: product.order,
      });
    }

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Product orders are updated by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({ message: "Product order updated successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// -----------------------------------------
// -----------------Variants----------------
// -----------------------------------------

const addVariantToProductController = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { variantName, variantTypes } = req.body;

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const formattedErrors = errors.array().reduce((acc, error) => {
        acc[error.param] = error.msg;
        return acc;
      }, {});
      return res.status(400).json({ errors: formattedErrors });
    }

    // Find the product by ID
    const product = await Product.findById(productId);
    if (!product) {
      return next(appError("Product not found", 404));
    }
    const category = await Category.findById(product.categoryId)
      .populate("businessCategoryId")
      .lean();
    const increasedPercentage =
      category?.businessCategoryId?.increasedPercentage || 5;

    // Adjust prices for variant types if user role is merchant
    const updatedVariantTypes = variantTypes.map((variant) => {
      let price = Math.round(variant.price);

      req.userRole === "Merchant"
        ? (price = Math.round(
            variant.costPrice * (1 + increasedPercentage / 100)
          ))
        : price != 0
        ? price
        : (price = Math.round(
            variant.costPrice * (1 + increasedPercentage / 100)
          ));

      return {
        ...variant,
        price,
      };
    });

    // Create new variant object
    const newVariant = {
      variantName,
      variantTypes: updatedVariantTypes,
    };

    // Add the new variant to the product's variants array
    product.variants.push(newVariant);

    await Promise.all([
      product.save(),
      ActivityLog.create({
        userId: req.userAuth,
        userType: req.userRole,
        description: `Variants added to product (${product.productName}) by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      }),
    ]);

    res.status(201).json({
      message: "Variant added successfully",
      data: product,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editVariantController = async (req, res, next) => {
  try {
    const { productId, variantId } = req.params;
    const { variantName, variantTypes } = req.body;

    const product = await Product.findById(productId);
    if (!product) return next(appError("Product not found", 404));
    const category = await Category.findById(product.categoryId)
      .populate("businessCategoryId")
      .lean();
    const increasedPercentage =
      category?.businessCategoryId?.increasedPercentage || 5;

    const variant = product.variants.id(variantId);
    if (!variant) return next(appError("Variant not found", 404));

    // Update variant name
    variant.variantName = variantName;

    // Check if user is a merchant and modify variantTypes price accordingly
    if (req.userRole === "Merchant") {
      variant.variantTypes = variantTypes.map((variant) => {
        let price = Math.round(variant.price);

        if (req.userRole === "Merchant" && variant.costPrice)
          price = Math.round(
            variant.costPrice * (1 + increasedPercentage / 100)
          );

        return {
          ...variant,
          price,
        };
      });
    } else {
      const variantTypePresent = variant.variantTypes;

      variant.variantTypes = variantTypes.map((variant) => {
        let price = Math.round(variant.price); // Default price

        // Find matching variant in variantTypePresent
        const existingVariant = variantTypePresent?.find(
          (v) => v.price === variant.price
        );

        // If found, keep variant.price; otherwise, calculate dynamically
        price = !existingVariant
          ? Math.round(variant.costPrice * (1 + increasedPercentage / 100))
          : variant.price;

        return {
          ...variant,
          price,
        };
      });
    }

    await Promise.all([
      product.save(),
      ActivityLog.create({
        userId: req.userAuth,
        userType: req.userRole,
        description: `Variants of product (${product.productName}) were edited by ${req.userRole} (${req.userName} - ${req.userAuth})`,
      }),
    ]);

    res.status(200).json({
      message: "Variant updated successfully",
      data: {
        productId: product._id,
        variant: variant,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const deleteVariantTypeController = async (req, res, next) => {
  try {
    const { productId, variantId, variantTypeId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return next(appError("Product not found", 404));
    }

    const variant = product.variants.id(variantId);
    if (!variant) {
      return next(appError("Variant not found", 404));
    }

    const variantTypeIndex = variant.variantTypes.findIndex(
      (vt) => vt._id.toString() === variantTypeId
    );
    if (variantTypeIndex === -1) {
      return next(appError("Variant type not found", 404));
    }

    // If the variant has only one variant type, delete the entire variant
    if (variant.variantTypes.length === 1) {
      product.variants.pull(variantId);
    } else {
      // Otherwise, just delete the specified variant type
      variant.variantTypes.splice(variantTypeIndex, 1);
    }

    await product.save();

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Variants of product (${product.productName}) is deleted by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({
      message: "Variant type deleted successfully",
      data: product,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const downloadProductSampleCSVController = async (req, res, next) => {
  try {
    // Define the path to your sample CSV file
    const filePath = path.join(__dirname, "../../../../Product_sample.csv");

    // Define the headers and data for the CSV
    const csvHeaders = [
      { id: "businessCategoryName", title: "Business Category Name*" },
      { id: "categoryName", title: "Category Name*" },
      { id: "categoryType", title: "Category Type*" },
      { id: "productName", title: "Product Name*" },
      { id: "productCostPrice", title: "Product Cost Price*" },
      { id: "productType", title: "Product Type*" },
      { id: "minQuantityToOrder", title: "Min Quantity To Order" },
      { id: "maxQuantityPerOrder", title: "Max Quantity Per Order" },
      { id: "sku", title: "SKU" },
      { id: "preparationTime", title: "Preparation Time" },
      { id: "description", title: "Description" },
      { id: "longDescription", title: "Long Description" },
      { id: "availableQuantity", title: "Available Quantity" },
      { id: "alert", title: "Alert" },
      { id: "variantName", title: "Variant Name" },
      { id: "typeName", title: "Variant Type Name" },
      { id: "variantTypeCostPrice", title: "Variant Type Cost Price" },
    ];

    if (req.userRole === "Admin") {
      csvHeaders.splice(4, 0, { id: "productPrice", title: "Product Price*" }); // Insert at position 4
      csvHeaders.push({ id: "variantTypePrice", title: "Variant Type Price" });
    }

    const csvData = [
      {
        businessCategoryName: "Business category",
        categoryName: "Category 1",
        categoryType: "Veg / Non-veg / Both",
        status: "TRUE / FALSE",
        productName: "Product 1",
        productPrice: "100",
        productCostPrice: "100",
        productType: "Veg / Non-veg / Other",
        minQuantityToOrder: "1",
        maxQuantityPerOrder: "20",
        sku: "SKU12345",
        preparationTime: "30",
        description: "Description",
        longDescription: "Long Description",
        availableQuantity: "20",
        alert: "10",
        variantName: "Size",
        typeName: "Medium",
        variantTypePrice: "150",
        variantTypeCostPrice: "100",
      },
      {
        businessCategoryName: "Business category",
        categoryName: "Category 2",
        categoryType: "Veg / Non-veg / Both",
        status: "TRUE / FALSE",
        productName: "Product 2",
        productPrice: "200",
        productCostPrice: "200",
        productType: "Veg / Non-veg / Other",
        minQuantityToOrder: "1",
        maxQuantityPerOrder: "20",
        sku: "SKU12345",
        preparationTime: "30",
        description: "Description",
        longDescription: "Long Description",
        availableQuantity: "20",
        alert: "10",
        variantName: "Size",
        typeName: "Medium",
        variantTypePrice: "150",
        variantTypeCostPrice: "100",
      },
    ];

    // Create a new CSV writer
    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    // Write the data to the CSV file
    await writer.writeRecords(csvData);

    // Send the CSV file as a response for download
    res.download(filePath, "Product_sample.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("File deletion error:", unlinkErr);
          }
        });
      }
    });
  } catch (error) {
    res.status(500).send("Error processing the CSV file");
  }
};

const downloadCobminedProductAndCategoryController = async (req, res, next) => {
  try {
    const { merchantId } = req.body;

    // Find all categories and related products for the given merchant
    const categories = await Category.find({ merchantId })
      .populate("businessCategoryId", "title")
      .lean();

    const formattedResponse = [];

    for (const category of categories) {
      const products = await Product.find({ categoryId: category._id }).lean();

      products.forEach((product) => {
        const variants =
          product.variants.length > 0
            ? product.variants
            : [
                {
                  variantName: null,
                  variantTypes: [{ typeName: null, price: null }],
                },
              ];

        variants.forEach((variant) => {
          const variantTypes =
            variant.variantTypes.length > 0
              ? variant.variantTypes
              : [{ typeName: null, price: null }];

          variantTypes.forEach((type) => {
            formattedResponse.push({
              businessCategory: category.businessCategoryId?.title || null,
              categoryName: category.categoryName || null,
              categoryType: category.type || null,
              categoryStatus: category.status || null,
              productName: product.productName || null,
              productPrice: product.price || null,
              minQuantityToOrder: product.minQuantityToOrder || null,
              maxQuantityPerOrder: product.maxQuantityPerOrder || null,
              productCostPrice: product.costPrice || null,
              sku: product.sku || null,
              preparationTime: product.preparationTime || null,
              description: product.description || null,
              longDescription: product.longDescription || null,
              type: product.type || null,
              productImageURL: product.productImageURL || null,
              inventory: product.inventory || null,
              availableQuantity: product.availableQuantity || null,
              alert: product.alert || null,
              variantName: variant.variantName || null,
              typeName: type.typeName || null,
              variantTypePrice: type.price || null,
              variantTypeCostPrice: type.costPrice || null,
            });
          });
        });
      });
    }

    const filePath = path.join(__dirname, "../../../../Product_Data.csv");

    const csvHeaders = [
      { id: "businessCategory", title: "Business Category Name*" },
      { id: "categoryName", title: "Category Name*" },
      { id: "categoryType", title: "Category Type*" },
      { id: "categoryStatus", title: "Category Status*" },
      { id: "productName", title: "Product Name*" },
      { id: "productCostPrice", title: "Product Cost Price*" },
      { id: "type", title: "Product Type*" },
      { id: "minQuantityToOrder", title: "Min Quantity To Order" },
      { id: "maxQuantityPerOrder", title: "Max Quantity Per Order" },
      { id: "sku", title: "SKU" },
      { id: "preparationTime", title: "Preparation Time" },
      { id: "description", title: "Description" },
      { id: "longDescription", title: "Long Description" },
      { id: "productImageURL", title: "Product Image" },
      { id: "inventory", title: "Inventory" },
      { id: "availableQuantity", title: "Available Quantity" },
      { id: "alert", title: "Alert" },
      { id: "variantName", title: "Variant Name" },
      { id: "typeName", title: "Variant Type Name" },
      { id: "variantTypeCostPrice", title: "Variant Type Cost Price" },
    ];

    if (req.userRole === "Admin") {
      csvHeaders.splice(4, 0, { id: "productPrice", title: "Product Price*" }); // Insert at position 4
      csvHeaders.push({ id: "variantTypePrice", title: "Variant Type Price" });
    }

    const writer = csvWriter({
      path: filePath,
      header: csvHeaders,
    });

    await writer.writeRecords(formattedResponse);

    // Add UTF-8 BOM to the CSV file
    const bom = "\uFEFF"; // BOM character
    const csvContent = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, bom + csvContent, { encoding: "utf8" });

    res.status(200).download(filePath, "Combined_Product_Data.csv", (err) => {
      if (err) {
        next(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("File deletion error:", unlinkErr);
          }
        });
      }
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const addCategoryAndProductsFromCSVController = async (req, res, next) => {
  let fileUrl = null;

  try {
    const { merchantId } = req.body;

    // ── 1. Input validation ──
    if (!merchantId) {
      return next(appError("Merchant ID is required", 400));
    }

    if (!req.file) {
      return next(appError("CSV file is required", 400));
    }

    // ── 2. Upload CSV to Firebase ──
    fileUrl = await uploadToFirebase(req.file, "csv-uploads");

    // ── 3. Fetch merchant + validate ──
    const merchant = await Merchant.findById(merchantId)
      .select("merchantDetail.businessCategoryId")
      .populate("merchantDetail.businessCategoryId", "title")
      .lean();

    if (!merchant) {
      return next(appError("Merchant not found", 404));
    }

    const businessCategoryTitles =
      merchant?.merchantDetail?.businessCategoryId?.map((cat) => cat.title) ||
      [];

    if (businessCategoryTitles.length === 0) {
      return next(
        appError("Merchant has no business categories assigned", 400)
      );
    }

    // ── 4. Download CSV from Firebase ──
    const response = await axios.get(fileUrl, { responseType: "text" });
    let csvData = response.data;

    // Strip UTF-8 BOM if present (exported CSVs include BOM)
    if (typeof csvData === "string" && csvData.charCodeAt(0) === 0xfeff) {
      csvData = csvData.slice(1);
    }

    // ── 5. Parse CSV into raw rows using a promise wrapper ──
    const rawRows = await new Promise((resolve, reject) => {
      const rows = [];
      const stream = Readable.from(csvData);

      stream
        .pipe(csvParser())
        .on("data", (row) => {
          const isRowEmpty = Object.values(row).every(
            (val) => val.trim() === ""
          );
          if (!isRowEmpty) rows.push(row);
        })
        .on("end", () => resolve(rows))
        .on("error", (err) => reject(err));
    });

    if (rawRows.length === 0) {
      return next(appError("CSV file is empty or has no valid rows", 400));
    }

    // ── 6. Pre-fetch all business categories in one query (cached) ──
    const uniqueBusinessCatNames = [
      ...new Set(
        rawRows
          .map((r) => r["Business Category Name*"]?.trim())
          .filter(Boolean)
      ),
    ];

    const businessCategories = await BusinessCategory.find({
      title: { $in: uniqueBusinessCatNames },
    }).lean();

    const businessCategoryMap = new Map(
      businessCategories.map((bc) => [bc.title, bc])
    );

    // ── 7. Validate ALL rows first (no DB writes until validation passes) ──
    const VALID_CATEGORY_TYPES = new Set(["Veg", "Non-veg", "Both"]);
    const VALID_PRODUCT_TYPES = new Set(["Veg", "Non-veg", "Other"]);
    const categoriesMap = new Map();
    const errors = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2; // +2 because row 1 is headers, data starts at 2

      const businessCategoryName = row["Business Category Name*"]?.trim();
      const categoryName = row["Category Name*"]?.trim();
      const productName = row["Product Name*"]?.trim();
      const categoryType = row["Category Type*"]?.trim();
      const productType = row["Product Type*"]?.trim();
      const rawCostPrice = parseFloat(row["Product Cost Price*"]?.trim());

      // Required field checks
      if (!businessCategoryName) {
        errors.push(`Row ${rowNum}: Business Category Name is required`);
        continue;
      }
      if (!categoryName) {
        errors.push(`Row ${rowNum}: Category Name is required`);
        continue;
      }
      if (!productName) {
        errors.push(`Row ${rowNum}: Product Name is required`);
        continue;
      }

      // Business category must match merchant's categories
      if (!businessCategoryTitles.includes(businessCategoryName)) {
        errors.push(
          `Row ${rowNum}: Business category "${businessCategoryName}" does not match merchant's categories`
        );
        continue;
      }

      // Business category must exist in DB
      if (!businessCategoryMap.has(businessCategoryName)) {
        errors.push(
          `Row ${rowNum}: Business category "${businessCategoryName}" not found in database`
        );
        continue;
      }

      if (!VALID_CATEGORY_TYPES.has(categoryType)) {
        errors.push(
          `Row ${rowNum}: Invalid category type "${categoryType}". Must be Veg, Non-veg, or Both`
        );
        continue;
      }

      if (!VALID_PRODUCT_TYPES.has(productType)) {
        errors.push(
          `Row ${rowNum}: Invalid product type "${productType}". Must be Veg, Non-veg, or Other`
        );
        continue;
      }

      if (isNaN(rawCostPrice) || rawCostPrice < 0) {
        errors.push(
          `Row ${rowNum}: Product "${productName}" has invalid or missing cost price`
        );
        continue;
      }

      // ── Build categoriesMap (in-memory grouping) ──
      const categoryKey = `${businessCategoryName}||${categoryName}`;
      const businessCategory = businessCategoryMap.get(businessCategoryName);
      const increasedPercentage = businessCategory?.increasedPercentage || 5;

      if (!categoriesMap.has(categoryKey)) {
        categoriesMap.set(categoryKey, {
          categoryData: {
            merchantId,
            businessCategoryId: businessCategory._id,
            categoryName,
            type: categoryType,
            status:
              row["Category Status*"]?.trim()?.toUpperCase() === "TRUE",
          },
          products: new Map(), // Map<productKey, productData> for O(1) lookup
        });
      }

      const categoryEntry = categoriesMap.get(categoryKey);

      // Compute price
      const rawPrice = parseFloat(row["Product Price*"]?.trim());
      const calculatedPrice = Math.round(
        req.userRole === "Merchant"
          ? rawCostPrice * (1 + increasedPercentage / 100)
          : !isNaN(rawPrice)
          ? rawPrice
          : rawCostPrice * (1 + increasedPercentage / 100)
      );

      // Handle "Max quantity Per Order" vs "Max Quantity Per Order" (case mismatch in download CSV)
      const maxQty =
        parseInt(row["Max Quantity Per Order"]?.trim()) ||
        parseInt(row["Max quantity Per Order"]?.trim()) ||
        0;

      const productKey = productName.toLowerCase();

      if (!categoryEntry.products.has(productKey)) {
        categoryEntry.products.set(productKey, {
          productName,
          price: calculatedPrice,
          minQuantityToOrder:
            parseInt(row["Min Quantity To Order"]?.trim()) || 0,
          maxQuantityPerOrder: maxQty,
          costPrice: rawCostPrice,
          sku: row["SKU"]?.trim() || null,
          preparationTime: row["Preparation Time"]?.trim() || "",
          description: row["Description"]?.trim() || "",
          longDescription: row["Long Description"]?.trim() || "",
          type: productType,
          inventory:
            row["Inventory"]?.trim()?.toUpperCase() === "TRUE",
          productImageURL: row["Product Image"]?.trim() || "",
          availableQuantity:
            parseInt(row["Available Quantity"]?.trim()) || 0,
          alert: parseInt(row["Alert"]?.trim()) || 0,
          variants: [], // will hold { variantName, variantTypes: [] }
        });
      }

      // ── Variant handling ──
      const variantName = row["Variant Name"]?.trim();
      const variantTypeName = row["Variant Type Name"]?.trim();
      const variantTypeCostPrice = parseFloat(
        row["Variant Type Cost Price"]?.trim()
      );
      const variantTypePrice = Math.round(
        req.userRole === "Merchant"
          ? variantTypeCostPrice * (1 + increasedPercentage / 100)
          : row["Variant Type Price"]?.trim()
          ? parseFloat(row["Variant Type Price"]?.trim())
          : variantTypeCostPrice * (1 + increasedPercentage / 100)
      );

      if (variantName && variantTypeName && !isNaN(variantTypePrice)) {
        const productData = categoryEntry.products.get(productKey);
        const variantKey = variantName.toLowerCase();
        let existingVariant = productData.variants.find(
          (v) => v.variantName.toLowerCase() === variantKey
        );

        if (!existingVariant) {
          existingVariant = { variantName, variantTypes: [] };
          productData.variants.push(existingVariant);
        }

        existingVariant.variantTypes.push({
          typeName: variantTypeName,
          price: variantTypePrice,
          costPrice: isNaN(variantTypeCostPrice) ? 0 : variantTypeCostPrice,
        });
      }
    }

    // Return first 20 validation errors if any
    if (errors.length > 0) {
      const errorMsg =
        errors.length <= 20
          ? errors.join("; ")
          : errors.slice(0, 20).join("; ") +
            `... and ${errors.length - 20} more errors`;
      return next(appError(errorMsg, 400));
    }

    // ── 8. Fetch existing categories for this merchant in one query ──
    const allCategoryNames = [
      ...new Set(
        [...categoriesMap.values()].map((e) => e.categoryData.categoryName)
      ),
    ];

    const existingCategories = await Category.find({
      merchantId,
      categoryName: { $in: allCategoryNames },
    }).lean();

    const existingCategoryMap = new Map(
      existingCategories.map((c) => [c.categoryName, c])
    );

    // Get the current max order for categories and products (one query each)
    const [lastCategoryDoc, lastProductDoc] = await Promise.all([
      Category.findOne().sort({ order: -1 }).select("order").lean(),
      Product.findOne().sort({ order: -1 }).select("order").lean(),
    ]);

    let nextCategoryOrder = lastCategoryDoc ? lastCategoryDoc.order + 1 : 1;
    let nextProductOrder = lastProductDoc ? lastProductDoc.order + 1 : 1;

    // ── 9. Save categories (sequential — usually small count) ──
    const categoryIdMap = new Map(); // categoryKey → ObjectId

    for (const [categoryKey, { categoryData }] of categoriesMap.entries()) {
      // Remove the temp field before saving
      const saveData = { ...categoryData };
      delete saveData.businessCategoryName;

      const existing = existingCategoryMap.get(categoryData.categoryName);

      if (existing) {
        await Category.findByIdAndUpdate(
          existing._id,
          { $set: saveData },
          { new: true }
        );
        categoryIdMap.set(categoryKey, existing._id);
      } else {
        saveData.order = nextCategoryOrder++;
        const newCategory = await Category.create(saveData);
        categoryIdMap.set(categoryKey, newCategory._id);
        // Add to map so duplicate category names in CSV don't create duplicates
        existingCategoryMap.set(categoryData.categoryName, newCategory);
      }
    }

    // ── 10. Batch fetch existing products for all categories at once ──
    const categoryIds = [...categoryIdMap.values()];

    const existingProducts = await Product.find({
      categoryId: { $in: categoryIds },
    })
      .select("productName categoryId sku order")
      .lean();

    // Build lookup: "categoryId|productName_lower" → existingProduct
    // For products with SKU, also index by "categoryId|productName_lower|sku"
    const existingProductMap = new Map();
    for (const p of existingProducts) {
      const baseKey = `${p.categoryId}|${p.productName.toLowerCase()}`;
      if (p.sku) {
        existingProductMap.set(`${baseKey}|${p.sku}`, p);
      } else {
        existingProductMap.set(baseKey, p);
      }
    }

    // ── 11. Build bulkWrite operations in batches ──
    const BULK_BATCH_SIZE = 500;
    const bulkOps = [];

    for (const [categoryKey, { products }] of categoriesMap.entries()) {
      const categoryId = categoryIdMap.get(categoryKey);

      for (const [, productData] of products) {
        productData.categoryId = categoryId;

        const baseKey = `${categoryId}|${productData.productName.toLowerCase()}`;
        const skuKey = productData.sku ? `${baseKey}|${productData.sku}` : null;

        const existing =
          (skuKey && existingProductMap.get(skuKey)) ||
          existingProductMap.get(baseKey);

        if (existing) {
          // Update existing product — preserve order
          bulkOps.push({
            updateOne: {
              filter: { _id: existing._id },
              update: {
                $set: {
                  productName: productData.productName,
                  price: productData.price,
                  costPrice: productData.costPrice,
                  minQuantityToOrder: productData.minQuantityToOrder,
                  maxQuantityPerOrder: productData.maxQuantityPerOrder,
                  sku: productData.sku,
                  preparationTime: productData.preparationTime,
                  description: productData.description,
                  longDescription: productData.longDescription,
                  type: productData.type,
                  inventory: productData.inventory,
                  productImageURL: productData.productImageURL,
                  availableQuantity: productData.availableQuantity,
                  alert: productData.alert,
                  categoryId: productData.categoryId,
                  variants: productData.variants,
                },
              },
            },
          });
        } else {
          // Insert new product with incremented order
          productData.order = nextProductOrder++;

          bulkOps.push({
            insertOne: {
              document: productData,
            },
          });
        }
      }
    }

    // Execute bulkWrite in batches to avoid memory spike on 20k+ products
    if (bulkOps.length > 0) {
      for (let i = 0; i < bulkOps.length; i += BULK_BATCH_SIZE) {
        const batch = bulkOps.slice(i, i + BULK_BATCH_SIZE);
        await Product.bulkWrite(batch, { ordered: false });
      }
    }

    // ── 12. Response ──
    const allCategories = await Category.find({ merchantId })
      .select("categoryName status")
      .sort({ order: 1 })
      .lean();

    await ActivityLog.create({
      userId: req.userAuth,
      userType: req.userRole,
      description: `Uploaded Product CSV (${rawRows.length} rows) by ${req.userRole} (${req.userName} - ${req.userAuth})`,
    });

    res.status(200).json({
      message: `Categories and products added successfully. Processed ${rawRows.length} rows.`,
      data: allCategories,
    });
  } catch (err) {
    next(appError(err.message));
  } finally {
    // Always clean up Firebase file — safe if already deleted or null
    if (fileUrl) {
      try {
        await deleteFromFirebase(fileUrl);
      } catch (_) {
        // Ignore — file may already be deleted or never uploaded
      }
    }
  }
};

module.exports = {
  getProductController,
  getAllProductsByMerchant,
  addProductController,
  editProductController,
  deleteProductController,
  addVariantToProductController,
  editVariantController,
  deleteVariantTypeController,
  searchProductController,
  getProductByCategoryController,
  changeProductCategoryController,
  changeInventoryStatusController,
  updateProductOrderController,
  downloadProductSampleCSVController,
  downloadCobminedProductAndCategoryController,
  addCategoryAndProductsFromCSVController,
};
