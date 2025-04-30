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
const NotificationSetting = require("../../models/NotificationSetting");

const appError = require("../../utils/appError");
const {
  getDistanceFromPickupToDelivery,
  calculateDeliveryCharges,
  calculatePromoCodeDiscount,
  calculateScheduledCartValue,
} = require("../../utils/customerAppHelpers");
const {
  createRazorpayOrderId,
  verifyPayment,
  razorpayRefund,
} = require("../../utils/razorpayPayment");
const { formatDate, formatTime } = require("../../utils/formatters");
const {
  deleteFromFirebase,
  uploadToFirebase,
} = require("../../utils/imageOperation");

const { sendNotification, sendSocketData } = require("../../socket/socket");
const {
  processSchedule,
  processDeliveryDetailInApp,
} = require("../../utils/createOrderHelpers");
const CustomerAppCustomization = require("../../models/CustomerAppCustomization");
const Tax = require("../../models/Tax");
const CustomerTransaction = require("../../models/CustomerTransactionDetail");
const CustomerWalletTransaction = require("../../models/CustomerWalletTransaction");

// Initialize cart
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

// Add pick and drop address
const addPickUpAddressController = async (req, res, next) => {
  try {
    const {
      pickUpAddressType,
      pickUpAddressOtherAddressId,
      deliveryAddressType,
      deliveryAddressOtherAddressId,
      newPickupAddress,
      newDeliveryAddress,
      instructionInPickup,
      instructionInDelivery,
      startDate,
      endDate,
      time,
    } = req.body;

    const customerId = req.userAuth;

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return next(appError("Customer not found", 404));
    }

    const { pickupLocation, pickupAddress, deliveryLocation, deliveryAddress } =
      await processDeliveryDetailInApp(
        customer,
        pickUpAddressType,
        pickUpAddressOtherAddressId,
        newPickupAddress,
        deliveryAddressType,
        deliveryAddressOtherAddressId,
        newDeliveryAddress
      );

    let cartFound = await PickAndCustomCart.findOne({
      customerId,
      "cartDetail.deliveryMode": "Pick and Drop",
    });

    let voiceInstructionInPickupURL =
      cartFound?.cartDetail?.voiceInstructionInPickup || "";
    let voiceInstructionInDeliveryURL =
      cartFound?.cartDetail?.voiceInstructionInDelivery || "";

    if (req.files) {
      const { voiceInstructionInPickup, voiceInstructionInDelivery } =
        req.files;

      if (req.files.voiceInstructionInPickup) {
        if (voiceInstructionInPickupURL) {
          await deleteFromFirebase(voiceInstructionInPickupURL);
        }
        voiceInstructionInPickupURL = await uploadToFirebase(
          voiceInstructionInPickup[0],
          "VoiceInstructions"
        );
      }

      if (req.files.voiceInstructionInDelivery) {
        if (voiceInstructionInDeliveryURL) {
          await deleteFromFirebase(voiceInstructionInDeliveryURL);
        }
        voiceInstructionInDeliveryURL = await uploadToFirebase(
          voiceInstructionInDelivery[0],
          "VoiceInstructions"
        );
      }
    }

    let scheduled;
    if (startDate && endDate && time) {
      const ifScheduled = {
        startDate,
        endDate,
        time,
      };

      scheduled = processSchedule(ifScheduled);
    }

    let updatedCartDetail = {
      pickupAddress: pickupAddress,
      pickupLocation: pickupLocation,
      deliveryAddress: deliveryAddress,
      deliveryLocation: deliveryLocation,
      deliveryMode: "Pick and Drop",
      deliveryOption: startDate && endDate && time ? "Scheduled" : "On-demand",
      instructionInPickup,
      instructionInDelivery,
      voiceInstructionInPickup: voiceInstructionInPickupURL,
      voiceInstructionInDelivery: voiceInstructionInDeliveryURL,
      startDate: scheduled?.startDate,
      endDate: scheduled?.endDate,
      time: scheduled?.time,
    };

    if (startDate && endDate && time) {
      const diffDays = scheduled.numOfDays;

      updatedCartDetail.numOfDays = diffDays;
    } else {
      updatedCartDetail.numOfDays = null;
    }

    // Calculate distance using MapMyIndia API
    const { distanceInKM, durationInMinutes } =
      await getDistanceFromPickupToDelivery(pickupLocation, deliveryLocation);

    updatedCartDetail.distance = parseFloat(distanceInKM);
    updatedCartDetail.duration = parseFloat(durationInMinutes);

    if (cartFound) {
      await PickAndCustomCart.findByIdAndUpdate(
        cartFound._id,
        {
          cartDetail: updatedCartDetail,
          items: cartFound.items,
        },
        {
          new: true,
        }
      );
    } else {
      cartFound = await PickAndCustomCart.create({
        customerId,
        cartDetail: updatedCartDetail,
      });
    }

    res.status(200).json({
      cartId: cartFound._id,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Get vehicle charges
const getVehiclePricingDetailsController = async (req, res, next) => {
  try {
    const customerId = req.userAuth;

    const customer = await Customer.findById(customerId);

    if (!customer) return next(appError("Customer not found", 404));

    const { cartId } = req.query;

    const cartFound = await PickAndCustomCart.findOne({
      _id: cartId,
      customerId,
      "cartDetail.deliveryMode": "Pick and Drop",
    });

    if (!cartFound) return next(appError("Customer cart not found", 404));

    const agents = await Agent.find({});
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

    let surgeCharges;

    const { distance, duration } = cartFound.cartDetail;

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

          let calculatedDeliveryCharges = deliveryCharges;

          if (cartFound?.cartDetail?.numOfDays === null) {
            calculatedDeliveryCharges += surgeCharges || 0;
          }

          if (cartFound?.cartDetail?.numOfDays > 0) {
            calculatedDeliveryCharges =
              deliveryCharges * cartFound.cartDetail.numOfDays;
          }

          return {
            vehicleType,
            deliveryCharges: Math.round(calculatedDeliveryCharges),
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

// Add Items
const addPickAndDropItemsController = async (req, res, next) => {
  try {
    const { items, vehicleType, deliveryCharges } = req.body;
    const customerId = req.userAuth;

    if (items.length === 0) return next(appError("Add at-least one item", 400));

    // Find the cart for the customer
    const cart = await PickAndCustomCart.findOne({
      customerId,
      "cartDetail.deliveryMode": "Pick and Drop",
    });

    // If cart doesn't exist, return an error
    if (!cart) return next(appError("Cart not found", 400));

    // Clear existing items
    cart.items = [];

    // Add the new formatted items to the cart
    const formattedItems = items.map((item) => ({
      itemName: item.itemName,
      length: item.length || null,
      width: item.width || null,
      height: item.height || null,
      unit: item.unit,
      weight: item.weight,
    }));

    cart.items.push(...formattedItems);

    const tax = await CustomerAppCustomization.findOne({}).select(
      "pickAndDropOrderCustomization"
    );

    const taxFound = await Tax.findById(
      tax.pickAndDropOrderCustomization.taxId
    );

    let taxAmount = 0;
    if (taxFound) {
      const calculatedTax = (deliveryCharges * taxFound.tax) / 100;
      taxAmount = parseFloat(calculatedTax.toFixed(2));
    }

    let updatedBill = {
      taxAmount,
      originalDeliveryCharge: Math.round(deliveryCharges),
      vehicleType,
      originalGrandTotal: Math.round(deliveryCharges + taxAmount),
      taxAmount,
    };

    cart.billDetail = updatedBill;
    await cart.save();

    res.status(200).json({
      cartId: cart._id,
      items: cart.items,
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
      "cartDetail.deliveryMode": "Pick and Drop",
    });

    if (!cart) {
      return next(appError("Cart not found", 404));
    }

    const billDetail = {
      deliveryCharge:
        cart.billDetail.discountedDeliveryCharge ||
        cart.billDetail.originalDeliveryCharge,
      surgePrice: cart.billDetail.surgePrice,
      addedTip: cart.billDetail.addedTip,
      discountedAmount: cart.billDetail.discountedAmount,
      promoCodeUsed: cart.billDetail.promoCodeUsed,
      taxAmount: cart.billDetail.taxAmount,
      grandTotal: cart.billDetail.discountedAmount
        ? cart.billDetail.discountedGrandTotal
        : cart.billDetail.originalGrandTotal,
    };

    res.status(200).json(billDetail);
  } catch (err) {
    next(appError(err.message));
  }
};

// Confirm pick and drop
const confirmPickAndDropController = async (req, res, next) => {
  try {
    const { paymentMode } = req.body;
    const customerId = req.userAuth;

    const [customer, cart] = await Promise.all([
      Customer.findById(customerId),
      PickAndCustomCart.findOne({
        customerId,
        "cartDetail.deliveryMode": "Pick and Drop",
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
        grandTotal:
          cart.billDetail.discountedGrandTotal ||
          cart.billDetail.originalGrandTotal,
        addedTip: cart.billDetail.addedTip,
        vehicleType: cart.billDetail.vehicleType,
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
      deliveryTime.setMinutes(deliveryTime.getMinutes() + 60);

      customer.customerDetails.walletBalance -= orderAmount;

      let newOrder;
      if (cart.cartDetail.deliveryOption === "Scheduled") {
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
        ]);

        res.status(200).json({
          success: true,
          data: newOrder,
        });

        return;
      }

      // Generate a unique order ID
      const orderId = new mongoose.Types.ObjectId();

      // Store order details temporarily in the database
      const tempOrder = await TemporaryOrder.create({
        orderId,
        customerId,
        items: cart.items,
        orderDetail: {
          ...cart.cartDetail,
          deliveryTime,
        },
        billDetail: orderBill,
        totalAmount: orderAmount,
        status: "Pending",
        paymentMode: "Famto-cash",
        paymentStatus: "Completed",
      });

      await Promise.all([
        customer.save(),
        PickAndCustomCart.deleteOne({ customerId }),
        CustomerTransaction.create(customerTransaction),
        CustomerWalletTransaction.create({ ...walletTransaction, orderId }),
      ]);

      if (!tempOrder)
        return next(appError("Error in creating temporary order"));

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
            items: storedOrderData.items,
            orderDetail: storedOrderData.orderDetail,
            billDetail: storedOrderData.billDetail,
            totalAmount: storedOrderData.orderAmount,
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

          const oldOrderId = orderId;

          // Remove the temporary order data from the database
          await Promise.all([
            TemporaryOrder.deleteOne({ orderId }),
            customer.save(),
            CustomerWalletTransaction.findOneAndUpdate(
              { orderId: oldOrderId },
              { $set: { orderId: newOrderCreated._id } },
              { new: true }
            ),
          ]);

          //? Notify the USER and ADMIN about successful order creation
          const customerData = {
            socket: {
              orderId: newOrder._id,
              orderDetail: newOrder.orderDetail,
              billDetail: newOrder.billDetail,
              orderDetailStepper: newOrder.orderDetailStepper.created,
            },
            fcm: {
              title: "Order created",
              body: "Your order was created successfully",
              image: "",
              orderId: newOrder._id,
              customerId: newOrder.customerId,
            },
          };

          const adminData = {
            socket: {
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
              deliveryOption: newOrder?.orderDetail?.deliveryOption,
              amount: newOrder.billDetail.grandTotal,
              orderDetailStepper: newOrder.orderDetailStepper.created,
            },
            fcm: {
              title: "New Order Admin",
              body: "Your have a new pending order",
              image: "",
              orderId: newOrder._id,
            },
          };

          const parameter = {
            eventName: "newOrderCreated",
            user: "Customer",
            role: "Admin",
          };

          sendNotification(
            newOrder.customerId,
            parameter.eventName,
            customerData,
            parameter.user
          );

          sendNotification(
            process.env.ADMIN_ID,
            parameter.eventName,
            adminData,
            parameter.role
          );
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

// Verify pick and drop
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
      "cartDetail.deliveryMode": "Pick and Drop",
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
      discountedAmount: cart.billDetail.discountedAmount,
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
        customerTransaction.create(customerTransaction),
      ]);

      res.status(200).json({
        message: "Scheduled order created successfully",
        data: newOrder,
      });
      return;
    }

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
      paymentMode: "Online-payment",
      paymentStatus: "Completed",
      paymentId: paymentDetails.razorpay_payment_id,
    });

    await Promise.all([
      PickAndCustomCart.deleteOne({ customerId }),
      customer.save(),
      customerTransaction.create(customerTransaction),
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
          items: storedOrderData.items,
          orderDetail: storedOrderData.orderDetail,
          billDetail: storedOrderData.billDetail,
          totalAmount: storedOrderData.orderAmount,
          status: "Pending",
          paymentMode: "Online-payment",
          paymentStatus: "Completed",
          paymentId: storedOrderData.paymentId,
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
        await TemporaryOrder.deleteOne({ orderId });

        const eventName = "newOrderCreated";

        // Fetch notification settings to determine roles
        const notificationSettings = await NotificationSetting.findOne({
          event: eventName,
        });

        const rolesToNotify = [
          "admin",
          "merchant",
          "driver",
          "customer",
        ].filter((role) => notificationSettings[role]);

        // Send notifications to each role dynamically
        for (const role of rolesToNotify) {
          let roleId;

          if (role === "admin") {
            roleId = process.env.ADMIN_ID;
          } else if (role === "merchant") {
            roleId = newOrder?.merchantId;
          } else if (role === "driver") {
            roleId = newOrder?.agentId;
          } else if (role === "customer") {
            roleId = newOrder?.customerId;
          }

          if (roleId) {
            const notificationData = {
              fcm: {
                orderId: newOrder._id,
                customerId: newOrder.customerId,
              },
            };

            await sendNotification(
              roleId,
              eventName,
              notificationData,
              role.charAt(0).toUpperCase() + role.slice(1)
            );
          }
        }

        const data = {
          title: notificationSettings.title,
          description: notificationSettings.description,

          orderId: newOrder._id,
          orderDetail: newOrder.orderDetail,
          billDetail: newOrder.billDetail,
          orderDetailStepper: newOrder.orderDetailStepper.created,

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

        sendSocketData(newOrder.customerId, eventName, data);
        sendSocketData(process.env.ADMIN_ID, eventName, data);
      }
    }, 60000);
  } catch (err) {
    next(appError(err.message));
  }
};

// Cancel order before creation
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

module.exports = {
  addPickUpAddressController,
  getVehiclePricingDetailsController,
  addPickAndDropItemsController,
  confirmPickAndDropController,
  verifyPickAndDropPaymentController,
  cancelPickBeforeOrderCreationController,
  initializePickAndDrop,
  getPickAndDropBill,
};
