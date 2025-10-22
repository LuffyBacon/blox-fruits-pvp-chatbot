// Blox GPT — fast, accurate, with proper long-form elaboration

document.addEventListener("DOMContentLoaded", init);

function init() {
  const chatBox = gid("chat-box");
  const input   = gid("user-input");
  const sendBtn = gid("send-btn");
  if (!chatBox || !input || !sendBtn) {
    console.error("Blox GPT: missing DOM nodes", {chatBox, input, sendBtn});
    return;
  }
  sendBtn.type = "button";

  // ---------- UI helpers ----------
  function addMessage(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
  }
  function addTyping() {
    const t = document.createElement("div");
    t.className = "msg bot";
    t.textContent = "…";
    chatBox.appendChild(t);
    chatBox.scrollTop = chatBox.scrollHeight;
    return () => t.remove();
  }

  // Send very long answers safely (no getting cut off)
  // It splits by paragraphs/chunks and appends all of them.
  async function sendLong(text, chunkSize = 1200, delay = 30) {
    const chunks = splitIntoChunks(text, chunkSize);
    for (const part of chunks) {
      addMessage("bot", part);
      // small delay so the browser paints smoothly on huge replies
      await sleep(delay);
    }
  }
  function splitIntoChunks(s, max) {
    // Prefer paragraph boundaries
    const paras = s.split(/\n{2,}/);
    const out = [];
    let buf = "";
    for (const p of paras) {
      if ((buf + "\n\n" + p).length <= max) {
        buf = buf ? buf + "\n\n" + p : p;
      } else {
        if (buf) out.push(buf);
        if (p.length <= max) {
          out.push(p);
          buf = "";
        } else {
          // hard split very long paragraphs
          for (let i = 0; i < p.length; i += max) {
            out.push(p.slice(i, i + max));
          }
          buf = "";
        }
      }
    }
    if (buf) out.push(buf);
    return out.length ? out : [s];
  }
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

  // ---------- Rules / system hints ----------
  const SYSTEM = `
You are Blox GPT, a friendly Blox Fruits PvP mentor.
Accuracy rules:
• Aura/Haki: lets you hit Elementals; it does NOT buff damage.
• Instinct (Ken): helps dodging/reading; no stat buff.
• Ken Tricking: toggle ON/OFF with timing to survive multi-hits; punish endlag.
• Portal cannot “talk to others”; focus on mobility/rifts/traps.
Default: short & actionable. If user says “elaborate / explain more”, switch to long mode.
`.trim();

  // ---------- Optional KB ----------
  let KB = { combos:[], counters:[], builds:[], guides:{} };
  (async () => {
    try {
      const r = await fetch("./kb/blox_pvp.json", { cache: "no-store" });
      if (r.ok) KB = await r.json();
    } catch {}
  })();

  const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  function makeCorpus(){
    const C = [];
    (KB.combos||[]).forEach(c=>{
      C.push({
        title:`Combo: ${c.title}`,
        text:`${(c.inputs||[]).join(" → ")} | ${(c.notes||[]).join(" | ")}`,
        key: norm(`${c.title} ${(c.inputs||[]).join(" ")} ${(c.notes||[]).join(" ")}`)
      });
    });
    (KB.counters||[]).forEach(ct=>{
      C.push({ title:`Counter vs ${ct.enemy||"?"}`, text:(ct.tips||[]).join(" | "), key:norm(`${ct.enemy} ${(ct.tips||[]).join(" ")}`) });
    });
    (KB.builds||[]).forEach(b=>{
      C.push({ title:`Build: ${b.label||"?"}`, text:(b.notes||[]).join(" | "), key:norm(`${b.label} ${(b.notes||[]).join(" ")}`) });
    });
    if (KB.guides?.theory) C.push({ title:"PvP Theory", text:KB.guides.theory, key:norm(KB.guides.theory) });
    return C;
  }
  function retrieve(q, k=5){
    const C = makeCorpus();
    const n = norm(q);
    const hits = C.filter(x=>x.key.includes(n)).slice(0,k);
    if (!hits.length && KB.guides?.theory) return `Context — PvP Theory: ${KB.guides.theory}`;
    return hits.map(h => `• ${h.title}: ${h.text}`).join("\n");
  }

  // ---------- Reply engine ----------
  let lastIntent = null;
  let longMode   = false; // turns on when user asks to elaborate

  const N = s => (s||"").toLowerCase();

  function replyShort(qRaw) {
    const q = N(qRaw);

    // sanity guards
    if (/sprite\b/.test(q)) return "There’s no Sprite race in Blox Fruits. Valid races include Angel, Cyborg, Draco, Ghoul, Rabbit.";
    if (/haki|aura/.test(q)) return "Aura (Haki) lets you hit Elemental users — it doesn’t add damage. Keep it on for PvP.";
    if (/instinct\b/.test(q) && !/ken|trick/.test(q)) return "Instinct helps dodging/reading. Use **Ken Tricking** (toggle ON/OFF with timing) to survive combos.";

    // greeting
    if (/(yo|hey|hello|hi|wsp|sup)\b/.test(q)) {
      lastIntent = "greet";
      return "Yo! Wanna work on **combos**, **counters**, **Ken Tricking**, or **playstyles**?";
    }

    // playstyles
    if (/(passive|aggressive)(.*playstyle|style)?/.test(q)) {
      lastIntent = "playstyles";
      return [
        "🔥 **Passive vs Aggressive**",
        "• **Aggressive**: Rushdown. Fast starters, break Ken, punish endlag.",
        "• **Passive**: Bait & punish. Keep spacing, poke, counter on whiff.",
        "Say **elaborate** for drills & examples."
      ].join("\n");
    }

    // Ken Tricking
    if (/ken.?trick|instinct trick|teach.*ken/.test(q)) {
      lastIntent = "kentrick";
      return [
        "⚡ **Ken Tricking (basics)**",
        "1) Instinct **OFF**.",
        "2) Toggle **ON** right as a multi-hit/stun begins.",
        "3) Toggle **OFF** instantly to save dodges.",
        "4) Counter during endlag (e.g., GH Z → C → X).",
        "Say **elaborate** for advanced timing."
      ].join("\n");
    }

    // combos
    if (/combo|route/.test(q) || /portal.*combo/.test(q)) {
      lastIntent = "combos";
      if (/portal/.test(q)) {
        return [
          "🌀 **Portal (mobile-friendly)**",
          "Portal **Z** → Shark Anchor **Z** → Sanguine **Z** → **C** → **X**",
          "Tip: keep camera level after Anchor Z so Sanguine connects.",
          "Say **elaborate** for more routes."
        ].join("\n");
      }
      const ctx = retrieve(q);
      if (ctx) return `⚔️ **Combos from KB**\n${ctx}\nSay **elaborate** for more.`;
      return [
        "⚔️ **Try these**",
        "• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X",
        "• Ice V → Unawakened Ice C → Ice Z → GH X → GH Z → GH C",
        "Say **elaborate** for fruit-specific routes."
      ].join("\n");
    }

    // counters
    if (/counter|how to beat|how do i beat|\bvs\b/.test(q)) {
      lastIntent = "counters";
      if (/\bbuddha\b/.test(q)) return "🙏 **Vs Buddha** — stay out of M1 range; poke from distance; air-camp if needed; punish Z endlag. Say **elaborate** for more.";
      if (/\bdough\b/.test(q))  return "🍩 **Vs Dough** — stay airborne; use Cyborg V4 Aftershock to interrupt; punish animation endlag. Say **elaborate**.";
      if (/\bice\b/.test(q))    return "❄️ **Vs Ice** — avoid ground trades; fight in air; punish missed Z/V with Trident X or GH Z. Say **elaborate**.";
      if (/\bportal\b/.test(q)) return "🌀 **Vs Portal** — don’t chase teleports; hold starter for Rift recovery; punish missed V trap. Say **elaborate**.";

      const ctx = retrieve(q);
      if (ctx) return `From KB:\n${ctx}\nSay **elaborate** for a longer breakdown.`;
      return "Who you fighting — **Buddha**, **Dough**, **Ice**, **Portal**, or someone else?";
    }

    // builds
    if (/build|stat|distribution|accessor|gear/.test(q)) {
      const ctx = retrieve("build");
      return ctx || "Rule of thumb: Max your main damage stat (Fruit/Sword/Gun) + Melee (energy) + Defense (HP). Accessories for mobility/dodges.";
    }

    // thanks/banter
    if (/(thanks|thank you|ur cool|you're cool|nice|love u)/.test(q)) {
      lastIntent = "nice";
      return "Respect 😎 — what should we optimize next?";
    }

    // default
    lastIntent = "misc";
    return "Bet bro 💪 ask me about **combos**, **counters**, **Ken Tricking**, or **playstyles**. Say **elaborate** to go deep.";
  }

  // Long content for elaborate answers (not cut off)
  function replyLong() {
    switch (lastIntent) {
      case "kentrick":
        return [
"⚡ **Ken Tricking — Advanced Guide**",
"",
"**Core idea**: You’re timing Instinct toggles to absorb the scary hits, then turning it off ASAP to save dodges and open a punish window.",
"",
"**When to toggle**",
"• Multi-hit stuns (Dough V, Dragon C, Ice V, Rumble moves): Toggle **ON** as the first hit connects; the early hits are your shield.",
"• Big AoEs: Toggle **ON** slightly before impact sound/flash; practice the visual cue.",
"• Single heavy hit: Toggle **ON** right before contact; if you’re late, don’t panic—disengage and reset.",
"",
"**Punish windows**",
"• After they miss Dough C/V or Dragon C: dash-cancel forward → **Trident X** or **GH Z → C → X**.",
"• If their combo drops (Instinct broken): fast starter (**Trident X**, **EClaw C**).",
"• Keep your finisher ready; don’t over-extend if their dodges reset.",
"",
"**Anti-Ken tips**",
"• **Cyborg V4 Aftershock** can disrupt Ken loops—use it to break pressure.",
"• Delay your starter to bait their toggle, then catch the recovery.",
"• Don’t spam Instinct; conserve for key moments.",
"",
"**Practice routine**",
"1) 10 rounds vs Dough friend: only try to survive Dough V/C with Ken Tricking—no counters.",
"2) 10 rounds vs Ice friend: practice dodging V then punishing Z endlag.",
"3) Review 1 mistake per round; focus on timing instead of spamming."
        ].join("\n");

      case "playstyles":
        return [
"🧩 **Passive vs Aggressive — Deep Dive & Drills**",
"",
"**Aggressive (Rushdown)**",
"• Goal: break Ken early, force panic, end fights quickly.",
"• Starters: **Trident X**, **GH Z**, **Anchor Z**, fruit stuns that travel fast.",
"• Path: Starter → extender → finisher. Keep cooldown awareness; don’t whiff.",
"",
"**Passive (Control/Punish)**",
"• Goal: make them swing first, then punish endlag.",
"• Tools: Range pokes, quick dashes, air-camping vs ground fruits.",
"• Watch for over-extensions and missed teleports.",
"",
"**Mixing both**",
"• Open passive to read them; switch aggressive after a big whiff.",
"• Surprise tempo switches win rounds at higher bounty.",
"",
"**Drills**",
"• Aggro drill (10 rounds): you must engage first every round; focus on clean starters only.",
"• Passive drill (10 rounds): you cannot use first strike; only counters after whiffs.",
"• Review: 1 mistake per round, fix it next time (late punish, greedy extend, missed bait)."
        ].join("\n");

      case "combos":
        return [
"⚔️ **Combo Catalog — Extended**",
"",
"**Mobile-friendly Portal**",
"• Portal Z → Anchor Z → Sanguine Z → C → X  (keep camera level after Anchor Z).",
"",
"**Sand Route**",
"• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X.",
"• Tip: Start from mid-range so Sand C lands clean before V.",
"",
"**Ice Route**",
"• Ice V → Unawakened Ice C → Ice Z → GH X → GH Z → GH C.",
"• Tip: Go airborne after Ice V against grounded enemies to avoid trades.",
"",
"**DT + Dough + EClaw**",
"• DT X → Dough V → Dough X → Dough C → EClaw C → EClaw X.",
"• Tip: look down for Dough C then up for EClaw C to keep tracking."
        ].join("\n");

      case "counters":
        return [
"🛡️ **Counterplay Pack — Extended**",
"",
"**Vs Buddha**",
"• Don’t brawl in M1 range—control space, poke, and punish Z endlag.",
"• If they chase, move vertical (air-camp) and force whiffs.",
"",
"**Vs Dough**",
"• Stay airborne—many routes are ground-centric.",
"• **Cyborg V4 Aftershock** can break combo pressure.",
"• Wait for C/V endlag and start with Trident X or GH Z.",
"",
"**Vs Ice**",
"• Avoid ground trades; fight in the air.",
"• Punish missed V/Z with fast starters.",
"",
"**Vs Portal**",
"• Don’t chase teleports. Hold your starter for Rift recovery.",
"• If V trap misses, that’s your punish moment.",
"",
"General: watch cooldowns, count dodges, and never chase when your finisher is down."
        ].join("\n");

      default:
        return "Tell me what to elaborate on — **Ken Tricking**, **playstyles**, **combos**, or **counters**.";
    }
  }

  // ---------- Send logic ----------
  async function sendNow() {
    const text = (input.value || "").trim();
    if (!text) return;
    addMessage("user", text);
    input.value = "";
    const done = addTyping();

    // detect explicit request for elaboration
    const lower = text.toLowerCase();
    if (/elaborate|explain more|go deeper|more detail|details|in depth/.test(lower)) {
      longMode = true;
    }

    setTimeout(async () => {
      done();
      // short first, then long if requested
      if (longMode) {
        const longText = replyLong();
        longMode = false; // reset after one long answer
        await sendLong(longText); // guarantee full delivery (no cut off)
      } else {
        const out = replyShort(text);
        addMessage("bot", out);
      }
    }, 100);
  }

  sendBtn.addEventListener("click", sendNow);
  input.addEventListener("keydown", e => { if (e.key === "Enter") sendNow(); });
}

function gid(id){ return document.getElementById(id); }
