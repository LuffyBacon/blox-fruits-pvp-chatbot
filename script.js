// Blox GPT — fast, accurate, KB-guided (no heavy model needed)

// Wait for DOM (defer already helps; this is double-safe)
document.addEventListener("DOMContentLoaded", init);

function init() {
  const chatBox = byId("chat-box");
  const input   = byId("user-input");
  const sendBtn = byId("send-btn");
  if (!chatBox || !input || !sendBtn) {
    console.error("Blox GPT: missing DOM nodes", {chatBox, input, sendBtn});
    return;
  }
  sendBtn.type = "button";

  // UI helpers
  function addMessage(role, text){
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  function addTyping(){
    const t = document.createElement("div");
    t.className = "msg bot";
    t.textContent = "…";
    chatBox.appendChild(t);
    chatBox.scrollTop = chatBox.scrollHeight;
    return () => t.remove();
  }

  // ----- System accuracy rules (used by reply engine) -----
  const SYSTEM = `
  You are Blox GPT, a friendly Blox Fruits PvP mentor.
  Be clear, short, and correct:
  • Aura/Haki: only lets you hit Elementals; does NOT add damage.
  • Instinct (Ken): about dodging/reading; no stat buff.
  • Ken Tricking: toggle ON/OFF with timing to survive combos, then punish endlag.
  • Portal cannot “talk to others”; stick to mobility, rifts, traps.
  Give quick steps + 1 tip; go deeper only if asked to “elaborate”.
  `;

  // ----- Load Knowledge Base if present (non-blocking) -----
  let KB = { combos:[], counters:[], builds:[], guides:{} };
  (async () => {
    try{
      const r = await fetch("./kb/blox_pvp.json", { cache: "no-store" });
      if (r.ok) KB = await r.json();
    }catch{ /* ok if missing */ }
  })();

  // Build lightweight searchable corpus each call (small + fast)
  const normalize = s => (s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  function makeCorpus(){
    const C = [];
    (KB.combos||[]).forEach(c=>{
      C.push({
        title:`Combo: ${c.title}`,
        text:`${(c.inputs||[]).join(" → ")} | ${(c.notes||[]).join(" | ")}`,
        key: normalize(`${c.title} ${(c.inputs||[]).join(" ")} ${(c.notes||[]).join(" ")}`)
      });
    });
    (KB.counters||[]).forEach(ct=>{
      C.push({
        title:`Counter vs ${ct.enemy||"?"}`,
        text:(ct.tips||[]).join(" | "),
        key: normalize(`${ct.enemy} ${(ct.tips||[]).join(" ")}`)
      });
    });
    (KB.builds||[]).forEach(b=>{
      C.push({
        title:`Build: ${b.label||"?"}`,
        text:(b.notes||[]).join(" | "),
        key: normalize(`${b.label} ${(b.notes||[]).join(" ")}`)
      });
    });
    if (KB.guides?.theory){
      C.push({title:"PvP Theory", text:KB.guides.theory, key: normalize(KB.guides.theory)});
    }
    return C;
  }
  function retrieve(q, k=4){
    const C = makeCorpus();
    const n = normalize(q);
    const hits = C.filter(x=>x.key.includes(n)).slice(0,k);
    if (!hits.length && KB.guides?.theory) {
      return `Context — PvP Theory: ${KB.guides.theory.slice(0,600)}`;
    }
    return hits.map(h => `${h.title}: ${h.text}`).join("\n");
  }

  // ----- Reply engine (fast intents + guards) -----
  let lastIntent = null;
  const N = s => (s||"").toLowerCase();

  function reply(userRaw){
    const q = N(userRaw);

    // correctness guards
    if (/sprite\b/.test(q)) return "There’s no Sprite race in Blox Fruits. Stick to Angel, Cyborg, Draco, Ghoul, Rabbit, etc.";
    if (/haki|aura/.test(q)) return "Aura (Haki) lets you hit Elemental users — it doesn’t add damage. Keep it on to bypass Elementals in PvP.";
    if (/instinct\b/.test(q) && !/ken|trick/.test(q)) return "Instinct helps with dodging/reading. Use **Ken Tricking** (toggle ON/OFF with timing) to survive combos and escape.";

    // small talk
    if (/(yo|hey|hello|hi|wsp|sup)\b/.test(q)){
      lastIntent = "greet";
      return "Yo! Wanna work on **combos**, **counters**, **Ken Tricking**, or **playstyle drills**?";
    }
    if (/(thanks|thank you|ur cool|you're cool|nice|love u)/.test(q)){
      lastIntent = "nice";
      return "Appreciate it 😎 now let’s cook some PvP wins.";
    }

    // playstyles
    if (/(passive|aggressive)(.*playstyle|style)?/.test(q)){
      lastIntent = "playstyles";
      return [
        "🔥 **Passive vs Aggressive**",
        "• **Aggressive**: Rushdown. Fast starters, break Ken, punish endlag.",
        "• **Passive**: Bait & punish. Keep range, poke, then counter on whiff.",
        "👉 Mix both mid-fight so you’re unpredictable."
      ].join("\n");
    }

    // Ken Tricking
    if (/ken.?trick|instinct trick|teach.*ken/.test(q)){
      lastIntent = "kentrick";
      return [
        "⚡ **Ken Tricking (how-to)**",
        "1) Keep Instinct **OFF**.",
        "2) Toggle **ON** right as a multi-hit/stun starts (absorb safely).",
        "3) Toggle **OFF** instantly to save dodges.",
        "4) Counter during endlag (e.g., GH Z → C → X).",
        "Practice vs Dough V / Ice V / Rumble to learn timings."
      ].join("\n");
    }

    // elaborate
    if (/elaborate|more detail|go deeper|explain more|detail/.test(q)){
      if (lastIntent === "kentrick"){
        return [
          "💥 **Ken Tricking — deeper**",
          "• Read animation/sound cues; don’t spam toggles.",
          "• Time for big AoEs (Dragon C / Dough V).",
          "• After a baited hit: dash-cancel → starter (Trident X / GH Z).",
          "• Cyborg V4 breaks Ken loops — disengage & reset spacing."
        ].join("\n");
      }
      if (lastIntent === "playstyles"){
        return [
          "🧩 **Drills**",
          "• Aggro: 10 rounds first-engage & punish every endlag.",
          "• Passive: 10 rounds react-only; no first strike.",
          "• Review 1 mistake per round and fix it next."
        ].join("\n");
      }
      return "Tell me what to go deeper on — **Ken Tricking**, **playstyles**, **combos**, or **counters**?";
    }

    // combos
    if (/combo|route/.test(q) || /portal.*combo/.test(q)){
      lastIntent = "combos";
      if (/portal/.test(q)){
        return [
          "🌀 **Portal (mobile-friendly)**",
          "Portal **Z** → Shark Anchor **Z** → Sanguine **Z** → **C** → **X**",
          "Tip: keep camera level after Anchor Z so Sanguine connects clean."
        ].join("\n");
      }
      const ctx = retrieve(q);
      if (ctx) return `⚔️ **Combos**\n${ctx}\nAsk your fruit and I’ll tailor it.`;
      return [
        "⚔️ **Try these**",
        "• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X",
        "• Ice V → Unawakened Ice C → Ice Z → GH X → GH Z → GH C",
        "• DT X → Dough V → Dough X → Dough C → EClaw C → EClaw X",
        "Say your fruit and I’ll tailor it."
      ].join("\n");
    }

    // counters
    if (/counter|how to beat|how do i beat|\bvs\b/.test(q)){
      lastIntent = "counters";
      if (/\bbuddha\b/.test(q)) return "🙏 **Vs Buddha** — stay out of M1 range; poke from distance; air-camp if needed; punish Z endlag. Don’t chase — make them whiff first.";
      if (/\bdough\b/.test(q))  return "🍩 **Vs Dough** — stay airborne (many routes are ground-based). Use Cyborg V4 Aftershock to interrupt; punish animation endlag.";
      if (/\bice\b/.test(q))    return "❄️ **Vs Ice** — avoid ground trades; fight in air; punish missed Z/V with a fast starter (Trident X / GH Z).";
      if (/\bportal\b/.test(q)) return "🌀 **Vs Portal** — don’t chase teleports; hold starter for Rift recovery; punish after missed V trap.";
      const ctx = retrieve(q);
      if (ctx) return ctx;
      return "Who you fighting — **Buddha**, **Dough**, **Ice**, **Portal**, or someone else?";
    }

    // builds / gear
    if (/build|stat|distribution|accessor|gear/.test(q)){
      const ctx = retrieve("build");
      return ctx || "Rule of thumb: Max your main damage stat (Fruit/Sword/Gun) + Melee (energy) + Defense (HP). Pick accessories for mobility/dodges.";
    }

    // default
    lastIntent = "misc";
    return "Bet bro 💪 ask me about **combos**, **counters**, **Ken Tricking**, or **playstyles**. Say your **fruit/race** and I’ll tailor it.";
  }

  // ----- wiring -----
  function sendNow(){
    const text = (input.value||"").trim();
    if (!text) return;
    addMessage("user", text);
    input.value = "";
    const done = addTyping();
    setTimeout(()=>{ // tiny vibe delay
      const _ = SYSTEM; // (kept for clarity)
      const out = reply(text);
      done();
      addMessage("bot", out);
    }, 120);
  }
  byId("send-btn").addEventListener("click", sendNow);
  byId("user-input").addEventListener("keydown", e => { if (e.key === "Enter") sendNow(); });
}

function byId(id){ return document.getElementById(id); }

