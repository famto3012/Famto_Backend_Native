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

    let updatedCartDetail;
    let pickupLocation;
    let deliveryLocation;
    let distance;
    let duration;

    //? If buyFromAnyWhere is true, set pickupLocation to null
    if (buyFromAnyWhere) {
      pickupLocation = [];
      deliveryLocation = customer.customerDetails.location;

      distance = 0;
      duration = 0;

      updatedCartDetail = {
        pickupLocation,
        deliveryLocation,
        deliveryMode: "Custom Order",
        deliveryOption: "On-demand",
        distance,
        duration,
      };
    } else {
      pickupLocation = [latitude, longitude];
      deliveryLocation = customer.customerDetails.location;

      const { distanceInKM, durationInMinutes } =
        await getDistanceFromPickupToDelivery(pickupLocation, deliveryLocation);

      distance = distanceInKM;
      duration = durationInMinutes;

      updatedCartDetail = {
        pickupLocation,
        pickupAddress: {
          fullName: shopName,
          area: place,
        },
        deliveryLocation,
        deliveryMode: "Custom Order",
        deliveryOption: "On-demand",
        distance,
        duration,
      };
    }

    const cart = await PickAndCustomCart.findOneAndUpdate(
      {
        customerId,
        "cartDetail.deliveryMode": "Custom Order",
      },
      {
        $set: { cartDetail: updatedCartDetail },
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

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    const formattedResponse = cart.items?.map((item) => ({
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
      "cartDetail.deliveryMode": "Custom Order",
    });

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

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

    cart.items.push(updatedItems);

    await cart.save();

    res.status(200).json({
      cartId: cart._id,
      customerId: cart.customerId,
      cartDetail: cart.cartDetail,
      items: cart.items?.map((item) => ({
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
      "cartDetail.deliveryMode": "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const item = cart.items?.find((item) => item.itemId.toString() === itemId);
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
      "cartDetail.deliveryMode": "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const itemIndex = cart.items.findIndex(
      (item) => item.itemId.toString() === itemId
    );

    if (itemIndex === -1) return next(appError("Item not found", 404));

    let itemImageURL = cart.items[itemIndex].itemImageURL;

    if (req.file) {
      // If there's a new image, delete the old one and upload the new image
      if (cart.items[itemIndex].itemImageURL) {
        await deleteFromFirebase(cart.items[itemIndex].itemImageURL);
      }

      itemImageURL = await uploadToFirebase(
        req.file,
        "Custom-order-item-Image"
      );
    }

    // Update the item details
    cart.items[itemIndex] = {
      itemId: cart.items[itemIndex].itemId,
      itemName,
      quantity,
      unit,
      numOfUnits,
      itemImageURL,
    };

    await cart.save();

    const formattedItems = cart.items?.map((item) => ({
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
      "cartDetail.deliveryMode": "Custom Order",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const itemIndex = cart.items.findIndex(
      (item) => item.itemId.toString() === itemId
    );

    if (itemIndex === -1) return next(appError("Item not found", 404));

    let itemImageURL = cart.items[itemIndex].itemImageURL;

    if (itemImageURL) await deleteFromFirebase(itemImageURL);

    // Remove the item from the cart
    cart.items.splice(itemIndex, 1);

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
        "cartDetail.deliveryMode": "Custom Order",
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

    const havePickupLocation =
      cartFound?.cartDetail?.pickupLocation?.length === 2;

    if (havePickupLocation) {
      const pickupLocation = cartFound.cartDetail.pickupLocation;
      const deliveryLocation = deliveryCoordinates;

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

    let updatedCartDetail = {
      pickupLocation: cartFound?.cartDetail?.pickupLocation || [],
      pickupAddress: cartFound.cartDetail.pickupAddress,
      deliveryAddress: deliveryAddress._doc,
      deliveryLocation: deliveryCoordinates,
      deliveryMode: cartFound.cartDetail.deliveryMode,
      distance,
      duration,
      instructionInDelivery,
      voiceInstructionToDeliveryAgent: voiceInstructionToAgentURL,
      deliveryOption: "On-demand",
    };

    let updatedDeliveryCharges = 0;
    let updatedSurgeCharges = 0;
    let taxFound;

    if (distance && distance > 0) {
      const { deliveryCharges, surgeCharges } = await getDeliveryAndSurgeCharge(
        cartFound.customerId,
        cartFound.cartDetail.deliveryMode,
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
        cartDetail: updatedCartDetail,
        items: cartFound.items,
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

    const havePickupLocation = cart?.cartDetail?.pickupLocation?.length === 2;

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
        "cartDetail.deliveryMode": "Custom Order",
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

    // Store order details temporarily in the database
    const tempOrder = await TemporaryOrder.create({
      orderId,
      customerId,
      items: cart.items,
      orderDetail: cart.cartDetail,
      billDetail: orderBill,
      totalAmount: orderAmount,
      status: "Pending",
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
    });

    // After 60 seconds, create the order if it is not cancelled
    setTimeout(async () => {
      const storedOrderData = await TemporaryOrder.findOne({ orderId });

      if (storedOrderData) {
        const deliveryTime = new Date();
        deliveryTime.setHours(deliveryTime.getHours() + 1);

        const newOrder = await Order.create({
          customerId: storedOrderData.customerId,
          items: storedOrderData.items,
          orderDetail: { ...storedOrderData.orderDetail, deliveryTime },
          billDetail: storedOrderData.billDetail,
          totalAmount: storedOrderData.totalAmount,
          status: storedOrderData.status,
          paymentMode: storedOrderData.paymentMode,
          paymentStatus: storedOrderData.paymentStatus,
          "orderDetailStepper.created": {
            by: storedOrderData.orderDetail.deliveryAddress.fullName,
            userId: storedOrderData.customerId,
            date: new Date(),
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
          orderDetail: newOrder.orderDetail,
          billDetail: newOrder.billDetail,

          //? Data for displaying detail in all orders table
          _id: newOrder._id,
          orderStatus: newOrder.status,
          merchantName:
            newOrder?.merchantId?.merchantDetail?.merchantName || "-",
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
      if (orderFound.orderDetail.deliveryOption === "On-demand") {
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
