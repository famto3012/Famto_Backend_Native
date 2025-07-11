const axios = require("axios");

const Tax = require("../models/Tax");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Merchant = require("../models/Merchant");
const Customer = require("../models/Customer");
const Referral = require("../models/Referral");
const FcmToken = require("../models/fcmToken");
const CustomerCart = require("../models/CustomerCart");
const LoyaltyPoint = require("../models/LoyaltyPoint");
const ReferralCode = require("../models/ReferralCode");
const CustomerSurge = require("../models/CustomerSurge");
const ScheduledOrder = require("../models/ScheduledOrder");
const CustomerPricing = require("../models/CustomerPricing");
const MerchantDiscount = require("../models/MerchantDiscount");
const ScheduledPickAndCustom = require("../models/ScheduledPickAndCustom");
const MerchantNotificationLogs = require("../models/MerchantNotificationLog");

const appError = require("./appError");

const { deleteFromFirebase, uploadToFirebase } = require("./imageOperation");

const { formatDate, formatTime } = require("./formatters");

// Helper function to sort merchants by sponsorship
const sortMerchantsBySponsorship = (merchants) => {
  return merchants.sort((a, b) => {
    const aSponsorship = a.sponsorshipDetail.some((s) => s.sponsorshipStatus);
    const bSponsorship = b.sponsorshipDetail.some((s) => s.sponsorshipStatus);
    return bSponsorship - aSponsorship;
  });
};

const getDistanceFromPickupToDelivery = async (
  pickupCoordinates,
  deliveryCoordinates,
  profile = "biking"
) => {
  if (pickupCoordinates.length !== 2 || deliveryCoordinates.length !== 2) {
    throw new Error("Invalid coordinates to find the distance");
  }

  if (process.env.NODE_ENV === "development") {
    const getRandomFloat = (min, max) => {
      const random = Math.random() * (max - min) + min;
      return Number(random.toFixed(2));
    };

    return {
      distanceInKM: getRandomFloat(2, 10),
      durationInMinutes: getRandomFloat(5.5, 30),
    };
  }

  const { data } = await axios.get(
    `https://apis.mapmyindia.com/advancedmaps/v1/${process.env.MapMyIndiaAPIKey}/distance_matrix/${profile}/${pickupCoordinates[1]},${pickupCoordinates[0]};${deliveryCoordinates[1]},${deliveryCoordinates[0]}`
  );

  if (
    data &&
    data.results &&
    data.results.distances &&
    data.results.distances.length > 0
  ) {
    const distance = (data.results.distances[0][1] / 1000).toFixed(2);
    const durationInMinutes = Math.ceil(data.results.durations[0][1] / 60);

    const distanceInKM = parseFloat(distance);

    return { distanceInKM, durationInMinutes };
  }
};

const calculateDeliveryCharges = (
  distance,
  baseFare,
  baseDistance,
  fareAfterBaseDistance
) => {
  if (fareAfterBaseDistance) {
    if (distance <= baseDistance) {
      return Number(parseFloat(baseFare).toFixed(2) || 0);
    } else {
      return Number(
        parseFloat(
          baseFare + (distance - baseDistance) * fareAfterBaseDistance
        ).toFixed(2) || 0
      );
    }
  } else {
    if (distance <= baseDistance) {
      return Number(parseFloat(baseFare).toFixed(2) || 0);
    } else {
      return Number(
        parseFloat(baseFare + (distance - baseDistance)).toFixed(2) || 0
      );
    }
  }
};

const getTaxAmount = async (
  businessCategoryId,
  geofenceId,
  itemTotal,
  deliveryCharges
) => {
  try {
    const taxFound = await Tax.findOne({
      assignToBusinessCategory: businessCategoryId,
      geofences: { $in: [geofenceId] },
    });

    if (!taxFound) throw new Error("Tax not found");

    const taxPercentage = taxFound.tax;

    const taxAmount = (parseFloat(itemTotal) * taxPercentage) / 100;

    return parseFloat(taxAmount.toFixed(2));
  } catch (err) {
    throw new Error(err.message);
  }
};

