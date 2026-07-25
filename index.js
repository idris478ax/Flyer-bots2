// index.js – Mineflayer bot with hardcoded settings (Render compatible)
const express = require('express');
const mineflayer = require('mineflayer');

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Render.com needs this!

// --- HARDCODED Bot configuration ---
const botOptions = {
  host: 'Power69.aternos.me',
  port: 42959,
  username: 'YourBotName', // Change this to your desired bot name
  version: false, // auto-detect
  auth: 'offline', // offline mode for Aternos
};

// --- Create the bot ---
const bot = mineflayer.createBot(botOptions);
let botReady = false;
let botStats = {
  startTime: new Date(),
  health: 20,
  food: 20,
  position: { x: 0, y: 0, z: 0 },
  ping: 0,
  serverOnline: false,
  lastError: null,
};

// --- Bot event handlers ---
bot.on('login', () => {
  console.log(`✅ Bot logged in as ${bot.username}`);
  botStats.serverOnline = true;
  botStats.startTime = new Date();
});

bot.on('spawn', () => {
  botReady = true;
  console.log('✅ Bot spawned in the world');
  bot.chat('Hello! I am a bot running on Render.com');
  
  setInterval(updateStats, 1000);
});

bot.on('health', () => {
  if (bot.health) {
    botStats.health = Math.round(bot.health);
    botStats.food = Math.round(bot.food);
  }
});

bot.on('error', (err) => {
  console.error('❌ Bot error:', err);
  botStats.lastError = err.message;
});

bot.on('end', (reason) => {
  botReady = false;
  botStats.serverOnline = false;
  console.log(`⚠️ Bot disconnected: ${reason}`);
  setTimeout(() => {
    console.log('🔄 Attempting to reconnect...');
    bot.connect();
  }, 5000);
});

bot.on('kicked', (reason, loggedIn) => {
  botReady = false;
  botStats.serverOnline = false;
  console.log(`👢 Bot kicked: ${reason}`);
  setTimeout(() => {
    console.log('🔄 Reconnecting after kick...');
    bot.connect();
  }, 5000);
});

function updateStats() {
  if (bot.entity && bot.entity.position) {
    botStats.position = {
      x: Math.round(bot.entity.position.x),
      y: Math.round(bot.entity.position.y),
      z: Math.round(bot.entity.position.z),
    };
  }
  if (bot.player && bot.player.ping !== undefined) {
    botStats.ping = bot.player.ping;
  }
}

// --- Serve static files for dashboard ---
app.use(express.static('public'));
app.use(express.json());

