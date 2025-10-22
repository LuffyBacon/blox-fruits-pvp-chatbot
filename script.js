// script.js — Blox Fruits PvP Assistant (anti-hang + instant KB replies)

import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

// ---------- UI ----------
const msgsEl   = document.getElementById('msgs');
const input    = document.getElementById('q');
const goBtn    = document.getElementById('go');
const statusEl = document.getElementById('status');

const ui = {
  add(role, content){
    const div = document.createElement('div');
    div.className = `msg ${role === 'user' ? 'me' : 'bot'}`;
    div.textContent = content;
    msgsEl.appendChild(div);
    msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
  },
  status(t){ statusEl.textContent = t; console.log('[status]', t); }
};

// ---------- knobs ----------
const CONTEXT_K      = 1;       // fastest
const MAX_TOKENS     = 160;     // short, complete answers
const KEEP_TURNS     = 0;       // no history sent
const REQ_TIMEOUT_MS = 45000;   // hard cap 45s
const KB_ONLY        = true;    // no hallucinations

// ---------- WebGPU check ----------
if (!('gpu' in navigator)) {
  ui.status('⚠️ WebGPU not available. Use Chrome/Edge on desktop.');
  goBtn.disabled = true;
  throw new Error('WebGPU not available');
}

// ---------- 1) Load modular KB ----------
const KB = {
  about:{}, fundamentals:[],
  combos:[], builds:[], counters:[],
  races:[], playstyles:[], fruits:[],
  guides:{}
};

const KB_FILES = [
  "blox_pvp_core.json",
  "blox_pvp_combos.json",
  "blox_pvp_builds.json",
  "blox_pvp_counters.json",
  "blox_pvp_races.json",
  "blox_pvp_playstyles.json",
  "blox_pvp_fruits.json",
  "blox_pvp_guides.json"
];

try {
  for (const f of KB_FILES) {
    const r = await fetch(`./kb/${f}`);
    if (!r.ok) throw new Error(`${f} not found`);
    const part = await r.json();

    if (part.about)         KB.about = part.about;
    if (part.fundamentals)  KB.fundamentals = part.fundamentals;

    if (part.combos)        KB.combos = (KB.combos||[]).concat(part.combos);
    if (part.builds)        KB.builds = (KB.builds||[]).concat(part.builds);
    if (part.counters)      KB.counters = (KB.counters||[]).concat(part.counters);
    if (part.races)         KB.races = (KB.races||[]).concat(part.races);
    if (part.playstyles)    KB.playstyles = (KB.playstyles||[]).concat(part.playstyles);
    if (part.fruits)        KB.fruits = (KB.fruits||[]).concat(part.fruits);

    if (part.guides)        Object.assign(KB.guides, part.guides);
  }
  ui.status('KB loaded. Initializing model… (first time downloads files)');
} catch (e) {
  ui.status('❌ Error loading KB: ' + e.message);
  goBtn.disabled = true;
  throw e;
}

// ---------- 2) Quick-answer engine (instant KB lookups) ----------
const norm = s => (s||'').toLowerCase();
const containsAny = (s, arr) => arr.some(x => s.includes(norm(x)));

