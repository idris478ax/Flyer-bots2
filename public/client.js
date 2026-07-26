const token = localStorage.getItem('token');
let socket;
let botConnected = false;

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem('botSettings'));
  if (saved) {
    document.getElementById('ip').value = saved.ip || 'Power69.aternos.me';
    document.getElementById('port').value = saved.port || 42959;
    document.getElementById('name').value = saved.username || 'dreamz';
    document.getElementById('ver').value = saved.version || '';
  }
}

function saveSettings() {
  localStorage.setItem('botSettings', JSON.stringify({
    ip: document.getElementById('ip').value,
    port: document.getElementById('port').value,
    username: document.getElementById('name').value,
    version: document.getElementById('ver').value
  }));
}

// Anti‑AFK settings
function loadAfkSettings() {
  const saved = JSON.parse(localStorage.getItem('afkSettings'));
  if (saved) {
    document.getElementById('moveMin').value = saved.moveMinSec || 30;
    document.getElementById('moveMax').value = saved.moveMaxSec || 40;
    document.getElementById('moveDist').value = saved.moveDistanceBlocks || 5;
    document.getElementById('chatMin').value = saved.chatMinMin || 10;
    document.getElementById('chatMax').value = saved.chatMaxMin || 13;
    document.getElementById('chatMsgs').value = (saved.chatMessages || []).join(', ');
    document.getElementById('afkToggle').checked = saved.enabled !== false;
  }
}

function saveAfkSettingsToStorage(settings) {
  localStorage.setItem('afkSettings', JSON.stringify(settings));
}

function getAfkSettingsFromForm() {
  return {
    enabled: document.getElementById('afkToggle').checked,
    moveMinSec: parseInt(document.getElementById('moveMin').value) || 30,
    moveMaxSec: parseInt(document.getElementById('moveMax').value) || 40,
    moveDistanceBlocks: parseFloat(document.getElementById('moveDist').value) || 5,
    chatMinMin: parseInt(document.getElementById('chatMin').value) || 10,
    chatMaxMin: parseInt(document.getElementById('chatMax').value) || 13,
    chatMessages: document.getElementById('chatMsgs').value.split(',').map(s => s.trim()).filter(s => s)
  };
}

// Login
if (token) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  initApp();
} else {
  loadSettings();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const password = document.getElementById('passwordInput').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (data.token) {
    localStorage.setItem('token', data.token);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    initApp();
  } else {
    document.getElementById('loginError').style.display = 'block';
  }
});

function initApp() {
  loadSettings();
  loadAfkSettings();
  connectSocket();
  setupTabs();
  setupEventListeners();
}

function setupTabs() {
  document.querySelectorAll('.sidebar li').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelector('.sidebar li.active').classList.remove('active');
      tab.classList.add('active');
      document.querySelector('.tab-content.active').classList.remove('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      document.getElementById('sidebar').classList.remove('open');
    });
  });
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
}

function setupEventListeners() {
  document.getElementById('connectBtn').addEventListener('click', () => {
    if (botConnected) return;
    const btn = document.getElementById('connectBtn');
    btn.textContent = 'Connecting...';
    btn.disabled = true;
    socket.emit('connectBot', {
      host: document.getElementById('ip').value,
      port: parseInt(document.getElementById('port').value) || 42959,
      username: document.getElementById('name').value,
      version: document.getElementById('ver').value || false
    });
    saveSettings();
  });

  document.getElementById('disconnectBtn').addEventListener('click', () => socket.emit('disconnectBot'));

  document.getElementById('autoReconnectToggle').addEventListener('change', (e) => {
    socket.emit('setAutoReconnect', e.target.checked);
  });

  document.getElementById('saveAfkSettings').addEventListener('click', () => {
    const settings = getAfkSettingsFromForm();
    saveAfkSettingsToStorage(settings);
    socket.emit('updateAfkSettings', settings);
  });

  document.getElementById('afkToggle').addEventListener('change', () => {
    const settings = getAfkSettingsFromForm();
    saveAfkSettingsToStorage(settings);
    socket.emit('updateAfkSettings', settings);
  });

  document.getElementById('sendMsg').addEventListener('click', () => {
    const msg = document.getElementById('msgInput').value.trim();
    if (msg) { socket.emit('sendMessage', msg); document.getElementById('msgInput').value = ''; }
  });

  document.getElementById('addCmd').addEventListener('click', () => {
    const name = document.getElementById('newCmd').value.trim();
    const resp = document.getElementById('newResp').value.trim();
    if (name && resp) {
      const cmds = JSON.parse(localStorage.getItem('customCmds') || '[]');
      cmds.push({ id: Date.now(), name, response: resp });
      localStorage.setItem('customCmds', JSON.stringify(cmds));
      socket.emit('updateCustomCommands', cmds);
      document.getElementById('newCmd').value = '';
      document.getElementById('newResp').value = '';
    }
  });

  ['ip', 'port', 'name', 'ver'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveSettings);
    document.getElementById(id).addEventListener('keyup', saveSettings);
  });
}

