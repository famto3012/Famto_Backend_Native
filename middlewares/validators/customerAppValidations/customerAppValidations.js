const { body } = require("express-validator");

const customerAuthenticateValidations = [
  body("phoneNumber")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .isMobilePhone("en-IN")
    .withMessage("Invalid phone number format"),
];

const updateAddressValidations = [
  body("addresses").isArray().withMessage("Addresses should be an array"),
  body("addresses.*.type")
    .notEmpty()
    .withMessage("Address type is required")
    .isIn(["home", "work", "other"])
    .withMessage("Invalid address type"),
  body("addresses.*.fullName").notEmpty().withMessage("Full name is required"),
  body("addresses.*.phoneNumber")
    .notEmpty()
    .withMessage("Phone number is required"),
  body("addresses.*.flat").notEmpty().withMessage("Flat is required"),
  body("addresses.*.area").notEmpty().withMessage("Area is required"),
  body("addresses.*.landmark").optional(),
];

const ratingValidations = [
  body("rating")
    .trim()
    .notEmpty()
    .withMessage("Rating is required")
    .isNumeric()
    .withMessage("Must be a number"),
  body("review").optional().trim(),
];

const updateCartProductValidations = [
  body("productId").trim().notEmpty().withMessage("Product Id is required"),
  body("quantity")
    .trim()
    .notEmpty()
    .withMessage("Quantity is required")
    .isNumeric()
    .withMessage("Quantity must be a number"),
  body("price")
    .trim()
    .notEmpty()
    .withMessage("Price is required")
    .isNumeric()
    .withMessage("Price must be a number"),
  body("variantId").optional().trim(),
];

module.exports = {
  customerAuthenticateValidations,
  updateAddressValidations,
  ratingValidations,
  updateCartProductValidations,
};