// --- Dashboard HTML ---
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mineflayer Bot Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e1e2f, #2a2a3f);
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .dashboard {
            max-width: 800px;
            width: 100%;
            background: rgba(30, 30, 50, 0.9);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        h1 {
            text-align: center;
            color: #6c8cff;
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 0 0 20px rgba(108, 140, 255, 0.3);
        }
        .subtitle {
            text-align: center;
            color: #8899bb;
            margin-bottom: 30px;
            font-size: 1rem;
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 25px 0;
        }
        .status-card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 15px;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.08);
            transition: transform 0.2s;
        }
        .status-card:hover {
            transform: translateY(-3px);
            border-color: rgba(108, 140, 255, 0.3);
        }
        .status-card .label {
            color: #8899bb;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }
        .status-card .value {
            font-size: 1.4rem;
            font-weight: bold;
            color: #e0e0e0;
        }
        .status-card .value.online { color: #4caf50; }
        .status-card .value.offline { color: #f44336; }
        .status-card .value.connecting { color: #ffa726; }
        .controls {
            margin: 25px 0;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .controls input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.05);
            color: #e0e0e0;
            font-size: 1rem;
            min-width: 200px;
        }
        .controls input:focus {
            outline: none;
            border-color: #6c8cff;
        }
        .controls input::placeholder {
            color: #667799;
        }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
            color: white;
        }
        .btn-primary {
            background: linear-gradient(135deg, #6c8cff, #5a7aee);
        }
        .btn-primary:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(108, 140, 255, 0.4);
        }
        .btn-success {
            background: linear-gradient(135deg, #4caf50, #43a047);
        }
        .btn-success:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(76, 175, 80, 0.4);
        }
        .btn-danger {
            background: linear-gradient(135deg, #f44336, #d32f2f);
        }
        .btn-danger:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(244, 67, 54, 0.4);
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
        }
        .log-area {
            background: rgba(0, 0, 0, 0.4);
            border-radius: 12px;
            padding: 15px;
            margin-top: 20px;
            max-height: 150px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .log-area::-webkit-scrollbar {
            width: 6px;
        }
        .log-area::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
        }
        .log-area::-webkit-scrollbar-thumb {
            background: rgba(108, 140, 255, 0.3);
            border-radius: 3px;
        }
        .log-entry {
            padding: 4px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            color: #aabbdd;
        }
        .log-entry .time {
            color: #667799;
            margin-right: 10px;
        }
        .log-entry .info { color: #6c8cff; }
        .log-entry .success { color: #4caf50; }
        .log-entry .error { color: #f44336; }
        .log-entry .warning { color: #ffa726; }
        .footer {
            text-align: center;
            margin-top: 25px;
            color: #667799;
            font-size: 0.8rem;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 20px;
        }
        .server-info {
            background: rgba(108, 140, 255, 0.1);
            border-radius: 8px;
            padding: 12px;
            margin: 15px 0;
            text-align: center;
            border: 1px solid rgba(108, 140, 255, 0.2);
        }
        .server-info span {
            color: #6c8cff;
            font-weight: bold;
        }
        .flex-row {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        @media (max-width: 600px) {
            .dashboard { padding: 20px; }
            h1 { font-size: 1.8rem; }
            .status-grid { grid-template-columns: 1fr 1fr; }
            .controls { flex-direction: column; }
            .controls input { min-width: auto; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <h1>⛏️ Mineflayer Bot</h1>
        <div class="subtitle">Minecraft Bot Control Panel</div>
        
        <div class="server-info">
            Connected to <span>Power69.aternos.me:42959</span> | Auto-detect version
        </div>
        
        <div class="status-grid" id="statusGrid">
            <div class="status-card">
                <div class="label">Bot Status</div>
                <div class="value" id="botStatus">Loading...</div>
            </div>
            <div class="status-card">
                <div class="label">Username</div>
                <div class="value" id="botUsername">-</div>
            </div>
            <div class="status-card">
                <div class="label">Health</div>
                <div class="value" id="botHealth">❤️ 20</div>
            </div>
            <div class="status-card">
                <div class="label">Food</div>
                <div class="value" id="botFood">🍖 20</div>
            </div>
            <div class="status-card">
                <div class="label">Position</div>
                <div class="value" id="botPosition">0, 0, 0</div>
            </div>
            <div class="status-card">
                <div class="label">Ping</div>
                <div class="value" id="botPing">0ms</div>
            </div>
        </div>

        <div class="controls">
            <input type="text" id="commandInput" placeholder="Type a command or message..." />
            <button class="btn btn-primary" onclick="sendCommand()">Send</button>
            <button class="btn btn-success" onclick="sendCommand('/list')">List Players</button>
            <button class="btn btn-success" onclick="sendCommand('/seed')">Seed</button>
        </div>

        <div class="flex-row" style="margin-top: 10px;">
            <button class="btn btn-primary" onclick="refreshStatus()" style="flex:1;">🔄 Refresh Status</button>
            <button class="btn btn-danger" onclick="reconnectBot()" style="flex:1;">🔌 Reconnect</button>
        </div>

        <div class="log-area" id="logArea">
            <div class="log-entry"><span class="time">[System]</span> <span class="info">Dashboard loaded. Waiting for bot...</span></div>
        </div>

        <div class="footer">
            Running on Render.com • Bot will auto-reconnect if disconnected
        </div>
    </div>

    <script>
        function addLog(message, type = 'info') {
            const logArea = document.getElementById('logArea');
            const time = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = `<span class="time">[${time}]</span> <span class="${type}">${message}</span>`;
            logArea.appendChild(entry);
            logArea.scrollTop = logArea.scrollHeight;
            while (logArea.children.length > 50) {
                logArea.removeChild(logArea.firstChild);
            }
        }

        function getStatus() {
            fetch('/status')
                .then(res => res.json())
                .then(data => {
                    const statusEl = document.getElementById('botStatus');
                    if (data.status === 'online') {
                        statusEl.textContent = '🟢 Online';
                        statusEl.className = 'value online';
                        addLog('Bot is online', 'success');
                    } else if (data.status === 'connecting') {
                        statusEl.textContent = '🟡 Connecting...';
                        statusEl.className = 'value connecting';
                    } else {
                        statusEl.textContent = '🔴 Offline';
                        statusEl.className = 'value offline';
                        addLog('Bot is offline', 'error');
                    }
                    
                    document.getElementById('botUsername').textContent = data.username || '-';
                    document.getElementById('botHealth').textContent = '❤️ ' + (data.health || '?');
                    document.getElementById('botFood').textContent = '🍖 ' + (data.food || '?');
                    document.getElementById('botPosition').textContent = 
                        data.position ? `${data.position.x}, ${data.position.y}, ${data.position.z}` : '?, ?, ?';
                    document.getElementById('botPing').textContent = (data.ping || '?') + 'ms';
                })
                .catch(() => {
                    addLog('Failed to fetch status', 'error');
                });
        }

        function sendCommand() {
            const input = document.getElementById('commandInput');
            const cmd = input.value.trim();
            if (!cmd) return;
            
            fetch(`/command?cmd=${encodeURIComponent(cmd)}`)
                .then(res => res.text())
                .then(() => {
                    addLog(`Sent: ${cmd}`, 'info');
                    input.value = '';
                })
                .catch(() => {
                    addLog('Failed to send command', 'error');
                });
        }

        function reconnectBot() {
            addLog('Attempting to reconnect...', 'warning');
            fetch('/reconnect', { method: 'POST' })
                .then(res => res.text())
                .then(() => {
                    addLog('Reconnection triggered', 'info');
                    setTimeout(getStatus, 2000);
                })
                .catch(() => {
                    addLog('Failed to trigger reconnect', 'error');
                });
        }

        function refreshStatus() {
            addLog('Refreshing status...', 'info');
            getStatus();
        }

        document.getElementById('commandInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendCommand();
        });

        getStatus();
        setInterval(getStatus, 3000);
        addLog('Dashboard initialized. Bot connecting to Power69.aternos.me:42959...', 'info');
    </script>
</body>
</html>
  `);
});

// --- API endpoints ---
app.get('/status', (req, res) => {
  res.json({
    status: botReady ? 'online' : (bot._client ? 'connecting' : 'offline'),
    username: bot.username || 'Not logged in',
    health: botStats.health,
    food: botStats.food,
    position: botStats.position,
    ping: botStats.ping,
    server: `${botOptions.host}:${botOptions.port}`,
    uptime: Math.floor((new Date() - botStats.startTime) / 1000),
    lastError: botStats.lastError,
  });
});

app.post('/reconnect', (req, res) => {
  console.log('🔄 Manual reconnect triggered');
  bot.end('Manual reconnect');
  setTimeout(() => {
    bot.connect();
    res.send('Reconnecting...');
  }, 1000);
});

app.get('/command', (req, res) => {
  const cmd = req.query.cmd;
  if (!cmd) {
    return res.status(400).send('Missing ?cmd= parameter');
  }
  if (!botReady) {
    return res.status(503).send('Bot is not ready');
  }
  bot.chat(cmd);
  console.log(`💬 Command sent: ${cmd}`);
  res.send(`Command sent: ${cmd}`);
});

// --- Start the HTTP server ---
app.listen(PORT, () => {
  console.log(`🌐 Dashboard running on port ${PORT}`);
  console.log(`🤖 Connecting to Power69.aternos.me:42959 as "${botOptions.username}"`);
});

// Keep alive with periodic status check
setInterval(() => {
  if (!botReady) {
    console.log('⚠️ Bot not ready, attempting to reconnect...');
    bot.connect();
  }
}, 60000);