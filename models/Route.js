const mongoose = require("mongoose");

const pathSchema = new mongoose.Schema({
  placeName: String,
  lat: Number,
  lng: Number,
  time: Number
});

const routeSchema = new mongoose.Schema({
  fromPlace: String,
  toPlace: String,
  direction: String,
  videoUrl: String,
  path: [pathSchema]
});

module.exports = mongoose.model("Route", routeSchema);
