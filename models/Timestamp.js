const mongoose = require("mongoose");

const TimestampSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g., "news"
  lastTimestamp: { type: Number, required: true },
});

module.exports = mongoose.model("Timestamp", TimestampSchema);
