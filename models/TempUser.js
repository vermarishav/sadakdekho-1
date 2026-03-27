const mongoose = require("mongoose");

const tempUserSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  verifyToken: String,
  verifyTokenExpiry: Date
});

module.exports = mongoose.model("TempUser", tempUserSchema);