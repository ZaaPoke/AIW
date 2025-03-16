const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch'); // Ensure you use node‑fetch v2 if needed
const app = express();
const port = 3000;
const DB_FILE = './db.json';

// In‑memory storage for intervals per auth token.
// Example: intervalsByAuthToken["TOKEN123"] = [intervalID1, intervalID2, …]
const intervalsByAuthToken = {};

app.use(express.json());

// Helper functions to read/write the DB (db.json)
async function readDB() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}
async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

// Serve static pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/conf/:authToken', (req, res) => {
  res.sendFile(path.join(__dirname, 'config.html'));
});

// Save configs for a given auth token
app.post('/conf/:authToken/save-configs', async (req, res) => {
  try {
    const { authToken } = req.params;
    const { configs } = req.body;
    if (!Array.isArray(configs)) {
      return res.status(400).json({ success: false, message: 'Configs must be an array' });
    }
    const db = await readDB();
    if (!db[authToken]) db[authToken] = {};
    db[authToken].configs = configs;
    await writeDB(db);
    res.json({ success: true, message: 'Configs saved' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start/Stop auto‑post state endpoint
app.post('/conf/:authToken/save-auto-post-state', async (req, res) => {
  try {
    const { authToken } = req.params;
    const { state } = req.body;
    if (!['started', 'stopped'].includes(state)) {
      return res.status(400).json({ success: false, message: 'Invalid state' });
    }
    const db = await readDB();
    if (!db[authToken]) db[authToken] = {};
    db[authToken].autoPostState = state;
    await writeDB(db);

    if (state === 'started') {
      startAutoPost(authToken);
    } else {
      stopAutoPost(authToken);
    }
    res.json({ success: true, message: `Auto‑post state set to ${state}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Load configs and auto‑post state for a given token
app.get('/conf/:authToken/load-configs', async (req, res) => {
  try {
    const { authToken } = req.params;
    const db = await readDB();
    const userData = db[authToken] || {};
    res.json({
      success: true,
      configs: userData.configs || [],
      autoPostState: userData.autoPostState || 'stopped'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save auth token endpoint
app.post('/save-auth-token', async (req, res) => {
  try {
    const { authToken } = req.body;
    if (!authToken) {
      return res.status(400).json({ success: false, message: 'Auth token required' });
    }
    const db = await readDB();
    if (!db[authToken]) {
      db[authToken] = { configs: [], autoPostState: 'stopped' };
    }
    await writeDB(db);
    res.json({ success: true, message: 'Auth token saved' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Send a Discord message using the provided config
function sendDiscordMessage(authToken, config) {
  fetch(`https://discord.com/api/v10/channels/${config.channelID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': authToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: config.message })
  })
    .then(res => res.json())
    .then(data => {
      if (data.id) {
        console.log(`[${new Date().toLocaleTimeString()}] Sent to ${config.channelID}: Success`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] Sent to ${config.channelID}: Failed`, data);
      }
    })
    .catch(err => {
      console.error(`[${new Date().toLocaleTimeString()}] Error sending to ${config.channelID}`, err);
    });
}

// Start auto‑post intervals for a given auth token based on stored configs
async function startAutoPost(authToken) {
  stopAutoPost(authToken); // Clear any existing intervals
  const db = await readDB();
  const userData = db[authToken];
  if (!userData || !Array.isArray(userData.configs)) return;

  intervalsByAuthToken[authToken] = [];

  userData.configs.forEach(config => {
    // Send immediately
    sendDiscordMessage(authToken, config);
    // Then send repeatedly based on the delay (in seconds)
    const intervalId = setInterval(() => {
      sendDiscordMessage(authToken, config);
    }, config.delay * 1000);
    intervalsByAuthToken[authToken].push(intervalId);
  });
  console.log(`Auto‑post started for ${authToken}`);
}

// Stop auto‑post intervals for a given auth token
function stopAutoPost(authToken) {
  if (intervalsByAuthToken[authToken]) {
    intervalsByAuthToken[authToken].forEach(id => clearInterval(id));
    intervalsByAuthToken[authToken] = [];
  }
  console.log(`Auto‑post stopped for ${authToken}`);
}

// On server startup, resume auto‑post for any token whose state is "started"
async function resumeAllAutoPosts() {
  const db = await readDB();
  for (const authToken in db) {
    if (db[authToken].autoPostState === 'started') {
      startAutoPost(authToken);
    }
  }
}

app.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);
  await resumeAllAutoPosts();
});