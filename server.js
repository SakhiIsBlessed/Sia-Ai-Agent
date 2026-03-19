require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 60000, max: 30, message: { error: 'Too many requests, slow down!' } });
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/todos', require('./routes/todos'));

// Status
app.get('/api/status', (req, res) => res.json({ status: 'online', version: '2.0.0', timestamp: new Date().toISOString() }));
app.get('/health', (req, res) => res.json({ ok: true }));

// Serve frontend for all routes
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`
  ⚡ NOVA AI Agent v2.0
  ──────────────────────────
  🚀 Port: ${PORT}
  🔑 Groq Key: ${process.env.GROQ_API_KEY ? '✅ Set' : '❌ Missing'}
  🗄️  Database: SQLite (nova.db)
  ──────────────────────────
  Open: http://localhost:${PORT}
  `);
});