const convertToIST = (date) => {
  // Convert the date to IST by adding 5 hours 30 minutes
  const istOffset = 5 * 60 + 30; // IST is UTC + 5 hours 30 minutes
  const dateInIST = new Date(date.getTime() + istOffset * 60 * 1000);
  return dateInIST;
};

const createOrdersFromScheduled = async (scheduledOrder) => {
  try {
    const customer = await Customer.findById(scheduledOrder.customerId);

    if (!customer) {
      throw new Error("Customer not found", 404);
    }

    const merchant = await Merchant.findById(scheduledOrder.merchantId);

    if (!merchant) {
      throw new Error("Merchant not found", 404);
    }

    let calculatedTip = 0;
    if (scheduledOrder?.billDetail?.addedTip > 0) {
      calculatedTip =
        scheduledOrder.billDetail.addedTip /
        scheduledOrder.orderDetail.numOfDays;
    }

    const deliveryTimeMinutes = parseInt(
      merchant.merchantDetail.deliveryTime,
      10
    );

    const deliveryTime = new Date(scheduledOrder.time);
    deliveryTime.setMinutes(deliveryTime.getMinutes() + deliveryTimeMinutes);

    const stepperData = {
      by: "Admin",
      date: new Date(),
    };

    let options = {
      customerId: scheduledOrder.customerId,
      merchantId: scheduledOrder.merchantId,
      scheduledOrderId: scheduledOrder._id,
      items: scheduledOrder.items,
      orderDetail: {
        ...scheduledOrder.orderDetail,
        deliveryTime,
      },
      billDetail: {
        ...scheduledOrder.billDetail,
        addedTip: calculatedTip,
      },
      totalAmount: scheduledOrder.totalAmount,
      paymentMode: scheduledOrder.paymentMode,
      paymentStatus: scheduledOrder.paymentStatus,
      status: "Pending",
      "orderDetailStepper.created": stepperData,
      purchasedItems: scheduledOrder.purchasedItems,
    };

    let newOrderCreated = await Order.create(options);

    options = {};

    const nextTime = new Date(scheduledOrder.time);
    nextTime.setDate(nextTime.getDate() + 1);

    if (nextTime < new Date(scheduledOrder.endDate)) {
      await ScheduledOrder.findByIdAndUpdate(scheduledOrder._id, {
        time: nextTime,
      });
    } else {
      await ScheduledOrder.findByIdAndUpdate(scheduledOrder._id, {
        status: "Completed",
      });
    }

    const newOrder = await Order.findById(newOrderCreated._id).populate(
      "merchantId"
    );

    const { sendSocketDataAndNotification } = require("./socketHelper");
    const { findRolesToNotify } = require("../socket/socket");

    const eventName = "newOrderCreated";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    const notificationData = {
      fcm: {
        orderId: newOrder._id,
        customerId: newOrder.customerId,
      },
    };

    const socketData = {
      ...data,

      orderId: newOrder._id,
      orderDetail: newOrder.orderDetail,
      billDetail: newOrder.billDetail,
      orderDetailStepper: stepperData,

      //? Data for displaying detail in all orders table
      _id: newOrder._id,
      orderStatus: newOrder.status,
      merchantName: newOrder.merchantId.merchantDetail.merchantName || "-",
      customerName:
        newOrder?.orderDetail?.deliveryAddress?.fullName ||
        newOrder?.customerId?.fullName ||
        "-",
      deliveryMode: newOrder?.orderDetail?.deliveryMode,
      orderDate: formatDate(newOrder.createdAt),
      orderTime: formatTime(newOrder.createdAt),
      deliveryDate: newOrder?.orderDetail?.deliveryTime
        ? formatDate(newOrder.orderDetail.deliveryTime)
        : "-",
      deliveryTime: newOrder?.orderDetail?.deliveryTime
        ? formatTime(newOrder.orderDetail.deliveryTime)
        : "-",
      paymentMethod: newOrder.paymentMode,
      deliveryOption: newOrder.orderDetail.deliveryOption,
      amount: newOrder.billDetail.grandTotal,
    };

    const userIds = {
      admin: process.env.ADMIN_ID,
      merchant: newOrder?.merchantId?._id,
      driver: newOrder?.agentId,
      customer: newOrder?.customerId,
    };

    // Send notifications to each role dynamically
    await sendSocketDataAndNotification({
      rolesToNotify,
      userIds,
      eventName,
      notificationData,
      socketData,
    });
  } catch (err) {
    console.error("Error creating order from scheduled order:", err.message);
  }
};

