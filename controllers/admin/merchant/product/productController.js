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
    const existingProduct = await Product.findOne({ productName, categoryId });
    const category = await Category.findById(categoryId).populate(
      "businessCategoryId"
    );
    const increasedPercentage =
      category?.businessCategoryId?.increasedPercentage || 5;

    if (existingProduct) {
      formattedErrors.productName = "Product already exists";
      return res.status(409).json({ errors: formattedErrors });
    }

    // Find the highest order number
    const lastCategory = await Product.findOne().sort({ order: -1 });
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

    const categories = await Category.find({ merchantId }).select("_id");

    const categoryIds = categories.map((category) => category._id);

    const products = await Product.find({
      categoryId: { $in: categoryIds },
    })
      .select("productName")
      .sort({ order: 1 });

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

    const productFound = await Product.findById(productId);

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
    const productToUpdate = await Product.findById(productId);
    const category = await Category.findById(
      productToUpdate.categoryId
    ).populate("businessCategoryId");
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
    const productToDelete = await Product.findById(req.params.productId);

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
    });

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
      .sort({ order: 1 });

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
    const category = await Category.findById(product.categoryId).populate(
      "businessCategoryId"
    );
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
      await product.save(),
      await ActivityLog.create({
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
    const category = await Category.findById(product.categoryId).populate(
      "businessCategoryId"
    );
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
      { id: "maxQuantityPerOrder", title: "Max quantity Per Order" },
      { id: "sku", title: "SKU" },
      { id: "preparationTime", title: "Preparation Time" },
      { id: "description", title: "Description" },
      { id: "longDescription", title: "Long Description" },
      { id: "productImageURL", title: "Product Image" },
      { id: "inventory", title: "Inventory" },
      { id: "availableQuantity", title: "Available quantity" },
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
  try {
    const { merchantId } = req.body;

    if (!req.file) {
      return next(appError("CSV file is required", 400));
    }

    // Upload the CSV file to Firebase and get the download URL
    const fileUrl = await uploadToFirebase(req.file, "csv-uploads");

    const categoriesMap = new Map(); // To store categories and their products

    // Download the CSV data from Firebase Storage
    const response = await axios.get(fileUrl);
    const csvData = response.data;

    // Create a readable stream from the CSV data
    const stream = Readable.from(csvData);

    const merchant = await Merchant.findById(merchantId)
      .select("merchantDetail.businessCategoryId")
      .populate("merchantDetail.businessCategoryId", "title")
      .lean();

    const businessCategoryTitles =
      merchant?.merchantDetail?.businessCategoryId?.map((cat) => cat.title);

    const categoryTypeArray = ["Veg", "Non-veg", "Both"];
    const productTypeArray = ["Veg", "Non-veg", "Other"];

    // Parse the CSV data
    stream
      .pipe(csvParser())
      .on("data", async (row) => {
        const isRowEmpty = Object.values(row).every(
          (value) => value.trim() === ""
        );

        if (!isRowEmpty) {
          const businessCategoryName = row["Business Category Name*"]?.trim();
          const categoryName = row["Category Name*"]?.trim();
          const productName = row["Product Name*"]?.trim();
          const categoryKey = `${merchantId}-${businessCategoryName}-${categoryName}`;
          const categoryType = row["Category Type*"]?.trim();
          const productType = row["Product Type*"]?.trim();

          if (!businessCategoryTitles.includes(businessCategoryName)) {
            await deleteFromFirebase(fileUrl);
            return next(
              appError(
                "One or more business categories does not match the merchant's business categories",
                400
              )
            );
          }

          if (!categoryTypeArray.includes(categoryType)) {
            await deleteFromFirebase(fileUrl);
            return next(
              appError("One or more category types are invalid", 400)
            );
          }

          if (!productTypeArray.includes(productType)) {
            await deleteFromFirebase(fileUrl);
            return next(appError("One or more product types are invalid", 400));
          }

          if (!categoriesMap.has(categoryKey)) {
            categoriesMap.set(categoryKey, {
              categoryData: {
                merchantId,
                businessCategoryName, // Ensure businessCategoryName is set correctly
                categoryName,
                type: categoryType,
                status:
                  row["Category Status*"]?.trim() === "TRUE" ||
                  row["Category Status*"]?.trim() === "true"
                    ? true
                    : false,
              },
              products: [], // Array to store products under this category
            });
          }

          // console.log(
          //   "Parsed Category Data:",
          //   categoriesMap.get(categoryKey).categoryData
          // );

          // Get the category entry from the map
          const categoryEntry = categoriesMap.get(categoryKey);

          const businessCategory = await BusinessCategory.findOne({
            title: businessCategoryName,
          });

          let increasedPercentage = 0; // Default 5% if no business category is found
          if (businessCategory) {
            increasedPercentage = businessCategory?.increasedPercentage || 5;
          }

          // Check if the product already exists in the category
          let existingProduct = categoryEntry.products.find((p) => {
            return p.productName.toLowerCase() === productName.toLowerCase();
          });

          // console.log("Existing product out", existingProduct);

          if (!existingProduct) {
            // Create a new product if it doesn't exist
            existingProduct = {
              productName,
              price: Math.round(
                req.userRole === "Merchant"
                  ? parseFloat(row["Product Cost Price*"]?.trim()) *
                      (1 + increasedPercentage / 100)
                  : row["Product Price*"]?.trim()
                  ? parseFloat(row["Product Price*"]?.trim())
                  : parseFloat(row["Product Cost Price*"]?.trim()) *
                    (1 + increasedPercentage / 100)
              ),
              minQuantityToOrder:
                parseInt(row["Min Quantity To Order"]?.trim()) || 0,
              maxQuantityPerOrder:
                parseInt(row["Max Quantity Per Order"]?.trim()) || 0,
              costPrice: parseFloat(row["Product Cost Price*"]?.trim()),
              sku: row["SKU"]?.trim() || null,
              preparationTime: row["Preparation Time"]?.trim() || "",
              description: row["Description"]?.trim() || "",
              longDescription: row["Long Description"]?.trim() || "",
              type: productType,
              inventory:
                row["Inventory"]?.trim() === "TRUE" ||
                row["Inventory"]?.trim() === "true"
                  ? true
                  : false,
              productImageURL: row["Product Image"]?.trim() || "",
              availableQuantity:
                parseInt(row["Available Quantity"]?.trim()) || 0,
              alert: parseInt(row["Alert"]?.trim()) || 0,
              variants: [], // Initialize empty variants array
            };

            // Add the new product to the category's product list
            categoryEntry.products.push(existingProduct);
            // console.log("New Product Added:", existingProduct.productName);
          }

          // Now handle the variant part
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

          if (
            variantName &&
            variantTypeName &&
            variantTypePrice !== null &&
            variantTypePrice !== undefined
          ) {
            // Check if the product already has the variant
            let existingVariant = existingProduct.variants.find(
              (v) => v.variantName.toLowerCase() === variantName.toLowerCase()
            );

            if (!existingVariant) {
              // If the variant doesn't exist, create a new one
              existingVariant = {
                variantName,
                variantTypes: [],
              };

              // Add the new variant to the product's variants array
              existingProduct.variants.push(existingVariant);
              // console.log("New Variant Added:", existingVariant);
            }

            // Add the variant type to the existing or newly created variant
            existingVariant.variantTypes.push({
              typeName: variantTypeName,
              price: variantTypePrice,
              costPrice: variantTypeCostPrice,
            });

            // console.log("Updated Variant:", existingVariant);
          }

          // console.log("Final Updated Product Data:", existingProduct);
        }
      })
      .on("end", async () => {
        try {
          for (const [
            _,
            { categoryData, products },
          ] of categoriesMap.entries()) {
            // console.log("Final Category Data to Save:", categoryData);
            // console.log("Associated Products:", products);

            // Find or create the business category using businessCategoryName
            const businessCategoryFound = await BusinessCategory.findOne({
              title: categoryData.businessCategoryName,
            });

            if (!businessCategoryFound) {
              // console.log(
              //   `Business category not found for ${categoryData.businessCategoryName}`
              // );
              continue; // Skip this category if the business category does not exist
            }

            // console.log(
            //   `Found business category: ${businessCategoryFound.title}`
            // );

            // Add business category ID to category data
            categoryData.businessCategoryId = businessCategoryFound._id;

            // Check if the category already exists
            const existingCategory = await Category.findOne({
              merchantId,
              categoryName: categoryData.categoryName,
            });
            // console.log("existingCategory", existingCategory._id)

            let newCategory;
            if (existingCategory) {
              // console.log(
              //   `Updating existing category: ${categoryData.categoryName}`
              // );
              // console.log("categoryData", categoryData)
              newCategory = await Category.findByIdAndUpdate(
                existingCategory._id,
                { $set: categoryData },
                { new: true }
              );
              // console.log("Updated Category:", newCategory._id);
            } else {
              // console.log(
              //   `Creating new category: ${categoryData.categoryName}`
              // );
              // Get the last category order
              let lastCategory = await Category.findOne().sort({ order: -1 });
              let newOrder = lastCategory ? lastCategory.order + 1 : 1;

              categoryData.order = newOrder++;
              newCategory = new Category(categoryData);
              await newCategory.save();
            }

            // Now, process products for the category
            const productPromises = products.map(async (productData) => {
              // console.log("newCategory._id", newCategory._id);
              // console.log("oldCategory._id",  productData.categoryId);
              productData.categoryId = newCategory._id;
              // console.log("newCategory._id after", productData.categoryId);
              // console.log(
              //   "Product Data to Save/Update:",
              //   productData.productName
              // );
              // console.log("productData.categoryId", productData.categoryId);
              // console.log("productData.sku", productData.sku);

              const existingProduct = await Product.findOne({
                productName: productData.productName,
                categoryId: productData.categoryId,
                sku: productData.sku,
              });
              // console.log("Existing product:", existingProduct);

              if (existingProduct) {
                // console.log(`Updating product: ${productData.productName}`);
                await Product.findByIdAndUpdate(
                  existingProduct._id,
                  { ...productData, order: existingProduct.order },
                  { new: true }
                );
              } else {
                // console.log(`Creating new product: ${productData.productName}`);
                // Get the last product order
                let lastProduct = await Product.findOne().sort({ order: -1 });
                let newOrder = lastProduct ? lastProduct.order + 1 : 1;

                productData.order = newOrder++;
                const newProduct = new Product(productData);
                await newProduct.save();
              }
            });

            await Promise.all(productPromises);
            // console.log("productPromises", productPromises)
          }

          // Fetch all categories after adding, ordered by the 'order' field in ascending order
          const allCategories = await Category.find({ merchantId })
            .select("categoryName status")
            .sort({ order: 1 });

          await ActivityLog.create({
            userId: req.userAuth,
            userType: req.userRole,
            description: `Uploaded Product CSV by ${req.userRole} (${req.userName} - ${req.userAuth})`,
          });

          // console.log("allCategories", allCategories)

          res.status(200).json({
            message: "Categories and products added successfully.",
            data: allCategories,
          });
        } catch (err) {
          // console.error("Error processing categories and products:", err);
          next(appError(err.message));
        } finally {
          // Delete the file from Firebase after processing
          await deleteFromFirebase(fileUrl);
        }
      })
      .on("error", (error) => {
        console.error("Error reading CSV data:", error);
        next(appError(error.message));
      });
  } catch (err) {
    // console.error("General error:", err);
    next(appError(err.message));
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
