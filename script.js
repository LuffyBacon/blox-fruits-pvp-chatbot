<script>
// === Blox GPT — smart replies (no AI, no lag) ===
const chatBox = document.getElementById("chat-box");
const input   = document.getElementById("user-input");
const btn     = document.getElementById("send-btn");

function addMessage(role, text){
  const div = document.createElement("div");
  div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Tiny intent engine
let lastIntent = null;
const N = s => (s||"").toLowerCase();

function replyFor(raw){
  const q = N(raw);

  // greetings / small talk
  if (/(yo|yoo|wsp|sup|hello|hey|hi)\b/.test(q)){ lastIntent='greet'; return "Yo! Wanna work on combos, counters, or playstyle drills?"; }
  if (/(thanks|thank you|ur cool|you're cool|nice|love u)/.test(q)){ lastIntent='nice'; return "Appreciate it 😎 now let’s cook some PvP wins."; }

  // playstyles
  if (/(passive|aggressive)(.*playstyle|style)?/.test(q)){
    lastIntent='playstyles';
    return [
      "🔥 Passive vs Aggressive:",
      "• Aggressive → Rushdown. Fast starters, break Ken, punish endlag.",
      "• Passive → Bait & punish. Keep range, poke, then counter on whiff.",
      "👉 Mix both mid-fight so you’re unpredictable."
    ].join("\n");
  }

  // Ken Tricking
  if (/ken.?trick|instinct trick|teach.*ken/.test(q)){
    lastIntent='kentrick';
    return [
      "⚡ Ken Tricking (how):",
      "1) Keep Instinct OFF.",
      "2) Toggle ON right as a multi-hit/stun starts to absorb safely.",
      "3) Toggle OFF instantly to save dodges.",
      "4) Counter during endlag (e.g., GH Z → C → X).",
      "Practice vs Dough V / Ice V / Rumble to learn timings."
    ].join("\n");
  }

  // elaborate
  if (/elaborate|more detail|go deeper|explain more|detail/.test(q)){
    if (lastIntent==='kentrick'){
      return [
        "💥 Ken Tricking — deeper:",
        "• Watch animation/sound cues; don’t spam toggles.",
        "• Time it for big AoEs like Dragon C / Dough V.",
        "• After baited hit: dash-cancel → starter to punish.",
        "• Cyborg V4 can break Ken loops — disengage & reset."
      ].join("\n");
    }
    if (lastIntent==='playstyles'){
      return [
        "🧩 Playstyle drills:",
        "• Aggro: 10 rounds where you must first-engage & punish endlag.",
        "• Passive: 10 rounds only reacting — no first strike.",
        "• Review 1 mistake per round and fix it next round."
      ].join("\n");
    }
    return "Tell me what to go deeper on — Ken Tricking, playstyles, combos, or counters?";
  }

  // combos
  if (/combo|route/.test(q) || /portal.*combo/.test(q)){
    lastIntent='combos';
    if (/portal/.test(q)){
      return [
        "🌀 Portal (mobile-friendly):",
        "Portal Z → Shark Anchor Z → Sanguine Z → Sanguine C → Sanguine X",
        "Tip: Keep camera level after Anchor Z so Sanguine connects clean."
      ].join("\n");
    }
    return [
      "⚔️ Try these routes:",
      "• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X",
      "• Ice V → Unawakened Ice C → Ice Z → GH X → GH Z → GH C",
      "• DT X → Dough V → Dough X → Dough C → EClaw C → EClaw X",
      "Say your fruit and I’ll tailor it."
    ].join("\n");
  }

  // counters
  if (/counter|how to beat|how do i beat|\bvs\b/.test(q)){
    lastIntent='counters';
    if (/\bbuddha\b/.test(q)){
      return [
        "🙏 Vs Buddha:",
        "• Stay out of M1 range; poke from distance.",
        "• Air-camp when needed; punish after Z endlag.",
        "• Don’t chase — make them whiff first."
      ].join("\n");
    }
    if (/\bdough\b/.test(q)){
      return [
        "🍩 Vs Dough:",
        "• Stay airborne — many routes are ground-based.",
        "• Cyborg V4 Aftershock can interrupt.",
        "• Wait for animation endlag, then punish fast."
      ].join("\n");
    }
    return "Who you fighting — Buddha, Dough, Ice, or someone else?";
  }

  // accuracy guards
  if (/(sprite|balanced team)/.test(q)) return "There’s no Sprite race, and PvP is 1v1 — builds & execution matter.";
  if (/(haki|instinct)/.test(q)) return "Aura (Haki) lets you hit Elemental users; it doesn’t add damage. Instinct helps Ken Tricking/dodging, not power.";

  // fallback
  lastIntent='misc';
  return "Bet bro 💪 ask me about combos, counters, Ken Tricking, or playstyles to get started!";
}

function sendNow(){
  const t = input.value.trim(); if(!t) return;
  addMessage('user', t); input.value = '';
  const out = replyFor(t);
  setTimeout(()=> addMessage('bot', out), 120); // tiny delay for vibe
}

btn.addEventListener('click', sendNow);
input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendNow(); });
</script>