function quickAnswer(q){
  const nq = norm(q);

  // combos
  if (nq.includes('combo')) {
    // try to match by fruit/weapon keywords
    const hits = KB.combos.filter(c => {
      const title = norm(c.title);
      return nq.split(/\s+/).some(tok => title.includes(tok));
    });
    const top = (hits.length ? hits : KB.combos).slice(0, 3);
    if (top.length){
      const lines = top.map(c => `• ${c.title}: ${c.inputs.join(' → ')}${c.notes?.length ? ` (${c.notes.join(', ')})` : ''}`);
      return `Here are some combos:\n${lines.join('\n')}\n(Pro tip: practice timing between the first 2 hits for stability on mobile.)`;
    }
  }

  // counters
  if (nq.includes('counter') || nq.includes('how to beat')) {
    const hits = KB.counters.filter(x => nq.includes(norm(x.enemy)));
    if (hits.length){
      const x = hits[0];
      return `Counter vs ${x.enemy} — Use: ${x.use?.join(', ') || 'your best mobility/stun'}\nTips: ${x.tips?.join(' | ')}`;
    }
  }

  // builds
  if (nq.includes('build') || nq.includes('setup')) {
    const top = KB.builds.slice(0, 3);
    if (top.length){
      const lines = top.map(b => `• ${b.label}${b.style?` [${b.style}]`:''} — ${b.notes?.join(' | ') || ''}`);
      return `Try these builds:\n${lines.join('\n')}`;
    }
  }

  // fruits / races / playstyles quick facts
  for (const f of KB.fruits || []) {
    if (nq.includes(norm(f.name))) {
      return `${f.name}: strengths ${f.strengths?.join(', ')}; weaknesses ${f.weaknesses?.join(', ') || '—'}. ${Array.isArray(f.notes)? f.notes.join(' ') : (f.notes||'')}`;
    }
  }
  for (const r of KB.races || []) {
    if (nq.includes(norm(r.name))) {
      return `Race — ${r.name}: ${r.description}`;
    }
  }
  for (const p of KB.playstyles || []) {
    if (nq.includes(norm(p.name))) {
      const summary = p.summary || (p.characteristics? p.characteristics.join(' | ') : '');
      return `Playstyle — ${p.name}: ${summary}${p.example_builds?.length? ` | Examples: ${p.example_builds.join(', ')}`:''}`;
    }
  }

  // no quick hit
  return null;
}

// ---------- 3) Build small retrieval context for LLM ----------
function mkBlock(title, text){
  return `### ${title}\n${text.slice(0, 600)}`;
}
function retrieveContext(q){
  const nq = norm(q);
  const chunks = [];

  // Prefer exact sections based on keywords
  for (const c of KB.combos || []) {
    if (nq.includes('combo') && nq.split(/\s+/).some(t => norm(c.title).includes(t))) {
      chunks.push(mkBlock(`Combo: ${c.title}`, `${c.inputs.join(' → ')}${c.notes?.length? ' | ' + c.notes.join(' | ') : ''}`));
      break;
    }
  }
  for (const x of KB.counters || []) {
    if (nq.includes('counter') && nq.includes(norm(x.enemy))) {
      chunks.push(mkBlock(`Counter vs ${x.enemy}`, `Use: ${(x.use||[]).join(', ')} | Tips: ${(x.tips||[]).join(' | ')}`));
      break;
    }
  }
  for (const b of KB.builds || []) {
    if (nq.includes('build') && nq.split(/\s+/).some(t => norm(b.label).includes(t))) {
      chunks.push(mkBlock(`Build: ${b.label}`, `${b.style? 'Style: ' + b.style + ' | ' : ''}${(b.notes||[]).join(' | ')}`));
      break;
    }
  }
  if (chunks.length) return chunks.slice(0, CONTEXT_K).join('\n\n');

  // Fallback: a single general theory chunk
  if (KB.guides?.theory) return mkBlock('PvP Theory', KB.guides.theory);
  return '';
}

// ---------- 4) System prompt ----------
const SYSTEM = `
// 3) System prompt (locked rules for model behavior)
const SYSTEM = `
You are the **Blox Fruits PvP Assistant**, a chill but accurate PvP coach.

🎯 **Mission**
Help players improve at Blox Fruits PvP with real meta knowledge — no fake info, no nonsense.

⚔️ **Core Rules**
- Use ONLY facts from the knowledge base (KB).
- Instinct = Ken Tricking and dodge timing only. It does NOT increase damage.
- Aura (Haki) = lets you hit Elemental users only, not a damage buff.
- Do NOT mention any "Sprite race", "balanced team", or made-up mechanics.
- Never invent new fruits, abilities, or stats.
- If unsure, say: "Not in my KB yet, bro."
- Keep every explanation game-accurate and up to date.

🗣️ **Tone**
Speak casually, friendly gamer-style (like a good PvP coach).  
Use phrases like "yo bro", "bet", or "let’s cook", but keep it clear and easy for everyone.  
Short paragraphs, bullet lists, and arrows (→) for combos.

💡 **Formatting**
- Combos: use → arrows and label difficulty (Easy / Mid / Advanced).
- Counters: give 2–3 ways to punish or evade.
- Long guides: 6 bullets max unless user says “explain in detail.”

