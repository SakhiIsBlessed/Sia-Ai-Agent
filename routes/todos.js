const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getDB } = require('../db');

router.get('/', authMiddleware, async (req, res) => {
  const db = getDB();
  const todos = await db.allAsync('SELECT * FROM todos WHERE user_id = ? ORDER BY done ASC, created_at DESC', [req.user.id]);
  res.json(todos);
});

router.post('/', authMiddleware, async (req, res) => {
  const { text, due_date, priority } = req.body;
  if (!text) return res.status(400).json({ error: 'Task text required' });
  const db = getDB();
  const r = await db.runAsync('INSERT INTO todos (user_id, text, due_date, priority) VALUES (?, ?, ?, ?)', [req.user.id, text, due_date || null, priority || 'medium']);
  res.json({ id: r.lastInsertRowid, text, done: 0, due_date, priority });
});

router.put('/:id', authMiddleware, async (req, res) => {
  const { done, text, priority } = req.body;
  const db = getDB();
  await db.runAsync('UPDATE todos SET done = ?, text = ?, priority = ? WHERE id = ? AND user_id = ?',
    [done ? 1 : 0, text, priority || 'medium', req.params.id, req.user.id]);
  res.json({ message: 'Updated' });
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const db = getDB();
  await db.runAsync('DELETE FROM todos WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Deleted' });
});

module.exports = router;
