const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mineflayer = require('mineflayer');
const { status } = require('minecraft-server-util');

// ---------- HARDCODED DEFAULTS (your Aternos server) ----------
const DEFAULTS = {
  host: 'Power69.aternos.me',
  port: 42959,
  username: 'dreamz',
  version: '1.20.4',
  offline: true
};

// ---------- CONFIG ----------
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_!';
const DASHBOARD_PASSWORD = 'nounou123_';
const RECONNECT_DELAY = 10000;            // 10 seconds between auto-retries
const CONNECTION_TIMEOUT = 20000;         // 20 seconds
const MAX_CONSOLE_LINES = 200;

const AFK_MOVE_INTERVAL_MIN = 30;
const AFK_MOVE_INTERVAL_MAX = 40;
const AFK_CHAT_INTERVAL_MIN = 10;
const AFK_CHAT_INTERVAL_MAX = 13;
const MOVE_DURATION_MS = 1200;

// ---------- GLOBALS ----------
let bot = null;
let botOpts = null;
let manualStop = false;
let startTime = null;
let afkEnabled = true;
let afkTimers = { move: null, chat: null };
let customCmds = [];
let consoleLog = [];
let connectionTimeout = null;
let autoRetryTimer = null;

// ---------- EXPRESS + SOCKET.IO ----------
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    const token = jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Wrong password' });
});

// ---------- SERVER STATUS (ping without joining) ----------
async function fetchServerStatus(host, port) {
  try {
    const res = await status(host, port, { timeout: 5000 });
    return {
      online: true,
      players: res.players.online,
      maxPlayers: res.players.max,
      version: res.version.name,
      motd: res.motd.clean
    };
  } catch (e) {
    return { online: false };
  }
}

function broadcastServerStatus() {
  if (!botOpts) return;
  fetchServerStatus(botOpts.host, botOpts.port).then(info => {
    io.emit('serverStatus', info);
  });
}

// ---------- SOCKET.IO AUTH ----------
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) return next(new Error('Invalid token'));
    next();
  });
});

io.on('connection', (socket) => {
  // Send current bot state
  const botStatus = bot ? (bot.entity ? 'online' : 'connecting') : 'offline';
  socket.emit('botStatus', {
    connected: bot ? true : false,
    connecting: bot && !bot.entity,
    state: botStatus
  });
  if (bot && bot.entity) {
    socket.emit('telemetry', getTelemetry());
    socket.emit('serverInfo', getServerInfo());
  }
  socket.emit('consoleInit', consoleLog);
  socket.emit('antiAfkStatus', afkEnabled);
  socket.emit('customCommands', customCmds);

  // Immediately send current server status (uses last stored opts or defaults)
  if (botOpts) {
    fetchServerStatus(botOpts.host, botOpts.port).then(info => socket.emit('serverStatus', info));
  } else {
    fetchServerStatus(DEFAULTS.host, DEFAULTS.port).then(info => socket.emit('serverStatus', info));
  }

  // Client requests
  socket.on('connectBot', (opts) => {
    if (bot) {
      socket.emit('errorMsg', 'Bot already connected.');
      return;
    }
    stopAutoRetry();
    startBot(opts);
  });

  socket.on('disconnectBot', () => {
    stopBot(true);
  });

  socket.on('toggleAntiAfk', (val) => {
    afkEnabled = val;
    io.emit('antiAfkStatus', afkEnabled);
    if (afkEnabled && bot) startAfk();
    else stopAfk();
    addLog('[AntiAFK] ' + (afkEnabled ? 'Enabled' : 'Disabled'), 'system');
  });

  socket.on('sendMessage', (msg) => {
    if (bot) {
      bot.chat(msg);
      addLog(`<${bot.username}> ${msg}`, 'bot-message');
    }
  });

  socket.on('updateCustomCommands', (cmds) => {
    customCmds = cmds;
    io.emit('customCommands', customCmds);
    addLog('Custom commands updated', 'system');
  });
});

// ---------- BOT FUNCTIONS ----------
function clearConnectionTimeout() {
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }
}

function stopAutoRetry() {
  if (autoRetryTimer) {
    clearTimeout(autoRetryTimer);
    autoRetryTimer = null;
  }
}

function startBot(opts) {
  botOpts = opts;
  manualStop = false;
  startTime = null;
  io.emit('botStatus', { connected: true, connecting: true, state: 'connecting' });

  try {
    bot = mineflayer.createBot({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      version: opts.version || false,
      auth: opts.offline ? 'offline' : 'microsoft'
    });
  } catch (e) {
    addLog('Connection error: ' + e.message, 'error');
    io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
    scheduleRetry();
    return;
  }

  bindBotEvents(bot);
  addLog(`Connecting to ${opts.host}:${opts.port}...`, 'system');

  clearConnectionTimeout();
  connectionTimeout = setTimeout(() => {
    if (bot && !bot.entity) {
      addLog('Connection timed out – server unreachable or wrong details', 'error');
      bot.quit();
      bot = null;
      io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
      scheduleRetry();
    }
    connectionTimeout = null;
  }, CONNECTION_TIMEOUT);
}

