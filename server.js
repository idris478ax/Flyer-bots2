const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mineflayer = require('mineflayer');
const { status } = require('minecraft-server-util');

// ---------- HARDCODED DEFAULTS ----------
const DEFAULTS = {
  host: 'Power69.aternos.me',
  port: 42959,
  username: 'dreamz',
  version: false,
  offline: true
};

// ---------- CONFIG ----------
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_!';
const DASHBOARD_PASSWORD = 'nounou123_';
const RETRY_DELAY = 10000;
const CONNECTION_TIMEOUT = 40000;
const MAX_CONSOLE_LINES = 200;

// Default Anti‑AFK settings
let afkSettings = {
  enabled: true,
  moveMinSec: 30,
  moveMaxSec: 40,
  moveDistanceBlocks: 5,
  chatMinMin: 10,
  chatMaxMin: 13,
  chatMessages: ['Hello!', 'How is everyone?', 'Nice day!', 'Anyone here?', 'Just mining...']
};

// Walking speed in m/s
const WALK_SPEED = 4.317;

function computeMoveDuration(blocks) {
  return (blocks / WALK_SPEED) * 1000; // ms
}

// ---------- GLOBALS ----------
let bot = null;
let botOpts = null;
let manualStop = false;
let startTime = null;
let customCmds = [];
let consoleLog = [];
let connectionTimeout = null;
let retryTimer = null;
let afkTimers = { move: null, chat: null };
const playerJoinTimes = new Map(); // username -> Date.now()

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

// Server ping
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
  fetchServerStatus(botOpts.host, botOpts.port).then(info => io.emit('serverStatus', info));
}

// ---------- SOCKET.IO ----------
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) return next(new Error('Invalid token'));
    next();
  });
});

