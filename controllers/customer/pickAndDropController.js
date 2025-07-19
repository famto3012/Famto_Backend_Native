const mongoose = require("mongoose");

const Customer = require("../../models/Customer");
const CustomerPricing = require("../../models/CustomerPricing");
const PromoCode = require("../../models/PromoCode");
const Order = require("../../models/Order");
const Agent = require("../../models/Agent");
const PickAndCustomCart = require("../../models/PickAndCustomCart");
const ScheduledPickAndCustom = require("../../models/ScheduledPickAndCustom");
const CustomerSurge = require("../../models/CustomerSurge");
const TemporaryOrder = require("../../models/TemporaryOrder");
const Tax = require("../../models/Tax");
const CustomerAppCustomization = require("../../models/CustomerAppCustomization");
const CustomerTransaction = require("../../models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("../../models/CustomerWalletTransaction");
const ActivityLog = require("../../models/ActivityLog");

const appError = require("../../utils/appError");
const {
  calculateDeliveryCharges,
  getDistanceFromMultipleCoordinates,
  filterCoordinatesFromData,
} = require("../../utils/customerAppHelpers");
const {
  createRazorpayOrderId,
  verifyPayment,
  razorpayRefund,
} = require("../../utils/razorpayPayment");
const { formatDate, formatTime } = require("../../utils/formatters");
const {
  uploadToFirebase,
  deleteFromFirebase,
} = require("../../utils/imageOperation");
const { sendSocketDataAndNotification } = require("../../utils/socketHelper");

const { findRolesToNotify } = require("../../socket/socket");

const initializePickAndDrop = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    await PickAndCustomCart.findOneAndDelete({
      customerId,
      "cartDetail.deliveryMode": "Pick and Drop",
    });

    res.status(200).json({ message: "Cart is cleared" });
  } catch (err) {
    next(appError(err.message));
  }
};

const addPickUpAddressController = async (req, res, next) => {
  try {
    const { cartData } = req.body;

    if (!cartData) {
      return next(appError("Invalid cart data", 400));
    }

    const parsedData = JSON.parse(cartData);

    const customer = await Customer.findById(req.userAuth);

    if (!customer) return next(appError("Customer not found", 404));

    const coordinates = filterCoordinatesFromData(parsedData);

    const { distanceInKM, duration } = await getDistanceFromMultipleCoordinates(
      coordinates
    );

    const pickups = parsedData.pickups;
    const drops = parsedData.drops;

    const files = req.files;

    for (const file of files) {
      const matchPickup = file.fieldname.match(/^pickupVoice(\d+)$/);
      const matchDrop = file.fieldname.match(/^dropVoice(\d+)$/);

      if (matchPickup) {
        const index = parseInt(matchPickup[1]);
        const pickup = pickups?.[index];

        if (pickup) {
          const existingUrl = pickup.voiceInstructionInPickup;
          if (existingUrl) {
            await deleteFromFirebase(existingUrl);
          }

          const url = await uploadToFirebase(file, "VoiceInstructions");
          pickup.voiceInstructionInPickup = url;
        }
      }

      if (matchDrop) {
        const index = parseInt(matchDrop[1]);
        const drop = drops?.[index];

        if (drop) {
          const existingUrl = drop.voiceInstructionInDelivery;
          if (existingUrl) {
            await deleteFromFirebase(existingUrl);
          }

          const url = await uploadToFirebase(file, "VoiceInstructions");
          drop.voiceInstructionInDelivery = url;
        }
      }
    }

    const newCart = await PickAndCustomCart.findOneAndUpdate(
      { customerId: customer._id, deliveryMode: "Pick and Drop" },
      {
        customerId: customer._id,
        deliveryMode: "Pick and Drop",
        deliveryOption: "On-demand",
        pickups,
        drops,
        distance: distanceInKM,
        duration,
      },
      {
        new: true,
        upsert: true,
      }
    );

    res.status(200).json({ success: true, cartId: newCart._id });
  } catch (err) {
    next(appError(err.message));
  }
};

const getPickAndDropItems = async (req, res, next) => {
  try {
    const { cartId } = req.query;

    const cart = await PickAndCustomCart.findById(cartId);

    if (!cart) return next(appError("Cart not found", 404));

    const items = getCartItems(cart);

    res.status(200).json(items);
  } catch (err) {
    next(appError(err.message));
  }
};

