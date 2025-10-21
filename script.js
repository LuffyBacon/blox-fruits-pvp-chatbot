// script.js — Blox Fruits PvP Assistant (offline, WebGPU)
// Drop-in replacement

import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

const msgsEl   = document.getElementById('msgs');
const input    = document.getElementById('q');
const goBtn    = document.getElementById('go');
const statusEl = document.getElementById('status');

const ui = {
  add(role, content){
    const div = document.createElement('div');
    div.className = `msg ${role==='user'?'me':'bot'}`;
    div.textContent = content;
    msgsEl.appendChild(div);
    msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior:'smooth' });
  },
  status(t){ statusEl.textContent = t; console.log('[status]', t); }
};

// 0) WebGPU check
if (!('gpu' in navigator)) {
  ui.status('⚠️ WebGPU not available. Use latest Chrome/Edge on desktop. (Mobile often lacks WebGPU.)');
  goBtn.disabled = true; throw new Error('WebGPU not available');
}

// 1) Load KB JSON
let KB = { combos:[], counters:[], matchups:[], builds:[], guides:{} };
try {
  const r = await fetch('./kb/blox_pvp.json');
  if (!r.ok) throw new Error('kb/blox_pvp.json not found');
  KB = await r.json();
  ui.status('KB loaded. Initializing model (first load downloads files)…');
} catch (e) {
  ui.status('❌ Error loading KB: '+e.message+' — ensure kb/blox_pvp.json exists.');
  goBtn.disabled = true; throw e;
}

// ---- Searchable corpus (for ANY Blox Fruits questions) ----
const normalize = s => (s||'').toLowerCase()
  .replace(/[^a-z0-9\s]/g,' ')
  .replace(/\s+/g,' ')
  .trim();

const SYN = {
  'gh':'godhuman', 'cdk':'cursed dual katana', 'dt':'dragon trident',
  'ec':'electric claw','eclaw':'electric claw','sa':'sanguine art',
  'ken':'instinct','haki':'aura'
};

const expandQuery = (q) => {
  const words = normalize(q).split(' ').filter(Boolean);
  const extra = [];
  for (const w of words) if (SYN[w]) extra.push(SYN[w]);
  return words.concat(extra);
};

function mkBlock(title, text, tag='kb'){
  return { title, text, tag, key: normalize(title+' '+text) };
}

// Build blocks from all KB parts
const CORPUS = [];
// Combos
for (const c of KB.combos||[]){
  CORPUS.push(mkBlock(
    `Combo: ${c.title}`,
    `Starter: ${c.starter||'-'} | Inputs: ${(c.inputs||[]).join(' → ')} | Notes: ${(c.notes||[]).join(' | ')}`,
    'combo'
  ));
}
// Counters
for (const ct of KB.counters||[]){
  CORPUS.push(mkBlock(
    `Counter vs ${ct.enemy}`,
    `Use: ${(ct.use||[]).join(', ')} | Tips: ${(ct.tips||[]).join(' | ')}`,
    'counter'
  ));
}
// Matchups
for (const m of KB.matchups||[]){
  CORPUS.push(mkBlock(
    `Matchup ${m.mine} vs ${m.theirs}`,
    `Plan: ${(m.plan||[]).join(' | ')}`,
    'matchup'
  ));
}
// Builds
for (const b of KB.builds||[]){
  CORPUS.push(mkBlock(
    `Build: ${b.label}`,
    `Stats: ${JSON.stringify(b.stats||{})} | Style: ${b.style||'-'} | Notes: ${(b.notes||[]).join(' | ')}`,
    'build'
  ));
}
// Guides / theory
if (KB.guides?.theory) CORPUS.push(mkBlock('PvP Theory', KB.guides.theory, 'guide'));

// Simple fuzzy score: token hits + phrase hits
function scoreBlock(tokens, block){
  let score = 0;
  for (const t of tokens){
    if (!t) continue;
    if (block.key.includes(t)) score += 2; // token hit
  }
  // bonus for multi-word fruit/style names in query
  const qJoined = tokens.join(' ');
  if (qJoined.length > 6 && block.key.includes(qJoined)) score += 3;
  return score;
}

