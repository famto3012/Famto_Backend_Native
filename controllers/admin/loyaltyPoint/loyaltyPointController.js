const { validationResult } = require("express-validator");

const LoyaltyPoint = require("../../../models/LoyaltyPoint");
const Customer = require("../../../models/Customer");                         // ← ADD
const CustomerWalletTransaction = require("../../../models/CustomerWalletTransaction"); // ← ADD
const ActivityLog = require("../../../models/ActivityLog");  

const appError = require("../../../utils/appError");

// Create / Update loyalty point criteria
const addLoyaltyPointController = async (req, res, next) => {
  const {
    earningCriteriaRupee,
    earningCriteriaPoint,
    minOrderAmountForEarning,
    maxEarningPointPerOrder,
    expiryDuration,
    redemptionCriteriaPoint,
    redemptionCriteriaRupee,
    minOrderAmountForRedemption,
    minLoyaltyPointForRedemption,
    maxRedemptionAmountPercentage,
  } = req.body;

  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    let newCriteria = await LoyaltyPoint.findOne({});
    if (newCriteria) {
      newCriteria.earningCriteriaRupee = earningCriteriaRupee;
      newCriteria.earningCriteriaPoint = earningCriteriaPoint;
      newCriteria.minOrderAmountForEarning = minOrderAmountForEarning;
      newCriteria.maxEarningPointPerOrder = maxEarningPointPerOrder;
      newCriteria.expiryDuration = expiryDuration;
      newCriteria.redemptionCriteriaPoint = redemptionCriteriaPoint;
      newCriteria.redemptionCriteriaRupee = redemptionCriteriaRupee;
      newCriteria.minOrderAmountForRedemption = minOrderAmountForRedemption;
      newCriteria.minLoyaltyPointForRedemption = minLoyaltyPointForRedemption;
      newCriteria.maxRedemptionAmountPercentage = maxRedemptionAmountPercentage;

      await newCriteria.save();
      res.status(201).json({ message: "Loyalty point criteria updated" });
    } else {
      const newLoyaltyPointCriteria = await LoyaltyPoint.create({
        earningCriteriaRupee,
        earningCriteriaPoint,
        minOrderAmountForEarning,
        maxEarningPointPerOrder,
        expiryDuration,
        redemptionCriteriaPoint,
        redemptionCriteriaRupee,
        minOrderAmountForRedemption,
        minLoyaltyPointForRedemption,
        maxRedemptionAmountPercentage,
      });

      if (!newLoyaltyPointCriteria) {
        return next(appError("Error in creating loyalty point"));
      }

      res.status(201).json({ message: "Loyalty point criteria created" });
    }
  } catch (err) {
    next(appError(err.message));
  }
};

