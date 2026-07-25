const express = require('express');
const mineflayer = require('mineflayer');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── BOT CONFIG (hardcoded) ──────────────────────────────
const BOT_CONFIG = {
  host: 'Power69.aternos.me',
  port: 42959,
  username: 'ABDOU_BOT_2024',
  version: '1.20.2',          // explicit version to avoid mismatches
  auth: 'offline'
};

let bot = null;
let botReady = false;
let botUsername = BOT_CONFIG.username;
let lastError = null;
let logMessages = [];
let isConnecting = false;
let afkInterval = null;
let reconnectAttempts = 0;
let lastActivity = Date.now();
let kicked = false;           // flag to know if bot was kicked
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
  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }

  afkInterval = setInterval(() => {
    if (!botReady || !bot) return;

    try {
      const now = Date.now();
      const idleTime = (now - lastActivity) / 1000;

      if (idleTime > 30) {
        const actions = [
          () => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); },
          () => { bot.setControlState('sneak', true); setTimeout(() => bot.setControlState('sneak', false), 1000); },
          () => { bot.look(Math.random() * Math.PI * 2, 0, true); },
          () => { bot.setControlState('forward', true); setTimeout(() => bot.setControlState('forward', false), 500); },
          () => { bot.setControlState('back', true); setTimeout(() => bot.setControlState('back', false), 500); },
        ];
        const action = actions[Math.floor(Math.random() * actions.length)];
        action();
        lastActivity = now;
        addLog(`🔄 Anti-AFK action`, 'info');
      }

      if (idleTime > 10 && Math.random() < 0.1) {
        bot.look(
          bot.entity?.yaw + (Math.random() - 0.5) * 0.5,
          bot.entity?.pitch + (Math.random() - 0.5) * 0.2,
          true
        );
      }
    } catch (e) { /* ignore */ }
  }, 5000);

  addLog('🛡️ Anti-AFK activated', 'success');
}

// ─── BOT CREATION ──────────────────────────────────────
function createBot() {
  if (isConnecting) return;
  if (bot) {
    try { bot.end(); } catch(e) {}
    bot = null;
  }

  isConnecting = true;
  addLog(`🔍 Checking server...`, 'info');

  checkServer((online) => {
    isConnecting = false;
    
    if (!online) {
      addLog(`❌ Server is OFFLINE!`, 'error');
      lastError = 'Aternos server not running. Start it and set to Cracked.';
      botReady = false;
      
      reconnectAttempts++;
      let delay = Math.min(10000 + (reconnectAttempts * 2000), 60000);
      addLog(`🔄 Retry in ${delay/1000}s (attempt ${reconnectAttempts})`, 'info');
      setTimeout(() => createBot(), delay);
      return;
    }

    reconnectAttempts = 0;
    addLog(`✅ Server online! Connecting as ${BOT_CONFIG.username} (${BOT_CONFIG.version})...`, 'success');
    
    try {
      bot = mineflayer.createBot(BOT_CONFIG);
    } catch(err) {
      addLog(`❌ Bot creation error: ${err.message}`, 'error');
      lastError = err.message;
      setTimeout(() => createBot(), 5000);
      return;
    }

    botReady = false;
    lastError = null;
    kicked = false;

    // ─── EVENT HANDLERS ──────────────────────────────

    bot.on('login', () => {
      botUsername = bot.username;
      addLog(`✅ Logged in as ${bot.username}`, 'success');
    });

    bot.on('spawn', () => {
      botReady = true;
      addLog('✅ Spawned in world – BOT IS NOW ONLINE', 'success');
      startAntiAFK();
      try { bot.chat('Hello! I am ABDOU_BOT_2024 – I will stay online!'); } catch(e) {}
      lastActivity = Date.now();
    });

    bot.on('error', (err) => {
      lastError = err.message;
      botReady = false;
      addLog(`❌ Error: ${err.message}`, 'error');
    });

    // ── This event fires when the connection is closed (including kicks) ──
    bot.on('end', (reason) => {
      botReady = false;
      lastError = reason || 'Disconnected';
      addLog(`⚠️ Connection ended: ${reason || 'unknown'}`, 'warn');
      
      if (afkInterval) {
        clearInterval(afkInterval);
        afkInterval = null;
      }

      // Only reconnect if it was a kick or an unexpected disconnect
      // (we always reconnect because we want the bot to stay online)
      reconnectAttempts++;
      let delay = Math.min(5000 + (reconnectAttempts * 2000), 60000);
      addLog(`🔄 Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts})`, 'info');
      setTimeout(() => createBot(), delay);
    });

    // ── This event fires when the server kicks the bot ──
    bot.on('kicked', (reason, loggedIn) => {
      botReady = false;
      kicked = true;
      lastError = reason;
      addLog(`👢 KICKED: ${reason}`, 'error');
      
      if (afkInterval) {
        clearInterval(afkInterval);
        afkInterval = null;
      }
      
      // Reconnect immediately but with backoff
      reconnectAttempts++;
      let delay = Math.min(5000 + (reconnectAttempts * 2000), 60000);
      addLog(`🔄 Reconnecting after kick in ${delay/1000}s (attempt ${reconnectAttempts})`, 'info');
      setTimeout(() => createBot(), delay);
    });

    bot.on('connect', () => {
      addLog('🔌 Connected to server', 'info');
    });

    // Reset AFK timer on any chat activity
    bot.on('message', () => { lastActivity = Date.now(); });
  });
}

