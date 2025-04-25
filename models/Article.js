const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema({
  published: { type: Number, required: true, unique: true },
  title: String,
  url: String,
  description: String,
  image_hd: String,
});

module.exports = mongoose.model("Article", articleSchema);