// Get loyalty point criteria
const getLoyaltyPointController = async (req, res, next) => {
  try {
    const loyaltyPointCriteriaFound = await LoyaltyPoint.findOne({}).lean();

    const formattedResponse = {
      status: loyaltyPointCriteriaFound?.status || false,
      earningCriteriaRupee:
        loyaltyPointCriteriaFound?.earningCriteriaRupee || null,
      earningCriteriaPoint:
        loyaltyPointCriteriaFound?.earningCriteriaPoint || null,
      minOrderAmountForEarning:
        loyaltyPointCriteriaFound?.minOrderAmountForEarning || null,
      maxEarningPointPerOrder:
        loyaltyPointCriteriaFound?.maxEarningPointPerOrder || null,
      expiryDuration: loyaltyPointCriteriaFound?.expiryDuration || null,
      redemptionCriteriaPoint:
        loyaltyPointCriteriaFound?.redemptionCriteriaPoint || null,
      redemptionCriteriaRupee:
        loyaltyPointCriteriaFound?.redemptionCriteriaRupee || null,
      minOrderAmountForRedemption:
        loyaltyPointCriteriaFound?.minOrderAmountForRedemption || null,
      minLoyaltyPointForRedemption:
        loyaltyPointCriteriaFound?.minLoyaltyPointForRedemption || null,
      maxRedemptionAmountPercentage:
        loyaltyPointCriteriaFound?.maxRedemptionAmountPercentage || null,
    };

    res.status(200).json({
      message: "Loyalty point criteria",
      data: formattedResponse,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Enable / Disable status
const updateStatusController = async (req, res, next) => {
  try {
    let existingCriteria = await LoyaltyPoint.findOne({});

    if (existingCriteria) {
      existingCriteria.status = !existingCriteria.status;

      await existingCriteria.save();

      return res.status(200).json({
        message: "Loyalty point criteria status updated successfully",
        data: existingCriteria.status,
      });
    }

    res.status(200).json({
      message: "Loyalty point criteria is not added",
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const redeemLoyaltyPointController = async (req, res, next) => {
  try {
    const customerId = req.userAuth;
    const { pointsToRedeem } = req.body;

    // ── Validate input ──────────────────────────────────────────────
    if (!pointsToRedeem || typeof pointsToRedeem !== "number" || pointsToRedeem <= 0) {
      return next(appError("Points to redeem must be a number greater than 0", 400));
    }

    // ── Fetch loyalty config ────────────────────────────────────────
    const loyaltyConfig = await LoyaltyPoint.findOne({}).lean();

    if (!loyaltyConfig || !loyaltyConfig.status) {
      return next(appError("Loyalty point redemption is currently disabled", 400));
    }

    // ── Fetch customer ──────────────────────────────────────────────
    const customer = await Customer.findById(customerId)
      .select("customerDetails.loyaltyPointLeftForRedemption customerDetails.walletBalance")
      .lean();

    if (!customer) {
      return next(appError("Customer not found", 404));
    }

    const availablePoints =
      customer.customerDetails?.loyaltyPointLeftForRedemption || 0;

    // ── Minimum points threshold check ──────────────────────────────
    if (pointsToRedeem < loyaltyConfig.minLoyaltyPointForRedemption) {
      return next(
        appError(
          `Minimum ${loyaltyConfig.minLoyaltyPointForRedemption} points required per redemption`,
          400
        )
      );
    }

    // ── Sufficient balance check ────────────────────────────────────
    if (pointsToRedeem > availablePoints) {
      return next(
        appError(
          `Insufficient loyalty points. Available: ${availablePoints}, Requested: ${pointsToRedeem}`,
          400
        )
      );
    }

    // ── Convert points → rupees ─────────────────────────────────────
    // Example: config says 10 points = ₹1 → 100 points = ₹10
    const redeemAmount =
      (pointsToRedeem / loyaltyConfig.redemptionCriteriaPoint) *
      loyaltyConfig.redemptionCriteriaRupee;

    const creditAmount = Math.round(redeemAmount * 100) / 100;

    // ── Atomic update: deduct points + credit wallet ────────────────
    const updatedCustomer = await Customer.findOneAndUpdate(
      {
        _id: customerId,
        "customerDetails.loyaltyPointLeftForRedemption": { $gte: pointsToRedeem },
      },
      {
        $inc: {
          "customerDetails.loyaltyPointLeftForRedemption": -pointsToRedeem,
          "customerDetails.walletBalance": creditAmount,
        },
      },
      { new: true }
    );

    if (!updatedCustomer) {
      return next(
        appError("Redemption failed. Points may have changed, please try again.", 409)
      );
    }

    // ── Create wallet transaction record ────────────────────────────
    await Promise.all([
      CustomerWalletTransaction.create({
        customerId,
        closingBalance: updatedCustomer.customerDetails.walletBalance,
        transactionAmount: creditAmount,
        date: new Date(),
        type: "Credit",
        transactionId: `LOYALTY_REDEEM_${Date.now()}`,
      }),
      ActivityLog.create({
        userId: customerId,
        userType: "Customer",
        description: `Redeemed ${pointsToRedeem} loyalty points for ₹${creditAmount} wallet credit`,
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Loyalty points redeemed successfully",
      data: {
        redeemedPoints: pointsToRedeem,
        creditedAmount: creditAmount,
        walletBalance: updatedCustomer.customerDetails.walletBalance,
        remainingPoints:
          updatedCustomer.customerDetails.loyaltyPointLeftForRedemption,
      },
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addLoyaltyPointController,
  getLoyaltyPointController,
  updateStatusController,
  redeemLoyaltyPointController
};
