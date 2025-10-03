const mongoose = require("mongoose");

const Customer = require("../../models/Customer");
const PickAndCustomCart = require("../../models/PickAndCustomCart");
const Order = require("../../models/Order");
const TemporaryOrder = require("../../models/TemporaryOrder");
const CustomerAppCustomization = require("../../models/CustomerAppCustomization");
const Tax = require("../../models/Tax");
const PromoCode = require("../../models/PromoCode");
const CustomerTransaction = require("../../models/CustomerTransactionDetail");
const ActivityLog = require("../../models/ActivityLog");

const appError = require("../../utils/appError");
const {
  getDistanceFromPickupToDelivery,
  getDeliveryAndSurgeCharge,
} = require("../../utils/customerAppHelpers");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../utils/imageOperation");
const { formatDate, formatTime } = require("../../utils/formatters");
const { sendSocketDataAndNotification } = require("../../utils/socketHelper");

const { findRolesToNotify } = require("../../socket/socket");

const addShopController = async (req, res, next) => {
  try {
    const { latitude, longitude, shopName, place, buyFromAnyWhere } = req.body;

    const customerId = req.userAuth;
    const customer = await Customer.findById(customerId);

    if (!customer) return next(appError("Customer not found", 404));

    let pickupLocation;
    let deliveryLocation;
    let distance;
    let duration;

    if (buyFromAnyWhere) {
      pickupLocation = [];
      deliveryLocation = customer.customerDetails.location;

      distance = 0;
      duration = 0;
    } else {
      pickupLocation = [latitude, longitude];
      deliveryLocation = customer.customerDetails.location;

      const { distanceInKM, durationInMinutes } =
        await getDistanceFromPickupToDelivery(pickupLocation, deliveryLocation);

      distance = distanceInKM;
      duration = durationInMinutes;
    }

    const pickups = {
      location: pickupLocation,
      address: {
        fullName: shopName,
        area: place,
      },
    };

    const drops = {
      location: deliveryLocation,
    };

    const cart = await PickAndCustomCart.findOneAndUpdate(
      {
        customerId,
        deliveryMode: "Custom Order",
      },
      {
        $set: {
          deliveryMode: "Custom Order",
          deliveryOption: "On-demand",
          pickups,
          drops,
          distance,
        },
        $setOnInsert: { customerId },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      cartId: cart._id,
      shopName: buyFromAnyWhere ? "Buy from any store" : shopName,
      place: buyFromAnyWhere ? "" : place,
      distance: parseFloat(distance) || null,
      duration: duration || null,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getCustomOrderItems = async (req, res, next) => {
  try {
    const { cartId } = req.query;

    const cart = await PickAndCustomCart.findById(cartId);

    if (!cart) return next(appError("Cart not found", 404));

    const formattedResponse = cart?.drops[0]?.items?.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      unit: item.unit,
      numOfUnits: item.numOfUnits,
      quantity: item.quantity,
      itemImageURL: item.itemImageURL,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const addItemsToCartController = async (req, res, next) => {
  try {
    const { itemName, quantity, unit, numOfUnits } = req.body;

    const customerId = req.userAuth;

    const cart = await PickAndCustomCart.findOne({
      customerId,
      deliveryMode: "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    let itemImageURL;

    if (req.file) {
      itemImageURL = await uploadToFirebase(
        req.file,
        "Custom-order-item-Image"
      );
    }

    let updatedItems = {
      itemId: new mongoose.Types.ObjectId(),
      itemName,
      quantity,
      unit,
      numOfUnits,
      itemImageURL,
    };

    cart?.drops[0]?.items.push(updatedItems);

    await cart.save();

    res.status(200).json({
      cartId: cart._id,
      customerId: cart.customerId,
      cartDetail: cart.cartDetail,
      items: cart?.drops[0]?.items?.map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        numOfUnits: item.numOfUnits,
        itemImage: item.itemImageURL,
      })),
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getSingleItemController = async (req, res, next) => {
  try {
    const { itemId } = req.params;

    const cart = await PickAndCustomCart.findOne({
      customerId: req.userAuth,
      deliveryMode: "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const dropDetail = cart.drops;
    const items = dropDetail[0]?.items;

    if (!Array.isArray(items)) {
      return next(appError("Invalid cart structure", 500));
    }

    const item = items?.find((item) => item.itemId.toString() === itemId);

    if (!item) return next(appError("Item not found", 404));

    const formattedResponse = {
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      numOfUnits: item.numOfUnits,
      itemImage: item.itemImageURL,
    };

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const editItemInCartController = async (req, res, next) => {
  try {
    const { itemName, quantity, unit, numOfUnits } = req.body;
    const { itemId } = req.params;
    const customerId = req.userAuth;

    const cart = await PickAndCustomCart.findOne({
      customerId,
      deliveryMode: "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const dropDetail = cart.drops;
    const items = dropDetail[0]?.items;

    if (!Array.isArray(items)) {
      return next(appError("Invalid cart structure", 500));
    }

    const itemIndex = items.findIndex(
      (item) => item.itemId.toString() === itemId.toString()
    );

    if (itemIndex === -1) return next(appError("Item not found", 404));

    let itemImageURL = items[itemIndex].itemImageURL;

    if (req.file) {
      if (itemImageURL) {
        await deleteFromFirebase(itemImageURL);
      }
      itemImageURL = await uploadToFirebase(
        req.file,
        "Custom-order-item-Image"
      );
    }

    // Update the item details
    items[itemIndex] = {
      itemId: items[itemIndex].itemId,
      itemName,
      quantity,
      unit,
      numOfUnits,
      itemImageURL,
    };

    await cart.save();

    const formattedItems = items?.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      numOfUnits: item.numOfUnits,
      itemImage: item.itemImageURL,
    }));

    res.status(200).json(formattedItems);
  } catch (err) {
    next(appError(err.message));
  }
};

const deleteItemInCartController = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const customerId = req.userAuth;

    const cart = await PickAndCustomCart.findOne({
      customerId,
      deliveryMode: "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const dropDetail = cart.drops;
    const items = dropDetail[0]?.items;

    if (!Array.isArray(items)) {
      return next(appError("Invalid cart structure", 500));
    }

    const itemIndex = items?.findIndex(
      (item) => item.itemId.toString() === itemId.toString()
    );

    if (itemIndex === -1) return next(appError("Item not found", 404));

    let itemImageURL = items[itemIndex].itemImageURL;

    if (itemImageURL) await deleteFromFirebase(itemImageURL);

    // Remove the item from the cart
    items.splice(itemIndex, 1);

    // Save the updated cart
    await cart.save();

    res.status(200).json({
      success: true,
      message: "Item deleted successfully",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const addDeliveryAddressController = async (req, res, next) => {
  try {
    const {
      deliveryAddressType,
      deliveryAddressOtherAddressId,
      newDeliveryAddress,
      addNewDeliveryToAddressBook,
      instructionInDelivery,
    } = req.body;

    const customerId = req.userAuth;

    const [customer, cartFound] = await Promise.all([
      Customer.findById(customerId),
      PickAndCustomCart.findOne({
        customerId,
        deliveryMode: "Custom Order",
      }),
    ]);

    if (!customer) return next(appError("Customer not found", 404));
    if (!cartFound) return next(appError("Cart not found", 404));

    // Retrieve the specified drop address coordinates from the customer data
    let deliveryCoordinates;
    let deliveryAddress = {};

    if (newDeliveryAddress) {
      deliveryAddress = {
        ...newDropAddress,
      };

      deliveryCoordinates = newDropAddress.coordinates;

      if (addNewDeliveryToAddressBook) {
        if (deliveryAddressType === "home") {
          customer.customerDetails.homeAddress = deliveryAddress;
        } else if (deliveryAddressType === "work") {
          customer.customerDetails.workAddress = deliveryAddress;
        } else if (deliveryAddressType === "other") {
          customer.customerDetails.otherAddress.push({
            id: new mongoose.Types.ObjectId(),
            ...deliveryAddress,
          });
        }

        await customer.save();
      }
    } else {
      if (deliveryAddressType === "home") {
        deliveryCoordinates = customer.customerDetails.homeAddress.coordinates;
        deliveryAddress = { ...customer.customerDetails.homeAddress };
      } else if (deliveryAddressType === "work") {
        deliveryCoordinates = customer.customerDetails.workAddress.coordinates;
        deliveryAddress = { ...customer.customerDetails.workAddress };
      } else {
        const otherAddress = customer.customerDetails.otherAddress.find(
          (addr) => addr.id.toString() === deliveryAddressOtherAddressId
        );
        if (otherAddress) {
          deliveryCoordinates = otherAddress.coordinates;
          deliveryAddress = { ...otherAddress };
        } else {
          return res.status(404).json({ error: "Address not found" });
        }
      }
    }

    let distance = 0;
    let duration = 0;
    let pickupLocation = [];
    let deliveryLocation = [];

    const havePickupLocation =
      cartFound?.pickupDropDetails[0]?.pickups[0]?.pickupLocation?.length === 2;

    if (havePickupLocation) {
      pickupLocation =
        cartFound?.pickupDropDetails[0]?.pickups[0]?.pickupLocation;
      deliveryLocation = deliveryCoordinates;

      const { distanceInKM, durationInMinutes } =
        await getDistanceFromPickupToDelivery(pickupLocation, deliveryLocation);

      distance = parseFloat(distanceInKM);
      duration = parseInt(durationInMinutes);
    }

    let voiceInstructionToAgentURL =
      cartFound?.cartDetail?.voiceInstructionToDeliveryAgent || "";

    if (req.file) {
      if (voiceInstructionToAgentURL) {
        await deleteFromFirebase(voiceInstructionToAgentURL);
      }

      voiceInstructionToAgentURL = await uploadToFirebase(
        req.file,
        "VoiceInstructions"
      );
    }

    let detail = {
      deliveryOption: "On-demand",
      pickups: [...cartFound?.pickupDropDetails[0]?.pickups],
      drops: [
        {
          location: deliveryLocation,
          address: deliveryAddress,
          instructionInDelivery,
          voiceInstructionInDelivery: voiceInstructionToAgentURL,
          items: [...cartFound?.pickupDropDetails[0]?.drops[0].items],
        },
      ],
      distance,
      duration,
    };

    let updatedDeliveryCharges = 0;
    let updatedSurgeCharges = 0;
    let taxFound;

    if (distance && distance > 0) {
      const { deliveryCharges, surgeCharges } = await getDeliveryAndSurgeCharge(
        cartFound.customerId,
        cartFound.deliveryMode,
        distance
      );

      updatedDeliveryCharges = deliveryCharges;
      updatedSurgeCharges = surgeCharges;

      const tax = await CustomerAppCustomization.findOne({}).select(
        "customOrderCustomization"
      );

      taxFound = await Tax.findById(tax.customOrderCustomization.taxId);
    }

    let taxAmount = 0;
    if (taxFound && taxFound.status) {
      const calculatedTax = (updatedDeliveryCharges * taxFound.tax) / 100;
      taxAmount = parseFloat(calculatedTax.toFixed(2));
    }

    updatedBillDetail = {
      originalDeliveryCharge: Math.round(updatedDeliveryCharges) || 0,
      deliveryChargePerDay: null,
      discountedDeliveryCharge: null,
      discountedAmount: null,
      originalGrandTotal:
        Math.round(updatedDeliveryCharges + taxAmount + updatedSurgeCharges) ||
        0,
      discountedGrandTotal: null,
      itemTotal: null,
      addedTip: null,
      subTotal: null,
      vehicleType: null,
      taxAmount,
      surgePrice: Math.round(updatedSurgeCharges) || null,
    };

    await PickAndCustomCart.findByIdAndUpdate(
      cartFound._id,
      {
        ...detail,
        billDetail: updatedBillDetail,
      },
      { new: true }
    );

    res.status(200).json({
      cartId: cartFound._id,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getCustomCartBill = async (req, res, next) => {
  try {
    const { cartId } = req.query;

    const cart = await PickAndCustomCart.findById(cartId);

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    const havePickupLocation =
      cart?.pickupDropDetails[0]?.pickups[0]?.pickupLocation?.length === 2;

    const billDetail = {
      deliveryCharge: havePickupLocation
        ? cart?.billDetail?.discountedDeliveryCharge ||
          cart?.billDetail?.originalDeliveryCharge
        : null,
      discountedAmount: havePickupLocation
        ? cart?.billDetail?.discountedAmount
        : null,
      grandTotal: havePickupLocation
        ? cart?.billDetail?.discountedGrandTotal ||
          cart?.billDetail?.originalGrandTotal
        : null,
      taxAmount: havePickupLocation ? cart?.billDetail?.taxAmount : null,
      itemTotal: cart?.billDetail?.itemTotal || null,
      addedTip: cart?.billDetail?.addedTip || null,
      subTotal: havePickupLocation ? cart?.billDetail?.subTotal : null,
      surgePrice: cart?.billDetail?.surgePrice || null,
      promoCodeUsed: cart?.billDetail?.promoCodeUsed || null,
    };

    res.status(200).json(billDetail);
  } catch (err) {
    next(appError(err.message));
  }
};

const confirmCustomOrderController = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const { cartId } = req.body;

    const [customer, cart] = await Promise.all([
      Customer.findById(customerId),
      PickAndCustomCart.findOne({
        _id: mongoose.Types.ObjectId.createFromHexString(cartId),
        customerId,
        deliveryMode: "Custom Order",
      }),
    ]);

    if (!customer) return next(appError("Customer not found", 404));
    if (!cart) return next(appError("Cart not found", 404));

    const orderAmount =
      cart.billDetail.discountedGrandTotal ||
      cart.billDetail.originalGrandTotal;

    let orderBill = {
      deliveryChargePerDay: cart.billDetail.deliveryChargePerDay,
      deliveryCharge:
        cart.billDetail.discountedDeliveryCharge ||
        cart.billDetail.originalDeliveryCharge,
      taxAmount: cart.billDetail.taxAmount,
      discountedAmount: cart.billDetail.discountedAmount,
      promoCodeUsed: cart.billDetail.promoCodeUsed,
      surgePrice: cart.billDetail.surgePrice,
      grandTotal:
        cart.billDetail.discountedGrandTotal ||
        cart.billDetail.originalGrandTotal,
      itemTotal: cart.billDetail.itemTotal,
      addedTip: cart.billDetail.addedTip,
      subTotal: cart.billDetail.subTotal,
    };

    // Generate a unique order ID
    const orderId = new mongoose.Types.ObjectId();

    const deliveryTime = new Date();
    deliveryTime.setMinutes(deliveryTime.getMinutes() + 61);

    // Store order details temporarily in the database
    const tempOrder = await TemporaryOrder.create({
      orderId,
      customerId,

      deliveryMode: "Custom Order",
      deliveryOption: cart.deliveryOption,

      pickups: cart.pickups,
      drops: cart.drops,

      billDetail: orderBill,
      distance: cart.distance,

      deliveryTime,
      startDate: cart.startDate,
      endDate: cart.endDate,
      time: cart.time,
      numOfDays: cart.numOfDays,

      totalAmount:
        cart?.billDetail?.discountedGrandTotal ||
        cart?.billDetail?.originalGrandTotal ||
        0,
      paymentMode: "Cash-on-delivery",
      paymentStatus: "Pending",
    });

    if (!tempOrder) return next(appError("Error in creating temporary order"));

    await Promise.all([
      customer.save(),
      CustomerTransaction.create({
        customerId,
        madeOn: new Date(),
        transactionType: "Bill",
        transactionAmount: orderAmount,
        type: "Debit",
      }),
      PickAndCustomCart.deleteOne({ customerId }),
      PromoCode.findOneAndUpdate(
        { promoCode: tempOrder.billDetail.promoCodeUsed },
        { $inc: { noOfUserUsed: 1 } }
      ),
    ]);

    // Return countdown timer to client
    res.status(200).json({
      success: true,
      orderId,
      createdAt: tempOrder.createdAt,
      deliveryMode: tempOrder.orderDetail.deliveryMode,
    });

    // After 60 seconds, create the order if it is not cancelled
    setTimeout(async () => {
      const storedOrderData = await TemporaryOrder.findOne({ orderId });

      if (storedOrderData) {
        const newOrder = await Order.create({
          customerId: storedOrderData.customerId,

          deliveryMode: storedOrderData.deliveryMode,
          deliveryOption: storedOrderData.deliveryOption,

          pickups: storedOrderData.pickups,
          drops: storedOrderData.drops,

          billDetail: storedOrderData.billDetail,
          distance: storedOrderData.distance,

          deliveryTime: storedOrderData.deliveryTime,
          startDate: storedOrderData.startDate,
          endDate: storedOrderData.endDate,
          time: storedOrderData.time,
          numOfDays: storedOrderData.numOfDays,

          totalAmount: storedOrderData.totalAmount,

          paymentMode: storedOrderData.paymentMode,
          paymentStatus: storedOrderData.paymentStatus,
          orderDetailStepper: {
            created: {
              by: "Customer",
              userId: req.userAuth,
              date: new Date(),
              location: storedOrderData?.drops[0]?.deliveryLocation || [],
            },
          },
        });

        if (!newOrder) {
          return next(appError("Error in creating order"));
        }

        // Remove the temporary order data from the database
        await Promise.all([
          TemporaryOrder.deleteOne({ orderId }),
          ActivityLog.create({
            userId: req.userAuth,
            userType: req.userRole,
            description: `Custom Order (#${
              newOrder._id
            }) from customer app by ${req?.userName || "N/A"} ( ${
              req.userAuth
            } )`,
          }),
        ]);

        const eventName = "newOrderCreated";

        // Fetch notification settings to determine roles
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
          billDetail: newOrder.billDetail,

          //? Data for displaying detail in all orders table
          _id: newOrder._id,
          orderStatus: newOrder.status,
          merchantName: "-",
          customerName:
            newOrder?.drops[0]?.address?.fullName ||
            newOrder?.customerId?.fullName ||
            "-",
          deliveryMode: newOrder?.deliveryMode,
          orderDate: formatDate(newOrder.createdAt),
          orderTime: formatTime(newOrder.createdAt),
          deliveryDate: newOrder?.deliveryTime
            ? formatDate(newOrder?.deliveryTime)
            : "-",
          deliveryTime: newOrder?.deliveryTime
            ? formatTime(newOrder.deliveryTime)
            : "-",
          paymentMethod: newOrder.paymentMode,
          deliveryOption: newOrder.deliveryOption,
          amount: newOrder.billDetail.grandTotal,
        };

        const userIds = {
          admin: process.env.ADMIN_ID,
          merchant: newOrder?.merchantId?._id,
          agent: newOrder?.agentId,
          customer: newOrder?.customerId,
        };

        await sendSocketDataAndNotification({
          rolesToNotify,
          userIds,
          eventName,
          notificationData,
          socketData,
        });
      }
    }, 60000);
  } catch (err) {
    next(appError(err.message));
  }
};

const cancelCustomBeforeOrderCreationController = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    const orderFound = await TemporaryOrder.findOne({ orderId });
    if (!orderFound) {
      res.status(200).json({
        success: false,
        message: "Order creation already processed or not found",
      });

      return;
    }

    const customerFound = await Customer.findById(orderFound.customerId);
    if (!customerFound) return next(appError("Customer not found", 404));

    let updatedTransactionDetail = {
      customerId: customerFound._id,
      transactionType: "Refund",
      madeOn: new Date(),
      type: "Credit",
    };

    if (orderFound.paymentMode === "Famto-cash") {
      const orderAmount = orderFound.billDetail.grandTotal;
      if (orderFound.deliveryOption === "On-demand") {
        customerFound.customerDetails.walletBalance += orderAmount;
        updatedTransactionDetail.transactionAmount = orderAmount;
      }

      // Remove the temporary order data from the database and push transaction to customer transaction
      await Promise.all([
        TemporaryOrder.deleteOne({ orderId }),
        customerFound.save(),
        CustomerTransaction.create(updatedTransactionDetail),
      ]);

      res.status(200).json({
        success: true,
        message: "Order cancelled and amount refunded to wallet",
      });

      return;
    } else if (orderFound.paymentMode === "Cash-on-delivery") {
      // Remove the temporary order data from the database
      await Promise.all([
        TemporaryOrder.deleteOne({ orderId }),
        PromoCode.findOneAndUpdate(
          { promoCode: orderFound.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: -1 } }
        ),
      ]);

      res.status(200).json({ success: true, message: "Order cancelled" });

      return;
    }
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addShopController,
  getCustomOrderItems,
  addItemsToCartController,
  editItemInCartController,
  deleteItemInCartController,
  addDeliveryAddressController,
  confirmCustomOrderController,
  cancelCustomBeforeOrderCreationController,
  getSingleItemController,
  getCustomCartBill,
};