const getVehiclePricingDetailsController = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const customer = await Customer.findById(customerId);

    if (!customer) return next(appError("Customer not found", 404));

    const { cartId } = req.query;

    const cartFound = await PickAndCustomCart.findOne({
      _id: cartId,
      customerId,
      deliveryMode: "Pick and Drop",
    });

    if (!cartFound) return next(appError("Customer cart not found", 404));

    const items = getCartItems(cartFound);

    const totalItemWeight = items.reduce((total, item) => {
      const weight = (item.weight || 1) * (item.quantity || 1);
      return total + weight;
    }, 0);

    const agents = await Agent.find({}).select("vehicleDetail");
    const vehicleTypes = agents.flatMap((agent) =>
      agent.vehicleDetail.map((vehicle) => vehicle.type)
    );
    const uniqueVehicleTypes = [...new Set(vehicleTypes)];

    // Fetch the customer pricing details for all vehicle types
    const customerPricingArray = await CustomerPricing.find({
      deliveryMode: "Pick and Drop",
      geofenceId: customer.customerDetails.geofenceId,
      status: true,
      vehicleType: { $in: uniqueVehicleTypes },
    });

    if (!customerPricingArray || customerPricingArray.length === 0) {
      return next(appError("Customer Pricing not found", 404));
    }

    const customerSurge = await CustomerSurge.findOne({
      geofenceId: customer.customerDetails.geofenceId,
      status: true,
    });

    let surgeCharges = 0;

    const { distance, duration } = cartFound;

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

    const vehicleData = uniqueVehicleTypes
      ?.map((vehicleType) => {
        const pricing = customerPricingArray.find(
          (price) => price.vehicleType === vehicleType
        );

        if (pricing) {
          const baseFare = pricing.baseFare;
          const baseDistance = pricing.baseDistance;
          const fareAfterBaseDistance = pricing.fareAfterBaseDistance;

          const deliveryCharges = calculateDeliveryCharges(
            distance,
            baseFare,
            baseDistance,
            fareAfterBaseDistance
          );

          let additionalWeightCharge = 0;
          if (totalItemWeight > pricing.baseWeightUpto) {
            additionalWeightCharge =
              (totalItemWeight - pricing.baseWeightUpto) *
              pricing.fareAfterBaseWeight;
          }

          let calculatedDeliveryCharges =
            deliveryCharges + additionalWeightCharge;

          if (cartFound?.cartDetail?.numOfDays === null) {
            calculatedDeliveryCharges += surgeCharges || 0;
          }

          if (cartFound?.cartDetail?.numOfDays > 0) {
            calculatedDeliveryCharges =
              deliveryCharges * cartFound.cartDetail.numOfDays;
          }

          console.log({ deliveryCharges, surgeCharges });

          return {
            vehicleType,
            deliveryCharges: Math.round(calculatedDeliveryCharges),
            surgeCharges,
            distance,
            duration,
          };
        } else {
          return null;
        }
      })
      .filter(Boolean);

    res.status(200).json(vehicleData);
  } catch (err) {
    next(appError(err.message));
  }
};

