const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getDB } = require('../db');

const MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B' },
  { id: 'llama-3.1-8b-instant',    label: 'LLaMA 3.1 8B'  },
  { id: 'gemma2-9b-it',            label: 'Gemma 2 9B'     },
  { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B'  },
];
const modelStatus = {};
MODELS.forEach(m => modelStatus[m.id] = { limited: false });
function markLimited(id) { modelStatus[id].limited = true; setTimeout(() => { modelStatus[id].limited = false; }, 65000); }

function getPersonalityPrompt(p) {
  const map = {
    cute: `Your personality is warm, cute and caring. Use occasional friendly emojis (💕✨🌸). Say things like "Aww don't worry! 💕". Be encouraging and sweet but accurate.`,
    professional: `Your personality is professional, precise and efficient. Use clear formatting. Be direct and thorough.`,
    funny: `Your personality is witty and fun. Add light humor when appropriate. Use casual language and occasional jokes.`,
    calm: `Your personality is calm, soothing and mindful. Use peaceful language. Be gentle and reassuring.`
  };
  return map[p] || map.cute;
}

function detectMood(text) {
  const l = text.toLowerCase();
  if (/sad|depressed|unhappy|crying|lonely|hopeless|heartbroken/.test(l)) return 'sad';
  if (/happy|excited|great|amazing|wonderful|fantastic|awesome/.test(l)) return 'happy';
  if (/anxious|stressed|worried|nervous|panic|overwhelmed/.test(l)) return 'anxious';
  if (/angry|frustrated|mad|annoyed|irritated/.test(l)) return 'angry';
  if (/tired|exhausted|sleepy|drained|burnout/.test(l)) return 'tired';
  if (/bored|boring|nothing to do/.test(l)) return 'bored';
  return null;
}

function getMoodCtx(mood) {
  const m = {
    sad: `User seems sad. Show extra empathy 💕. Offer encouragement, suggest calming activity, recommend soothing music.`,
    happy: `User is happy! Match their energy with enthusiasm ✨. Celebrate with them!`,
    anxious: `User seems anxious. Be calm and grounding 🌿. Suggest breathing, breaking tasks into small steps.`,
    angry: `User seems frustrated. Acknowledge feelings without judgment. Be calm and validating.`,
    tired: `User seems tired. Be gentle 😴. Suggest a short break, remind them rest is productive.`,
    bored: `User is bored! Suggest something fun: a fact, creative challenge, or music. Keep it light!`
  };
  return m[mood] || '';
}

function buildSystem(user, memories, mood) {
  const now = new Date().toLocaleString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  const h = new Date().getHours();
  const greet = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const memStr = memories.length ? memories.map(m=>`${m.key}: ${m.value}`).join('\n') : 'None yet';
  const moodCtx = mood ? `\nMOOD DETECTED: ${getMoodCtx(mood)}` : '';
  return `You are NOVA, a personal AI agent for ${user.name}. ${greet}, ${user.name}!
${getPersonalityPrompt(user.personality||'cute')}
${moodCtx}
Current date/time: ${now}
What you know about ${user.name}:
${memStr}
Capabilities: memory, natural conversation, mood support, trip planning, study help, code, math, music suggestions.
Rules: Use ${user.name}'s name occasionally. Use **bold** for key terms. Use \`\`\`lang\\ncode\`\`\` for all code. Be warm and genuinely helpful.`;
}

// Send message
router.post('/message', authMiddleware, async (req, res) => {
  const { messages, conversationId, preferredModel } = req.body;
  const db = getDB();
  const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const memories = await db.allAsync('SELECT key, value FROM memories WHERE user_id = ?', [req.user.id]);
  const lastMsg = messages[messages.length-1]?.content || '';
  const mood = detectMood(lastMsg);
  if (mood) await db.runAsync('INSERT INTO moods (user_id, mood, note) VALUES (?, ?, ?)', [req.user.id, mood, lastMsg.slice(0,200)]);

  // Auto-extract memories
  const memPatterns = [
    [/(?:my name is|i'm called|call me)\s+([A-Za-z]+)/i, 'name'],
    [/i(?:'m| am) (?:a |an )?([a-z ]{3,30}(?:developer|engineer|student|designer|doctor|teacher|manager|founder))/i, 'job'],
    [/i (?:live in|am from|based in)\s+([^.!?\n]{3,30})/i, 'location'],
    [/i (?:love|like|enjoy)\s+([^.!?\n]{3,40})/i, 'interest'],
    [/my favorite (?:music|song|genre) is ([^.!?\n]{3,40})/i, 'music'],
  ];
  for (const [pattern, key] of memPatterns) {
    const m = lastMsg.match(pattern);
    if (m) await db.runAsync('INSERT OR REPLACE INTO memories (user_id, key, value) VALUES (?, ?, ?)', [req.user.id, key, m[1].trim()]);
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set in .env' });

  const systemPrompt = buildSystem(user, memories, mood);
  const modelsToTry = [preferredModel, ...MODELS.map(m=>m.id)].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);

  for (const modelId of modelsToTry) {
    if (modelStatus[modelId]?.limited) continue;
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({ model: modelId, max_tokens: 2048, temperature: 0.75,
          messages: [{ role: 'system', content: systemPrompt }, ...messages.slice(-20)] })
      });
      if (response.status === 429) { markLimited(modelId); continue; }
      if (!response.ok) { const e = await response.json(); throw new Error(e.error?.message || `HTTP ${response.status}`); }
      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content;
      if (!reply) throw new Error('Empty response');

      let convId = conversationId;
      if (!convId) {
        const r = await db.runAsync('INSERT INTO conversations (user_id, title) VALUES (?, ?)', [req.user.id, lastMsg.slice(0,50)]);
        convId = r.lastInsertRowid;
      } else {
        await db.runAsync("UPDATE conversations SET updated_at = strftime('%s','now') WHERE id = ?", [convId]);
      }
      await db.runAsync('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [convId, 'user', lastMsg]);
      await db.runAsync('INSERT INTO messages (conversation_id, role, content, model) VALUES (?, ?, ?, ?)', [convId, 'assistant', reply, modelId]);

      return res.json({ reply, conversationId: convId, modelLabel: MODELS.find(m=>m.id===modelId)?.label||modelId, mood: mood||null });
    } catch(e) {
      if (e.message?.includes('429')) markLimited(modelId);
      console.error(`Model ${modelId} failed:`, e.message);
    }
  }
  res.status(503).json({ error: 'All models unavailable. Try again in a minute.' });
});

// Conversations
router.get('/conversations', authMiddleware, async (req, res) => {
  const db = getDB();
  const convs = await db.allAsync('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50', [req.user.id]);
  res.json(convs);
});

router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
  const db = getDB();
  const conv = await db.getAsync('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  const messages = await db.allAsync('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [req.params.id]);
  res.json({ conversation: conv, messages });
});

router.delete('/conversations/:id', authMiddleware, async (req, res) => {
  const db = getDB();
  await db.runAsync('DELETE FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Deleted' });
});

// Memories
router.get('/memories', authMiddleware, async (req, res) => {
  const db = getDB();
  const mems = await db.allAsync('SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
  res.json(mems);
});

router.delete('/memories/:id', authMiddleware, async (req, res) => {
  const db = getDB();
  await db.runAsync('DELETE FROM memories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ message: 'Deleted' });
});

router.get('/moods', authMiddleware, async (req, res) => {
  const db = getDB();
  const moods = await db.allAsync('SELECT * FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [req.user.id]);
  res.json(moods);
});

module.exports = router;
