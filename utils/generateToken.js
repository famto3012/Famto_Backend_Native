const jwt = require("jsonwebtoken");

const generateToken = (id, role, name, expiresIn = "20d") => {
  const token = jwt.sign({ id, role, name }, process.env.JWT_SECRET_KEY, {
    expiresIn,
  });

  return token;
};

module.exports = generateToken;