const confirmPickAndDropVehicleType = async (req, res, next) => {
  try {
    const { vehicleType, deliveryCharges, surgeCharges = 0 } = req.body;
    const customerId = req.userAuth;

    // Find the cart for the customer
    const cart = await PickAndCustomCart.findOne({
      customerId,
      deliveryMode: "Pick and Drop",
    });

    if (!cart) return next(appError("Cart not found", 400));

    const customization = await CustomerAppCustomization.findOne().select(
      "pickAndDropOrderCustomization"
    );
    const taxId = customization?.pickAndDropOrderCustomization?.taxId;

    const taxFound = await Tax.findById(taxId);

    let taxAmount = 0;
    if (taxFound && taxFound.status) {
      const calculatedTax = (deliveryCharges * taxFound.tax) / 100;
      taxAmount = parseFloat(calculatedTax.toFixed(2));
    }

    const originalDeliveryCharge = Math.round(deliveryCharges - surgeCharges);
    const originalGrandTotal = Math.round(deliveryCharges + taxAmount);

    cart.billDetail = {
      taxAmount,
      originalDeliveryCharge,
      vehicleType,
      originalGrandTotal,
      taxAmount,
      surgePrice: surgeCharges,
    };

    await cart.save();

    const items = getCartItems(cart);

    res.status(200).json({
      cartId: cart._id,
      items,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getPickAndDropBill = async (req, res, next) => {
  try {
    const { cartId } = req.query;

    const cart = await PickAndCustomCart.findOne({
      _id: mongoose.Types.ObjectId.createFromHexString(cartId),
      customerId: req.userAuth,
      deliveryMode: "Pick and Drop",
    });

    if (!cart) return next(appError("Cart not found", 404));

    const billDetail = {
      deliveryCharge:
        cart?.billDetail?.discountedDeliveryCharge ||
        cart?.billDetail?.originalDeliveryCharge ||
        null,
      surgePrice: cart?.billDetail?.surgePrice || null,
      addedTip: cart?.billDetail?.addedTip || null,
      discountedAmount: cart?.billDetail?.discountedAmount || null,
      promoCodeUsed: cart?.billDetail?.promoCodeUsed || null,
      taxAmount: cart?.billDetail?.taxAmount || null,
      grandTotal: cart?.billDetail?.discountedAmount
        ? cart.billDetail.discountedGrandTotal
        : cart?.billDetail?.originalGrandTotal,
    };

    res.status(200).json(billDetail);
  } catch (err) {
    next(appError(err.message));
  }
};

const confirmPickAndDropController = async (req, res, next) => {
  try {
    const { paymentMode } = req.body;
    const customerId = req.userAuth;

    const [customer, cart] = await Promise.all([
      Customer.findById(customerId),
      PickAndCustomCart.findOne({
        customerId,
        deliveryMode: "Pick and Drop",
      }),
    ]);

    if (!customer) return next(appError("Customer not found", 404));
    if (!cart) return next(appError("Cart not found", 404));

    const orderAmount = parseFloat(
      cart.billDetail.discountedGrandTotal || cart.billDetail.originalGrandTotal
    );

    if (isNaN(orderAmount) || orderAmount <= 0)
      return next(appError("Invalid order amount", 400));

    if (paymentMode === "Famto-cash") {
      const orderAmount =
        cart.billDetail.discountedGrandTotal ||
        cart.billDetail.originalGrandTotal;

      let orderBill = {
        deliveryChargePerDay: cart.billDetail.deliveryChargePerDay,
        deliveryCharge:
          cart.billDetail.discountedDeliveryCharge ||
          cart.billDetail.originalDeliveryCharge,
        discountedAmount: cart.billDetail.discountedAmount,
        promoCodeUsed: cart.billDetail.promoCodeUsed,
        grandTotal:
          cart.billDetail.discountedGrandTotal ||
          cart.billDetail.originalGrandTotal,
        addedTip: cart.billDetail.addedTip,
        vehicleType: cart.billDetail.vehicleType,
        surgePrice: cart.billDetail.surgePrice,
      };

      let walletTransaction = {
        customerId,
        closingBalance: customer?.customerDetails?.walletBalance,
        transactionAmount: orderAmount,
        date: new Date(),
        type: "Debit",
      };

      let customerTransaction = {
        madeOn: new Date(),
        transactionType: "Bill",
        transactionAmount: orderAmount,
        type: "Debit",
        customerId,
      };

      const deliveryTime = new Date();
      deliveryTime.setMinutes(deliveryTime.getMinutes() + 61);

      customer.customerDetails.walletBalance -= orderAmount;

      let newOrder;
      if (cart.deliveryOption === "Scheduled") {
        newOrder = await ScheduledPickAndCustom.create({
          customerId,
          items: cart.items,
          orderDetail: cart.cartDetail,
          billDetail: orderBill,
          totalAmount: orderAmount,
          status: "Pending",
          paymentMode: "Online-payment",
          paymentStatus: "Completed",
          startDate: cart.cartDetail.startDate,
          endDate: cart.cartDetail.endDate,
          time: cart.cartDetail.time,
        });

        await Promise.all([
          customer.save(),
          PickAndCustomCart.deleteOne({ customerId }),
          CustomerTransaction.create(customerTransaction),
          ActivityLog.create({
            userId: req.userAuth,
            userType: req.userRole,
            description: `Scheduled Pick & Drop (#${
              newOrder._id
            }) from customer app by ${req?.userName || "N/A"} ( ${
              req.userAuth
            } )`,
          }),
          PromoCode.findOneAndUpdate(
            { promoCode: newOrder.billDetail.promoCodeUsed },
            { $inc: { noOfUserUsed: 1 } }
          ),
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

        res.status(200).json({
          success: true,
          orderId: newOrder._id,
          createdAt: null,
        });

        await sendSocketDataAndNotification({
          rolesToNotify,
          userIds,
          eventName,
          notificationData,
          socketData,
        });

        return;
      }

      // Generate a unique order ID
      const orderId = new mongoose.Types.ObjectId();

      // Store order details temporarily in the database
      const tempOrder = await TemporaryOrder.create({
        orderId,
        customerId,

        deliveryMode: "Pick and Drop",
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
        paymentMode: "Famto-cash",
        paymentStatus: "Completed",
      });

      if (!tempOrder)
        return next(appError("Error in creating temporary order"));

      await Promise.all([
        customer.save(),
        PickAndCustomCart.deleteOne({ customerId }),
        CustomerTransaction.create(customerTransaction),
        CustomerWalletTransaction.create({ ...walletTransaction, orderId }),
        PromoCode.findOneAndUpdate(
          { promoCode: tempOrder.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: 1 } }
        ),
      ]);

      res.status(200).json({
        success: true,
        orderId,
        createdAt: tempOrder.createdAt,
      });

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
            paymentId: storedOrderData.paymentId,
            orderDetailStepper: {
              created: {
                by: "Customer",
                userId: req.userAuth,
                date: new Date(),
                location: storedOrderData?.drops[0]?.deliveryLocation || [],
              },
            },
          });

          if (!newOrder) return next(appError("Error in creating order"));

          const oldOrderId = orderId;

          // Remove the temporary order data from the database
          await Promise.all([
            TemporaryOrder.deleteOne({ orderId }),
            customer.save(),
            CustomerWalletTransaction.findOneAndUpdate(
              { orderId: oldOrderId },
              { $set: { orderId: newOrder._id } },
              { new: true }
            ),
            ActivityLog.create({
              userId: req.userAuth,
              userType: req.userRole,
              description: `Pick & Drop Order (#${
                newOrder._id
              }) from customer app by ${req?.userName || "N/A"} ( ${
                req.userAuth
              } )`,
            }),
          ]);

          //? Notify the USER and ADMIN about successful order creation
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
    } else if (paymentMode === "Online-payment") {
      const { success, orderId, error } = await createRazorpayOrderId(
        orderAmount
      );

      if (!success) {
        return next(
          appError(`Error in creating Razorpay order: ${error}`, 500)
        );
      }

      res.status(200).json({ success: true, orderId, amount: orderAmount });
    }
  } catch (err) {
    next(appError(err.message));
  }
};

const verifyPickAndDropPaymentController = async (req, res, next) => {
  try {
    const { paymentDetails } = req.body;
    const customerId = req.userAuth;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return next(appError("Customer not found", 404));
    }

    const cart = await PickAndCustomCart.findOne({
      customerId,
      deliveryMode: "Pick and Drop",
    });

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    const isPaymentValid = await verifyPayment(paymentDetails);
    if (!isPaymentValid) {
      return next(appError("Invalid payment", 400));
    }

    const orderAmount =
      cart.billDetail.discountedGrandTotal ||
      cart.billDetail.originalGrandTotal;

    let orderBill = {
      deliveryChargePerDay: cart.billDetail.deliveryChargePerDay,
      deliveryCharge:
        cart.billDetail.discountedDeliveryCharge ||
        cart.billDetail.originalDeliveryCharge,
      promoCodeUsed: cart.billDetail.promoCodeUsed,
      discountedAmount: cart.billDetail.discountedAmount,

      surgePrice: cart.billDetail.surgePrice,
      grandTotal:
        cart.billDetail.discountedGrandTotal ||
        cart.billDetail.originalGrandTotal,
      addedTip: cart.billDetail.addedTip,
    };

    let customerTransaction = {
      customerId,
      madeOn: new Date(),
      transactionType: "Bill",
      transactionAmount: orderAmount,
      type: "Debit",
    };

    let newOrder;
    if (cart.cartDetail.deliveryOption === "Scheduled") {
      // Create scheduled Pick and Drop
      newOrder = await ScheduledPickAndCustom.create({
        customerId,
        items: cart.items,
        orderDetail: cart.cartDetail,
        billDetail: orderBill,
        totalAmount: orderAmount,
        status: "Pending",
        paymentMode: "Online-payment",
        paymentStatus: "Completed",
        startDate: cart.cartDetail.startDate,
        endDate: cart.cartDetail.endDate,
        time: cart.cartDetail.time,
      });

      await Promise.all([
        PickAndCustomCart.deleteOne({ customerId }),
        customer.save(),
        CustomerTransaction.create(customerTransaction),
        ActivityLog.create({
          userId: req.userAuth,
          userType: req.userRole,
          description: `Scheduled Pick & Drop Order (#${
            newOrder._id
          }) from customer app by ${req?.userName || "N/A"} ( ${
            req.userAuth
          } )`,
        }),
        PromoCode.findOneAndUpdate(
          { promoCode: newOrder.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: 1 } }
        ),
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
        merchantName: newOrder?.merchantId?.merchantDetail?.merchantName || "-",
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

      res.status(200).json({
        success: true,
        orderId: newOrder._id,
        createdAt: null,
      });

      await sendSocketDataAndNotification({
        rolesToNotify,
        userIds,
        eventName,
        notificationData,
        socketData,
      });

      return;
    }

    // Generate a unique order ID
    const orderId = new mongoose.Types.ObjectId();

    // Store order details temporarily in the database
    const tempOrder = await TemporaryOrder.create({
      orderId,
      customerId,

      deliveryMode: "Pick and Drop",
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
      paymentMode: "Online-payment",
      paymentStatus: "Completed",
      paymentId: paymentDetails.razorpay_payment_id,
    });

    await Promise.all([
      PickAndCustomCart.deleteOne({ customerId }),
      customer.save(),
      CustomerTransaction.create(customerTransaction),
      PromoCode.findOneAndUpdate(
        { promoCode: tempOrder.billDetail.promoCodeUsed },
        { $inc: { noOfUserUsed: 1 } }
      ),
    ]);

    if (!tempOrder) {
      return next(appError("Error in creating temporary order"));
    }

    // Return countdown timer to client
    res.status(200).json({
      success: true,
      orderId,
      createdAt: tempOrder.createdAt,
    });

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

          totalAmount: storedData.totalAmount,
          paymentMode: storedOrderData.paymentMode,
          paymentStatus: storedOrderData.paymentStatus,
          paymentId: storedOrderData.paymentId,
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
            description: `Pick & Drop Order (#${
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
          merchantName:
            newOrder?.merchantId?.merchantDetail?.merchantName || "-",
          customerName:
            newOrder?.drops[0]?.address?.fullName ||
            newOrder?.customerId?.fullName ||
            "-",
          deliveryMode: newOrder?.deliveryMode,
          orderDate: formatDate(newOrder.createdAt),
          orderTime: formatTime(newOrder.createdAt),
          deliveryDate: newOrder?.deliveryTime
            ? formatDate(newOrder.deliveryTime)
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

const cancelPickBeforeOrderCreationController = async (req, res, next) => {
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

    if (!customerFound) {
      return next(appError("Customer not found", 404));
    }

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

      await Promise.all([
        TemporaryOrder.deleteOne({ orderId }),
        customerFound.save(),
        CustomerTransaction.create(updatedTransactionDetail),
      ]);

      res.status(200).json({
        success: true,
        message: "Order cancelled",
      });

      return;
    } else if (orderFound.paymentMode === "Cash-on-delivery") {
      // Remove the temporary order data from the database
      await TemporaryOrder.deleteOne({ orderId });

      res.status(200).json({ success: true, message: "Order cancelled" });

      return;
    } else if (orderFound.paymentMode === "Online-payment") {
      const paymentId = orderFound.paymentId;

      let refundAmount;

      if (orderFound.orderDetail.deliveryOption === "On-demand") {
        refundAmount = orderFound.billDetail.grandTotal;
        updatedTransactionDetail.transactionAmount = refundAmount;
      } else if (orderFound.orderDetail.deliveryOption === "Scheduled") {
        refundAmount =
          orderFound.billDetail.grandTotal / orderFound.orderDetail.numOfDays;
        updatedTransactionDetail.transactionAmount = refundAmount;
      }

      const refundResponse = await razorpayRefund(paymentId, refundAmount);

      if (!refundResponse.success) {
        return next(appError("Refund failed: " + refundResponse.error, 500));
      }

      await Promise.all([
        TemporaryOrder.deleteOne({ orderId }),
        customerFound.save(),
        CustomerTransaction.create(updatedTransactionDetail),
        PromoCode.findOneAndUpdate(
          { promoCode: orderFound.billDetail.promoCodeUsed },
          { $inc: { noOfUserUsed: -1 } }
        ),
      ]);

      res.status(200).json({
        success: true,
        message: "Order cancelled",
      });

      return;
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// =====================================
// ===============HELPERS===============
// =====================================

const getCartItems = (cart) => {
  let items = [];

  cart.pickups.forEach((pickup) => {
    pickup.items.forEach((pickupItem) => {
      items.push(pickupItem);
    });
  });

  return items;
};

module.exports = {
  addPickUpAddressController,
  getVehiclePricingDetailsController,
  confirmPickAndDropVehicleType,
  confirmPickAndDropController,
  verifyPickAndDropPaymentController,
  cancelPickBeforeOrderCreationController,
  initializePickAndDrop,
  getPickAndDropBill,
  getPickAndDropItems,
};