🔥 **Goal**
Be fast, confident, and real — no fluff, no broken mechanics.
`;


// ---------- 5) Greeting ----------
ui.add('assistant', "Yo bro! I'm your PvP chatbot specifically designed for Blox Fruits! You can ask me for any help you want.");

// ---------- 6) Model init (start with tiny models) ----------
const MODELS = [
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",     // tiny & fast
  "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",  // tiny & fast
  "Phi-3-mini-4k-instruct-q4f16_1-MLC"     // fallback
];
let engine;

async function initModel(){
  for (const name of MODELS){
    try {
      ui.status(`Downloading model: ${name}…`);
      engine = await CreateMLCEngine(name, {
        initProgressCallback: p => { if (p?.text) ui.status(`${name}: ${p.text}`); }
      });
      ui.status(`✅ Model ready (${name}) — Ask anything!`);
      return;
    } catch (e) {
      console.warn('Model failed:', name, e);
    }
  }
  throw new Error('All models failed to initialize.');
}

try { await initModel(); }
catch (e){ ui.status('❌ Model init failed: ' + e.message); goBtn.disabled = true; throw e; }

// ---------- 7) LLM call with Promise.race timeout + auto-continue ----------
async function callLLMOnce(messages){
  // Some engines ignore AbortController; use Promise.race to enforce timeout.
  const p = (engine.chat?.completions?.create)
    ? engine.chat.completions.create({ messages, temperature: 0.2, max_tokens: MAX_TOKENS, stream: false })
    : (typeof engine.chatCompletion === 'function'
        ? engine.chatCompletion({ messages, temperature: 0.2, max_tokens: MAX_TOKENS })
        : Promise.reject(new Error('Unsupported web-llm API version.')));

  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('timeout')), REQ_TIMEOUT_MS)
  );

  return Promise.race([p, timeout]);
}

async function askLLM(userMsg){
  // 0) Instant path: answer straight from KB if possible
  const quick = quickAnswer(userMsg);
  if (quick) return quick;

  // 1) If KB-only and no context, bail fast
  const ctx = retrieveContext(userMsg);
  if (KB_ONLY && (!ctx || !ctx.trim())) {
    return "I don’t have that in my knowledge yet. Add it to the KB or tell me your fruit/playstyle.";
  }

  // 2) Build messages (no history for speed)
  const base = [
    { role: 'system', content: `${SYSTEM}\n\nContext:\n${ctx}` },
    { role: 'user',   content: userMsg }
  ];

  ui.status('Thinking…');

  try {
    // First page
    let res   = await callLLMOnce(base);
    let part  = res?.choices?.[0]?.message?.content || '';
    let done  = (res?.choices?.[0]?.finish_reason || '').toLowerCase() !== 'length';
    let pages = 1;

    // Auto-continue at most twice
    while (!done && pages < 3) {
      pages++;
      const follow = [
        ...base,
        { role: 'assistant', content: part },
        { role: 'user', content: 'continue from where you stopped. keep it concise and finish the list.' }
      ];
      res  = await callLLMOnce(follow);
      const next = res?.choices?.[0]?.message?.content || '';
      part += (next ? '\n' + next : '');
      done = (res?.choices?.[0]?.finish_reason || '').toLowerCase() !== 'length';
    }

    ui.status('✅ Ready');
    return part || '…';

  } catch (err) {
    if (String(err.message).includes('timeout')) {
      ui.status('⏱️ Timed out');
      return "Yo, that took too long on this GPU. Try a shorter question (e.g., '2 portal combos mobile') or close heavy tabs and ask again.";
    }
    console.error(err);
    ui.status('❌ Error');
    return 'Error while thinking. Open Console (F12) → copy the first red error to me.';
  }
}

// ---------- 8) Send ----------
goBtn.addEventListener('click', async ()=>{
  const q = input.value.trim(); if (!q) return;
  ui.add('user', q); input.value = ''; goBtn.disabled = true;
  try {
    const a = await askLLM(q);
    ui.add('assistant', a);
  } catch (err) {
    ui.add('assistant', 'Error: ' + (err?.message||err));
  } finally {
    goBtn.disabled = false;
  }
});
