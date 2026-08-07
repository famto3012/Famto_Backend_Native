const Merchant = require("../../../models/Merchant");
const Customer = require("../../../models/Customer");
const appError = require("../../../utils/appError");

// GET /api/v1/merchants/reviews?page=&limit=
// Merchant-scoped list of own reviews with customer info, average rating,
// and star distribution. Newest first (ratingByCustomers is push-ordered).
// Customer info is joined via a manual $in lookup (avoids the dangling
// ref:"User" on the schema — same pattern as the merchant customer list).
const getMerchantReviewsController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    const merchant = await Merchant.findById(merchantId)
      .select("merchantDetail.ratingByCustomers")
      .lean();

    if (!merchant) return next(appError("Merchant not found", 404));

    const allReviews = merchant.merchantDetail?.ratingByCustomers || [];
    const newestFirst = [...allReviews].reverse();

    // Join customer info for the page we return
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100
    );
    const total = newestFirst.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const start = (page - 1) * limit;
    const pageReviews = newestFirst.slice(start, start + limit);

    const customerIds = [
      ...new Set(pageReviews.map((r) => String(r.customerId)).filter(Boolean)),
    ];
    const customers = customerIds.length
      ? await Customer.find({ _id: { $in: customerIds } })
          .select("fullName phoneNumber email")
          .lean()
      : [];
    const customerMap = new Map(customers.map((c) => [String(c._id), c]));

    const reviews = pageReviews.map((r) => {
      const customer = customerMap.get(String(r.customerId)) || {};
      return {
        customerId: r.customerId || null,
        customerName: customer.fullName || null,
        customerPhone: customer.phoneNumber || null,
        customerEmail: customer.email || null,
        review: r.review,
        rating: r.rating,
        reply: r.reply || null,
        replyDate: r.replyDate || null,
      };
    });

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    allReviews.forEach((r) => {
      if (r.rating >= 1 && r.rating <= 5) distribution[r.rating] += 1;
    });

    const averageRating =
      total > 0
        ? Math.round(
            (allReviews.reduce((acc, r) => acc + r.rating, 0) / total) * 10
          ) / 10
        : 0;

    res.status(200).json({
      success: true,
      reviews,
      averageRating,
      totalReviews: total,
      distribution,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// PATCH /api/v1/merchants/reviews/:customerId/reply
// Replies to the (first) review left by the given customer for this merchant.
const replyToMerchantReviewController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { customerId } = req.params;
    const reply = (req.body.reply || "").trim();

    if (!reply) return next(appError("Reply is required", 400));

    const merchant = await Merchant.findById(merchantId);
    if (!merchant) return next(appError("Merchant not found", 404));

    const reviews = merchant.merchantDetail?.ratingByCustomers || [];
    // ratingByCustomers is push-ordered (oldest first) -> pick the NEWEST
    // review by this customer so the reply lands on the one the UI shows first.
    let review;
    for (let i = reviews.length - 1; i >= 0; i--) {
      if (String(reviews[i].customerId) === String(customerId)) {
        review = reviews[i];
        break;
      }
    }
    if (!review) return next(appError("Review not found for this customer", 404));

    review.reply = reply;
    review.replyDate = new Date();
    await merchant.save();

    res.status(200).json({
      success: true,
      message: "Reply submitted successfully",
      review: {
        customerId: review.customerId,
        review: review.review,
        rating: review.rating,
        reply: review.reply,
        replyDate: review.replyDate,
      },
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getMerchantReviewsController,
  replyToMerchantReviewController,
};
