import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

const msgsEl = document.getElementById('msgs');
const input  = document.getElementById('q');
const goBtn  = document.getElementById('go');
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
  ui.status('⚠️ WebGPU not available. Use latest Chrome or Edge on desktop.');
  goBtn.disabled = true; throw new Error('WebGPU not available');
}

// 1) Load KB
let KB = { combos:[], counters:[], matchups:[], guides:{} };
try {
  const r = await fetch('./kb/blox_pvp.json');
  if (!r.ok) throw new Error('kb/blox_pvp.json not found');
  KB = await r.json();
  ui.status('KB loaded. Initializing model (first load downloads files)…');
} catch (e) {
  ui.status('❌ Error loading KB: '+e.message);
  goBtn.disabled = true; throw e;
}

// 2) Simple retrieval
function retrieveContext(query, k=6){
  const q = query.toLowerCase(), blocks=[];
  const push = (title, text)=>blocks.push(`### ${title}\n${text}`);
  for (const c of KB.combos||[]){
    const hay = `${c.title} ${c.tag||''} ${(c.inputs||[]).join(' ')}`.toLowerCase();
    const keys = ['dough','buddha','portal','sand','ice','kitsune','gas','dragon','gravity','eclaw','yama','bomb','shark','trident','sanguine'];
    if (keys.some(k=>q.includes(k)&&hay.includes(k))){
      push(`Combo: ${c.title}`, `Starter: ${c.starter||'-'}\nInputs: ${(c.inputs||[]).join(' → ')}\nNotes: ${(c.notes||[]).join(' | ')}`);
    }
  }
  for (const ct of KB.counters||[]){
    if (q.includes((ct.enemy||'').toLowerCase())){
      push(`Counter vs ${ct.enemy}`, `Use: ${(ct.use||[]).join(', ')}\nTips: ${(ct.tips||[]).join(' | ')}`);
    }
  }
  for (const m of KB.matchups||[]){
    if (q.includes((m.mine||'').toLowerCase()) && q.includes((m.theirs||'').toLowerCase())){
      push(`Matchup ${m.mine} vs ${m.theirs}`, `Plan: ${(m.plan||[]).join(' | ')}`);
    }
  }
  if (blocks.length<k && KB.guides?.theory) push('PvP Theory', KB.guides.theory.slice(0,1200));
  return blocks.slice(0,k).join('\n\n');
}

// 3) System + greeting
const SYSTEM = `You are the Blox Fruits PvP Assistant. Tone: friendly gamer coach (fun, clean).
- Prefer the KB context first.
- Combos: show inputs with arrows (→), a starter, and one ping tip if useful.
- Counters: 2–3 actions + punish window.
- Be concise for simple asks; deeper for complex.
- If missing data, say what you do know and ask a tiny follow-up.`;

ui.add('assistant', "Yo bro! I'm your PvP chatbot specificially designed for Blox Fruits! You can ask me for any help you want.");

// 4) Initialize model (smaller model = faster load)
let engine;
const MODEL_CANDIDATES = [
  // very small, loads quick
  'Phi-3-mini-4k-instruct-q4f16_1-MLC',
  // fallback if first fails
  'Llama-3.2-1B-Instruct-q4f16_1-MLC'
];

async function initModel(){
  for (const name of MODEL_CANDIDATES){
    try {
      ui.status(`Downloading model: ${name} …`);
      const t0 = performance.now();
      engine = await CreateMLCEngine(name, {
        initProgressCallback: p => { if (p?.text) ui.status(`${name}: ${p.text}`); },
      });
      ui.status(`✅ Model ready (${name}) in ${Math.round((performance.now()-t0)/1000)}s. Ask anything!`);
      return;
    } catch (e) {
      console.warn('model failed:', name, e);
    }
  }
  throw new Error('All model candidates failed to initialize.');
}

try { await initModel(); } 
catch (e) { ui.status('❌ Failed to init model: '+(e?.message||e)); goBtn.disabled = true; throw e; }

const history = [{ role:'system', content: SYSTEM }];

async function askLLM(userMsg){
  const context = retrieveContext(userMsg, 6);
  const messages = [
    ...history,
    { role:'system', content: `KB Context (use this first):\n${context}` },
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

// 5) Button handler
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

