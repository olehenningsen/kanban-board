require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3333;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'kanban-data.json');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Webhook helper — fires when a card lands in "todo" (Opgaver) column
async function fireWebhook(event, card, columnId) {
  const url = process.env.WEBHOOK_URL;
  if (!url || columnId !== 'todo') return;
  try {
    const payload = JSON.stringify({ event, card, columnId, timestamp: new Date().toISOString() });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    console.log(`Webhook ${event}: ${resp.status}`);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
}

// Notifications store (in-memory, survives until restart)
let pendingNotifications = [];

function addNotification(event, card, columnId) {
  if (columnId !== 'todo') return;
  pendingNotifications.push({ event, card, columnId, timestamp: new Date().toISOString() });
}

// Data helpers
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      columns: [
        { id: 'backlog', title: 'Backlog', cards: [] },
        { id: 'todo', title: 'Opgaver', cards: [] },
        { id: 'inprogress', title: 'I gang', cards: [] },
        { id: 'done', title: 'Færdig', cards: [] }
      ]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Auth routes
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  const hash = process.env.KANBAN_PASSWORD;
  if (!hash) return res.status(500).json({ error: 'No password configured' });
  
  const match = await bcrypt.compare(password, hash);
  if (match) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Forkert adgangskode' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// Data routes
app.get('/api/board', requireAuth, (req, res) => {
  res.json(readData());
});

app.post('/api/cards', requireAuth, (req, res) => {
  const { columnId, card } = req.body;
  const data = readData();
  const col = data.columns.find(c => c.id === columnId);
  if (!col) return res.status(400).json({ error: 'Column not found' });
  
  card.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  card.createdAt = new Date().toISOString();
  col.cards.push(card);
  writeData(data);
  fireWebhook('card_created', card, columnId);
  addNotification('card_created', card, columnId);
  res.json(card);
});

app.put('/api/cards/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const data = readData();
  
  for (const col of data.columns) {
    const idx = col.cards.findIndex(c => c.id === id);
    if (idx !== -1) {
      col.cards[idx] = { ...col.cards[idx], ...updates };
      writeData(data);
      return res.json(col.cards[idx]);
    }
  }
  res.status(404).json({ error: 'Card not found' });
});

app.delete('/api/cards/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const data = readData();
  
  for (const col of data.columns) {
    const idx = col.cards.findIndex(c => c.id === id);
    if (idx !== -1) {
      col.cards.splice(idx, 1);
      writeData(data);
      return res.json({ success: true });
    }
  }
  res.status(404).json({ error: 'Card not found' });
});

app.put('/api/move', requireAuth, (req, res) => {
  const { cardId, fromColumnId, toColumnId, toIndex } = req.body;
  const data = readData();
  
  const fromCol = data.columns.find(c => c.id === fromColumnId);
  const toCol = data.columns.find(c => c.id === toColumnId);
  if (!fromCol || !toCol) return res.status(400).json({ error: 'Column not found' });
  
  const cardIdx = fromCol.cards.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return res.status(404).json({ error: 'Card not found' });
  
  const [card] = fromCol.cards.splice(cardIdx, 1);
  const insertAt = typeof toIndex === 'number' ? toIndex : toCol.cards.length;
  toCol.cards.splice(insertAt, 0, card);
  writeData(data);
  fireWebhook('card_moved', card, toColumnId);
  addNotification('card_moved', card, toColumnId);
  res.json({ success: true });
});

// Notifications endpoint — lightweight polling target
app.get('/api/notifications', requireAuth, (req, res) => {
  const notes = [...pendingNotifications];
  pendingNotifications = [];
  res.json(notes);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Kanban board running on http://localhost:${PORT}`);
});
