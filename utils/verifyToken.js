const jwt = require("jsonwebtoken");

const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

    return decoded;
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      console.error("⚠️ Token has expired!");
    } else if (err.name === "JsonWebTokenError") {
      console.error("⚠️ Invalid Token Signature!");
    }

    return false;
  }
};

module.exports = verifyToken;