const createOrdersFromScheduledPickAndDrop = async (scheduledOrder) => {
  try {
    const customer = await Customer.findById(scheduledOrder.customerId);

    if (!customer) {
      throw new Error("Customer not found", 404);
    }

    let calculatedTip = 0;
    if (scheduledOrder?.billDetail?.addedTip > 0) {
      calculatedTip =
        scheduledOrder.billDetail.addedTip /
        scheduledOrder.orderDetail.numOfDays;
    }

    const deliveryTime = convertToIST(new Date());
    deliveryTime.setHours(deliveryTime.getHours() + 1);

    const stepperData = {
      by: "Admin",
      date: new Date(),
    };

    const newOrder = await Order.create({
      customerId: scheduledOrder.customerId,
      items: scheduledOrder.items,
      orderDetail: {
        ...scheduledOrder.orderDetail,
        deliveryTime,
      },
      billDetail: {
        ...scheduledOrder.billDetail,
        addedTip: calculatedTip,
      },
      totalAmount: scheduledOrder.totalAmount,
      paymentMode: scheduledOrder.paymentMode,
      paymentStatus: scheduledOrder.paymentStatus,
      status: "Pending",
      "orderDetailStepper.created": stepperData,
    });

    const nextTime = new Date(scheduledOrder.time);
    nextTime.setDate(nextTime.getDate() + 1);

    if (nextTime < new Date(scheduledOrder.endDate)) {
      await ScheduledPickAndCustom.findByIdAndUpdate(scheduledOrder._id, {
        time: nextTime,
      });
    } else {
      await ScheduledPickAndCustom.findByIdAndUpdate(scheduledOrder._id, {
        status: "Completed",
      });
    }

    const { sendSocketDataAndNotification } = require("./socketHelper");
    const { findRolesToNotify } = require("../socket/socket");

    const eventName = "newOrderCreated";

    const { rolesToNotify, data } = await findRolesToNotify(eventName);

    const notificationData = {
      fcm: {
        orderId: newOrder._id,
        customerId: newOrder.customerId,
      },
    };

    const socketData = {
      ...data,

      orderId: newOrder._id,
      orderDetail: newOrder.orderDetail,
      billDetail: newOrder.billDetail,
      orderDetailStepper: stepperData,

      //? Data for displaying detail in all orders table
      _id: newOrder._id,
      orderStatus: newOrder.status,
      merchantName: "-",
      customerName:
        newOrder?.orderDetail?.deliveryAddress?.fullName ||
        newOrder?.customerId?.fullName ||
        "-",
      deliveryMode: newOrder?.orderDetail?.deliveryMode,
      orderDate: formatDate(newOrder.createdAt),
      orderTime: formatTime(newOrder.createdAt),
      deliveryDate: newOrder?.orderDetail?.deliveryTime
        ? formatDate(newOrder.orderDetail.deliveryTime)
        : "-",
      deliveryTime: newOrder?.orderDetail?.deliveryTime
        ? formatTime(newOrder.orderDetail.deliveryTime)
        : "-",
      paymentMethod: newOrder.paymentMode,
      deliveryOption: newOrder.orderDetail.deliveryOption,
      amount: newOrder.billDetail.grandTotal,
    };

    const userIds = {
      admin: process.env.ADMIN_ID,
      merchant: newOrder?.merchantId,
      driver: newOrder?.agentId,
      customer: newOrder?.customerId,
    };

    // Send notifications to each role dynamically
    await sendSocketDataAndNotification({
      rolesToNotify,
      userIds,
      eventName,
      notificationData,
      socketData,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateOneDayLoyaltyPointEarning = async () => {
  try {
    await Customer.updateMany(
      {},
      { "customerDetails.loyaltyPointEarnedToday": 0 }
    );
  } catch (err) {
    console.log(`Error in updating loyalty point: ${err}`);
  }
};

const getDeliveryAndSurgeCharge = async (
  customerId,
  deliveryMode,
  distance,
  businessCategoryId
) => {
  const customer = await Customer.findById(customerId);

  if (!customer) throw new Error("Customer not found", 404);

  let customerPricing;

  if (deliveryMode === "Home Delivery") {
    customerPricing = await CustomerPricing.findOne({
      deliveryMode,
      businessCategoryId,
      // geofenceId: customer.customerDetails.geofenceId,
      status: true,
    });
  } else {
    customerPricing = await CustomerPricing.findOne({
      deliveryMode,
      geofenceId: customer.customerDetails.geofenceId,
      status: true,
    });
  }

  if (!customerPricing) throw new Error("Customer pricing not found", 404);

  let baseFare = customerPricing.baseFare;
  let baseDistance = customerPricing.baseDistance;
  let fareAfterBaseDistance = customerPricing.fareAfterBaseDistance;

  const customerSurge = await CustomerSurge.findOne({
    geofenceId: customer.customerDetails.geofenceId,
    status: true,
  });

  let surgeCharges = 0;

  if (customerSurge) {
    let surgeBaseFare = customerSurge.baseFare;
    let surgeBaseDistance = customerSurge.baseDistance;
    let surgeFareAfterBaseDistance = customerSurge.fareAfterBaseDistance;

    surgeCharges = calculateDeliveryCharges(
      distance,
      surgeBaseFare,
      surgeBaseDistance,
      surgeFareAfterBaseDistance
    );
  }

  const deliveryCharges = calculateDeliveryCharges(
    distance,
    baseFare,
    baseDistance,
    fareAfterBaseDistance
  );

  return { deliveryCharges, surgeCharges };
};

const calculateDiscountedPrice = (product, variantId) => {
  const currentDate = new Date();
  const validFrom = new Date(product?.discountId?.validFrom);
  const validTo = new Date(product?.discountId?.validTo);

  // Adjusting the validTo date to the end of the day
  validTo?.setHours(23, 59, 59, 999);

  let discountPrice;

  if (variantId) {
    const getVariantPrice = (product, variantTypeId) => {
      let variantPrice;

      product.variants.forEach((variant) => {
        variant.variantTypes.forEach((type) => {
          if (type.id === variantTypeId) {
            variantPrice = type.price;
          }
        });
      });

      return variantPrice || product.price;
    };

    let variantTypePrice = getVariantPrice(product, variantId);
    discountPrice = variantTypePrice;
  } else {
    discountPrice = product.price;
  }

  let variantsWithDiscount = product?.variants;

  if (
    product?.discountId &&
    validFrom <= currentDate &&
    validTo >= currentDate &&
    product?.discountId?.status
  ) {
    const discount = product.discountId;

    if (discount.discountType === "Percentage-discount") {
      let discountAmount = (product.price * discount.discountValue) / 100;
      if (discountAmount > discount.maxAmount) {
        discountAmount = discount.maxAmount;
      }
      discountPrice -= discountAmount;
    } else if (discount.discountType === "Flat-discount") {
      discountPrice -= discount.discountValue;
    }

    if (discountPrice < 0) discountPrice = 0;

    // Apply discount to the variants if onAddOn is true
    if (discount.onAddOn) {
      variantsWithDiscount = product.variants.map((variant) => {
        const variantTypesWithDiscount = variant.variantTypes.map(
          (variantType) => {
            let variantDiscountPrice = variantType.price;
            if (discount.discountType === "Percentage-discount") {
              let discountAmount =
                (variantType.price * discount.discountValue) / 100;
              if (discountAmount > discount.maxAmount) {
                discountAmount = discount.maxAmount;
              }
              variantDiscountPrice -= discountAmount;
            } else if (discount.discountType === "Flat-discount") {
              variantDiscountPrice -= discount.discountValue;
            }

            if (variantDiscountPrice < 0) variantDiscountPrice = 0;

            return {
              ...variantType._doc,
              discountPrice: variantDiscountPrice,
            };
          }
        );
        return {
          ...variant._doc,
          variantTypes: variantTypesWithDiscount,
        };
      });
    }
  }

  return { discountPrice, variantsWithDiscount };
};

const completeReferralDetail = async (newCustomer, code) => {
  try {
    const referralFound = await Referral.findOne({ status: true });

    if (referralFound) {
      const referralType = referralFound.referralType;
      const referrerFound = await ReferralCode.findOne({ referralCode: code });

      if (referrerFound) {
        newCustomer.referralDetail = {
          referrerUserId: referrerFound.customerId,
          referralType: referralType,
        };

        await newCustomer.save();

        referrerFound.numOfReferrals += 1;

        await referrerFound.save();
      }
    }
  } catch (err) {
    throw new Error(err.message);
  }
};

const filterProductIdAndQuantity = async (items) => {
  try {
    const filteredArray = await Promise.all(
      items.map(async (item) => {
        if (!item.productId) return null;

        const product = await Product.findById(item?.productId).lean();
        if (!product) return null;

        let price, costPrice;

        if (item.variantTypeId) {
          const variantType = product.variants
            .flatMap((variant) => variant.variantTypes)
            .find(
              (vType) =>
                vType._id.toString() === item?.variantTypeId?._id?.toString()
            );

          if (variantType) {
            price = variantType?.price || 0;
            costPrice = variantType?.costPrice || 0;
          } else {
            price = product?.price || 0;
            costPrice = product?.costPrice || 0;
          }
        } else {
          price = product?.price || 0;
          costPrice = product?.costPrice || 0;
        }

        return {
          productId: item?.productId,
          variantId: item?.variantTypeId || null,
          price,
          costPrice,
          quantity: item?.quantity,
        };
      })
    );

    // Filter out any null values from items that were skipped
    return filteredArray.filter((item) => item !== null);
  } catch (err) {
    throw new Error(`Error filtering items: ${err.message}`);
  }
};

const reduceProductAvailableQuantity = async (purchasedItems, merchantId) => {
  try {
    for (const item of purchasedItems) {
      const productFound = await Product.findById(item.productId);

      if (!productFound) {
        throw new Error("Product not found");
      }

      productFound.availableQuantity -= item.quantity;

      // if (productFound.availableQuantity <= 0) {
      //   productFound.availableQuantity = 0;
      //   productFound.inventory = false;
      // }

      await productFound.save();

      if (productFound.availableQuantity <= productFound.alert) {
        const { sendPushNotificationToUser } = require("../socket/socket");

        const fcmToken = await FcmToken.findOne({ userId: merchantId });

        const eventName = "alertProductQuantity";
        const message = {
          title: "Alert",
          body: `${productFound.productName}'s quantity is low`,
        };

        if (fcmToken) {
          try {
            sendPushNotificationToUser(fcmToken.token, message, eventName);
            await MerchantNotificationLogs.create({
              title: "Alert",
              description: `${productFound.productName}'s quantity is low`,
              merchantId,
            });
          } catch (err) {
            throw new Error("Error in processing low product alert");
          }
        }
      }
    }
  } catch (err) {
    throw new Error(err.message);
  }
};

const calculateMerchantDiscount = async (
  cart,
  itemTotal,
  merchantId,
  startDate,
  endDate
) => {
  try {
    let calculatedMerchantDiscount = 0;

    for (const item of cart?.items) {
      const product = await Product.findById(item.productId)
        .populate("discountId")
        .exec();

      if (!product) continue;

      if (product.discountId && product.discountId.status) {
        const currentDate = new Date();
        const validFrom = new Date(product.discountId.validFrom);
        const validTo = new Date(product.discountId.validTo);

        // Adjusting the validTo date to the end of the day
        validTo.setHours(23, 59, 59, 999);

        if (validFrom <= currentDate && validTo >= currentDate) {
          // Product has a valid discount, skip applying merchant discount
          continue;
        }
      }

      // Apply merchant discount to the product's price
      const merchantDiscount = await MerchantDiscount.findOne({
        merchantId,
        status: true,
      });

      if (merchantDiscount) {
        if (itemTotal > merchantDiscount.maxCheckoutValue) {
          const currentDate = new Date();
          const validFrom = new Date(merchantDiscount.validFrom);
          const validTo = new Date(merchantDiscount.validTo);

          // Adjusting the validTo date to the end of the day
          validTo.setHours(23, 59, 59, 999);

          if (validFrom <= currentDate && validTo >= currentDate) {
            let eligibleDates = calculateEligibleDates(
              currentDate,
              validFrom,
              validTo,
              startDate,
              endDate
            );

            const startDateTime = new Date(startDate);
            const endDateTime = new Date(endDate);

            const diffTime = Math.abs(endDateTime - startDateTime);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

            const perDayAmount = itemTotal / diffDays;
            const calculatedAmount = perDayAmount * diffDays;

            if (merchantDiscount.discountType === "Percentage-discount") {
              let discountValue =
                (calculatedAmount * merchantDiscount.discountValue) / 100;

              if (discountValue > merchantDiscount.maxDiscountValue) {
                discountValue = merchantDiscount.maxDiscountValue;
              }

              calculatedMerchantDiscount += discountValue;
            } else if (merchantDiscount.discountType === "Flat-discount") {
              calculatedMerchantDiscount += merchantDiscount.discountValue;
            }
          }
        }
      }
    }

    return calculatedMerchantDiscount;
  } catch (err) {
    throw new Error(`Error in calculating merchant discount: ${err}`);
  }
};

const calculateEligibleDates = (
  currentDate,
  validFrom,
  validTo,
  startDate,
  endDate
) => {
  const deliveryStartDate = new Date(startDate || currentDate);
  const deliveryEndDate = new Date(endDate || currentDate);

  // Determine the effective start and end dates for applying the discount
  const effectiveStartDate =
    deliveryStartDate > validFrom ? deliveryStartDate : validFrom;
  const effectiveEndDate =
    deliveryEndDate < validTo ? deliveryEndDate : validTo;

  // Calculate the number of eligible days within the valid promo period
  const eligibleDates =
    Math.ceil((effectiveEndDate - effectiveStartDate) / (1000 * 60 * 60 * 24)) +
    1;

  return eligibleDates;
};

const getDiscountAmountFromLoyalty = async (customer, cartTotal) => {
  try {
    const loyaltyPoint = await LoyaltyPoint.findOne();

    let discountAmount = 0;

    const pointsLeftForRedemption =
      customer.customerDetails.loyaltyPointLeftForRedemption;

    if (
      loyaltyPoint?.status &&
      cartTotal >= loyaltyPoint.minOrderAmountForRedemption &&
      pointsLeftForRedemption >= loyaltyPoint.redemptionCriteriaPoint
    ) {
      const maxRedemptionAmount =
        (loyaltyPoint.maxRedemptionAmountPercentage / 100) * cartTotal;

      const calculatedDiscount =
        Math.floor(cartTotal / loyaltyPoint.redemptionCriteriaPoint) *
        loyaltyPoint.redemptionCriteriaRupee;

      discountAmount = Math.min(calculatedDiscount, maxRedemptionAmount);
    }

    return discountAmount;
  } catch (err) {
    throw new Error(err.message);
  }
};

const deleteOldLoyaltyPoints = async () => {
  try {
    const isLoyaltyActive = await LoyaltyPoint.findOne();

    if (isLoyaltyActive.status) {
      const date180DaysAgo = new Date();
      date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);

      // Find all customers
      const customers = await Customer.find();

      for (const customer of customers) {
        // Filter loyalty points older than 180 days
        const oldPoints = customer.loyaltyPointDetails.filter(
          (detail) => detail.earnedOn < date180DaysAgo
        );

        if (oldPoints.length > 0) {
          // Calculate points to be deleted for this customer
          const pointsToDelete = oldPoints.reduce(
            (sum, detail) => sum + detail.point,
            0
          );

          // Remove old points from loyaltyPointDetails array
          customer.loyaltyPointDetails = customer.loyaltyPointDetails.filter(
            (detail) => detail.earnedOn >= date180DaysAgo
          );

          // Update loyaltyPointLeftForRedemption
          customer.customerDetails.loyaltyPointLeftForRedemption -=
            pointsToDelete;

          // Save changes to the customer document
          await customer.save();
        }
      }
    }
  } catch (error) {
    console.error("Error deleting old loyalty points:", error);
  }
};

// Universal
const fetchCustomerAndMerchantAndCart = async (customerId, next) => {
  const [customer, cart] = await Promise.all([
    Customer.findById(customerId),
    CustomerCart.findOne({ customerId }),
  ]);

  if (!customer) return next(appError("Customer not found", 404));
  if (!cart) return next(appError("Cart not found", 404));

  const merchant = await Merchant.findById(cart.merchantId);
  if (!merchant) return next(appError("Merchant not found", 404));

  return { customer, cart, merchant };
};

const processVoiceInstructions = async (req, cart, next) => {
  try {
    let voiceInstructionToMerchantURL =
      cart?.cartDetail?.voiceInstructionToMerchant || "";
    let voiceInstructionToAgentURL =
      cart?.cartDetail?.voiceInstructionToAgent || "";

    if (req.files) {
      const { voiceInstructionToMerchant, voiceInstructionToAgent } = req.files;

      if (req.files.voiceInstructionToMerchant) {
        if (voiceInstructionToMerchantURL) {
          await deleteFromFirebase(voiceInstructionToMerchantURL);
        }
        voiceInstructionToMerchantURL = await uploadToFirebase(
          voiceInstructionToMerchant[0],
          "VoiceInstructions"
        );
      }

      if (req.files.voiceInstructionToAgent) {
        if (voiceInstructionToAgentURL) {
          await deleteFromFirebase(voiceInstructionToAgentURL);
        }
        voiceInstructionToAgentURL = await uploadToFirebase(
          voiceInstructionToAgent[0],
          "VoiceInstructions"
        );
      }
    }

    return { voiceInstructionToMerchantURL, voiceInstructionToAgentURL };
  } catch (err) {
    next(appError(err.message));
  }
};

// Promo code helpers
const calculateScheduledCartValue = (cart, promoCodeFound) => {
  const { itemTotal, originalDeliveryCharge } = cart.billDetail;
  const { startDate, endDate, numOfDays } = cart.cartDetail;

  const effectiveStartDate = new Date(
    Math.max(new Date(startDate), promoCodeFound.fromDate)
  );
  const effectiveEndDate = new Date(
    Math.min(new Date(endDate), promoCodeFound.toDate)
  );

  const eligibleDays =
    Math.ceil((effectiveEndDate - effectiveStartDate) / (1000 * 60 * 60 * 24)) +
    1;

  if (
    cart.cartDetail.deliveryMode === "Take Away" ||
    cart.cartDetail.deliveryMode === "Home Delivery"
  ) {
    return promoCodeFound.appliedOn === "Cart-value"
      ? (itemTotal / numOfDays) * eligibleDays
      : (originalDeliveryCharge / numOfDays) * eligibleDays;
  } else {
    const calculatedValue = (originalDeliveryCharge / numOfDays) * eligibleDays;
    return calculatedValue;
    s;
  }
};

const calculatePromoCodeDiscount = (promoCode, total) => {
  if (promoCode.promoType === "Flat-discount") {
    return Math.min(promoCode.discount, promoCode.maxDiscountValue);
  }

  const percentageDiscount = (total * promoCode.discount) / 100;
  return Math.min(percentageDiscount, promoCode.maxDiscountValue);
};

const applyPromoCodeDiscount = (cart, promo, discountValue) => {
  const {
    itemTotal,
    originalDeliveryCharge,
    originalGrandTotal,
    addedTip = 0,
    promoCodeDiscount = 0,
  } = cart.billDetail;

  const { appliedOn, promoCode } = promo;

  let discountAmount = 0;
  let discountedDeliveryCharge = originalDeliveryCharge;

  if (appliedOn.toLowerCase() === "cart-value") {
    discountAmount = Math.min(discountValue, itemTotal);
  } else if (appliedOn.toLowerCase() === "delivery-charge") {
    discountAmount = Math.min(discountValue, originalDeliveryCharge);
    discountedDeliveryCharge = originalDeliveryCharge - discountAmount;
  }

  const discountedGrandTotal = Math.max(
    originalGrandTotal + promoCodeDiscount - discountAmount,
    0
  );
  const subTotal = Math.max(
    itemTotal +
      discountedDeliveryCharge +
      promoCodeDiscount +
      addedTip -
      discountAmount,
    0
  );

  cart.billDetail = {
    ...cart.billDetail,
    discountedGrandTotal,
    discountedDeliveryCharge,
    promoCodeUsed: promoCode,
    discountedAmount: discountAmount,
    subTotal,
    promoCodeDiscount: discountAmount,
  };

  return cart;
};

const deductPromoCodeDiscount = (cart, discount) => {
  const subtractOrNull = (currentValue, discount) => {
    const newValue = currentValue - discount;

    return newValue <= 0 ? null : newValue;
  };

  cart.billDetail.discountedAmount = subtractOrNull(
    cart.billDetail.discountedAmount,
    discount
  );
  cart.billDetail.subTotal += discount;
  cart.billDetail.discountedGrandTotal += discount;
  cart.billDetail.discountedDeliveryCharge = null;

  cart.billDetail.promoCodeUsed = null;
  cart.billDetail.promoCodeDiscount = null;

  return cart;
};

const populateCartDetails = async (customerId) => {
  const cart = await CustomerCart.findOne({ customerId })
    .populate({
      path: "items.productId",
      select: "productName productImageURL description variants",
    })
    .exec();

  // return {
  //   ...cart.toObject(),
  //   items: cart.items.map((item) => ({
  //     ...item,
  //     productId: {
  //       id: item.productId._id,
  //       productName: item.productId.productName,
  //       description: item.productId.description,
  //       productImageURL: item.productId.productImageURL,
  //     },
  //     variantTypeId: item.variantTypeId
  //       ? getVariantDetails(item.productId.variants, item.variantTypeId)
  //       : null,
  //   })),
  // };

  return cart.billDetail;
};

const getVariantDetails = (variants, variantTypeId) => {
  const variantType = variants
    .flatMap((variant) => variant.variantTypes)
    .find((type) => type._id.equals(variantTypeId));

  return variantType
    ? { id: variantType._id, variantTypeName: variantType.typeName }
    : null;
};

module.exports = {
  sortMerchantsBySponsorship,
  getDistanceFromPickupToDelivery,
  calculateDeliveryCharges,
  getTaxAmount,
  createOrdersFromScheduled,
  createOrdersFromScheduledPickAndDrop,
  updateOneDayLoyaltyPointEarning,
  getDeliveryAndSurgeCharge,
  calculateDiscountedPrice,
  getDiscountAmountFromLoyalty,
  completeReferralDetail,
  filterProductIdAndQuantity,
  reduceProductAvailableQuantity,
  calculateMerchantDiscount,
  deleteOldLoyaltyPoints,
  fetchCustomerAndMerchantAndCart,
  processVoiceInstructions,
  calculateScheduledCartValue,
  calculatePromoCodeDiscount,
  applyPromoCodeDiscount,
  populateCartDetails,
  deductPromoCodeDiscount,
};
