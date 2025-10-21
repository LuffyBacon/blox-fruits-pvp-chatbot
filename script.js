import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

const msgsEl = document.getElementById('msgs');
const form = document.getElementById('form');
const input = document.getElementById('q');
const goBtn = document.getElementById('go');

const ui = {
  add(role, content){
    const div = document.createElement('div');
    div.className = `msg ${role==='user'?'me':'bot'}`;
    div.textContent = content;
    msgsEl.appendChild(div);
    msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: 'smooth' });
  }
};

// Load KB JSON
const KB = await fetch('./kb/blox_pvp.json').then(r=>r.json());

// Simple keyword retrieval over combos/counters/matchups + theory
function retrieveContext(query, k=6){
  const q = query.toLowerCase();
  const blocks = [];
  const push = (title, text) => blocks.push(`### ${title}\n${text}`);

  // Combos
  for (const c of KB.combos||[]){
    const hay = `${c.title} ${c.tag||''} ${(c.inputs||[]).join(' ')}`.toLowerCase();
    const hit = ['dough','buddha','portal','sand','ice','kitsune','gas','dragon','gravity','eclaw','yama','bomb','shark','trident','sanguine']
      .some(k => q.includes(k) && hay.includes(k));
    if (hit) push(`Combo: ${c.title}`,
      `Starter: ${c.starter||'-'}\nInputs: ${(c.inputs||[]).join(' → ')}\nNotes: ${(c.notes||[]).join(' | ')}`);
  }
  // Counters
  for (const ct of KB.counters||[]){
    if (q.includes(ct.enemy.toLowerCase())){
      push(`Counter vs ${ct.enemy}`,
        `Use: ${(ct.use||[]).join(', ')}\nTips: ${(ct.tips||[]).join(' | ')}`);
    }
  }
  // Matchups
  for (const m of KB.matchups||[]){
    const pair = `${m.mine} ${m.theirs}`.toLowerCase();
    if (q.includes(m.mine.toLowerCase()) && q.includes(m.theirs.toLowerCase())){
      push(`Matchup ${m.mine} vs ${m.theirs}`, `Plan: ${(m.plan||[]).join(' | ')}`);
    }
  }
  // Theory fallback
  if (blocks.length<k && KB.guides?.theory) push('PvP Theory', KB.guides.theory.slice(0,1200));
  return blocks.slice(0,k).join('\n\n');
}

// === System style (your tone + greeting) ===
const SYSTEM = `You are the Blox Fruits PvP Assistant. Tone: friendly gamer coach (fun, clean language).
Rules:
- Prefer facts from the provided KB context first.
- For combos: show inputs with arrows (→), a starter, and 1 ping tip if useful.
- For counters: give 2–3 clear actions and a punish window.
- Be concise for simple asks; go deeper for complex ones.
- If missing data, say what you do know and ask for a tiny follow-up (e.g., “PC or Mobile?”).
`;

ui.add('assistant', "Yo bro! I'm your PvP chatbot specificially designed for Blox Fruits! You can ask me for any help you want.");

const engine = await CreateMLCEngine('Llama-3.2-1B-Instruct-q4f16_1', {
  initProgressCallback: p => { if (p?.text) ui.add('assistant', p.text); }
});

const history = [{ role:'system', content: SYSTEM }];

async function askLLM(userMsg){
  const context = retrieveContext(userMsg, 6);
  const messages = [
    ...history,
    { role:'system', content: `KB Context (use this first):\n${context}` },
    { role:'user', content: userMsg }
  ];
  let reply = '';
  for await (const chunk of engine.chat.completions.create({ messages, stream: true })){
    const d = chunk.choices?.[0]?.delta?.content;
    if (d){ reply += d; }
  }
  history.push({ role:'user', content: userMsg });
  history.push({ role:'assistant', content: reply });
  return reply;
}

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const q = input.value.trim(); if (!q) return;
  ui.add('user', q); input.value = ''; goBtn.disabled = true;
  try {
    const a = await askLLM(q);
    ui.add('assistant', a);
  } catch (err) {
    ui.add('assistant', 'Error: ' + (err?.message || err));
  } finally {
    goBtn.disabled = false;
  }
});
