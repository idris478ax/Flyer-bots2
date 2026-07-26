const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mineflayer = require('mineflayer');
const path = require('path');

// ---------- CONFIG ----------
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_!';
const DASHBOARD_PASSWORD = 'nounou123_';
const RECONNECT_DELAY = 5000;
const MAX_CONSOLE_LINES = 200;

// Anti‑AFK timing
const AFK_MOVE_INTERVAL_MIN = 30;   // seconds
const AFK_MOVE_INTERVAL_MAX = 40;
const AFK_CHAT_INTERVAL_MIN = 10;   // minutes
const AFK_CHAT_INTERVAL_MAX = 13;

// Movement
const MOVE_DURATION_MS = 1200;      // ~5 blocks

// ---------- GLOBALS ----------
let bot = null;
let botOpts = null;          // last connection options
let manualStop = false;      // user clicked Disconnect
let startTime = null;
let afkEnabled = true;
let afkTimers = { move: null, chat: null };
let customCmds = [];
let consoleLog = [];

// ---------- EXPRESS + SOCKET.IO ----------
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(cookieParser());
app.use(express.json());

// ---------- AUTH ----------
app.post('/api/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    const token = jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Wrong password' });
});

// ---------- SERVE DASHBOARD (all HTML/CSS/JS inline) ----------
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<title>MineBot Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:#0f0f0f;color:#e0e0e0;height:100vh;overflow:hidden;}
#loginScreen{display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0a;}
.login-card{background:#1e1e1e;padding:2rem;border-radius:1rem;box-shadow:0 10px 25px rgba(0,0,0,0.5);width:90%;max-width:400px;}
.login-card h1{font-size:1.8rem;margin-bottom:1.5rem;text-align:center;color:#00c896;}
.input-group{margin-bottom:1rem;}
.input-group label{display:block;margin-bottom:0.3rem;font-weight:600;color:#aaa;}
.input-group input{width:100%;padding:0.8rem;border-radius:0.5rem;border:none;background:#2a2a2a;color:#fff;font-size:1rem;}
.btn{width:100%;padding:0.8rem;background:#00c896;border:none;border-radius:0.5rem;color:#000;font-weight:700;font-size:1rem;cursor:pointer;transition:background 0.3s;}
.btn:hover{background:#00b386;}
.error-msg{color:#ff4d4d;text-align:center;margin-top:0.5rem;display:none;}
#dashboard{display:none;height:100vh;}
.sidebar{width:250px;background:#1a1a1a;height:100%;float:left;padding:1.5rem 0;transition:transform 0.3s;z-index:10;}
.sidebar h2{color:#00c896;padding:0 1.5rem;margin-bottom:2rem;font-size:1.5rem;}
.sidebar ul{list-style:none;}
.sidebar li{padding:0.8rem 1.5rem;cursor:pointer;color:#aaa;font-weight:500;transition:0.2s;display:flex;align-items:center;gap:0.8rem;}
.sidebar li:hover,.sidebar li.active{background:#2a2a2a;color:#fff;}
.sidebar li i{font-style:normal;font-size:1.2rem;}
.main-content{margin-left:250px;height:100%;overflow-y:auto;padding:2rem;background:#121212;}
.menu-toggle{display:none;position:fixed;top:1rem;left:1rem;z-index:20;background:#00c896;border:none;color:#000;font-size:1.5rem;width:40px;height:40px;border-radius:8px;cursor:pointer;}
@media(max-width:768px){
.sidebar{position:fixed;transform:translateX(-100%);}
.sidebar.open{transform:translateX(0);}
.main-content{margin-left:0;padding-top:4rem;}
.menu-toggle{display:flex;align-items:center;justify-content:center;}
}
.tab-content{display:none;}
.tab-content.active{display:block;}
.card{background:#1e1e1e;border-radius:0.8rem;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);}
.card h3{margin-bottom:1rem;color:#ccc;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;}
.stat{background:#2a2a2a;padding:1rem;border-radius:0.5rem;}
.stat label{color:#888;font-size:0.85rem;display:block;}
.stat span{font-size:1.2rem;font-weight:700;color:#fff;}
.console-box{background:#000;color:#0f0;font-family:monospace;padding:1rem;border-radius:0.5rem;height:400px;overflow-y:auto;margin-bottom:1rem;border:1px solid #333;}
.console-line{margin-bottom:0.2rem;}
.console-line.system{color:#888;}
.console-line.bot-message{color:#ffa500;}
.console-line.error{color:#f44;}
.console-line.anti-afk{color:#5af;}
.message-input{display:flex;gap:0.5rem;}
.message-input input{flex:1;padding:0.6rem;background:#2a2a2a;border:none;border-radius:0.5rem;color:#fff;}
.message-input button{padding:0.6rem 1.2rem;background:#00c896;border:none;border-radius:0.5rem;color:#000;font-weight:600;cursor:pointer;}
.toggle-container{display:flex;align-items:center;gap:1rem;margin-top:1rem;}
.toggle{position:relative;display:inline-block;width:50px;height:24px;}
.toggle input{opacity:0;width:0;height:0;}
.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#555;transition:.4s;border-radius:24px;}
.slider:before{position:absolute;content:"";height:18px;width:18px;left:3px;bottom:3px;background-color:white;transition:.4s;border-radius:50%;}
input:checked+.slider{background-color:#00c896;}
input:checked+.slider:before{transform:translateX(26px);}
.cmd-list{width:100%;border-collapse:collapse;}
.cmd-list th,.cmd-list td{padding:0.8rem;text-align:left;border-bottom:1px solid #333;}
.cmd-list th{color:#888;}
.cmd-list button{background:#d44;border:none;color:white;padding:0.3rem 0.8rem;border-radius:4px;cursor:pointer;}
.add-cmd-form{display:flex;gap:0.5rem;margin-top:1rem;}
.add-cmd-form input{flex:1;padding:0.6rem;background:#2a2a2a;border:none;border-radius:0.5rem;color:#fff;}
</style>
</head>
<body>
<div id="loginScreen">
  <div class="login-card">
    <h1>🤖 MineBot</h1>
    <div class="input-group"><label>Password</label><input type="password" id="pwd" placeholder="Enter password"></div>
    <button class="btn" id="loginBtn">Login</button>
    <div class="error-msg" id="loginErr">Wrong password!</div>
  </div>
</div>
<div id="dashboard">
  <button class="menu-toggle" id="menuToggle">☰</button>
  <div class="sidebar" id="sidebar">
    <h2>⚡ MineBot</h2>
    <ul>
      <li class="active" data-tab="connection"><i>🔌</i> Connection</li>
      <li data-tab="telemetry"><i>📊</i> Telemetry</li>
      <li data-tab="console"><i>💬</i> Console</li>
      <li data-tab="commands"><i>⚙️</i> Commands</li>
    </ul>
  </div>
  <div class="main-content" id="mainContent">
    <div class="tab-content active" id="tab-connection">
      <div class="card">
        <h3>Server Connection</h3>
        <div class="grid">
          <div class="input-group"><label>Server IP</label><input type="text" id="ip" placeholder="localhost" value="localhost"></div>
          <div class="input-group"><label>Port</label><input type="number" id="port" value="25565"></div>
          <div class="input-group"><label>Bot Username</label><input type="text" id="name" placeholder="MyBot" value="MyBot"></div>
          <div class="input-group"><label>Version (blank = auto)</label><input type="text" id="ver" placeholder="e.g. 1.20.4"></div>
        </div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
          <label style="display:flex;align-items:center;gap:0.5rem;color:#aaa;"><input type="checkbox" id="offline"> Offline mode</label>
        </div>
        <div style="display:flex;gap:1rem;margin-top:1rem;">
          <button class="btn" id="connectBtn" style="background:#00c896;color:#000;">Connect</button>
          <button class="btn" id="disconnectBtn" style="background:#444;color:#fff;" disabled>Disconnect</button>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-telemetry">
      <div class="card">
        <h3>Live Telemetry</h3>
        <div class="grid" id="telem">
          <div class="stat"><label>Uptime</label><span id="uptime">00:00:00</span></div>
          <div class="stat"><label>Health</label><span id="health">--</span></div>
          <div class="stat"><label>Hunger</label><span id="hunger">--</span></div>
          <div class="stat"><label>Position</label><span id="pos">--</span></div>
          <div class="stat"><label>Ping</label><span id="ping">--</span></div>
          <div class="stat"><label>Inventory</label><span id="inv">--</span></div>
        </div>
        <div class="toggle-container">
          <span>Anti-AFK</span>
          <label class="toggle"><input type="checkbox" id="afkToggle" checked><span class="slider"></span></label>
        </div>
      </div>
      <div class="card">
        <h3>Anti-AFK Log</h3>
        <div class="console-box" id="afkLog" style="height:250px;"></div>
      </div>
    </div>
    <div class="tab-content" id="tab-console">
      <div class="card">
        <h3>Server Chat & Output</h3>
        <div class="console-box" id="consoleOut"></div>
        <div class="message-input">
          <input type="text" id="msgInput" placeholder="Type message or command...">
          <button id="sendMsg">Send</button>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-commands">
      <div class="card">
        <h3>Custom Chat Commands</h3>
        <table class="cmd-list"><thead><tr><th>Command</th><th>Response</th><th>Actions</th></tr></thead><tbody id="cmdTable"></tbody></table>
        <div class="add-cmd-form">
          <input type="text" id="newCmd" placeholder="!command">
          <input type="text" id="newResp" placeholder="Response">
          <button class="btn" id="addCmd" style="width:auto;background:#00c896;">Add</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
// ---------- CLIENT LOGIC ----------
const token = localStorage.getItem('token');
let socket;

if(token) initDash();
document.getElementById('loginBtn').onclick = async () => {
  const pwd = document.getElementById('pwd').value;
  const res = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});
  const data = await res.json();
  if(data.token){ localStorage.setItem('token',data.token); initDash(); }
  else document.getElementById('loginErr').style.display='block';
};

function initDash(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('dashboard').style.display='block';
  connectWS();
  setupTabs();
  // Connection form
  document.getElementById('connectBtn').onclick = () => {
    socket.emit('connectBot',{
      host: document.getElementById('ip').value,
      port: parseInt(document.getElementById('port').value)||25565,
      username: document.getElementById('name').value,
      version: document.getElementById('ver').value,
      offline: document.getElementById('offline').checked
    });
  };
  document.getElementById('disconnectBtn').onclick = () => socket.emit('disconnectBot');
  document.getElementById('afkToggle').onchange = (e) => socket.emit('toggleAntiAfk', e.target.checked);
  document.getElementById('sendMsg').onclick = () => {
    const msg = document.getElementById('msgInput').value.trim();
    if(msg) { socket.emit('sendMessage',msg); document.getElementById('msgInput').value=''; }
  };
  document.getElementById('addCmd').onclick = () => {
    const name = document.getElementById('newCmd').value.trim();
    const resp = document.getElementById('newResp').value.trim();
    if(name && resp) {
      const cmds = JSON.parse(localStorage.getItem('customCmds')||'[]');
      cmds.push({id:Date.now(),name,response:resp});
      localStorage.setItem('customCmds',JSON.stringify(cmds));
      socket.emit('updateCustomCommands',cmds);
      document.getElementById('newCmd').value='';
      document.getElementById('newResp').value='';
    }
  };
}

function connectWS(){
  socket = io({auth:{token}});
  socket.on('botStatus',(s)=>{
    document.getElementById('connectBtn').disabled = s.connected;
    document.getElementById('disconnectBtn').disabled = !s.connected;
    ['ip','port','name','ver','offline'].forEach(id=>document.getElementById(id).disabled = s.connected);
    if(!s.connected){
      ['uptime','health','hunger','pos','ping','inv'].forEach(id=>document.getElementById(id).textContent='--');
    }
    if(!s.connected && !s.connecting) beep();
  });
  socket.on('consoleInit',(lines)=>{ lines.forEach(l=>addConsoleLine(l)); });
  socket.on('console',(line)=>{ addConsoleLine(line); if(line.style==='anti-afk') addAfkLog(line); });
  socket.on('telemetry',(t)=>{
    if(!t) return;
    document.getElementById('uptime').textContent = msToTime(t.uptime);
    document.getElementById('health').textContent = t.health.toFixed(1);
    document.getElementById('hunger').textContent = t.hunger.toFixed(1);
    document.getElementById('pos').textContent = Math.floor(t.position.x)+', '+Math.floor(t.position.y)+', '+Math.floor(t.position.z);
    document.getElementById('ping').textContent = t.ping+'ms';
    document.getElementById('inv').textContent = t.inventoryCount;
  });
  socket.on('antiAfkStatus',(v)=>{ document.getElementById('afkToggle').checked = v; });
  socket.on('customCommands',(cmds)=>{ renderCmdTable(cmds); });
  socket.on('errorMsg',(m)=>alert(m));
}

function addConsoleLine(l){
  const box = document.getElementById('consoleOut');
  if(!box) return;
  const div = document.createElement('div');
  div.className = 'console-line '+l.style;
  div.textContent = l.text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function addAfkLog(l){
  const box = document.getElementById('afkLog');
  if(!box) return;
  const div = document.createElement('div');
  div.className = 'console-line '+l.style;
  div.textContent = l.text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function renderCmdTable(cmds){
  const tb = document.getElementById('cmdTable');
  tb.innerHTML = '';
  cmds.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>'+c.name+'</td><td>'+c.response+'</td><td><button>Del</button></td>';
    tr.querySelector('button').onclick = () => {
      const updated = cmds.filter(x=>x.id!==c.id);
      localStorage.setItem('customCmds',JSON.stringify(updated));
      socket.emit('updateCustomCommands',updated);
    };
    tb.appendChild(tr);
  });
}
function msToTime(ms){
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ctx.createOscillator(); osc.type='square'; osc.frequency.value=800;
    const gain = ctx.createGain(); gain.gain.value=0.1; gain.gain.exponentialRampToValueAtTime(0.00001,ctx.currentTime+0.2);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime+0.2);
  }catch(e){}
}
// Tab switching
function setupTabs(){
  const lis = document.querySelectorAll('.sidebar li');
  const tabs = document.querySelectorAll('.tab-content');
  lis.forEach(li=>li.onclick=()=>{
    lis.forEach(l=>l.classList.remove('active'));
    li.classList.add('active');
    tabs.forEach(t=>t.classList.remove('active'));
    document.getElementById('tab-'+li.dataset.tab).classList.add('active');
    document.getElementById('sidebar').classList.remove('open');
  });
}
// Mobile menu
document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
</script>
</body>
</html>`);
});

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
  // Send current state
  socket.emit('botStatus', { connected: !!bot, connecting: false });
  if (bot && bot.entity) socket.emit('telemetry', getTelemetry());
  socket.emit('consoleInit', consoleLog);
  socket.emit('antiAfkStatus', afkEnabled);
  socket.emit('customCommands', customCmds);

  socket.on('connectBot', (opts) => {
    if (bot) {
      socket.emit('errorMsg', 'Bot already connected.');
      return;
    }
    startBot(opts);
  });

  socket.on('disconnectBot', () => {
    stopBot();
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
      addLog(\`<\${bot.username}> \${msg}\`, 'bot-message');
    }
  });

  socket.on('updateCustomCommands', (cmds) => {
    customCmds = cmds;
    io.emit('customCommands', customCmds);
    addLog('Custom commands updated', 'system');
  });
});

// ---------- BOT FUNCTIONS ----------
function startBot(opts) {
  botOpts = opts;
  manualStop = false;
  try {
    bot = mineflayer.createBot({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      version: opts.version || false,
      auth: opts.offline ? 'offline' : 'microsoft'
    });
    bindBotEvents(bot);
    addLog('Connecting to server...', 'system');
    io.emit('botStatus', { connected: false, connecting: true });
  } catch (e) {
    addLog('Connection error: ' + e.message, 'error');
  }
}

function stopBot() {
  if (!bot) return;
  manualStop = true;
  stopAfk();
  bot.quit();
  bot = null;
  io.emit('botStatus', { connected: false });
  addLog('Bot manually disconnected', 'system');
}

function bindBotEvents(bot) {
  bot.on('login', () => {
    startTime = Date.now();
    addLog(\`Connected as \${bot.username}\`, 'system');
    io.emit('botStatus', { connected: true });
    if (afkEnabled) startAfk();
  });

  bot.on('spawn', () => addLog('Spawned in the world', 'system'));

  bot.on('chat', (username, message) => {
    const style = username === bot.username ? 'bot-message' : 'chat';
    addLog(\`<\${username}> \${message}\`, style);
    // Process custom commands
    for (const cmd of customCmds) {
      if (message.trim().toLowerCase() === cmd.name.toLowerCase()) {
        bot.chat(cmd.response);
        addLog(\`[Cmd] Responded to \${username}: \${cmd.response}\`, 'system');
      }
    }
  });

  bot.on('kicked', (reason) => {
    addLog('Kicked: ' + reason, 'error');
    handleEnd();
  });

  bot.on('error', (err) => addLog('Error: ' + err.message, 'error'));

  bot.on('end', (reason) => {
    addLog('Disconnected: ' + reason, 'error');
    handleEnd();
  });

  function handleEnd() {
    io.emit('botStatus', { connected: false });
    stopAfk();
    bot = null;
    if (!manualStop) {
      addLog(\`Reconnecting in \${RECONNECT_DELAY / 1000}s...\`, 'system');
      setTimeout(() => {
        if (!manualStop && botOpts) startBot(botOpts);
      }, RECONNECT_DELAY);
    } else {
      manualStop = false;
    }
  }
}

// Telemetry interval
setInterval(() => {
  if (bot && bot.entity) io.emit('telemetry', getTelemetry());
}, 1000);

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

// ---------- ANTI-AFK ----------
function startAfk() {
  if (!bot || !afkEnabled) return;
  stopAfk();
  // Random movement
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

  // Random chat
  const chatMs = (Math.floor(Math.random() * (AFK_CHAT_INTERVAL_MAX - AFK_CHAT_INTERVAL_MIN + 1)) + AFK_CHAT_INTERVAL_MIN) * 60000;
  afkTimers.chat = setInterval(() => {
    if (!bot || !afkEnabled) return;
    const msgs = ['Hello!', 'How is everyone?', 'Nice day!', 'Anyone here?', 'Just mining...'];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    bot.chat(msg);
    addLog(\`[AntiAFK] Sent: \${msg}\`, 'anti-afk');
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

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(\`Dashboard live on port \${PORT}\`));