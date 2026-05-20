const Razorpay = require("razorpay");
const crypto = require("crypto");
const TemporaryOrder = require("../models/TemporaryOrder");
const WebhookEvent = require("../models/WebhookEvent");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const createRazorpayOrderId = async (amount) => {
  try {
    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: crypto.randomBytes(10).toString("hex"),
    };

    const order = await razorpay.orders.create(options);

    return { success: true, orderId: order.id };
  } catch (err) {
    console.error("Error in processing payment:", err);
    return { success: false, error: err.message };
  }
};

const verifyPayment = (paymentDetails) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = paymentDetails;

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  console.log("Expected :", expectedSignature);
  console.log("Received :", razorpay_signature);

  return expectedSignature === razorpay_signature;
};

// const verifyPayment = async (paymentDetails) => {
//   const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
//     paymentDetails;

//   const body = razorpay_order_id + "|" + razorpay_payment_id;
//   const expectedSignature = crypto
//     .createHmac("sha256", razorpay.key_secret)
//     .update(body.toString())
//     .digest("hex");

//     console.log("Signature", expectedSignature);

//   return expectedSignature === razorpay_signature;
// };

const razorpayRefund = async (paymentId, amount) => {
  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amount * 100,
      speed: "normal",
    });

    return { success: true, refundId: refund.id };
  } catch (err) {
    console.error("Error in processing refund:", err);
    return { success: false, error: err.message };
  }
};

const createRazorpayQrCode = async (amount) => {
  try {
    const twoMinutesLater = Math.floor(Date.now() / 1000) + 120;

    const qrCode = await razorpay.qrCode.create({
      type: "upi_qr",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: amount * 100,
      description: "Amount to be paid",
      name: "FAMTO Delivery",
      close_by: twoMinutesLater,
    });

    return qrCode;
  } catch (err) {
    console.error(
      "Error creating Razorpay QR code:",
      JSON.stringify(err, null, 2)
    );

    throw new Error(err.message || "Failed to create Razorpay QR code");
  }
};

const fetchRazorpayOrderPayments = async (
  razorpayOrderId
) => {
  try {
    const payments =
      await razorpay.orders.fetchPayments(
        razorpayOrderId
      );

    const captured = payments.items?.find(
      (p) => p.status === "captured"
    );

    if (captured) {
      return {
        captured: true,
        paymentId: captured.id,
      };
    }

    return {
      captured: false,
    };
  } catch (err) {
    console.error(
      "Error fetching Razorpay payments:",
      err.message
    );

    return {
      captured: false,
    };
  }
};


const createSettlement = async () => {
  try {
    const settlement = await razorpay.settlements.createOndemandSettlement({
      settle_full_balance: true,
      description: "Settling full payments",
    });

    return settlement;
  } catch (err) {
    console.error(
      "Error creating Razorpay settlement:",
      JSON.stringify(err, null, 2)
    );
  }
};

const razorpayWebhookController = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    const signature = req.headers["x-razorpay-signature"];

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body.toString())
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).send("Invalid signature");
    }

    const payload = JSON.parse(req.body);

    const eventId = payload?.payload?.payment?.entity?.id;

    const existingEvent = await WebhookEvent.findOne({
      eventId,
    });

    if (existingEvent) {
      return res.status(200).json({
        success: true,
        message: "Duplicate webhook ignored",
      });
    }

    await WebhookEvent.create({
      eventId,
      eventType: payload.event,
      payload,
      processed: true,
    });

    if (payload.event === "payment.captured") {
      const payment = payload.payload.payment.entity;

      await TemporaryOrder.findOneAndUpdate(
        {
          razorpayOrderId: payment.order_id,
          paymentStatus: "PENDING_PAYMENT",
        },
        {
          paymentStatus: "PAYMENT_COMPLETED",
          paymentId: payment.id,
        }
      );

      console.log(
        `✅ Payment completed for ${payment.order_id}`
      );
    }

    if (payload.event === "payment.failed") {
      const payment = payload.payload.payment.entity;

      await TemporaryOrder.findOneAndUpdate(
        {
          razorpayOrderId: payment.order_id,
        },
        {
          paymentStatus: "PAYMENT_FAILED",
        }
      );

      console.log(
        `❌ Payment failed for ${payment.order_id}`
      );
    }

    return res.status(200).json({
      success: true,
    });
  } catch (err) {
    console.error("Webhook Error:", err.message);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};


module.exports = {
  createRazorpayOrderId,
  verifyPayment,
  razorpayRefund,
  createRazorpayQrCode,
  createSettlement,
  fetchRazorpayOrderPayments,
  razorpayWebhookController
};
