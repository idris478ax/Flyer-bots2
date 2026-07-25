const express = require('express');
const mineflayer = require('mineflayer');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── BOT CONFIG ──────────────────────────────────────────
const BOT_CONFIG = {
  host: 'Power69.aternos.me',
  port: 42959,
  username: 'ABDOU_BOT_2024',
  version: false,               // auto-detect – let mineflayer figure it out
  auth: 'offline'
};

let bot = null;
let botReady = false;
let botUsername = BOT_CONFIG.username;
let lastError = null;
let logMessages = [];
let afkInterval = null;
let reconnectAttempts = 0;
let lastActivity = Date.now();
let isReconnecting = false;     // prevent overlapping reconnects
let reconnectTimer = null;
const MAX_LOG = 100;

function addLog(message, type = 'info') {
  const entry = { time: new Date().toISOString(), message, type };
  logMessages.push(entry);
  if (logMessages.length > MAX_LOG) logMessages.shift();
  console.log(`[${type}] ${message}`);
}

// ─── CHECK SERVER ──────────────────────────────────────────
function checkServer(callback) {
  const socket = new net.Socket();
  let timeout = setTimeout(() => {
    socket.destroy();
    callback(false);
  }, 3000);

  socket.on('connect', () => {
    clearTimeout(timeout);
    socket.destroy();
    callback(true);
  });

  socket.on('error', () => {
    clearTimeout(timeout);
    callback(false);
  });

  socket.connect(BOT_CONFIG.port, BOT_CONFIG.host);
}

// ─── ANTI-AFK ────────────────────────────────────────────
function startAntiAFK() {
  if (afkInterval) clearInterval(afkInterval);
  afkInterval = setInterval(() => {
    if (!botReady || !bot) return;
    try {
      const idleTime = (Date.now() - lastActivity) / 1000;
      if (idleTime > 30) {
        const actions = [
          () => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); },
          () => { bot.setControlState('sneak', true); setTimeout(() => bot.setControlState('sneak', false), 1000); },
          () => { bot.look(Math.random() * Math.PI * 2, 0, true); },
          () => { bot.setControlState('forward', true); setTimeout(() => bot.setControlState('forward', false), 500); },
          () => { bot.setControlState('back', true); setTimeout(() => bot.setControlState('back', false), 500); }
        ];
        actions[Math.floor(Math.random() * actions.length)]();
        lastActivity = Date.now();
        addLog(`🔄 Anti-AFK action`, 'info');
      }
    } catch (_) {}
  }, 5000);
  addLog('🛡️ Anti-AFK activated', 'success');
}

