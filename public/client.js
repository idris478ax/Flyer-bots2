const token = localStorage.getItem('token');
let socket;
let botConnected = false;

// Load settings from localStorage or defaults
function loadSettings() {
  const saved = JSON.parse(localStorage.getItem('botSettings'));
  if (saved) {
    document.getElementById('ip').value = saved.ip || 'Power69.aternos.me';
    document.getElementById('port').value = saved.port || 42959;
    document.getElementById('name').value = saved.username || 'dreamz';
    document.getElementById('ver').value = saved.version || '1.20.4';
    document.getElementById('offline').checked = saved.offline !== false;
  } else {
    // Defaults
    document.getElementById('ip').value = 'Power69.aternos.me';
    document.getElementById('port').value = 42959;
    document.getElementById('name').value = 'dreamz';
    document.getElementById('ver').value = '1.20.4';
    document.getElementById('offline').checked = true;
  }
}

function saveSettings() {
  localStorage.setItem('botSettings', JSON.stringify({
    ip: document.getElementById('ip').value,
    port: document.getElementById('port').value,
    username: document.getElementById('name').value,
    version: document.getElementById('ver').value,
    offline: document.getElementById('offline').checked
  }));
}

// Login
if (token) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  initApp();
} else {
  loadSettings(); // still load fields on login screen
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
  connectSocket();
  setupTabs();
  setupEventListeners();
}

function setupTabs() {
  const tabs = document.querySelectorAll('.sidebar li');
  tabs.forEach(tab => {
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
      version: document.getElementById('ver').value,
      offline: document.getElementById('offline').checked
    });
    saveSettings();
  });

  document.getElementById('disconnectBtn').addEventListener('click', () => {
    socket.emit('disconnectBot');
  });

  document.getElementById('afkToggle').addEventListener('change', (e) => {
    socket.emit('toggleAntiAfk', e.target.checked);
  });

  document.getElementById('sendMsg').addEventListener('click', () => {
    const msg = document.getElementById('msgInput').value.trim();
    if (msg) {
      socket.emit('sendMessage', msg);
      document.getElementById('msgInput').value = '';
    }
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

  // Save settings on change
  ['ip', 'port', 'name', 'ver', 'offline'].forEach(id => {
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
    } else if (status.connected && status.state === 'online') {
      connectBtn.textContent = 'Connected';
      connectBtn.disabled = true;
      disconnectBtn.disabled = false;
      disableInputs(true);
    } else {
      connectBtn.textContent = 'Connect';
      connectBtn.disabled = false;
      disconnectBtn.disabled = true;
      disableInputs(false);
      if (!status.connected) {
        ['uptime', 'health', 'hunger', 'pos', 'ping', 'inv'].forEach(id => document.getElementById(id).textContent = '--');
      }
    }
  });

  socket.on('serverStatus', (info) => {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const players = document.getElementById('statusPlayers');
    if (info.online) {
      dot.className = 'online';
      text.textContent = 'Online';
      players.textContent = `${info.players}/${info.maxPlayers} players`;
    } else {
      dot.className = '';
      text.textContent = 'Offline';
      players.textContent = '';
    }
  });

  socket.on('consoleInit', (lines) => {
    lines.forEach(addConsoleLine);
  });

  socket.on('console', (line) => {
    addConsoleLine(line);
    if (line.style === 'anti-afk') addAfkLog(line);
  });

  socket.on('telemetry', (t) => {
    if (!t) return;
    document.getElementById('uptime').textContent = msToTime(t.uptime);
    document.getElementById('health').textContent = t.health.toFixed(1);
    document.getElementById('hunger').textContent = t.hunger.toFixed(1);
    document.getElementById('pos').textContent = `${Math.floor(t.position.x)}, ${Math.floor(t.position.y)}, ${Math.floor(t.position.z)}`;
    document.getElementById('ping').textContent = t.ping + 'ms';
    document.getElementById('inv').textContent = t.inventoryCount;
  });

  socket.on('serverInfo', (info) => {
    if (!info) return;
    document.getElementById('onlinePlayers').textContent = info.onlinePlayers || '--';
    document.getElementById('serverBrand').textContent = info.brand || '--';
    document.getElementById('serverVersion').textContent = info.version || '--';
  });

  socket.on('antiAfkStatus', (v) => {
    document.getElementById('afkToggle').checked = v;
  });

  socket.on('customCommands', (cmds) => {
    renderCmdTable(cmds);
  });

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
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function disableInputs(disabled) {
  ['ip', 'port', 'name', 'ver', 'offline'].forEach(id => {
    document.getElementById(id).disabled = disabled;
  });
}