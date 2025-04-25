const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const mongoose = require("mongoose");
const express = require("express");
require("dotenv").config();

// MongoDB Schema to save last timestamp and article info
const articleSchema = new mongoose.Schema({
  title: String,
  url: String,
  description: String,
  image_hd: String,
  published: Number,
});

const Article = mongoose.model("Article", articleSchema);

// API Endpoint
const API_URL = "https://api.watcher.guru/content/data?news=10";

// Connect to MongoDB
mongoose.set("strictQuery", false);
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ Database connection failed. Server not started");
    console.error(err);
  });

// Discord Bot Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize timestamp from MongoDB
async function initializeTimestamp() {
  try {
    const latest = await Article.findOne().sort({ published: -1 });
    return latest ? latest.published : 0;
  } catch (err) {
    console.error("Error fetching latest timestamp:", err);
    return 0;
  }
}

// Save new articles to MongoDB
async function saveArticles(articles) {
  try {
    await Article.insertMany(
      articles.map((a) => ({
        title: a.title,
        url: a.url,
        description: a.description,
        image_hd: a.image_hd,
        published: a.published,
      }))
    );
  } catch (err) {
    console.error("Error saving articles:", err);
  }
}

// Validate image URL (must end in common image extension)
function isValidImageUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      /^https?:\/\//.test(parsed.href) &&
      /\.(jpe?g|png|webp|gif)$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await client.user.setPresence({
    status: "online",
    activities: [{ name: "Fetching news", type: "WATCHING" }],
  });

  let lastTimestamp = await initializeTimestamp();
  console.log(`Last timestamp: ${lastTimestamp}`);

  setInterval(async () => {
    console.log("🔄 Checking for new articles...");
    try {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      if (!channel?.isTextBased()) return;

      const { data } = await axios.get(API_URL);
      const newArticles = data
        .filter((a) => a.published > lastTimestamp)
        .sort((a, b) => a.published - b.published);

      if (newArticles.length === 0) return;

      for (const article of newArticles) {
        console.log(`Processing article: ${article.title}`);
        console.log(`Raw Image URL: ${article.image_hd}`);

        // ── Normalize & percent-encode any whitespace
        let thumb = article.image_hd;

        // ── Build embed
        const embed = new EmbedBuilder()
          .setTitle(article.title)
          .setURL(article.url)
          .setDescription(article.description)
          .setColor("#FF0000")
          .setTimestamp(article.published * 1000);

        // ── Validate and set thumbnail
        if (isValidImageUrl(thumb)) {
          embed.setThumbnail(thumb);
        } else {
          console.warn(
            `⚠️ Skipped invalid thumbnail URL: "${article.image_hd}"`
          );
        }
        await channel.send("@everyone");
        await channel.send({ embeds: [embed] });
        // Simple rate-limit delay
        await new Promise((r) => setTimeout(r, 1000));
      }

      lastTimestamp = Math.max(...newArticles.map((a) => a.published));
      await saveArticles(newArticles);
      console.log("✅ Articles sent.");
    } catch (err) {
      console.error("❌ Error fetching or sending articles:", err);
    }
  }, 15000);
});

// Keep-alive HTTP server
const app = express();
app.get("/", (_, res) => res.send("Bot is running!"));
app.listen(process.env.PORT || 3000, () =>
  console.log("✅ HTTP Server listening")
);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🤖 Shutting down bot...");
  await client.destroy();
  await mongoose.connection.close();
  console.log("✅ Bot shut down successfully");
  process.exit(0);
});

// Bot login
client.login(process.env.BOT_TOKEN).catch((err) => {
  console.error("❌ Bot login failed:", err);
});
