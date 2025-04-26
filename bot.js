require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const Binance = require("binance-api-node").default;
const axios = require("axios");
const mongoose = require("mongoose");
const express = require("express");

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

// MongoDB Schema for news articles
const articleSchema = new mongoose.Schema({
  title: String,
  url: String,
  description: String,
  image_hd: String,
  published: Number,
});
const Article = mongoose.model("Article", articleSchema);

// Connect to MongoDB
mongoose.set("strictQuery", false);
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ Database connection failed. Server not started");
    console.error(err);
  });

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize Binance client
const binance = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
});

// Queue system for Binance messages
let queue = [];
let isSending = false;

// Color mapping
const orderTypeColors = {
  BUY: "#00FF00", // Green
  SELL: "#FF0000", // Red
  DEFAULT: "#808080", // Grey
};

const orderStatusColors = {
  FILLED: "#00FFFF", // Cyan
  CANCELED: "#FFA500", // Orange
  EXPIRED: "#800080", // Purple
  NEW: "#FFFF00", // Yellow
  DEFAULT: "#808080", // Grey
};

// Send message to a Discord webhook
const sendToDiscord = async (payload, attempt = 1) => {
  try {
    await axios.post(discordWebhookUrl, payload);
    console.log("✅ Message sent to Discord");
  } catch (error) {
    console.error(
      `❌ Error sending to Discord (Attempt ${attempt}):`,
      error.message
    );
    if (attempt < 3) {
      const delay = 1000 * attempt;
      setTimeout(() => sendToDiscord(payload, attempt + 1), delay);
    } else {
      console.error("🚫 Giving up after 3 attempts.");
    }
  }
};

// Process message queue
const processQueue = async () => {
  if (isSending || queue.length === 0) return;
  isSending = true;

  const { payload } = queue.shift();
  try {
    await sendToDiscord(payload);
  } catch (err) {
    console.error("❌ Discord send error:", err.message);
  }

  isSending = false;
  setTimeout(processQueue, 1000);
};

// Add message to queue
const queueMessage = (payload) => {
  queue.push({ payload });
  processQueue();
};

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

// Discord bot is ready
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await client.user.setPresence({
    status: "online",
    activities: [{ name: "Fetching news + Binance updates", type: "WATCHING" }],
  });

  // Binance WebSocket
  // Binance WebSocket
  binance.ws.futuresUser((userData) => {
    if (userData.eventType === "ORDER_TRADE_UPDATE") {
      const {
        symbol,
        side,
        orderType,
        orderStatus,
        executionType,
        quantity,
        price,
        averagePrice,
        realizedProfit,
        isMaker,
      } = userData;

      // Mapping side colors (BUY/SELL)
      const orderTypeColors = {
        BUY: "#00FF00", // Green
        SELL: "#FF0000", // Red
        DEFAULT: "#808080", // Grey
      };

      // Mapping status colors (NEW, FILLED, CANCELED, etc.)
      const orderStatusColors = {
        NEW: "#FFFF00", // Yellow
        FILLED: "#00FFFF", // Cyan
        CANCELED: "#FFA500", // Orange
        EXPIRED: "#800080", // Purple
        DEFAULT: "#808080", // Grey
      };

      // Mapping status emojis
      const statusEmojis = {
        NEW: "🆕",
        FILLED: "✅",
        CANCELED: "❌",
        EXPIRED: "⌛",
        DEFAULT: "🔔",
      };

      // Pick colors and emoji
      const orderColor = orderTypeColors[side] || orderTypeColors.DEFAULT;
      const statusColor =
        orderStatusColors[orderStatus] || orderStatusColors.DEFAULT;
      const statusEmoji = statusEmojis[orderStatus] || statusEmojis.DEFAULT;

      // Final color: if NEW -> use side color (BUY/SELL), else use status color (FILLED/CANCELED)
      const finalColor = orderStatus === "NEW" ? orderColor : statusColor;

      // Build the Discord embed
      const embed = new EmbedBuilder()
        .setTitle(`${statusEmoji} Futures Order Update - ${symbol}`)
        .setColor(finalColor)
        .addFields(
          { name: "Side", value: side || "Unknown", inline: true },
          { name: "Type", value: orderType || "Unknown", inline: true },
          { name: "Status", value: orderStatus || "Unknown", inline: true },
          {
            name: "Execution",
            value: executionType || "Unknown",
            inline: true,
          },
          {
            name: "Quantity",
            value: quantity?.toString() || "0",
            inline: true,
          },
          { name: "Price", value: price?.toString() || "0", inline: true },
          {
            name: "Average Price",
            value: averagePrice?.toString() || "0",
            inline: true,
          },
          {
            name: "Realized PnL",
            value: realizedProfit?.toString() || "0",
            inline: true,
          },
          { name: "Maker?", value: isMaker ? "Yes" : "No", inline: true }
        )
        .setTimestamp(new Date());

      // Send embed to Discord (queued)
      queueMessage({ embeds: [embed] });
    }
  });

  console.log("✅ Connected to Binance WebSocket");

  // Watcher Guru News Monitoring
  const API_URL = "https://api.watcher.guru/content/data?news=10";
  let lastTimestamp = await initializeTimestamp();
  console.log(`Last news timestamp: ${lastTimestamp}`);

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

        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle(article.title)
          .setURL(article.url)
          .setDescription(article.description)
          .setTimestamp(article.published * 1000);

        if (isValidImageUrl(article.image_hd)) {
          embed.setThumbnail(article.image_hd);
        } else {
          console.warn(
            `⚠️ Skipped invalid thumbnail URL: "${article.image_hd}"`
          );
        }

        await channel.send({
          content: "@everyone",
          embeds: [embed],
        });

        await new Promise((r) => setTimeout(r, 1000));
      }

      lastTimestamp = Math.max(...newArticles.map((a) => a.published));
      await saveArticles(newArticles);
      console.log("✅ Articles sent.");
    } catch (err) {
      console.error("❌ Error fetching or sending articles:", err);
    }
  }, 30000);
});

// Express Keep-Alive HTTP server
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
