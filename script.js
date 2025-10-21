// script.js — Blox Fruits PvP Assistant (AMD fast + timeout build)

import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

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

// ---- speed / safety knobs ----
const CONTEXT_K      = 2;       // how many KB chunks to include
const MAX_TOKENS     = 120;     // cap response length
const KEEP_TURNS     = 1;       // keep last N Q&A pairs in history
const REQ_TIMEOUT_MS = 45000;   // abort any single reply after 45s
const KB_ONLY        = false;   // set true to answer ONLY from KB

// 0) WebGPU check
if (!('gpu' in navigator)) {
  ui.status('⚠️ WebGPU not available. Use Chrome/Edge on desktop.');
  goBtn.disabled = true;
  throw new Error('WebGPU not available');
}

// 1) Load KB
let KB = { combos:[], counters:[], matchups:[], builds:[], guides:{} };
try {
  const r = await fetch('./kb/blox_pvp.json');
  if (!r.ok) throw new Error('kb/blox_pvp.json not found');
  KB = await r.json();
  ui.status('KB loaded. Initializing model… (first time downloads files)');
} catch (e) {
  ui.status('❌ Error loading KB: ' + e.message);
  goBtn.disabled = true;
  throw e;
}

// 2) Simple search corpus (so you can ask ANYTHING)
const normalize = s => (s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
function mkBlock(title, text){ return { title, text, key: normalize(`${title} ${text}`) }; }

const CORPUS = [];
for (const c of KB.combos||[])   CORPUS.push(mkBlock(`Combo: ${c.title}`, `${(c.inputs||[]).join(' → ')} | ${(c.notes||[]).join(' | ')}`));
for (const ct of KB.counters||[]) CORPUS.push(mkBlock(`Counter vs ${ct.enemy}`, (ct.tips||[]).join(' | ')));
for (const b of KB.builds||[])    CORPUS.push(mkBlock(`Build: ${b.label}`, (b.notes||[]).join(' | ')));
if (KB.guides?.theory)            CORPUS.push(mkBlock('PvP Theory', KB.guides.theory));

function retrieveContext(q){
  const n = normalize(q);
  const hits = CORPUS.filter(b => b.key.includes(n)).slice(0, CONTEXT_K);
  if (hits.length === 0 && KB.guides?.theory) return `### PvP Theory\n${KB.guides.theory.slice(0,1200)}`;
  return hits.map(b => `### ${b.title}\n${b.text}`).join('\n\n');
}

// 3) Single system prompt (ONLY ONE)
const SYSTEM = `
You are the **Blox Fruits PvP Assistant**, a friendly gamer coach for all ages.
Answer ANY Blox Fruits question (PvP, fruits, weapons, builds, movement, races).
Use the provided Context below when helpful. Be concise, clear, and positive.
Combos: show inputs with arrows (→) + one timing tip. Counters: 2–3 actions + punish window.
If information is missing${KB_ONLY ? ', say you do not have it and ask the user to add it to the knowledge base.' : ', make a best-effort helpful answer.'}
`;

// 4) Greeting
ui.add('assistant', "Yo bro! I'm your PvP chatbot specifically designed for Blox Fruits! You can ask me for any help you want.");

// 5) Load a valid Web-LLM model — AMD iGPU: smallest only for speed/stability
const MODELS = [
  "Phi-3-mini-4k-instruct-q4f16_1-MLC"
];
let engine;

async function initModel(){
  for (const name of MODELS){
    try{
      ui.status(`Downloading model: ${name}…`);
      engine = await CreateMLCEngine(name, {
        initProgressCallback: p => { if (p?.text) ui.status(`${name}: ${p.text}`); }
      });
      ui.status(`✅ Model ready (${name}) — Ask anything!`);
      return;
    }catch(e){ console.warn('Model failed:', name, e); }
  }
  throw new Error('All models failed to initialize.');
}

try { await initModel(); }
catch (e){ ui.status('❌ Model init failed: ' + e.message); goBtn.disabled = true; throw e; }

// 6) Chat (NON-STREAMING) — system prompt FIRST, only once
const history = []; // only user/assistant pairs, NO system here

async function askLLM(userMsg){
  const ctx = retrieveContext(userMsg);

  if (KB_ONLY && (!ctx || ctx.trim() === "")) {
    return "I don't have that in my knowledge yet. Tell me your fruit/playstyle and I’ll add it.";
  }

  const trimmedHistory = history.slice(-KEEP_TURNS * 2);
  const messages = [
    { role: 'system', content: `${SYSTEM}\n\nContext:\n${ctx}` }, // ONE system message total
    ...trimmedHistory,
    { role: 'user', content: userMsg }
  ];

  ui.status('Thinking…');

  // hard timeout guard
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), REQ_TIMEOUT_MS);

  try {
    // Modern API
    if (engine.chat?.completions?.create){
      const res = await engine.chat.completions.create({
        messages,
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        stream: false,
        signal: controller.signal
      });
      clearTimeout(timeout);
      const reply = res?.choices?.[0]?.message?.content || '…';
      history.push({ role:'user', content:userMsg });
      history.push({ role:'assistant', content:reply });
      ui.status('✅ Ready');
      return reply;
    }
    // Legacy fallback
    if (typeof engine.chatCompletion === 'function'){
      const res = await engine.chatCompletion({
        messages,
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        signal: controller.signal
      });
      clearTimeout(timeout);
      const reply = res?.choices?.[0]?.message?.content || res?.message?.content || '…';
      history.push({ role:'user', content:userMsg });
      history.push({ role:'assistant', content:reply });
      ui.status('✅ Ready');
      return reply;
    }

    clearTimeout(timeout);
    throw new Error('Unsupported web-llm API version.');
  } catch (err) {
    clearTimeout(timeout);
    if (String(err).includes('timeout') || String(err?.name).includes('AbortError')) {
      ui.status('⏱️ Timed out');
      return "Yo, that took too long on this GPU. Try a shorter question or ask again (close heavy tabs for more speed).";
    }
    console.error(err);
    ui.status('❌ Error');
    return 'Error while thinking. Open Console (F12) and send me the first red line.';
  }
}

// 7) Send button
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
