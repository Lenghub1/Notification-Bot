const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const mongoose = require("mongoose");
const express = require("express");
require("dotenv").config();

// MongoDB Schema
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

// Initialize last timestamp
async function initializeTimestamp() {
  try {
    const latest = await Article.findOne().sort({ published: -1 });
    return latest ? latest.published : 0;
  } catch (err) {
    console.error("Error fetching latest timestamp:", err);
    return 0;
  }
}

// Save new articles
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

// Validate image URL
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
    activities: [{ name: "Watching for crypto news", type: "WATCHING" }],
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

      // 🔥 Send @everyone once
      await channel.send(
        `@everyone 🚨 **${newArticles.length} new crypto news articles!**`
      );

      for (const article of newArticles) {
        console.log(`Processing article: ${article.title}`);
        console.log(`Raw Image URL: ${article.image_hd}`);

        const embed = new EmbedBuilder()
          .setTitle(article.title)
          .setURL(article.url)
          .setDescription(article.description)
          .setColor("#FF0000")
          .setTimestamp(article.published * 1000);

        if (isValidImageUrl(article.image_hd)) {
          embed.setThumbnail(article.image_hd);
        } else {
          console.warn(`⚠️ Skipped invalid thumbnail: "${article.image_hd}"`);
        }

        await channel.send({ embeds: [embed] });

        // Update lastTimestamp and save after each article
        lastTimestamp = article.published;
        await Article.create({
          title: article.title,
          url: article.url,
          description: article.description,
          image_hd: article.image_hd,
          published: article.published,
        });

        await new Promise((r) => setTimeout(r, 1000)); // simple rate-limit delay
      }

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