// ─── START BOT ──────────────────────────────────────────
addLog('🚀 Starting ABDOU-BOT...', 'info');
createBot();

// ─── EXPRESS SERVER ──────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ABDOU-BOT Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
    .container { max-width: 950px; margin: 0 auto; }
    h1 { color: #58a6ff; border-bottom: 2px solid #30363d; padding-bottom: 10px; margin-bottom: 20px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap: 12px; }
    .status-item { background: #0d1117; padding: 12px; border-radius: 6px; text-align: center; }
    .status-item .label { font-size: 0.75rem; color: #8b949e; }
    .status-item .value { font-size: 1.3rem; font-weight: bold; }
    .online { color: #2ea043; }
    .offline { color: #f85149; }
    .connecting { color: #d29922; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0; }
    .controls input { flex: 1; min-width: 180px; padding: 10px 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 1rem; }
    .controls input:focus { outline: none; border-color: #58a6ff; }
    .btn { padding: 10px 18px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; transition: 0.15s; color: #fff; }
    .btn-primary { background: #238636; }
    .btn-primary:hover { background: #2ea043; }
    .btn-danger { background: #da3633; }
    .btn-danger:hover { background: #f85149; }
    .btn-warning { background: #d29922; }
    .btn-warning:hover { background: #e3b341; }
    .btn-secondary { background: #30363d; }
    .btn-secondary:hover { background: #484f58; }
    .log-area { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px; max-height: 320px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-all; }
    .log-entry { padding: 2px 0; border-bottom: 1px solid #161b22; }
    .log-time { color: #8b949e; margin-right: 8px; }
    .log-info { color: #58a6ff; }
    .log-success { color: #2ea043; }
    .log-error { color: #f85149; }
    .log-warn { color: #d29922; }
    .footer { margin-top: 20px; text-align: center; color: #8b949e; font-size: 0.8rem; }
    .highlight { background: #1f6feb33; padding: 10px; border-radius: 6px; border-left: 3px solid #1f6feb; margin: 10px 0; }
    .badge-green { background: #2ea04333; color: #2ea043; padding: 2px 12px; border-radius: 12px; font-size: 0.8rem; }
    .badge-red { background: #f8514933; color: #f85149; padding: 2px 12px; border-radius: 12px; font-size: 0.8rem; }
  </style>
</head>
<body>
<div class="container">
  <h1>⛏️ ABDOU-BOT Dashboard <span class="badge-green">🛡️ Anti-AFK</span></h1>

  <div class="highlight">
    💡 <strong>Server must be RUNNING</strong> and set to <strong>"Cracked"</strong> mode.
    Bot version: <strong>1.20.2</strong>
  </div>

  <div class="card">
    <div class="status-grid" id="statusGrid">
      <div class="status-item"><div class="label">Status</div><div class="value" id="statusText">⏳ Loading...</div></div>
      <div class="status-item"><div class="label">Bot Name</div><div class="value" id="username">-</div></div>
      <div class="status-item"><div class="label">Server</div><div class="value" style="font-size:1rem;">Power69.aternos.me:42959</div></div>
      <div class="status-item"><div class="label">Version</div><div class="value" style="font-size:1rem;" id="version">1.20.2</div></div>
      <div class="status-item"><div class="label">Uptime</div><div class="value" id="uptime">0s</div></div>
      <div class="status-item"><div class="label">Reconnects</div><div class="value" id="reconnectAttempts">0</div></div>
      <div class="status-item"><div class="label">Memory</div><div class="value" id="memory">0 MB</div></div>
      <div class="status-item"><div class="label">Anti-AFK</div><div class="value" style="font-size:1.2rem;" id="afkStatus">🟢 Active</div></div>
    </div>
    <div class="memory-bar"><div class="memory-bar-fill" id="memBar" style="width:0%; height:6px; background:#58a6ff; border-radius:3px; margin-top:6px;"></div></div>
    <div id="lastError" style="margin-top:10px;color:#f85149;"></div>
  </div>

  <div class="card">
    <div class="controls">
      <input type="text" id="cmdInput" placeholder="Type a command or message..." />
      <button class="btn btn-primary" onclick="sendCommand()">Send</button>
      <button class="btn btn-secondary" onclick="sendCommand('/list')">/list</button>
      <button class="btn btn-secondary" onclick="sendCommand('/seed')">/seed</button>
      <button class="btn btn-secondary" onclick="sendCommand('/whereami')">/whereami</button>
      <button class="btn btn-warning" onclick="reconnectBot()">🔄 Reconnect</button>
      <button class="btn btn-danger" onclick="clearLogs()">🗑️ Clear Logs</button>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:10px;">📜 Live Logs</h3>
    <div class="log-area" id="logArea"></div>
  </div>

  <div class="footer">
    ABDOU-BOT • Stays online • Anti-AFK • Auto-reconnect only on kicks/disconnects
  </div>
</div>

<script>
  function addLogMessage(entry) {
    const logArea = document.getElementById('logArea');
    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date(entry.time).toLocaleTimeString();
    div.innerHTML = '<span class="log-time">[' + time + ']</span><span class="log-' + entry.type + '">' + entry.message + '</span>';
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
    if (logArea.children.length > 200) logArea.removeChild(logArea.firstChild);
  }

  function fetchStatus() {
    fetch('/status')
      .then(r => r.json())
      .then(data => {
        const statusEl = document.getElementById('statusText');
        if (data.status === 'online') {
          statusEl.textContent = '✅ Online';
          statusEl.className = 'value online';
        } else if (data.status === 'connecting') {
          statusEl.textContent = '⏳ Connecting...';
          statusEl.className = 'value connecting';
        } else {
          statusEl.textContent = '❌ Offline';
          statusEl.className = 'value offline';
        }
        document.getElementById('username').textContent = data.username || '-';
        document.getElementById('uptime').textContent = data.uptime + 's';
        document.getElementById('memory').textContent = data.memoryMB + ' MB';
        document.getElementById('memBar').style.width = Math.min(data.memoryPercent, 100) + '%';
        document.getElementById('version').textContent = data.version || '1.20.2';
        document.getElementById('reconnectAttempts').textContent = data.reconnectAttempts || 0;
        const afkEl = document.getElementById('afkStatus');
        if (data.afkActive) {
          afkEl.textContent = '🟢 Active';
          afkEl.style.color = '#2ea043';
        } else {
          afkEl.textContent = '🔴 Inactive';
          afkEl.style.color = '#f85149';
        }
        if (data.lastError) {
          document.getElementById('lastError').textContent = '⚠️ ' + data.lastError;
        } else {
          document.getElementById('lastError').textContent = '';
        }
      })
      .catch(() => {});
  }

  function fetchLogs() {
    fetch('/logs')
      .then(r => r.json())
      .then(logs => {
        const logArea = document.getElementById('logArea');
        if (logArea.children.length === logs.length) return;
        logArea.innerHTML = '';
        logs.forEach(addLogMessage);
      })
      .catch(() => {});
  }

  function sendCommand() {
    const input = document.getElementById('cmdInput');
    const cmd = input.value.trim();
    if (!cmd) return;
    fetch('/command?cmd=' + encodeURIComponent(cmd))
      .then(() => { input.value = ''; })
      .catch(() => {});
  }

  function reconnectBot() {
    fetch('/reconnect', { method: 'POST' })
      .then(() => {})
      .catch(() => {});
  }

  function clearLogs() {
    fetch('/clear-logs', { method: 'POST' })
      .then(() => { document.getElementById('logArea').innerHTML = ''; })
      .catch(() => {});
  }

  document.getElementById('cmdInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendCommand();
  });

  setInterval(fetchStatus, 2000);
  setInterval(fetchLogs, 3000);
  fetchStatus();
  fetchLogs();
</script>
</body>
</html>
  `);
});

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
    version: bot?.version || '1.20.2',
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
  if (afkInterval) {
    clearInterval(afkInterval);
    afkInterval = null;
  }
  if (bot) {
    try { bot.end('Manual reconnect'); } catch(e) {}
    setTimeout(() => { createBot(); }, 500);
  } else {
    createBot();
  }
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
  console.log('🌐 Dashboard running on port ' + PORT);
  console.log('🤖 Bot configured for Power69.aternos.me:42959 as ' + BOT_CONFIG.username);
  console.log('📦 Version: ' + BOT_CONFIG.version);
  console.log('🛡️ Anti-AFK enabled, bot will stay online permanently.');
});