function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('botStatus', (status) => {
    botConnected = status.connected;
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (status.connecting) {
      connectBtn.textContent = 'Connecting...';
      connectBtn.disabled = true;
      disconnectBtn.disabled = true;
      disableInputs(true);
    } else if (status.state === 'online') {
      connectBtn.textContent = 'Connected';
      connectBtn.disabled = true;
      disconnectBtn.disabled = false;
      disableInputs(true);
    } else {
      connectBtn.textContent = 'Connect';
      connectBtn.disabled = false;
      disconnectBtn.disabled = true;
      disableInputs(false);
    }
  });

  socket.on('autoReconnect', (value) => {
    document.getElementById('autoReconnectToggle').checked = value;
  });

  socket.on('serverStatus', (info) => {
    document.getElementById('statusDot').className = info.online ? 'online' : '';
    document.getElementById('statusText').textContent = info.online ? 'Online' : 'Offline';
    document.getElementById('statusPlayers').textContent = info.online ? `${info.players}/${info.maxPlayers} players` : '';
  });

  socket.on('telemetry', (t) => {
    if (!t) return;
    document.getElementById('uptime').textContent = msToTime(t.uptime);
    document.getElementById('health').textContent = t.health.toFixed(1);
    document.getElementById('hunger').textContent = t.hunger.toFixed(1);
    document.getElementById('xp').textContent = t.xpLevel;
    document.getElementById('ping').textContent = t.ping + 'ms';
    document.getElementById('inv').textContent = t.inventoryCount;
    document.getElementById('pos').textContent = `${Math.floor(t.position.x)}, ${Math.floor(t.position.y)}, ${Math.floor(t.position.z)}`;
    document.getElementById('biome').textContent = t.biome;
    document.getElementById('dim').textContent = t.dimension;
  });

  socket.on('serverInfo', (info) => {
    document.getElementById('onlinePlayers').textContent = info.onlinePlayers || '0';
    document.getElementById('serverBrand').textContent = info.brand || '--';
    document.getElementById('serverVersion').textContent = info.version || '--';
  });

  socket.on('playerList', (players) => {
    const tbody = document.getElementById('playerTable').querySelector('tbody');
    tbody.innerHTML = '';
    players.forEach(p => {
      const tr = document.createElement('tr');
      const time = new Date(p.onlineTime * 1000).toISOString().substr(11, 8);
      tr.innerHTML = `<td>${p.username}</td><td>${time}</td><td>${p.ping}</td><td>${p.position ? p.position.x + ', ' + p.position.y + ', ' + p.position.z : 'N/A'}</td>`;
      tbody.appendChild(tr);
    });
  });

  socket.on('antiAfkSettings', (settings) => {
    document.getElementById('moveMin').value = settings.moveMinSec;
    document.getElementById('moveMax').value = settings.moveMaxSec;
    document.getElementById('moveDist').value = settings.moveDistanceBlocks;
    document.getElementById('chatMin').value = settings.chatMinMin;
    document.getElementById('chatMax').value = settings.chatMaxMin;
    document.getElementById('chatMsgs').value = settings.chatMessages.join(', ');
    document.getElementById('afkToggle').checked = settings.enabled;
    saveAfkSettingsToStorage(settings);
  });

  socket.on('consoleInit', (lines) => lines.forEach(addConsoleLine));
  socket.on('console', (line) => { addConsoleLine(line); if (line.style === 'anti-afk') addAfkLog(line); });
  socket.on('customCommands', (cmds) => renderCmdTable(cmds));
  socket.on('errorMsg', (msg) => alert(msg));
}

function addConsoleLine(line) {
  const box = document.getElementById('consoleOut');
  const div = document.createElement('div');
  div.className = 'console-line ' + line.style;
  div.textContent = line.text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addAfkLog(line) {
  const box = document.getElementById('afkLog');
  const div = document.createElement('div');
  div.className = 'console-line ' + line.style;
  div.textContent = line.text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function renderCmdTable(cmds) {
  const tbody = document.getElementById('cmdTable');
  tbody.innerHTML = '';
  cmds.forEach(cmd => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${cmd.name}</td><td>${cmd.response}</td><td><button class="del-btn">Del</button></td>`;
    tr.querySelector('.del-btn').addEventListener('click', () => {
      const updated = cmds.filter(c => c.id !== cmd.id);
      localStorage.setItem('customCmds', JSON.stringify(updated));
      socket.emit('updateCustomCommands', updated);
    });
    tbody.appendChild(tr);
  });
}

function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function disableInputs(disabled) {
  ['ip', 'port', 'name', 'ver'].forEach(id => document.getElementById(id).disabled = disabled);
}