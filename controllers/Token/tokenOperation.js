const axios = require("axios");
const Token = require("../../models/Token");

// Legacy OAuth token generator — kept as fallback
// const generateMapplsAuthToken = async () => {
//   try {
//     const response = await axios.post(
//       `https://outpost.mappls.com/api/security/oauth/token?grant_type=client_credentials&client_id=${process.env.MAPPLS_CLIENT_ID}&client_secret=${process.env.MAPPLS_CLIENT_SECRET}`
//     );
//     const { access_token } = response.data;
//     if (access_token) {
//       await Token.findOneAndUpdate(
//         {},
//         { mapplsAuthToken: access_token },
//         { upsert: true }
//       );
//     }
//     return access_token;
//   } catch (error) {
//     console.error("Failed to retrieve access token");
//   }
// };

const getAuthToken = async (req, res, next) => {
  try {
    // NEW AUTH: return static MAPPLS_ACCESS_TOKEN from .env
    const staticToken = process.env.MAPPLS_ACCESS_TOKEN;
    if (staticToken) {
      return res.json({ success: true, data: staticToken });
    }

    // FALLBACK: legacy OAuth token from DB
    const tokenFound = await Token.findOne({});
    if (!tokenFound || !tokenFound.mapplsAuthToken) {
      return next(require("../../utils/appError")("Token not found", 404));
    }

    return res.json({
      success: true,
      data: tokenFound.mapplsAuthToken,
    });
  } catch (error) {
    return next(error);
  }
};

// Legacy export — kept for reference, not called anywhere
// module.exports = { generateMapplsAuthToken, getAuthToken };
module.exports = { getAuthToken };