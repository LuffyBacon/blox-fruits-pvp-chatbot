// script.js — Blox Fruits PvP Assistant (final clean build)

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
  const hits = CORPUS.filter(b => b.key.includes(n)).slice(0,6);
  if (hits.length === 0 && KB.guides?.theory) return `### PvP Theory\n${KB.guides.theory.slice(0,1200)}`;
  return hits.map(b => `### ${b.title}\n${b.text}`).join('\n\n');
}

// 3) Single system prompt (ONLY ONE)
const SYSTEM = `
You are the **Blox Fruits PvP Assistant**, a friendly gamer coach for all ages.
Answer ANY Blox Fruits question (PvP, fruits, weapons, builds, movement, races).
Use the provided context when helpful. Be concise, clear, and positive.
Combos: show inputs with arrows (→), include a starter/timing tip. Counters: 2–3 actions + punish window.
`;

// 4) Greeting
ui.add('assistant', "Yo bro! I'm your PvP chatbot specifically designed for Blox Fruits! You can ask me for any help you want.");

// 5) Load a valid Web-LLM model
const MODELS = [
  "Phi-3-mini-4k-instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Mistral-7B-Instruct-v0.2-q4f16_1-MLC"
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
  const messages = [
    { role: 'system', content: `${SYSTEM}\n\nContext:\n${ctx}` }, // ONE system message total
    ...history,
    { role: 'user', content: userMsg }
  ];

  ui.status('Thinking…');

  // Modern API
  if (engine.chat?.completions?.create){
    const res = await engine.chat.completions.create({ messages, temperature: 0.3, stream: false });
    const reply = res?.choices?.[0]?.message?.content || '…';
    history.push({ role:'user', content:userMsg });
    history.push({ role:'assistant', content:reply });
    ui.status('✅ Ready');
    return reply;
  }
  // Legacy fallback
  if (typeof engine.chatCompletion === 'function'){
    const res = await engine.chatCompletion({ messages, temperature: 0.3 });
    const reply = res?.choices?.[0]?.message?.content || res?.message?.content || '…';
    history.push({ role:'user', content:userMsg });
    history.push({ role:'assistant', content:reply });
    ui.status('✅ Ready');
    return reply;
  }

  throw new Error('Unsupported web-llm API version.');
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
