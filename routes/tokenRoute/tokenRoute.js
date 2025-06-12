const express = require("express");

const isAuthenticated = require("../../middlewares/isAuthenticated");

const { getAuthToken } = require("../../controllers/Token/tokenOperation");
const { generateApiKey } = require("../../controllers/Token/apiKeyController");
const isAdmin = require("../../middlewares/isAdmin");

const tokenRoute = express.Router();

tokenRoute.get("/get-auth-token", isAuthenticated, getAuthToken);

tokenRoute.get("/merchant-api-key", isAuthenticated, isAdmin, generateApiKey);

module.exports = tokenRoute;
