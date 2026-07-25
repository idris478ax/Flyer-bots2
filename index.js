const express = require('express');
const mineflayer = require('mineflayer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── HARDCODED CONFIG ──────────────────────────────────
const BOT_CONFIG = {
  host: 'Power69.aternos.me',
  port: 42959,
  username: 'ABDOU-BOT',          // <-- hardcoded as requested
  version: false,                 // auto-detect
  auth: 'offline'
};

let bot = null;
let botReady = false;
let botUsername = BOT_CONFIG.username;

// ─── BOT CREATION & RECONNECT LOGIC ──────────────────
function createBot() {
  if (bot) {
    bot.end();
    bot = null;
  }

  bot = mineflayer.createBot(BOT_CONFIG);
  botReady = false;

  bot.on('login', () => {
    console.log(`✅ Logged in as ${bot.username}`);
    botUsername = bot.username;
  });

  bot.on('spawn', () => {
    botReady = true;
    console.log('✅ Spawned in world');
    // Optional: send a greeting
    // bot.chat('Hello! I am ABDOU-BOT');
  });

  bot.on('error', (err) => {
    console.error('❌ Bot error:', err);
    botReady = false;
  });

  bot.on('end', (reason) => {
    botReady = false;
    console.log(`⚠️ Disconnected: ${reason}`);
    setTimeout(() => {
      console.log('🔄 Reconnecting...');
      createBot();
    }, 5000);
  });

  bot.on('kicked', (reason, loggedIn) => {
    botReady = false;
    console.log(`👢 Kicked: ${reason}`);
    setTimeout(() => {
      console.log('🔄 Reconnecting after kick...');
      createBot();
    }, 5000);
  });
}

// Start the bot
createBot();

// ─── WEB SERVER (status + simple dashboard) ──────────
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>ABDOU-BOT Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background: #1a1a2e; color: #eee; }
          .status { font-size: 2rem; margin: 20px 0; }
          .online { color: #4caf50; }
          .offline { color: #f44336; }
          .info { background: #16213e; padding: 20px; border-radius: 10px; display: inline-block; }
        </style>
      </head>
      <body>
        <h1>⛏️ ABDOU-BOT</h1>
        <div class="info">
          <p><strong>Server:</strong> Power69.aternos.me:42959</p>
          <p><strong>Bot Name:</strong> ABDOU-BOT</p>
          <p><strong>Status:</strong> 
            <span class="${botReady ? 'online' : 'offline'}">
              ${botReady ? '✅ Online' : '❌ Offline'}
            </span>
          </p>
          <p><small>Auto‑reconnect is active</small></p>
        </div>
        <p><a href="/status" style="color: #6c8cff;">/status (JSON)</a></p>
      </body>
    </html>
  `);
});

app.get('/status', (req, res) => {
  res.json({
    status: botReady ? 'online' : 'offline',
    username: botUsername || 'ABDOU-BOT',
    server: `${BOT_CONFIG.host}:${BOT_CONFIG.port}`,
    uptime: botReady ? Math.floor((Date.now() - (bot._client?.connectedTime || Date.now())) / 1000) : 0,
  });
});

// ─── START SERVER ──────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  console.log(`🤖 Bot connecting to ${BOT_CONFIG.host}:${BOT_CONFIG.port} as "ABDOU-BOT"`);
});