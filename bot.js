const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const fs = require("fs").promises;
const mongoose = require("mongoose");
require("dotenv").config();

const API_URL = "https://api.watcher.guru/content/data?news=10";

// MongoDB Schema to save last timestamp and article info
const articleSchema = new mongoose.Schema({
  title: String,
  url: String,
  description: String,
  image_hd: String,
  published: Number,
});

const Article = mongoose.model("Article", articleSchema);

// Connect to MongoDB
mongoose.set("strictQuery", true);
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
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

// Initialize timestamp from file or MongoDB
async function initializeTimestamp() {
  try {
    const latestArticle = await Article.findOne().sort({ published: -1 });
    if (latestArticle) {
      return latestArticle.published;
    }
  } catch (error) {
    console.error("Error fetching the latest timestamp from MongoDB:", error);
  }
  return 0; // If no articles in the DB, start from 0
}

// Save articles and timestamp to MongoDB
async function saveArticles(newArticles) {
  try {
    for (const article of newArticles) {
      const newArticle = new Article({
        title: article.title,
        url: article.url,
        description: article.description,
        image_hd: article.image_hd,
        published: article.published,
      });
      await newArticle.save();
    }
  } catch (error) {
    console.error("Error saving articles to MongoDB:", error);
  }
}

// Main bot logic
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  let lastTimestamp = await initializeTimestamp();
  console.log(`Last timestamp: ${lastTimestamp}`);

  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      if (!channel?.isTextBased()) return;

      console.log("🔄 Checking for new articles...");

      const res = await axios.get(API_URL);
      const newArticles = res.data
        .filter((article) => article.published > lastTimestamp)
        .sort((a, b) => a.published - b.published); // Oldest first

      if (newArticles.length) {
        for (const article of newArticles) {
          const embed = new EmbedBuilder()
            .setTitle(article.title)
            .setURL(article.url)
            .setDescription(article.description)
            .setThumbnail(article.image_hd)
            .setColor("#FF0000")
            .setTimestamp(article.published * 1000);

          await channel.send("@everyone");
          await channel.send({ embeds: [embed] });

          // Rate limit protection
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Update lastTimestamp after sending new articles
        lastTimestamp = Math.max(...newArticles.map((a) => a.published));
        await saveArticles(newArticles); // Save new articles to DB
        console.log("✅ Articles sent.");
      }
    } catch (error) {
      console.error("❌ Error fetching or sending articles:", error);
    }
  }, 60000); // Run every 1 minute
});

client.login(process.env.BOT_TOKEN);
