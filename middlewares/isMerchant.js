const appError = require("../utils/appError");

// Asserts the authenticated user is a Merchant and exposes req.merchantId.
// Must run AFTER isAuthenticated or isAdminOrMerchant (they set req.userRole/req.userAuth).
const isMerchant = (req, res, next) => {
  if (req.userRole !== "Merchant") {
    return next(appError("Access denied, Merchant only!", 403));
  }
  req.merchantId = req.userAuth;
  next();
};

module.exports = isMerchant;
