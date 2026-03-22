const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB } = require('../db');
const { signToken, authMiddleware } = require('../middleware/auth');

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const db = getDB();
    const existing = await db.getAsync('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const result = await db.runAsync('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name.trim(), email.toLowerCase().trim(), hash]);
    const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
    await db.runAsync('INSERT OR REPLACE INTO memories (user_id, key, value) VALUES (?, ?, ?)', [user.id, 'name', name.trim()]);
    const token = signToken(user);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, personality: user.personality } });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const db = getDB();
    const user = await db.getAsync('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, personality: user.personality } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const db = getDB();
    const user = await db.getAsync('SELECT * FROM users WHERE email = ?', [email?.toLowerCase().trim()]);
    if (!user) return res.json({ message: 'If that email exists, a reset link was sent.' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000;
    await db.runAsync('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, user.id]);
    console.log(`🔑 Reset token for ${email}: ${token}`);
    res.json({ message: 'Reset link generated! Check server console for the token (dev mode).', devToken: token });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Failed: ' + e.message });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
    const db = getDB();
    const user = await db.getAsync('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?', [token, Date.now()]);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });
    const hash = await bcrypt.hash(password, 12);
    await db.runAsync('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [hash, user.id]);
    res.json({ message: 'Password reset successfully! You can now login.' });
  } catch (e) {
    res.status(500).json({ error: 'Reset failed: ' + e.message });
  }
});

// Get profile
router.get('/me', authMiddleware, async (req, res) => {
  const db = getDB();
  const user = await db.getAsync('SELECT id, name, email, avatar, theme, language, personality, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Update profile
router.put('/profile', authMiddleware, async (req, res) => {
  const { name, avatar, theme, personality } = req.body;
  const db = getDB();
  await db.runAsync('UPDATE users SET name = ?, avatar = ?, theme = ?, personality = ? WHERE id = ?',
    [name || req.user.name, avatar || '⚡', theme || 'dark', personality || 'cute', req.user.id]);
  res.json({ message: 'Profile updated' });
});

module.exports = router;