function retrieveContext(query, k=8){
  const tokens = expandQuery(query);
  const scored = CORPUS
    .map(b => ({ b, s: scoreBlock(tokens, b) }))
    .filter(x => x.s > 0)
    .sort((a,b) => b.s - a.s)
    .slice(0, k)
    .map(x => `### ${x.b.title}\n${x.b.text}`);
  // Fallback if nothing matched: give general theory/help + ask a small follow-up
  if (scored.length === 0 && KB.guides?.theory){
    scored.push(`### PvP Theory\n${KB.guides.theory.slice(0, 1200)}`);
  }
  return scored.join('\n\n');
}

// 2) System prompt — answer ANY Blox Fruits questions (PvP focus but not limited)
const SYSTEM = `
You are the **Blox Fruits PvP Assistant**. Tone: friendly gamer coach (fun, clean).
You can answer ANY Blox Fruits question (PvP, fruits, weapons, builds, movement, races, raids basics),
but prefer PvP coaching. Use the KB context when relevant. If data is missing, answer from general knowledge
and ask a TINY follow-up (e.g., "PC or Mobile?" or "Fruit or Sword main?").

Formatting rules:
- For combos: show Inputs with arrows (→), include Starter and 1 ping tip if useful.
- For counters: give 2–3 clear actions + a punish window.
- For builds: give stat focus + style + 1–2 accessory notes.
- Simple question → short answer. Complex → step-by-step tips.
- Be helpful, precise, and positive. Keep it safe for all ages.
`;

// 3) Greeting
ui.add('assistant', "Yo bro! I'm your PvP chatbot specificially designed for Blox Fruits! You can ask me for any help you want.");

// 4) Initialize a valid Web-LLM model (with -MLC suffix)
let engine;
const MODEL_CANDIDATES = [
  'Phi-3-mini-4k-instruct-q4f16_1-MLC',   // fastest to load
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',    // a bit larger
  'Llama-3.2-1B-Instruct-q4f16_1-MLC'     // also small
];

async function initModel(){
  for (const name of MODEL_CANDIDATES){
    try {
      ui.status(`Downloading model: ${name} …`);
      const t0 = performance.now();
      engine = await CreateMLCEngine(name, {
        initProgressCallback: p => { if (p?.text) ui.status(`${name}: ${p.text}`); }
      });
      ui.status(`✅ Model ready (${name}) in ${Math.round((performance.now()-t0)/1000)}s. Ask anything!`);
      return;
    } catch (e) {
      console.warn('Model failed:', name, e);
    }
  }
  throw new Error('All model candidates failed to initialize.');
}

try { await initModel(); }
catch (e) { ui.status('❌ Failed to init model: '+(e?.message||e)); goBtn.disabled = true; throw e; }

const history = [{ role:'system', content: SYSTEM }];

async function askLLM(userMsg){
  const context = retrieveContext(userMsg, 8);
  const messages = [
    ...history,
    { role:'system', content: `KB Context (use this when helpful):\n${context}` },
    { role:'user', content: userMsg }
  ];
  let reply = '';
  for await (const chunk of engine.chat.completions.create({ messages, stream:true })){
    const d = chunk.choices?.[0]?.delta?.content;
    if (d) reply += d;
  }
  history.push({ role:'user', content:userMsg });
  history.push({ role:'assistant', content:reply });
  return reply;
}

// 5) Button handler (no form submit → no page reload)
goBtn.addEventListener('click', async ()=>{
  const q = input.value.trim(); if (!q) return;
  ui.add('user', q); input.value=''; goBtn.disabled = true;
  try {
    const a = await askLLM(q);
    ui.add('assistant', a);
  } catch (err) {
    ui.add('assistant', 'Error: ' + (err?.message||err));
  } finally {
    goBtn.disabled = false;
  }
});

