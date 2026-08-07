const appError = require("../utils/appError");

// Defense-in-depth for endpoints callable by BOTH Admin and Merchant.
// Must run AFTER isAuthenticated or isAdminOrMerchant.
// - Merchant: forces req.merchantId = req.userAuth and REFUSES any client-supplied
//   merchantId (query/body/params) that does not match the authenticated merchant.
// - Admin/Manager: passes through unchanged (global access).
const merchantScope = (req, res, next) => {
  if (req.userRole !== "Merchant") {
    return next();
  }

  const merchantId = req.userAuth;
  const provided =
    req.params.merchantId || req.body.merchantId || req.query.merchantId;

  if (provided && provided !== merchantId) {
    return next(appError("Access denied", 403));
  }

  req.merchantId = merchantId;
  next();
};

module.exports = merchantScope;