io.on('connection', (socket) => {
  const state = bot ? (bot.entity ? 'online' : 'connecting') : 'offline';
  socket.emit('botStatus', { connected: !!bot, connecting: bot && !bot.entity, state });
  if (bot && bot.entity) {
    socket.emit('telemetry', getTelemetry());
    socket.emit('serverInfo', getServerInfo());
    socket.emit('playerList', getPlayerList());
  }
  socket.emit('consoleInit', consoleLog);
  socket.emit('antiAfkSettings', afkSettings);
  socket.emit('customCommands', customCmds);

  const host = botOpts ? botOpts.host : DEFAULTS.host;
  const port = botOpts ? botOpts.port : DEFAULTS.port;
  fetchServerStatus(host, port).then(info => socket.emit('serverStatus', info));

  socket.on('connectBot', (opts) => {
    if (bot) { socket.emit('errorMsg', 'Bot already connected.'); return; }
    stopRetry();
    startBot(opts);
  });

  socket.on('disconnectBot', () => stopBot(true));

  socket.on('updateAfkSettings', (newSettings) => {
    afkSettings = { ...afkSettings, ...newSettings };
    io.emit('antiAfkSettings', afkSettings);
    if (bot && afkSettings.enabled) {
      stopAfk();
      startAfk();
    }
    addLog('[AntiAFK] Settings updated', 'system');
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

// ---------- BOT ----------
function startBot(opts) {
  botOpts = opts;
  manualStop = false;
  startTime = null;
  playerJoinTimes.clear();
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
      addLog('Connection timed out – retrying...', 'error');
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
  stopRetry();
  addLog(`Retrying in ${RETRY_DELAY / 1000}s...`, 'system');
  retryTimer = setTimeout(() => {
    if (!manualStop && botOpts) startBot(botOpts);
  }, RETRY_DELAY);
}

function stopBot(manual = false) {
  if (!bot) return;
  manualStop = manual;
  stopAfk();
  clearConnectionTimeout();
  stopRetry();
  bot.quit();
  bot = null;
  io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
  addLog('Bot disconnected', 'system');
  if (manual) manualStop = false;
}

function bindBotEvents(bot) {
  bot.on('login', () => {
    clearConnectionTimeout();
    stopRetry();
    startTime = Date.now();
    addLog(`Connected as ${bot.username}`, 'system');
    io.emit('botStatus', { connected: true, connecting: false, state: 'online' });
    io.emit('serverInfo', getServerInfo());
    if (afkSettings.enabled) startAfk();
    broadcastServerStatus();
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

  bot.on('kicked', (reason) => { addLog('Kicked: ' + reason, 'error'); handleEnd(); });
  bot.on('error', (err) => {
    addLog('Error: ' + err.message, 'error');
    if (!startTime) {
      clearConnectionTimeout();
      io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
      scheduleRetry();
    }
  });
  bot.on('end', (reason) => { addLog('Disconnected: ' + reason, 'error'); handleEnd(); });

  function handleEnd() {
    clearConnectionTimeout();
    io.emit('botStatus', { connected: false, connecting: false, state: 'offline' });
    stopAfk();
    bot = null;
    if (!manualStop) scheduleRetry();
    else manualStop = false;
  }
}

// ---------- DATA EMIT ----------
setInterval(() => {
  if (bot && bot.entity) {
    io.emit('telemetry', getTelemetry());
    io.emit('serverInfo', getServerInfo());
    io.emit('playerList', getPlayerList());
  }
  if (botOpts) broadcastServerStatus();
}, 1000); // 1‑second updates

function getTelemetry() {
  if (!bot || !bot.entity) return null;
  const pos = bot.entity.position;
  let biome = 'Unknown';
  try {
    const block = bot.blockAt(pos);
    if (block && block.biome && block.biome.name) biome = block.biome.name;
  } catch (e) {}
  return {
    uptime: startTime ? Date.now() - startTime : 0,
    health: bot.health,
    hunger: bot.food,
    position: pos,
    ping: bot.player ? bot.player.ping : 0,
    inventoryCount: bot.inventory.items().length,
    xpLevel: bot.experience ? bot.experience.level : 0,
    biome,
    dimension: bot.game ? bot.game.dimension : 'Unknown'
  };
}

function getServerInfo() {
  if (!bot) return null;
  return {
    onlinePlayers: bot.players ? Object.keys(bot.players).length : 0,
    brand: bot.game ? bot.game.serverBrand || 'Unknown' : 'Unknown',
    version: bot.version || 'Unknown'
  };
}

function getPlayerList() {
  if (!bot || !bot.players) return [];
  const list = [];
  for (const [username, player] of Object.entries(bot.players)) {
    if (!playerJoinTimes.has(username)) playerJoinTimes.set(username, Date.now());
    const onlineTime = Math.floor((Date.now() - playerJoinTimes.get(username)) / 1000);
    const pos = player.entity ? player.entity.position : null;
    list.push({
      username,
      ping: player.ping || 'N/A',
      position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
      onlineTime
    });
  }
  // Clean up stored times for players who left
  for (const name of playerJoinTimes.keys()) {
    if (!bot.players[name]) playerJoinTimes.delete(name);
  }
  return list;
}

// ---------- ANTI-AFK ----------
function startAfk() {
  if (!bot || !afkSettings.enabled) return;
  stopAfk();

  const moveDur = computeMoveDuration(afkSettings.moveDistanceBlocks);
  const moveInterval = Math.floor(Math.random() * (afkSettings.moveMaxSec - afkSettings.moveMinSec + 1)) + afkSettings.moveMinSec;
  afkTimers.move = setInterval(() => {
    if (!bot || !afkSettings.enabled || !bot.entity) return;
    const yaw = Math.random() * Math.PI * 2;
    bot.look(yaw, 0, true);
    bot.setControlState('forward', true);
    addLog('[AntiAFK] Moving', 'anti-afk');
    setTimeout(() => { if (bot) bot.setControlState('forward', false); }, moveDur);
  }, moveInterval * 1000);

  const chatMs = (Math.floor(Math.random() * (afkSettings.chatMaxMin - afkSettings.chatMinMin + 1)) + afkSettings.chatMinMin) * 60000;
  afkTimers.chat = setInterval(() => {
    if (!bot || !afkSettings.enabled) return;
    const msgs = afkSettings.chatMessages;
    if (msgs.length > 0) {
      const msg = msgs[Math.floor(Math.random() * msgs.length)];
      bot.chat(msg);
      addLog(`[AntiAFK] Sent: ${msg}`, 'anti-afk');
    }
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

function stopRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
function clearConnectionTimeout() { if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; } }

function initialConnect() {
  botOpts = { ...DEFAULTS };
  startBot(botOpts);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${PORT}`);
  initialConnect();
});