const { validationResult } = require("express-validator");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Customer = require("../../models/Customer");
const PromoCode = require("../../models/PromoCode");
const Order = require("../../models/Order");
const Agent = require("../../models/Agent");
const CustomerSubscription = require("../../models/CustomerSubscription");
const CustomerAppCustomization = require("../../models/CustomerAppCustomization");
const PickAndDropBanner = require("../../models/PickAndDropBanner");
const CustomOrderBanner = require("../../models/CustomOrderBanner");
const ServiceCategory = require("../../models/ServiceCategory");
const ReferralCode = require("../../models/ReferralCode");
const NotificationSetting = require("../../models/NotificationSetting");
const CustomerNotificationLogs = require("../../models/CustomerNotificationLog");
const AppBanner = require("../../models/AppBanner");
const CustomerCart = require("../../models/CustomerCart");
const Referral = require("../../models/Referral");
const ScheduledOrder = require("../../models/ScheduledOrder");
const scheduledPickAndCustom = require("../../models/ScheduledPickAndCustom");
const LoyaltyPoint = require("../../models/LoyaltyPoint");
const Banner = require("../../models/Banner");
const PickAndCustomCart = require("../../models/PickAndCustomCart");
const Merchant = require("../../models/Merchant");
const Product = require("../../models/Product");
const Category = require("../../models/Category");
const CustomerTransaction = require("../../models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("../../models/CustomerWalletTransaction");

const appError = require("../../utils/appError");
const generateToken = require("../../utils/generateToken");
const { geoLocation } = require("../../utils/getGeoLocation");
const {
  deleteFromFirebase,
  uploadToFirebase,
} = require("../../utils/imageOperation");
const {
  completeReferralDetail,
  calculateScheduledCartValue,
  calculatePromoCodeDiscount,
  deductPromoCodeDiscount,
  applyPromoCodeDiscount,
} = require("../../utils/customerAppHelpers");
const {
  createRazorpayOrderId,
  verifyPayment,
} = require("../../utils/razorpayPayment");
const { formatDate, formatTime } = require("../../utils/formatters");

const { sendNotification, sendSocketData } = require("../../socket/socket");
const Task = require("../../models/Task");

// Register or login customer
const registerAndLoginController = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().reduce((acc, error) => {
      acc[error.path] = error.msg;
      return acc;
    }, {});
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const { phoneNumber, latitude, longitude, referralCode, platform } =
      req.body;
    const location = [latitude, longitude];
    const geofence = await geoLocation(latitude, longitude, next);

    // Check if customer exists; if not, create a new one
    let customer = await Customer.findOne({ phoneNumber });

    const isNewCustomer = !customer;
    if (!customer) {
      customer = await Customer.create({
        phoneNumber,
        lastPlatformUsed: platform ? platform : "Not recognized",
        customerDetails: {
          location,
          geofenceId: geofence?._id ? geofence?._id : null,
        },
      });
    } else {
      customer.lastPlatformUsed = platform ? platform : "Web";

      customer.customerDetails = {
        ...customer.customerDetails,
        location,
        geofenceId: geofence?._id ? geofence?._id : null,
      };
    }

    if (customer.customerDetails.isBlocked) {
      return res.status(403).json({ message: "Account is Blocked" });
    }

    if (isNewCustomer) {
      if (referralCode) await completeReferralDetail(customer, referralCode);

      const notification = await NotificationSetting.findOne({
        event: "newCustomer",
      });
      if (notification) {
        const eventData = {
          title: notification.title,
          description: notification.description,
        };
        sendNotification(
          process.env.ADMIN_ID,
          "newCustomer",
          eventData,
          "Customer"
        );
        sendSocketData(process.env.ADMIN_ID, "newCustomer", eventData);
      }
    }

    const refreshToken = generateToken(
      customer?._id,
      customer?.role,
      customer?.fullName ? customer?.fullName : "",
      "30d"
    );
    const token = generateToken(
      customer?.id,
      customer?.role,
      customer?.fullName ? customer?.fullName : "",
      "2hr"
    );

    customer.refreshToken = refreshToken;

    await customer.save();

    res.status(200).json({
      success: `User ${isNewCustomer ? "created" : "logged in"} successfully`,
      id: customer?.id,
      token,
      refreshToken: refreshToken,
      role: customer?.role,
      geofenceName: geofence?.name,
      outsideGeofence: geofence?._id ? false : true,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Set selected geofence
const setSelectedGeofence = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    const geofence = await geoLocation(latitude, longitude, next);

    if (!geofence) {
      return next(appError("Selected location is outside our geofence", 400));
    }

    const customerFound = await Customer.findById(req.userAuth);

    if (!customerFound) return next(appError("Customer not found", 404));

    customerFound.customerDetails.geofenceId = geofence._id;

    await customerFound.save();

    res.status(200).json({
      success: true,
      message: "Geofence saved successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const verifyCustomerAddressLocation = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;

    const geofence = await geoLocation(latitude, longitude, next);

    res.status(200).json({ success: geofence ? true : false });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get the profile details of customer
const getCustomerProfileController = async (req, res, next) => {
  try {
    const currentCustomer = await Customer.findById(req.userAuth).select(
      "fullName phoneNumber email customerDetails.customerImageURL"
    );

    if (!currentCustomer) return next(appError("Customer not found", 404));

    const formattedCustomer = {
      customerId: currentCustomer._id,
      fullName: currentCustomer.fullName || "",
      imageURL: currentCustomer?.customerDetails?.customerImageURL || "",
      email: currentCustomer.email || "",
      phoneNumber: currentCustomer.phoneNumber,
    };

    res.status(200).json(formattedCustomer);
  } catch (err) {
    next(appError(err.message));
  }
};

// Update profile details of customer
const updateCustomerProfileController = async (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      errors: errors.array().reduce((acc, error) => {
        acc[error.path] = error.msg;
        return acc;
      }, {}),
    });
  }

  try {
    const { fullName, email } = req.body;
    const normalizedEmail = email?.toLowerCase();
    const currentCustomer = await Customer.findById(req.userAuth);

    if (!currentCustomer) return next(appError("Customer not found", 404));

    // Check if the new email is already in use by another user, only if email is provided
    if (normalizedEmail && normalizedEmail !== currentCustomer.email) {
      const emailExists = await Customer.exists({
        _id: { $ne: req.userAuth },
        email: normalizedEmail,
      });
      if (emailExists) {
        return res.status(409).json({
          errors: { email: "Email already exists" },
        });
      }
    }

    // Handle image update if provided
    let customerImageURL =
      currentCustomer?.customerDetails?.customerImageURL || "";

    if (req.file) {
      if (customerImageURL) await deleteFromFirebase(customerImageURL);
      customerImageURL = await uploadToFirebase(req.file, "CustomerImages");
    }

    // Prepare updates
    const updates = {
      ...(fullName && { fullName }),
      ...(normalizedEmail && { email: normalizedEmail }),
      "customerDetails.customerImageURL": customerImageURL,
    };

    // Update customer
    await Customer.findByIdAndUpdate(req.userAuth, updates, { new: true });

    // Update Referral Code if necessary
    if (fullName || normalizedEmail) {
      await ReferralCode.findOneAndUpdate(
        { customerId: req.userAuth },
        {
          ...(fullName && { name: fullName }),
          ...(normalizedEmail && { email: normalizedEmail }),
        },
        { new: true }
      );
    }

    res.status(200).json({ success: true });
  } catch (err) {
    next(appError(err.message));
  }
};

// Update customer address details
const updateCustomerAddressController = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      errors: errors.array().map((error) => ({ [error.path]: error.msg })),
    });
  }

  try {
    const {
      type,
      fullName,
      phoneNumber,
      flat,
      area,
      landmark,
      coordinates,
      id,
    } = req.body;

    const currentCustomer = await Customer.findById(req.userAuth);

    if (!currentCustomer) return next(appError("Customer not found", 404));
    if (!type) return next(appError("Address type is required", 400));

    const { customerDetails } = currentCustomer;

    // Helper function to remove address
    const removeAddress = () => {
      switch (type) {
        case "home":
          customerDetails.homeAddress = null;
          break;
        case "work":
          customerDetails.workAddress = null;
          break;
        case "other":
          customerDetails.otherAddress = customerDetails.otherAddress.filter(
            (addr) => addr.id.toString() !== id?.toString()
          );
          break;
      }
    };

    // If type exists but coordinates & flat are missing, delete the address
    if (!coordinates && !flat) {
      removeAddress();
      await currentCustomer.save();
      return res.status(200).json({ success: true, address: null });
    }

    const address = {
      id: id || new mongoose.Types.ObjectId(),
      type,
      fullName,
      phoneNumber,
      flat,
      area,
      landmark,
      coordinates,
    };
    let updatedAddress = address;

    switch (type) {
      case "home":
        customerDetails.homeAddress = address;
        break;
      case "work":
        customerDetails.workAddress = address;
        break;
      case "other":
        if (id) {
          const index = customerDetails.otherAddress.findIndex(
            (addr) => addr.id.toString() === id.toString()
          );
          if (index !== -1) {
            customerDetails.otherAddress[index] = address;
          } else {
            return next(appError("Address ID not found", 404));
          }
        } else {
          customerDetails.otherAddress.push(address);
        }
        break;
      default:
        return next(appError("Invalid address type", 400));
    }

    await currentCustomer.save();
    res.status(200).json({ success: true, address: updatedAddress });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get the address details of customer
const getCustomerAddressController = async (req, res, next) => {
  try {
    const currentCustomer = await Customer.findById(req.userAuth);

    if (!currentCustomer) return next(appError("Customer not found", 404));

    const { homeAddress, workAddress, otherAddress } =
      currentCustomer.customerDetails;

    // Ensure only actual object properties are used
    const formatAddress = (type, address) =>
      address
        ? { type, ...address.toObject() } // Convert Mongoose document to plain object
        : null;

    const formattedHomeAddress = formatAddress("home", homeAddress);
    const formattedWorkAddress = formatAddress("work", workAddress);
    const formattedOtherAddress = (otherAddress || [])
      .map((address) => formatAddress("other", address))
      .filter(Boolean); // Remove any null values

    res.status(200).json({
      homeAddress: formattedHomeAddress,
      workAddress: formattedWorkAddress,
      otherAddress: formattedOtherAddress,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Adding money to wallet
const addWalletBalanceController = async (req, res, next) => {
  try {
    const { amount } = req.body;

    const { success, orderId } = await createRazorpayOrderId(amount);

    if (!success)
      return next(appError("Error in creating Razorpay order", 500));

    res.status(200).json({ success: true, orderId, amount });
  } catch (err) {
    next(appError(err.message));
  }
};

// Verifying adding money to wallet
const verifyWalletRechargeController = async (req, res, next) => {
  try {
    const { paymentDetails, amount } = req.body;
    const customerId = req.userAuth;

    const customer = await Customer.findById(customerId);
    if (!customer) return next(appError("Customer not found", 404));

    const parsedAmount = parseFloat(amount);

    const isPaymentValid = await verifyPayment(paymentDetails);
    if (!isPaymentValid) return next(appError("Invalid payment", 400));

    let walletTransaction = {
      customerId,
      closingBalance: customer?.customerDetails?.walletBalance || 0,
      transactionAmount: parsedAmount,
      transactionId: paymentDetails.razorpay_payment_id,
      date: new Date(),
      type: "Credit",
    };

    // Ensure walletBalance is initialized
    customer.customerDetails.walletBalance =
      parseFloat(customer?.customerDetails?.walletBalance) || 0;
    customer.customerDetails.walletBalance += parsedAmount;

    await Promise.all([
      customer.save(),
      CustomerTransaction.create({
        customerId,
        madeOn: new Date(),
        transactionType: "Top-up",
        transactionAmount: parsedAmount,
        type: "Credit",
      }),
      CustomerWalletTransaction.create(walletTransaction),
    ]);

    res.status(200).json({ message: "Wallet recharged successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Rate agent with Order
const rateDeliveryAgentController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;

    const { orderId } = req.params;

    const { rating, review } = req.body;

    const orderFound = await Order.findById(orderId);

    if (!orderFound) return next(appError("Order not found", 404));

    const agentFound = await Agent.findById(orderFound.agentId);

    if (!agentFound) return next(appError("Agent not found", 404));

    let updatedRating = {
      review,
      rating,
    };

    // Initialize orderRating if it doesn't exist
    if (!orderFound.orderRating) orderFound.orderRating = {};

    orderFound.orderRating.ratingToDeliveryAgent = updatedRating;

    let updatedAgentRating = {
      customerId: currentCustomer,
      review,
      rating,
    };

    agentFound.ratingsByCustomers.push(updatedAgentRating);

    await Promise.all([orderFound.save(), agentFound.save()]);

    res.status(200).json({ message: "Agent rated successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get favorite merchants
// const getFavoriteMerchantsController = async (req, res, next) => {
//   try {
//     const currentCustomer = req.userAuth;
//     // Retrieving only necessary fields for customer and their favorite merchants
//     const customer = await Customer.findById(currentCustomer)
//       .select("customerDetails.favoriteMerchants")
//       .populate({
//         path: "customerDetails.favoriteMerchants.merchantId",
//       })
//       .populate({
//         path: "customerDetails.favoriteMerchants.businessCategoryId",
//         select: "title",
//       });

//     if (!customer || !customer.customerDetails) {
//       return next(appError("Customer details not found", 404));
//     }

//     // Map the favorite merchants into the desired format
//     const formattedMerchants = customer.customerDetails.favoriteMerchants.map(
//       (merchant) => ({
//         id: merchant?.merchantId?._id,
//         merchantName:
//           merchant?.merchantId?.merchantDetail?.merchantName || null,
//         description: merchant?.merchantId?.merchantDetail?.description || null,
//         averageRating: merchant?.merchantId?.merchantDetail?.averageRating,
//         status: merchant?.merchantId?.status,
//         restaurantType:
//           merchant?.merchantId?.merchantDetail?.merchantFoodType || null,
//         merchantImageURL:
//           merchant?.merchantId?.merchantDetail?.merchantImageURL ||
//           "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FMerchantDefaultImage.png?alt=media&token=a7a11e18-047c-43d9-89e3-8e35d0a4e231",
//         displayAddress:
//           merchant?.merchantId?.merchantDetail?.displayAddress || null,
//         preOrderStatus: merchant?.merchantId?.merchantDetail?.preOrderStatus,
//         isFavorite: true,
//         businessCategoryId: merchant?.businessCategoryId?.id,
//         businessCategoryName: merchant?.businessCategoryId?.title,
//       })
//     );

//     res.status(200).json({
//       success: true,
//       data: formattedMerchants,
//     });
//   } catch (err) {
//     next(appError(err.message));
//   }
// };

const getFavoriteMerchantsController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;
    // Retrieving only necessary fields for customer and their favorite merchants
    const customer = await Customer.findById(currentCustomer)
      .select("customerDetails.favoriteMerchants")
      .populate({
        path: "customerDetails.favoriteMerchants.merchantId",
      })
      .populate({
        path: "customerDetails.favoriteMerchants.businessCategoryId",
        select: "title",
      });

    if (!customer || !customer.customerDetails) {
      return next(appError("Customer details not found", 404));
    }

    // Map the favorite merchants into the desired format
    const formattedMerchants = customer.customerDetails.favoriteMerchants.map(
      (merchant) => {
        // Determine redirectable based on specific conditions
        const redirectable = !!(
          merchant?.merchantId?.merchantDetail?.pricing?.[0] &&
          merchant?.merchantId?.merchantDetail?.pricing?.[0]?.modelType &&
          merchant?.merchantId?.merchantDetail?.pricing?.[0]?.modelId &&
          merchant?.merchantId?.merchantDetail?.location?.length > 0 &&
          !merchant?.merchantId?.isBlocked &&
          merchant?.merchantId?.isApproved === "Approved"
        );

        return {
          id: merchant?.merchantId?._id,
          merchantName:
            merchant?.merchantId?.merchantDetail?.merchantName || null,
          description:
            merchant?.merchantId?.merchantDetail?.description || null,
          averageRating: merchant?.merchantId?.merchantDetail?.averageRating,
          status: merchant?.merchantId?.status,
          restaurantType:
            merchant?.merchantId?.merchantDetail?.merchantFoodType || null,
          merchantImageURL:
            merchant?.merchantId?.merchantDetail?.merchantImageURL ||
            "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FMerchantDefaultImage.png?alt=media&token=a7a11e18-047c-43d9-89e3-8e35d0a4e231",
          displayAddress:
            merchant?.merchantId?.merchantDetail?.displayAddress || null,
          preOrderStatus: merchant?.merchantId?.merchantDetail?.preOrderStatus,
          isFavorite: true,
          businessCategoryId: merchant?.businessCategoryId?.id,
          businessCategoryName: merchant?.businessCategoryId?.title,
          redirectable: redirectable, // Add redirectable field based on conditions
        };
      }
    );

    res.status(200).json({
      success: true,
      data: formattedMerchants,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get favorite products
// const getFavoriteProductsController = async (req, res, next) => {
//   try {
//     const customer = await Customer.findById(req.userAuth)
//       .populate({
//         path: "customerDetails.favoriteProducts",
//         select:
//           "productName price productImageURL description categoryId inventory",
//         populate: {
//           path: "categoryId",
//           select: "businessCategoryId merchantId",
//         },
//       })
//       .select("customerDetails.favoriteProducts");

//     if (!customer) return next(appError("Customer not found", 404));

//     const formattedResponse = customer.customerDetails.favoriteProducts?.map(
//       (product) => ({
//         productId: product._id,
//         productName: product.productName || null,
//         price: product.price || null,
//         productImageURL:
//           product.productImageURL ||
//           "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
//         businessCategoryId: product.categoryId.businessCategoryId || null,
//         merchantId: product.categoryId.merchantId || null,
//         inventory: product.inventory || null,
//         description: product.description || null,
//         isFavorite: true,
//       })
//     );

//     res.status(200).json(formattedResponse);
//   } catch (err) {
//     next(appError(err.message));
//   }
// };

const getFavoriteProductsController = async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.userAuth)
      .populate({
        path: "customerDetails.favoriteProducts",
        select:
          "productName price productImageURL description categoryId inventory",
        populate: [
          {
            path: "categoryId",
            select: "businessCategoryId merchantId",
            populate: {
              path: "merchantId",
              select: "merchantDetail isBlocked isApproved",
            },
          },
        ],
      })
      .select("customerDetails.favoriteProducts");

    if (!customer) return next(appError("Customer not found", 404));

    const formattedResponse = customer.customerDetails.favoriteProducts?.map(
      (product) => {
        // Determine redirectable based on specific conditions
        const redirectable = !!(
          product.categoryId?.merchantId?.merchantDetail?.pricing?.[0] &&
          product.categoryId?.merchantId?.merchantDetail?.pricing?.[0]
            ?.modelType &&
          product.categoryId?.merchantId?.merchantDetail?.pricing?.[0]
            ?.modelId &&
          product.categoryId?.merchantId?.merchantDetail?.location?.length >
            0 &&
          !product.categoryId?.merchantId?.isBlocked &&
          product.categoryId?.merchantId?.isApproved === "Approved"
        );

        return {
          productId: product._id,
          productName: product.productName || null,
          price: product.price || null,
          productImageURL:
            product.productImageURL ||
            "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
          businessCategoryId: product.categoryId.businessCategoryId || null,
          merchantId: product.categoryId.merchantId._id || null,
          inventory: product.inventory || null,
          description: product.description || null,
          isFavorite: true,
          redirectable: redirectable, // Add redirectable field based on conditions
        };
      }
    );

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get all orders of customer in latest order
const getCustomerOrdersController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;

    // Query with only necessary fields and populate merchant details selectively
    const ordersOfCustomer = await Order.find({
      customerId: currentCustomer,
    })
      .sort({ createdAt: -1 })
      .select("merchantId status createdAt billDetail orderDetail")
      .populate({
        path: "merchantId",
        select: "merchantDetail.merchantName merchantDetail.displayAddress",
      })
      .lean();

    const formattedResponse = ordersOfCustomer.map((order) => {
      return {
        orderId: order._id,
        merchantName: order?.merchantId?.merchantDetail?.merchantName || null,
        displayAddress:
          order?.merchantId?.merchantDetail?.displayAddress ||
          order?.orderDetail?.pickupAddress?.area ||
          null,
        deliveryMode: order?.orderDetail?.deliveryMode || null,
        orderStatus: order.status,
        orderDate: formatDate(order.createdAt),
        orderTime: formatTime(order.createdAt),
        grandTotal: order?.billDetail?.grandTotal || null,
      };
    });

    res.status(200).json({
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message || "Server Error"));
  }
};

// Get all scheduled orders of customer
const getAllScheduledOrdersOfCustomer = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const [universalOrders, pickAndCustomOrders] = await Promise.all([
      ScheduledOrder.find({ customerId }).populate(
        "merchantId",
        "merchantDetail.merchantName merchantDetail.displayAddress"
      ),
      scheduledPickAndCustom.find({ customerId }),
    ]);

    console.log("Initalizing all orders");

    const allOrders = [...universalOrders, ...pickAndCustomOrders].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    console.log("All Orders",allOrders);

    const formattedResponse = allOrders?.map((order) => ({
      orderId: order._id,
      merchantName: order?.merchantId?.merchantDetail?.merchantName || null,
      displayAddress: order?.merchantId?.merchantDetail?.displayAddress || null,
      deliveryMode: order.deliveryMode || null,
      startDate: formatDate(order?.startDate),
      endDate: formatDate(order?.endDate),
      time: formatTime(order.time) || null,
      numberOfDays: order?.numOfDays || null,
      grandTotal: order.billDetail.grandTotal || null,
      orderStatus: order?.status,
    }));

    console.log("Formatted Response",formattedResponse);

    res.status(200).json({ data: formattedResponse });
  } catch (err) {
    next(appError(err.message));
  }
};

const getSingleOrderDetailController = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const customerId = req.userAuth;

    // Find the order with populated fields
    const orderFound = await Order.findOne({
      _id: orderId,
      customerId,
    })
      .populate("agentId")
      .populate("merchantId")
      .select(
        "agentId merchantId orderDetail billDetail orderDetailStepper detailAddedByAgent paymentStatus createdAt items paymentMode status deliveryMode pickups drops purchasedItems"
      );

    if (!orderFound) return next(appError("Order not found", 404));

    let showBill = true;
    if (orderFound?.deliveryMode === "Custom Order") {
      const task = await Task.findOne({ orderId }).select("deliveryDetail");

      showBill = false;

      if (
        task &&
        !["Started", "Completed", "Cancelled"].includes(
          task?.deliveryDetail?.deliveryStatus
        )
      ) {
        showBill = true;
      }
    }

    console.log("Order Response",orderFound);

    // Construct the response object
    const formattedResponse = {
      orderId: orderFound?._id,
      status: orderFound?.status || "Unknown", // Include order status
      agentId: orderFound?.agentId?._id || null,
      agentName: orderFound?.agentId?.fullName || null,
      agentLocation: orderFound?.agentId?.location || null,
      agentImageURL: orderFound?.agentId?.agentImageURL || null,
      agentPhone: orderFound?.agentId?.phoneNumber || null,
      merchantName:
        orderFound?.merchantId?.merchantDetail?.merchantName || null,
      merchantPhone: orderFound?.merchantId?.phoneNumber || null,
      deliveryTime: formatTime(orderFound?.deliveryTime),
      paymentStatus: orderFound?.paymentStatus || null,
      // pickUpAddress:
      //   orderFound?.pickups?.[0]?.address?.flat ||
      //   orderFound?.orderDetail?.area ||
      //   null,  
    pickUpAddress: orderFound?.pickups?.[0]?.address || null,
    deliveryAddress: orderFound?.drops?.[0]?.address || null,
    // deliveryAddress:
      //   orderFound?.drops?.[0]?.address?.flat ||
      //   orderFound?.drops?.[0]?.address?.area ||
      //   null,
      pickUpLocation: orderFound?.pickups?.[0]?.address?.area || null,
      deliveryLocation: orderFound?.drops?.[0]?.address?.area || null,
      items: orderFound?.purchasedItems || null,
      billDetail: showBill
        ? {
            deliveryCharge: orderFound?.billDetail?.deliveryCharge || null,
            taxAmount: orderFound?.billDetail?.taxAmount || null,
            discountedAmount: orderFound?.billDetail?.discountedAmount || null,
            grandTotal: orderFound?.billDetail?.grandTotal || null,
            itemTotal: orderFound?.billDetail?.itemTotal || null,
            addedTip: orderFound?.billDetail?.addedTip || null,
            subTotal: orderFound?.billDetail?.subTotal || null,
            surgePrice: orderFound?.billDetail?.surgePrice || null,
            waitingCharge: orderFound?.billDetail?.waitingCharge || null,
            vehicleType: orderFound?.billDetail?.vehicleType || null,
          }
        : "Bill will be updated soon",
      orderDate: formatDate(orderFound?.createdAt),
      orderTime: formatTime(orderFound?.createdAt),
      paymentMode: orderFound?.paymentMode || null,
      deliveryMode: orderFound?.deliveryMode || null,
      vehicleType: orderFound?.billDetail?.vehicleType || null,
      orderDetailStepper: orderFound?.orderDetailStepper || null,
      detailAddedByAgent: {
        notes: orderFound?.detailAddedByAgent?.notes || null,
        signatureImageURL:
          orderFound?.detailAddedByAgent?.signatureImageURL || null,
        imageURL: orderFound?.detailAddedByAgent?.imageURL || null,
      },
    };

    res.status(200).json({
      message: "Customer order detail",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get scheduled order detail
const getScheduledOrderDetailController = async (req, res, next) => {
  try {
    const { orderId, deliveryMode } = req.query;

    let orderFound;

    if (["Take Away", "Home Delivery"].includes(deliveryMode)) {
      orderFound = await ScheduledOrder.findById(orderId);
    } else if (["Pick and Drop", "Custom Order"].includes(deliveryMode)) {
      orderFound = await scheduledPickAndCustom.findById(orderId);
    }

    if (!orderFound) return next(appError("Order not found", 404));

    const formattedResponse = {
      orderId: orderFound._id,
      pickUpAddress: orderFound?.pickups?.[0]?.address || null,
      deliveryAddress: orderFound?.drops?.[0]?.address || null,
      items: orderFound?.purchasedItems || null,
      billDetail: {
        deliveryCharge: orderFound?.billDetail?.deliveryCharge || null,
        taxAmount: orderFound?.billDetail?.taxAmount || null,
        discountedAmount: orderFound?.billDetail?.discountedAmount || null,
        grandTotal: orderFound?.billDetail?.grandTotal || null,
        itemTotal: orderFound?.billDetail?.itemTotal || null,
        addedTip: orderFound?.billDetail?.addedTip || null,
        subTotal: orderFound?.billDetail?.subTotal || null,
        surgePrice: orderFound?.billDetail?.surgePrice || null,
        waitingCharge: orderFound?.billDetail?.waitingCharge || null,
        vehicleType: orderFound?.billDetail?.vehicleType || null,
      },
      orderDate: formatDate(orderFound?.createdAt),
      orderTime: formatTime(orderFound?.createdAt),
      paymentMode: orderFound?.paymentMode || null,
      deliveryMode: orderFound?.deliveryMode || null,
      vehicleType: orderFound?.billDetail?.vehicleType || null,
      startDate: formatDate(orderFound?.startDate),
      endDate: formatDate(orderFound?.endDate),
      time: formatTime(orderFound.time) || null,
      numberOfDays: orderFound?.numOfDays || null,
      deliveryTime: formatTime(orderFound?.deliveryTime),
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

// Search order by dish or Merchant
const searchOrderController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;
    const { query } = req.query;

    if (!query) {
      return next(appError("Search query is required", 400));
    }

    // Use MongoDB to filter based on the query (case-insensitive regex search)
    const ordersOfCustomer = await Order.find({
      customerId: currentCustomer,
      $or: [
        {
          "merchantId.merchantDetail.merchantName": {
            $regex: query,
            $options: "i",
          },
        },
        { "items.itemName": { $regex: query, $options: "i" } },
        { "items.variantTypeName": { $regex: query, $options: "i" } },
      ],
    })
      .sort({ createdAt: -1 })
      .select("merchantId status createdAt items billDetail")
      .populate({
        path: "merchantId",
        select: "merchantDetail.merchantName merchantDetail.displayAddress",
      });

    // Format orders for the response
    const formattedResponse = ordersOfCustomer.map((order) => ({
      id: order._id,
      merchantName: order?.merchantId?.merchantDetail?.merchantName || null,
      displayAddress: order?.merchantId?.merchantDetail?.displayAddress || null,
      orderStatus: order?.status || null,
      orderDate: formatDate(order?.createdAt) || null,
      orderDate: formatTime(order?.createdAt) || null,
      items: order?.items || [],
      grandTotal: order?.billDetail?.grandTotal || null,
    }));

    res.status(200).json({
      message: "Search results for orders",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get transaction details of customer
const getTransactionOfCustomerController = async (req, res, next) => {
  try {
    let { page = 1, limit = 20 } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    const customerId = req.userAuth;

    const transactions = await CustomerTransaction.find({ customerId })
      .sort({
        madeOn: -1,
      })
      .skip(skip)
      .limit(limit);

    const formattedResponse = transactions?.map((transaction) => ({
      transactionAmount: transaction.transactionAmount,
      transactionType: transaction.transactionType,
      type: transaction.type,
      transactionDate: `${formatDate(transaction.madeOn)}`,
      transactionTime: `${formatTime(transaction.madeOn)}`,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get subscriptions details of customer
const getCustomerSubscriptionDetailController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;

    // Fetch both all subscription plans and the current customer subscription in one step
    const [allSubscriptionPlans, customer] = await Promise.all([
      CustomerSubscription.find().select(
        "title name amount duration taxId renewalReminder noOfOrder description"
      ),
      Customer.findById(currentCustomer)
        .select("customerDetails.pricing")
        .populate({
          path: "customerDetails.pricing",
          model: "SubscriptionLog",
          select: "planId endDate",
          populate: {
            path: "planId",
            model: "CustomerSubscription",
            select: "name duration amount description",
          },
        }),
    ]);

    // Format all available subscription plans
    const formattedAllSubscriptionPlans = allSubscriptionPlans.map((plan) => ({
      planId: plan._id,
      planName: plan.name,
      planAmount: plan.amount,
      planDuration: plan.duration,
      noOfOrder: plan.noOfOrder,
      description: plan.description,
    }));

    // Format the current subscription plan, if it exists
    const currentSubscription = customer.customerDetails.pricing[0];
    let formattedCurrentSubscriptionPlan = {};

    if (currentSubscription) {
      const { planId, endDate } = currentSubscription;
      const daysLeft = Math.ceil(
        (new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24)
      );

      formattedCurrentSubscriptionPlan = {
        planName: planId.name,
        planDuration: planId.duration,
        planAmount: planId.amount,
        daysLeft,
      };
    }

    res.status(200).json({
      currentSubscription: formattedCurrentSubscriptionPlan,
      allSubscriptionPlans: formattedAllSubscriptionPlans,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Fetch promo codes
const fetchPromoCodesController = async (req, res, next) => {
  try {
    const customerId = req.userAuth;
    const customer = await Customer.findById(customerId);

    if (!customer) return next(appError("Customer not found", 404));

    const { deliveryMode, merchantId, query } = req.query;

    const currentDate = new Date();
    const filter = {
      geofenceId: customer.customerDetails.geofenceId,
      fromDate: { $lte: currentDate },
      toDate: { $gte: currentDate },
      $expr: { $lt: ["$noOfUserUsed", "$maxAllowedUsers"] },
    };

    if (deliveryMode) {
      filter.deliveryMode = deliveryMode;
    }

    if (merchantId) {
      filter.merchantId = { $in: merchantId };
    }

    if (query) {
      filter.$or = [{ promoCode: query.trim() }, { applicationMode: "Hidden" }];
    } else {
      filter.applicationMode = "Public";
    }

    const promocodesFound = await PromoCode.find(filter);

    const formattedResponse = promocodesFound.map((promo) => ({
      id: promo._id,
      imageURL: promo.imageUrl,
      promoCode: promo.promoCode,
      validUpTo: formatDate(promo.toDate),
      minOrderAmount: promo.minOrderAmount,
      status: promo.status,
      promoType:
        promo.promoType === "Percentage-discount"
          ? "Percentage"
          : "Flat discount",
      discount: promo.discount,
      description: promo.description,
      maxDiscountValue: promo.maxDiscountValue,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get wallet balance and Loyalty points of customer
const getWalletAndLoyaltyController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;

    const customerFound = await Customer.findById(currentCustomer).select(
      "customerDetails.walletBalance customerDetails.loyaltyPointLeftForRedemption"
    );

    const customerData = {
      walletBalance:
        customerFound?.customerDetails?.walletBalance.toFixed(2) || "0",
      loyaltyPoints:
        customerFound?.customerDetails?.loyaltyPointLeftForRedemption || 0,
    };

    res.status(200).json(customerData);
  } catch (err) {
    next(appError(err.message));
  }
};

// Get customers cart
const getCustomerCartController = async (req, res, next) => {
  try {
    const currentCustomer = req.userAuth;

    const populatedCart = await CustomerCart.findOne({
      customerId: currentCustomer,
    })
      .populate({
        path: "items.productId",
        select: "productName productImageURL description variants",
      })
      .exec();

    let populatedCartWithVariantNames;
    if (populatedCart) {
      populatedCartWithVariantNames = populatedCart.toObject();
      populatedCartWithVariantNames.items =
        populatedCartWithVariantNames.items.map((item) => {
          const product = item.productId;
          let variantTypeName = null;
          let variantTypeData = null;
          if (item.variantTypeId && product.variants) {
            const variantType = product.variants
              .flatMap((variant) => variant.variantTypes)
              .find((type) => type._id.equals(item.variantTypeId));
            if (variantType) {
              variantTypeName = variantType.typeName;
              variantTypeData = {
                id: variantType._id,
                variantTypeName: variantTypeName,
              };
            }
          }
          return {
            ...item,
            productId: {
              id: product._id,
              productName: product.productName,
              description: product.description,
              productImageURL: product.productImageURL,
            },
            variantTypeId: variantTypeData,
          };
        });
    }

    res.status(200).json({
      message: "Customer cart found",
      data: {
        showCart:
          populatedCartWithVariantNames?.items?.length > 0 ? true : false,
        cartId: populatedCartWithVariantNames?._id || null,
        customerId: populatedCartWithVariantNames?.customerId || null,
        merchantId: populatedCartWithVariantNames?.merchantId || null,
        items: populatedCartWithVariantNames?.items || [],
        deliveryOption:
          populatedCartWithVariantNames?.cartDetail?.deliveryOption || null,
        itemLength: populatedCartWithVariantNames?.items?.length || 0,
      },
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getSplashScreenImageController = async (req, res, next) => {
  try {
    const splashScreenImage = await CustomerAppCustomization.findOne({}).select(
      "splashScreenUrl"
    );

    res.status(200).json({
      message: "Splash screen image",
      data: splashScreenImage.splashScreenUrl,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getCustomerAppBannerController = async (req, res, next) => {
  try {
    const customerId = req?.userAuth;

    let matchCriteria = { status: true };

    if (customerId) {
      const customer = await Customer.findById(customerId).select(
        "customerDetails.geofenceId"
      );

      matchCriteria.geofenceId = customer?.customerDetails?.geofenceId;
    }

    const allBanners = await AppBanner.find(matchCriteria).select(
      "name imageUrl businessCategoryId merchantId"
    );

    const formattedResponse = await Promise.all(
      allBanners.map(async (banner) => {
        const merchant = await Merchant.findById(banner.merchantId).select(
          "merchantDetail.merchantName"
        );

        return {
          name: banner.name,
          imageUrl: banner.imageUrl,
          businessCategoryId: banner.businessCategoryId,
          merchantId: banner.merchantId,
          merchantName: merchant?.merchantDetail?.merchantName || "",
        };
      })
    );

    res.status(200).json({ message: "Banner", data: formattedResponse });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getPickAndDropBannersController = async (req, res, next) => {
  try {
    const allBanners = await PickAndDropBanner.find({ status: true }).select(
      "title description imageUrl"
    );

    const formattedResponse = allBanners.map((banner) => {
      return {
        title: banner.title,
        description: banner.description,
        imageUrl: banner.imageUrl,
      };
    });

    res.status(200).json({ message: "Banner", data: formattedResponse });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getCustomOrderBannersController = async (req, res, next) => {
  try {
    const allBanners = await CustomOrderBanner.find({ status: true }).select(
      "title description imageUrl"
    );

    const formattedResponse = allBanners?.map((banner) => {
      return {
        title: banner.title,
        description: banner.description,
        imageUrl: banner.imageUrl,
      };
    });

    res.status(200).json({ message: "Banner", data: formattedResponse });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getMerchantAppBannerController = async (req, res, next) => {
  try {
    const { merchantId } = req.params;

    const banners = await Banner.find({ merchantId })
      .select("imageUrl")
      .sort({ createdAt: -1 });

    const formattedResponse = banners?.map((banner) => ({
      imageURL: banner.imageUrl,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getAvailableServiceController = async (req, res, next) => {
  try {
    const availableServices = await ServiceCategory.find({})
      .select("title geofenceId bannerImageURL")
      .sort({ order: 1 });

    const formattedResponse = availableServices?.map((service) => {
      return {
        title: service.title,
        bannerImageURL: service.bannerImageURL,
      };
    });

    res.status(200).json({
      message: "All service categories",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const generateReferralCode = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    // Find the customer and any existing referral code in one query
    const customer = await Customer.findById(customerId)
      .select("fullName email customerDetails.referralCode")
      .populate("customerDetails.referralCode");

    if (!customer) return next(appError("Customer not found", 404));

    // If a referral code already exists, return it
    if (customer.customerDetails.referralCode) {
      return res.status(200).json({
        message: "Referral Code",
        appLink: process.env.PLAY_STORE_APP_LINK,
        referralCode: customer.customerDetails.referralCode,
      });
    }

    // Generate a new referral code if one doesn't exist
    const newReferralCode = `${customerId.slice(1)}${crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;

    await ReferralCode.create({
      customerId,
      name: customer.fullName || null,
      email: customer.email || null,
      referralCode: newReferralCode,
    });

    // Attach the referral code to the customer and save
    customer.customerDetails.referralCode = newReferralCode;
    await customer.save();

    res.status(200).json({
      appLink: process.env.PLAY_STORE_APP_LINK,
      referralCode: newReferralCode,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getSelectedOngoingOrderDetailController = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const customerId = req.userAuth;

    const orderFound = await Order.findOne({
      _id: orderId,
      customerId,
    })
      .populate("agentId")
      .populate("merchantId")
      .select(
        "agentId merchantId orderDetail.deliveryTime orderDetail.pickupLocation orderDetail.deliveryLocation billDetail orderDetailStepper detailAddedByAgent paymentStatus"
      );

    const formattedResponse = {
      orderId: orderFound?._id,
      agentId: orderFound?.agentId?._id || null,
      agentName: orderFound?.agentId?.fullName || null,
      agentLocation: orderFound?.agentId?.location || null,
      agentImageURL: orderFound?.agentId?.agentImageURL || null,
      merchantName:
        orderFound?.merchantId?.merchantDetail?.merchantName || null,
      merchantPhone: orderFound?.merchantId?.phoneNumber || null,
      agentPhone: orderFound?.agentId?.phoneNumber || null,
      deliveryTime: formatTime(orderFound.orderDetail.deliveryTime),
      paymentStatus: orderFound?.paymentStatus || null,
      orderDetail: {
        pickupLocation: orderFound?.orderDetail?.pickupLocation || null,
        deliveryLocation: orderFound?.orderDetail?.deliveryLocation || null,
      },
      orderDetailStepper: orderFound?.orderDetailStepper || null,
      detailAddedByAgent: {
        notes: orderFound?.detailAddedByAgent.notes || null,
        signatureImageURL:
          orderFound?.detailAddedByAgent.signatureImageURL || null,
        imageURL: orderFound?.detailAddedByAgent.imageURL || null,
      },
      billDetail: orderFound?.billDetail || null,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getAllNotificationsOfCustomerController = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const getAllNotifications = await CustomerNotificationLogs.find({
      customerId,
    }).sort({ createdAt: -1 });

    const formattedResponse = getAllNotifications?.map((notification) => {
      return {
        notificationId: notification._id,
        imageUrl: notification?.imageUrl || null,
        title: notification?.title || null,
        description: notification?.description || null,
      };
    });

    res.status(200).json({
      message: "All notifications",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getVisibilityOfReferralAndLoyaltyPoint = async (req, res, next) => {
  try {
    const { query } = req.query;

    let itemFound;

    if (query === "loyalty-point") {
      itemFound = await LoyaltyPoint.find({ status: true });
    } else if (query === "referral") {
      itemFound = await Referral.find({ status: true });
    } else if (query === "order") {
      itemFound = await Order.find({
        customerId: req.userAuth,
        $or: [{ status: "Pending" }, { status: "On-going" }],
      });
    }

    let status = itemFound?.length >= 1 ? true : false;

    res.status(200).json({ status });
  } catch (err) {
    next(appError(err.message));
  }
};

//
const getCurrentOngoingOrders = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const orders = await Order.find({
      customerId,
      $or: [{ status: "Pending" }, { status: "On-going" }],
    })
      .populate("merchantId", "merchantDetail.merchantName")
      .select("merchantId orderDetail.deliveryTime orderDetail.deliveryMode")
      .sort({ createdAt: -1 });

    const formattedResponse = orders?.map((order) => ({
      orderId: order._id,
      merchantName: order?.merchantId?.merchantDetail?.merchantName || null,
      deliveryMode: order?.orderDetail?.deliveryMode || null,
      deliveryTime: formatTime(order?.orderDetail?.deliveryTime) || null,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

//
const removeAppliedPromoCode = async (req, res, next) => {
  try {
    const { cartId, deliveryMode } = req.body;

    const modal =
      deliveryMode === "Take Away" || deliveryMode === "Home Delivery"
        ? CustomerCart
        : PickAndCustomCart;

    const cart = await modal.findById(cartId);

    if (!cart) return next(appError("Cart not found", 404));

    const { billDetail } = cart;

    const promoCodeFound = await PromoCode.findOne({
      promoCode: billDetail.promoCodeUsed,
    });

    if (!promoCodeFound) {
      return next(appError("Promo code not found", 404));
    }

    const { itemTotal, originalDeliveryCharge } = billDetail;

    const totalCartPrice =
      cart.cartDetail.deliveryOption === "Scheduled"
        ? calculateScheduledCartValue(cart, promoCodeFound)
        : deliveryMode === "Take Away" || deliveryMode === "Home Delivery"
        ? itemTotal
        : originalDeliveryCharge;

    const promoCodeDiscount = calculatePromoCodeDiscount(
      promoCodeFound,
      totalCartPrice
    );

    const updatedCart = deductPromoCodeDiscount(
      cart,
      Number(promoCodeDiscount.toFixed(2))
    );

    await cart.save();

    res.status(200).json(updatedCart.billDetail);
  } catch (err) {
    next(appError(err.message));
  }
};

const applyPromoCode = async (req, res, next) => {
  try {
    const { cartId, promoCode, deliveryMode } = req.body;
    const customerId = req.userAuth;

    let cart;

    if (["Take Away", "Home Delivery"].includes(deliveryMode)) {
      cart = await CustomerCart.findById(cartId);
    } else {
      cart = await PickAndCustomCart.findById(cartId);
    }

    const customer = await Customer.findById(customerId);

    if (!customer) return next(appError("Customer not found", 404));
    if (!cart) return next(appError("Cart not found", 404));

    const { geofenceId } = customer.customerDetails;
    const { deliveryOption } = cart.cartDetail;
    const {
      itemTotal,
      originalDeliveryCharge,
      discountedAmount = 0,
      promoCodeDiscount = 0,
    } = cart.billDetail;

    const promoCodeFound = await PromoCode.findOne({
      promoCode,
      geofenceId,
      status: true,
      deliveryMode,
    });

    if (!promoCodeFound) {
      return next(appError("Promo code not found or inactive", 404));
    }

    const {
      merchantId: promoMerchants,
      minOrderAmount,
      fromDate,
      toDate,
      noOfUserUsed,
      maxAllowedUsers,
    } = promoCodeFound;

    const merchantId = cart?.merchantId?.toString();
    if (
      !promoMerchants.includes(merchantId) &&
      ["Take Away", "Home Delivery"].includes(deliveryMode)
    ) {
      return next(
        appError("Promo code is not applicable for this merchant", 400)
      );
    }

    let totalCartPrice;
    if (["Take Away", "Home Delivery"].includes(deliveryMode)) {
      totalCartPrice =
        deliveryOption === "Scheduled"
          ? calculateScheduledCartValue(cart, promoCodeFound)
          : itemTotal;
    } else if (["Pick and Drop", "Custom Order"].includes(deliveryMode)) {
      totalCartPrice =
        deliveryOption === "Scheduled"
          ? calculateScheduledCartValue(cart, promoCodeFound)
          : originalDeliveryCharge;
    }

    if (totalCartPrice < minOrderAmount) {
      return next(
        appError(`Minimum order amount should be ${minOrderAmount}`, 400)
      );
    }

    const now = new Date();
    if (now < fromDate || now > toDate) {
      return next(appError("Promo code is not valid at this time", 400));
    }

    if (noOfUserUsed >= maxAllowedUsers) {
      return next(appError("Promo code usage limit reached", 400));
    }

    const promoDiscount = calculatePromoCodeDiscount(
      promoCodeFound,
      totalCartPrice
    );

    const totalDiscount = Number(
      (promoDiscount + discountedAmount - promoCodeDiscount).toFixed(2)
    );

    // Apply discount
    const updatedCart = applyPromoCodeDiscount(
      cart,
      promoCodeFound,
      totalDiscount
    );

    await updatedCart.save();

    res.status(200).json({
      success: true,
      message: `Promo code ${promoCode} applied`,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateOrderTipController = async (req, res, next) => {
  try {
    const { cartId, deliveryMode, tip = 0 } = req.body;
    let cart;

    if (["Take Away", "Home Delivery"].includes(deliveryMode)) {
      cart = await CustomerCart.findById(cartId);
    } else {
      cart = await PickAndCustomCart.findById(cartId);
    }

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    const { billDetail: cartBill } = cart;
    if (!cartBill) {
      return next(appError("Billing details not found", 404));
    }

    const oldTip = parseFloat(cartBill.addedTip ?? 0) || 0;
    const newTip = parseFloat(tip) ?? 0;

    // Apply tip update
    cartBill.addedTip = newTip;

    // Only update totals if they are not null
    if (cartBill.subTotal !== null) {
      cartBill.subTotal += newTip - oldTip;
    }

    if (cartBill.discountedGrandTotal !== null) {
      cartBill.discountedGrandTotal += newTip - oldTip;
    }

    if (cartBill.originalGrandTotal !== null) {
      cartBill.originalGrandTotal += newTip - oldTip;
    }

    await cart.save();

    res.status(200).json({ success: true, message: "Tip", cart: cart });
  } catch (err) {
    console.error("❗ Error in updateOrderTipController:", err.message);
    next(appError(err.message));
  }
};

const haveValidCart = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const cart = await CustomerCart.aggregate([
      { $match: { customerId } }, // Filter by customer ID
      {
        $lookup: {
          from: "merchants", // Name of the Merchant collection
          localField: "merchantId",
          foreignField: "_id",
          as: "merchantDetail",
        },
      },
      { $unwind: "$merchantDetail" }, // Convert array to object
      {
        $project: {
          haveCart: { $gt: [{ $size: "$items" }, 0] }, // Check if items exist
          merchantName: "$merchantDetail.merchantDetail.merchantName",
        },
      },
    ]);

    res.status(200).json({
      haveCart: cart.length ? cart[0].haveCart : false,
      merchant: cart.length ? cart[0].merchantName : null,
      cartId: cart.length ? cart[0]._id : null,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const searchProductAndMerchantController = async (req, res) => {
  try {
    const { query, page = 1, limit = 10 } = req.query;
    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "Query cannot be empty" });
    }

    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;

    // Merchant search filter
    const merchantFilter = {
      isBlocked: false,
      isApproved: "Approved",
      "merchantDetail.merchantName": { $regex: query, $options: "i" },
      "merchantDetail.location": { $exists: true, $ne: [] },
      "merchantDetail.pricing.0": { $exists: true },
      "merchantDetail.pricing.modelType": { $exists: true }, // Ensures modelType exists
      "merchantDetail.pricing.modelId": { $exists: true },
    };

    const merchantFilterForProduct = {
      isBlocked: false,
      isApproved: "Approved",
      "merchantDetail.location": { $exists: true, $ne: [] },
      "merchantDetail.pricing.0": { $exists: true },
      "merchantDetail.pricing.modelType": { $exists: true }, // Ensures modelType exists
      "merchantDetail.pricing.modelId": { $exists: true },
    };
    // Product search filter
    // const productFilter = { productName: { $regex: query, $options: "i" } };

    const availableMerchants = await Merchant.find(merchantFilterForProduct)
      .select("_id")
      .lean();

    const availableMerchantIds = availableMerchants.map(
      (merchant) => merchant._id
    );

    const productFilter = {
      productName: { $regex: query, $options: "i" },
      categoryId: {
        $in: await Category.find({
          merchantId: { $in: availableMerchantIds },
        }).select("_id"),
      },
    };

    // Fetch merchants and populate business categories
    const merchants = await Merchant.find(merchantFilter)
      .select(
        "_id merchantDetail.merchantName merchantDetail.displayAddress merchantDetail.merchantImageURL merchantDetail.ratingByCustomers merchantDetail.businessCategoryId"
      )
      .populate({ path: "merchantDetail.businessCategoryId", select: "title" }) // Fetch category name
      .lean();

    // Format merchants (handling multiple business categories)
    const merchantResults = [];
    for (const merchant of merchants) {
      const ratings = merchant.merchantDetail.ratingByCustomers || [];
      const totalRating = ratings.reduce((acc, cur) => acc + cur.rating, 0);
      const averageRating =
        ratings.length > 0 ? (totalRating / ratings.length).toFixed(1) : 0;

      const businessCategories = Array.isArray(
        merchant.merchantDetail.businessCategoryId
      )
        ? merchant.merchantDetail.businessCategoryId
        : [merchant.merchantDetail.businessCategoryId];

      // If merchant has multiple business categories, add category name; otherwise, exclude it
      if (businessCategories.length > 1) {
        for (const category of businessCategories) {
          merchantResults.push({
            _id: merchant._id,
            name: merchant.merchantDetail.merchantName,
            address: merchant.merchantDetail.displayAddress,
            image:
              merchant.merchantDetail.merchantImageURL ||
              "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FMerchantDefaultImage.png?alt=media&token=a7a11e18-047c-43d9-89e3-8e35d0a4e231",
            averageRating: parseFloat(averageRating),
            type: "merchant",
            businessCategoryId: category?._id || null,
            businessCategoryName: category?.title || null,
            businessCategoryForPush: category?.title || null,
          });
        }
      } else {
        merchantResults.push({
          _id: merchant._id,
          name: merchant.merchantDetail.merchantName,
          address: merchant.merchantDetail.displayAddress,
          image:
            merchant.merchantDetail.merchantImageURL ||
            "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FMerchantDefaultImage.png?alt=media&token=a7a11e18-047c-43d9-89e3-8e35d0a4e231",
          averageRating: parseFloat(averageRating),
          type: "merchant",
          businessCategoryId: businessCategories[0]?._id || null,
          businessCategoryName: null,
          businessCategoryForPush: businessCategories[0]?.title || null,
        });
      }
    }

    // Fetch products and populate category to get businessCategoryId
    const products = await Product.find(productFilter)
      .select("_id productName productImageURL categoryId type")
      .populate({
        path: "categoryId",
        select: "businessCategoryId name",
        populate: {
          path: "businessCategoryId",
          select: "title", // Fetch the title field from businessCategoryId
        },
      }) // Fetch category name
      .lean();

    // Remove duplicate product names
    const uniqueProducts = [];
    const seenProductNames = new Set();

    for (const product of products) {
      if (!seenProductNames.has(product.productName)) {
        seenProductNames.add(product.productName);
        uniqueProducts.push({
          _id: product?._id,
          name: product?.productName,
          image:
            product?.productImageURL ||
            "https://firebasestorage.googleapis.com/v0/b/famto-aa73e.appspot.com/o/DefaultImages%2FProductDefaultImage.png?alt=media&token=044503ee-84c8-487b-9df7-793ad0f70e1c",
          type: product?.type,
          businessCategoryId:
            product.categoryId?.businessCategoryId?._id || null,
          businessCategoryName:
            product.categoryId?.businessCategoryId?.title || null, // Added category name
        });
      }
    }

    // Intermix merchants and products like Swiggy
    const combinedResults = [];
    let productIndex = 0;
    let merchantIndex = 0;

    while (
      productIndex < uniqueProducts.length ||
      merchantIndex < merchantResults.length
    ) {
      // Add up to 3 products
      for (let i = 0; i < 3 && productIndex < uniqueProducts.length; i++) {
        combinedResults.push(uniqueProducts[productIndex]);
        productIndex++;
      }

      // Add 1 merchant
      if (merchantIndex < merchantResults.length) {
        combinedResults.push(merchantResults[merchantIndex]);
        merchantIndex++;
      }
    }

    // Paginate results
    const startIndex = (pageNumber - 1) * pageSize;
    const paginatedResults = combinedResults.slice(
      startIndex,
      startIndex + pageSize
    );
    const hasNextPage = startIndex + pageSize < combinedResults?.length;

    return res.json({
      results: paginatedResults,
      page: pageNumber,
      limit: pageSize,
      hasNextPage,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

const deleteCustomerAccount = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const result = await Customer.updateOne(
      { _id: customerId },
      {
        $set: {
          "customerDetails.homeAddress": null,
          "customerDetails.workAddress": null,
          "customerDetails.otherAddress": [],
          "customerDetails.customerImageURL": null,
          fullName: null,
          email: null,
        },
      }
    );

    if (result.modifiedCount === 0)
      return next(appError("Customer not found", 404));

    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  registerAndLoginController,
  setSelectedGeofence,
  getCustomerProfileController,
  updateCustomerProfileController,
  updateCustomerAddressController,
  getCustomerAddressController,
  addWalletBalanceController,
  verifyWalletRechargeController,
  rateDeliveryAgentController,
  getFavoriteMerchantsController,
  getFavoriteProductsController,
  getCustomerOrdersController,
  getSingleOrderDetailController,
  getTransactionOfCustomerController,
  getCustomerSubscriptionDetailController,
  searchOrderController,
  getWalletAndLoyaltyController,
  getCustomerCartController,
  getCustomerAppBannerController,
  getSplashScreenImageController,
  getPickAndDropBannersController,
  getCustomOrderBannersController,
  getAvailableServiceController,
  generateReferralCode,
  getSelectedOngoingOrderDetailController,
  getAllNotificationsOfCustomerController,
  getVisibilityOfReferralAndLoyaltyPoint,
  getCurrentOngoingOrders,
  getAllScheduledOrdersOfCustomer,
  getScheduledOrderDetailController,
  getMerchantAppBannerController,
  fetchPromoCodesController,
  removeAppliedPromoCode,
  haveValidCart,
  searchProductAndMerchantController,
  verifyCustomerAddressLocation,
  updateOrderTipController,
  applyPromoCode,
  deleteCustomerAccount,
};
