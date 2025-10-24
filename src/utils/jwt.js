const jwt = require("jsonwebtoken");
const { auth } = require("../config/env");

function signJwt(payload) {
  return jwt.sign(payload, auth.jwtSecret, { expiresIn: auth.jwtExpiresIn });
}

function verifyJwt(token) {
  return jwt.verify(token, auth.jwtSecret);
}

module.exports = { signJwt, verifyJwt };
