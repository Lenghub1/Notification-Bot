const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const fs = require("fs").promises;
require("dotenv").config();

let lastTimestamp = 0;
const API_URL = "https://api.watcher.guru/content/data?news=10";
const STORAGE_FILE = "lastTimestamp.json";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize timestamp on startup
async function initializeTimestamp() {
  try {
    const data = await fs.readFile(STORAGE_FILE);
    lastTimestamp = JSON.parse(data).lastTimestamp;
  } catch {
    const res = await axios.get(API_URL);
    if (res.data?.length) {
      lastTimestamp = Math.max(...res.data.map((article) => article.published));
      await saveTimestamp();
    }
  }
}

async function saveTimestamp() {
  await fs.writeFile(STORAGE_FILE, JSON.stringify({ lastTimestamp }));
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await initializeTimestamp();

  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      if (!channel?.isTextBased()) return;
      console.log("Bot Running ...");

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
          await channel.send("@everyone ");
          await channel.send({ embeds: [embed] });

          await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit protection
        }

        lastTimestamp = Math.max(
          ...newArticles.map((article) => article.published)
        );
        await saveTimestamp();
        console.log("Bot Running ...");
      }
    } catch (error) {
      console.error("Error:", error);
    }
  }, 60000); // 1 minutes
});

client.login(process.env.BOT_TOKEN);