function scheduleRetry() {
  if (manualStop) return;
  stopAutoRetry();
  addLog(`Retrying in ${RECONNECT_DELAY / 1000}s...`, 'system');
  autoRetryTimer = setTimeout(() => {
    if (!manualStop && botOpts) startBot(botOpts);
  }, RECONNECT_DELAY);
}

function stopBot(manual = false) {
  if (!bot) return;
  manualStop = manual;
  stopAfk();
  clearConnectionTimeout();
  stopAutoRetry();
  bot.quit();
  bot = null;
  io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
  addLog('Bot disconnected', 'system');
  if (manual) {
    // user manually disconnected – don't auto-retry
    manualStop = false; // reset for future
  }
}

function bindBotEvents(bot) {
  bot.on('login', () => {
    clearConnectionTimeout();
    stopAutoRetry();
    startTime = Date.now();
    addLog(`Connected as ${bot.username}`, 'system');
    io.emit('botStatus', { connected: true, connecting: false, state: 'online' });
    io.emit('serverInfo', getServerInfo());
    if (afkEnabled) startAfk();
    broadcastServerStatus(); // update server status now that we're inside
  });

  bot.on('spawn', () => addLog('Spawned in the world', 'system'));

  bot.on('chat', (username, message) => {
    const style = username === bot.username ? 'bot-message' : 'chat';
    addLog(`<${username}> ${message}`, style);
    for (const cmd of customCmds) {
      if (message.trim().toLowerCase() === cmd.name.toLowerCase()) {
        bot.chat(cmd.response);
        addLog(`[Cmd] Responded to ${username}: ${cmd.response}`, 'system');
      }
    }
  });

  bot.on('kicked', (reason) => {
    addLog('Kicked: ' + reason, 'error');
    handleEnd();
  });

  bot.on('error', (err) => {
    addLog('Error: ' + err.message, 'error');
    if (!startTime) {
      clearConnectionTimeout();
      io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
      scheduleRetry();
    }
  });

  bot.on('end', (reason) => {
    addLog('Disconnected: ' + reason, 'error');
    handleEnd();
  });

  function handleEnd() {
    clearConnectionTimeout();
    io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
    stopAfk();
    bot = null;
    if (!manualStop) {
      scheduleRetry();
    } else {
      manualStop = false;
    }
  }
}

// Telemetry + server info broadcast
setInterval(() => {
  if (bot && bot.entity) {
    io.emit('telemetry', getTelemetry());
    io.emit('serverInfo', getServerInfo());
  }
  if (botOpts) broadcastServerStatus();
}, 3000); // every 3 seconds

function getTelemetry() {
  if (!bot || !bot.entity) return null;
  return {
    uptime: startTime ? Date.now() - startTime : 0,
    health: bot.health,
    hunger: bot.food,
    position: bot.entity.position,
    ping: bot.player ? bot.player.ping : 0,
    inventoryCount: bot.inventory.items().length
  };
}

function getServerInfo() {
  if (!bot) return null;
  return {
    onlinePlayers: bot.players ? Object.keys(bot.players).join(', ') || 'None' : '--',
    brand: bot.game ? bot.game.serverBrand || 'Unknown' : 'Unknown',
    version: bot.version || 'Unknown'
  };
}

// ---------- ANTI-AFK ----------
function startAfk() {
  if (!bot || !afkEnabled) return;
  stopAfk();
  afkTimers.move = setInterval(() => {
    if (!bot || !afkEnabled || !bot.entity) return;
    const yaw = Math.random() * Math.PI * 2;
    bot.look(yaw, 0, true);
    bot.setControlState('forward', true);
    addLog('[AntiAFK] Moving', 'anti-afk');
    setTimeout(() => {
      if (bot) bot.setControlState('forward', false);
    }, MOVE_DURATION_MS);
  }, (Math.floor(Math.random() * (AFK_MOVE_INTERVAL_MAX - AFK_MOVE_INTERVAL_MIN + 1)) + AFK_MOVE_INTERVAL_MIN) * 1000);

  const chatMs = (Math.floor(Math.random() * (AFK_CHAT_INTERVAL_MAX - AFK_CHAT_INTERVAL_MIN + 1)) + AFK_CHAT_INTERVAL_MIN) * 60000;
  afkTimers.chat = setInterval(() => {
    if (!bot || !afkEnabled) return;
    const msgs = ['Hello!', 'How is everyone?', 'Nice day!', 'Anyone here?', 'Just mining...'];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    bot.chat(msg);
    addLog(`[AntiAFK] Sent: ${msg}`, 'anti-afk');
  }, chatMs);
}

function stopAfk() {
  if (afkTimers.move) clearInterval(afkTimers.move);
  if (afkTimers.chat) clearInterval(afkTimers.chat);
  afkTimers = { move: null, chat: null };
}

function addLog(text, style = 'default') {
  const entry = { text, style, time: new Date().toISOString() };
  consoleLog.push(entry);
  if (consoleLog.length > MAX_CONSOLE_LINES) consoleLog.shift();
  io.emit('console', entry);
}

// ---------- AUTO-CONNECT ON STARTUP ----------
function initialConnect() {
  botOpts = { ...DEFAULTS };
  startBot(botOpts);
}

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${PORT}`);
  initialConnect();
});