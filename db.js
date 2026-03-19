const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'nova.db');
let db;

function getDB() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH);
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
    db.getAsync  = (sql, p=[]) => new Promise((res,rej) => db.get(sql,p,(e,r)=>e?rej(e):res(r)));
    db.allAsync  = (sql, p=[]) => new Promise((res,rej) => db.all(sql,p,(e,r)=>e?rej(e):res(r)));
    db.runAsync  = (sql, p=[]) => new Promise((res,rej) => db.run(sql,p,function(e){e?rej(e):res({lastInsertRowid:this.lastID,changes:this.changes})}));
    initTables();
  }
  return db;
}

function initTables() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      avatar TEXT DEFAULT '⚡', theme TEXT DEFAULT 'dark',
      language TEXT DEFAULT 'en', personality TEXT DEFAULT 'cute',
      reset_token TEXT, reset_expires INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now')))`);
    db.run(`CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, title TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, model TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`);
    db.run(`CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
    db.run(`CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, text TEXT NOT NULL, done INTEGER DEFAULT 0,
      due_date TEXT, priority TEXT DEFAULT 'medium',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
    db.run(`CREATE TABLE IF NOT EXISTS moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, mood TEXT NOT NULL, note TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
    console.log('✅ Database tables ready');
  });
}

module.exports = { getDB };