// ─── BOT CREATION (with safe reconnect) ──────────────────
function createBot() {
  // Prevent multiple simultaneous reconnect attempts
  if (isReconnecting) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (bot) {
    try { bot.end(); } catch(e) {}
    bot = null;
  }

  isReconnecting = true;
  addLog(`🔍 Checking server...`, 'info');

  checkServer((online) => {
    if (!online) {
      addLog(`❌ Server is OFFLINE`, 'error');
      lastError = 'Aternos server not running. Start it and set to Cracked.';
      botReady = false;
      isReconnecting = false;

      // Retry after 15 seconds
      reconnectTimer = setTimeout(() => createBot(), 15000);
      return;
    }

    addLog(`✅ Server online – connecting as ${BOT_CONFIG.username} (auto-version)`, 'success');
    try {
      bot = mineflayer.createBot(BOT_CONFIG);
    } catch(err) {
      addLog(`❌ Bot creation error: ${err.message}`, 'error');
      lastError = err.message;
      isReconnecting = false;
      reconnectTimer = setTimeout(() => createBot(), 10000);
      return;
    }

    botReady = false;
    lastError = null;
    isReconnecting = false;

    // ─── EVENT HANDLERS ──────────────────────────────

    bot.on('login', () => {
      botUsername = bot.username;
      addLog(`✅ Logged in as ${bot.username}`, 'success');
    });

    bot.on('spawn', () => {
      botReady = true;
      addLog('✅ SPAWNED – BOT IS ONLINE', 'success');
      startAntiAFK();
      try { bot.chat('Hello! I am ABDOU_BOT_2024 – staying online!'); } catch(e) {}
      lastActivity = Date.now();
      reconnectAttempts = 0; // reset on successful spawn
    });

    bot.on('error', (err) => {
      lastError = err.message;
      botReady = false;
      addLog(`❌ Error: ${err.message}`, 'error');
      // If it's a version error, we might want to try auto again
      if (err.message.includes('version')) {
        addLog(`💡 Version mismatch – switching to auto-detection (already enabled)`, 'warn');
      }
      // Do NOT reconnect here – let 'end' handle it
    });

    bot.on('end', (reason) => {
      botReady = false;
      lastError = reason || 'Disconnected';
      addLog(`⚠️ Connection ended: ${reason || 'Unknown'}`, 'warn');
      
      if (afkInterval) {
        clearInterval(afkInterval);
        afkInterval = null;
      }

      // Schedule reconnect with a fixed delay (no rapid loops)
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectAttempts++;
      const delay = Math.min(10000 + (reconnectAttempts * 5000), 60000);
      addLog(`🔄 Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts})`, 'info');
      reconnectTimer = setTimeout(() => createBot(), delay);
    });

    bot.on('kicked', (reason, loggedIn) => {
      botReady = false;
      lastError = reason;
      addLog(`👢 KICKED: ${reason}`, 'error');
      
      if (afkInterval) {
        clearInterval(afkInterval);
        afkInterval = null;
      }

      // Same reconnect delay
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectAttempts++;
      const delay = Math.min(10000 + (reconnectAttempts * 5000), 60000);
      addLog(`🔄 Reconnecting after kick in ${delay/1000}s (attempt ${reconnectAttempts})`, 'info');
      reconnectTimer = setTimeout(() => createBot(), delay);
    });

    bot.on('connect', () => {
      addLog('🔌 TCP connected', 'info');
    });
  });
}

// ─── START BOT ──────────────────────────────────────────
addLog(`🚀 Starting ABDOU-BOT...`, 'info');
createBot();

// ─── EXPRESS SERVER ──────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dashboard (same as before – but I'll keep it minimal for length)
// ... (full dashboard code) ...
// For brevity, I'll include the same HTML/JS as previous, but you can copy the full dashboard from earlier.

// ─── API ROUTES ──────────────────────────────────────────
app.get('/status', (req, res) => {
  const mem = process.memoryUsage();
  const memMB = Math.round(mem.heapUsed / 1024 / 1024);
  const memPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);
  const uptime = botReady ? Math.floor((Date.now() - (bot._client?.connectedTime || Date.now())) / 1000) : 0;
  res.json({
    status: botReady ? 'online' : (bot ? 'connecting' : 'offline'),
    username: botUsername || 'ABDOU_BOT_2024',
    uptime: uptime,
    memoryMB: memMB,
    memoryPercent: memPercent,
    version: bot?.version || 'auto',
    lastError: lastError,
    reconnectAttempts: reconnectAttempts,
    afkActive: afkInterval !== null && botReady
  });
});

app.get('/logs', (req, res) => {
  res.json(logMessages);
});

app.post('/clear-logs', (req, res) => {
  logMessages = [];
  res.send('OK');
});

app.post('/reconnect', (req, res) => {
  addLog('🔄 Manual reconnect triggered', 'warn');
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }
  if (bot) {
    try { bot.end('Manual reconnect'); } catch(e) {}
  }
  setTimeout(() => createBot(), 1000);
  res.send('Reconnecting...');
});

app.get('/command', (req, res) => {
  const cmd = req.query.cmd;
  if (!cmd) return res.status(400).send('Missing ?cmd=');
  if (!botReady) return res.status(503).send('Bot not ready');
  try {
    bot.chat(cmd);
    addLog('💬 Command sent: ' + cmd, 'info');
    lastActivity = Date.now();
    res.send('OK');
  } catch(e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// ─── START SERVER ──────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🌐 Dashboard on port ${PORT}`);
  console.log(`🤖 Bot for Power69.aternos.me:42959 (auto-version)`);
  console.log(`🛡️ Anti-AFK enabled – will stay online.`);
});