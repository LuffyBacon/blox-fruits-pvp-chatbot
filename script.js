// script.js — Blox Fruits PvP Assistant (modular KB + AMD fast + timeout)

// Uses: @mlc-ai/web-llm (WebGPU, fully local)
import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

// ===== UI helpers =====
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

// ===== speed / safety knobs (tweak if needed) =====
const CONTEXT_K      = 2;       // KB chunks included per question (1–3 recommended)
const MAX_TOKENS     = 150;     // max reply length (120–180 is good)
const KEEP_TURNS     = 1;       // keep last N Q&A pairs in history (0–2)
const REQ_TIMEOUT_MS = 45000;   // abort a reply after 45s
const KB_ONLY        = true;    // true = only answer from KB (no make-believe)

// ===== WebGPU check =====
if (!('gpu' in navigator)) {
  ui.status('⚠️ WebGPU not available. Use Chrome/Edge on desktop.');
  goBtn.disabled = true;
  throw new Error('WebGPU not available');
}

// ===== 1) Load modular KB files =====
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

// ===== 2) Build a searchable corpus =====
const normalize = s => (s||'').toLowerCase()
  .replace(/[^a-z0-9\s]/g,' ')
  .replace(/\s+/g,' ')
  .trim();

function mkBlock(title, text, tag='kb'){
  return { title, text, tag, key: normalize(`${title} ${text}`) };
}

const CORPUS = [];

// About / fundamentals / guides
if (KB.about?.description) CORPUS.push(mkBlock('About', KB.about.description, 'about'));
for (const line of KB.fundamentals||[]) CORPUS.push(mkBlock('Fundamentals', line, 'fundamentals'));
for (const k in (KB.guides||{})) CORPUS.push(mkBlock(`Guide: ${k}`, KB.guides[k], 'guide'));

// Combos / builds / counters
for (const c of KB.combos||[])
  CORPUS.push(mkBlock(`Combo: ${c.title}`,
    `${(c.inputs||[]).join(' → ')}${c.notes?.length? ' | ' + c.notes.join(' | ') : ''}`,
    'combo'
  ));

for (const b of KB.builds||[])
  CORPUS.push(mkBlock(`Build: ${b.label}`,
    `${(b.style? ('Style: ' + b.style + ' | ') : '')}${(b.notes||[]).join(' | ')}${b.accessories?.length? ' | Acc: ' + b.accessories.join(', ') : ''}`,
    'build'
  ));

for (const ct of KB.counters||[])
  CORPUS.push(mkBlock(`Counter vs ${ct.enemy}`,
    `Use: ${(ct.use||[]).join(', ')} | Tips: ${(ct.tips||[]).join(' | ')}`,
    'counter'
  ));

// Races / playstyles / fruits
for (const r of KB.races||[])
  CORPUS.push(mkBlock(`Race: ${r.name}`, r.description||'', 'race'));

for (const p of KB.playstyles||[])
  CORPUS.push(mkBlock(`Playstyle: ${p.name}`,
    `${p.summary||p.characteristics?.join(' | ')||''}${p.tip? ' | Tip: '+p.tip : ''}${p.example_builds?.length? ' | Examples: '+p.example_builds.join(', ') : ''}`,
    'playstyle'
  ));

for (const f of KB.fruits||[])
  CORPUS.push(mkBlock(`Fruit: ${f.name}`,
    `${f.role? f.role + '. ' : ''}Strengths: ${(f.strengths||[]).join(', ')}. Weaknesses: ${(f.weaknesses||[]).join(', ')}. ${Array.isArray(f.notes)? f.notes.join(' ') : (f.notes||'')}`,
    'fruit'
  ));

function retrieveContext(q){
  const n = normalize(q);
  const hits = CORPUS
    .map(b => ({ b, s: (n ? (b.key.includes(n)? 2 : 0) : 0) }))
    .filter(x => x.s > 0)
    .sort((a,b) => b.s - a.s)
    .slice(0, CONTEXT_K)
    .map(x => `### ${x.b.title}\n${x.b.text.slice(0, 600)}`);

  if (hits.length === 0 && KB.guides?.theory) {
    return `### PvP Theory\n${KB.guides.theory.slice(0, 800)}`;
  }
  return hits.join('\n\n');
}

// ===== 3) System prompt (single system message forever) =====
const SYSTEM = `
You are the **Blox Fruits PvP Assistant**, a friendly gamer coach for all ages.

Rules:
- Use ONLY the provided Context${KB_ONLY ? ' (KB-only: if missing, say you do not have it)' : ' when helpful; otherwise answer from general PvP knowledge.'}
- Be concise, clear, and positive.
- Combos: format inputs with arrows (→) and add one timing/ping tip.
- Counters: give 2–3 specific actions + a punish window.
- Builds: include stat focus or style and 1–2 accessory notes.
- If user asks something unrelated to Blox Fruits PvP, politely decline.
`;

// ===== 4) Greeting =====
ui.add('assistant', "Yo bro! I'm your PvP chatbot specifically designed for Blox Fruits! You can ask me for any help you want.");

// ===== 5) Initialize model (AMD: smallest for stability/speed) =====
const MODELS = [
  "Phi-3-mini-4k-instruct-q4f16_1-MLC"  // best balance for AMD iGPU
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

// ===== 6) Chat flow (non-streaming, timeout, trimmed history) =====
const history = []; // only user/assistant pairs (never put system here)

async function askLLM(userMsg){
  const ctx = retrieveContext(userMsg);

  if (KB_ONLY) {
    // If KB has nothing relevant, fail fast with a helpful line
    const noCtx = !ctx || !ctx.trim() || ctx.startsWith('### PvP Theory') && !CORPUS.length;
    if (noCtx) {
      return "I don’t have that in my knowledge yet. Tell me your fruit/playstyle or add it to the KB, then ask again.";
    }
  }

  const trimmedHistory = KEEP_TURNS > 0 ? history.slice(-KEEP_TURNS * 2) : [];
  const messages = [
    { role: 'system', content: `${SYSTEM}\n\nContext:\n${ctx}` },
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
      return "Yo, that took too long on this GPU. Ask a shorter question or close heavy tabs and try again.";
    }
    console.error(err);
    ui.status('❌ Error');
    return 'Error while thinking. Open Console (F12) and send me the first red line.';
  }
}

// ===== 7) Send button =====
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
