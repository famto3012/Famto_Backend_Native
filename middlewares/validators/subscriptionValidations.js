const { body } = require("express-validator");

const subscriptionValidationRules = [
  body("name").optional().notEmpty().withMessage("Name is required"),
  body("amount").optional().isNumeric().withMessage("Amount must be a number"),
  body("duration")
    .optional()
    .isNumeric()
    .withMessage("Duration must be a number"),
  body("taxId").optional().trim(),
  body("renewalReminder")
    .optional()
    .isNumeric()
    .withMessage("Renewal Reminder must be a number"),
];

module.exports = subscriptionValidationRules;
