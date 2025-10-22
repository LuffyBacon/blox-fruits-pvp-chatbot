/* Blox GPT — freeform, entity-aware PvP coach
   - Flexible NLP: detects fruits/races/styles/weapons with synonyms
   - Handles: "counter X", "vs X", "how to use X", "best build for X", "tips for X"
   - Deep mode + elaborate for long, chunked replies
   - Uses kb/blox_pvp.json if present
*/

document.addEventListener("DOMContentLoaded", init);

function init() {
  const chat = gid("chat-box");
  const input = gid("user-input");
  const sendBtn = gid("send-btn");
  if (!chat || !input || !sendBtn) return console.error("Missing DOM");
  sendBtn.type = "button";

  // ===== UI =====
  function add(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }
  function typing() {
    const t = add("bot", "…");
    return () => t.remove();
  }
  async function sayLong(full, chunk = 1200, delay = 18) {
    const parts = chunkByParas(full, chunk);
    for (const p of parts) {
      add("bot", p);
      await sleep(delay);
    }
  }
  function chunkByParas(s, max) {
    const paras = s.split(/\n{2,}/);
    const out = [];
    let buf = "";
    for (const p of paras) {
      if ((buf + "\n\n" + p).length <= max) buf = buf ? buf + "\n\n" + p : p;
      else {
        if (buf) out.push(buf);
        if (p.length <= max) out.push(p);
        else for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
        buf = "";
      }
    }
    if (buf) out.push(buf);
    return out.length ? out : [s];
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ===== KB (optional) =====
  let KB = { combos: [], counters: [], builds: [], guides: {} };
  (async () => {
    try {
      const r = await fetch("./kb/blox_pvp.json", { cache: "no-store" });
      if (r.ok) KB = await r.json();
    } catch {}
  })();

  // ===== Lexicon & synonyms =====
  // Canonical -> synonyms (all lowercase)
  const LEX = {
    // fruits
    "buddha": ["buddha"],
    "dough": ["dough", "doe", "doh"],
    "ice": ["ice"],
    "portal": ["portal"],
    "kitsune": ["kitsune", "fox"],
    "sand": ["sand"],
    "dragon": ["dragon"],
    "gas": ["gas"],
    "bomb": ["bomb"],
    "gravity": ["gravity", "grav"],
    "blizzard": ["blizzard"],
    "venom": ["venom"],
    "dark": ["dark"],
    "quake": ["quake"],
    "rumble": ["rumble"],
    // styles
    "godhuman": ["godhuman", "gh"],
    "sanguine art": ["sanguine", "sanguine art"],
    "electric claw": ["eclaw", "electric claw", "e-claw"],
    "superhuman": ["superhuman"],
    // swords
    "cursed dual katana": ["cdk", "cursed dual katana"],
    "spikey trident": ["spikey trident", "trident"],
    "shark anchor": ["shark anchor", "anchor"],
    "dragon trident": ["dragon trident", "dt"],
    "gravity cane": ["gravity cane"],
    "yama": ["yama"],
    // guns
    "acidum rifle": ["acidum rifle", "acidum"],
    "kabucha": ["kabucha"],
    "serpent bow": ["serpent bow", "serpent"],
    "venom bow": ["venom bow"],
    "soul guitar": ["soul guitar", "skull guitar", "skull"], // add common misnames
    // races (incl. v4)
    "angel v4": ["angel v4", "angel"],
    "cyborg v4": ["cyborg v4", "cyborg"],
    "draco v4": ["draco v4", "draco"],
    "ghoul v4": ["ghoul v4", "ghoul"],
    "rabbit v4": ["rabbit v4", "rabbit", "mink"]
  };

  // quick reverse index
  const CANON = Object.keys(LEX);
  const ALIASES = [];
  for (const key of CANON) {
    for (const alias of LEX[key]) ALIASES.push([alias, key]);
  }
  const N = (s) => (s || "").toLowerCase();

  function detectEntities(text) {
    const q = " " + N(text) + " ";
    const found = new Set();
    for (const [alias, canon] of ALIASES) {
      if (q.includes(" " + alias + " ")) found.add(canon);
    }
    return Array.from(found); // list of canonicals
  }

  // ===== helpers: KB retrieval =====
  const normalize = (s) => (s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  function buildCorpus() {
    const C = [];
    (KB.combos||[]).forEach(c=>{
      C.push({
        type:"combo", title:`${c.title}`,
        text:`${(c.inputs||[]).join(" → ")} | ${(c.notes||[]).join(" | ")}`,
        key: normalize(`${c.title} ${(c.inputs||[]).join(" ")} ${(c.notes||[]).join(" ")}`)
      });
    });
    (KB.counters||[]).forEach(ct=>{
      C.push({ type:"counter", title:`vs ${ct.enemy||"?"}`, text:(ct.tips||[]).join(" | "), key:normalize(`${ct.enemy} ${(ct.tips||[]).join(" ")}`) });
    });
    (KB.builds||[]).forEach(b=>{
      C.push({ type:"build", title:`${b.label||"Build"}`, text:(b.notes||[]).join(" | "), key:normalize(`${b.label} ${(b.notes||[]).join(" ")}`) });
    });
    if (KB.guides?.theory) C.push({ type:"theory", title:"PvP Theory", text:KB.guides.theory, key:normalize(KB.guides.theory) });
    return C;
  }
  function retrieveKB(q, k=6) {
    const C = buildCorpus();
    const n = normalize(q);
    const hits = C.filter(x=>x.key.includes(n)).slice(0,k);
    if (!hits.length && KB.guides?.theory) return `Context — PvP Theory: ${KB.guides.theory}`;
    return hits.map(h => `• ${cap(h.type)} | ${h.title}: ${h.text}`).join("\n");
  }

  // ===== intent & patterns =====
  function matchIntent(text) {
    const s = N(text);
    // toggles
    if (/^deep mode on\b/.test(s)) return { type: "toggle", value: "on" };
    if (/^deep mode off\b/.test(s)) return { type: "toggle", value: "off" };

    // elaborate
    if (/(elaborate|explain more|go deeper|more detail|in depth|details)\b/.test(s))
      return { type: "elaborate" };

    // core intents
    if (/\b(counter|vs|beat|against)\b/.test(s)) return { type: "counter" };
    if (/\b(combo|route|string)\b/.test(s)) return { type: "combo" };
    if (/\bhow to use\b|\bhow do i use\b|\busage\b|\bplay with\b/.test(s)) return { type: "usage" };
    if (/\bbest build\b|\bbuild\b|\bstat\b|\bdistribution\b|\baccessor|\bgear\b/.test(s)) return { type: "build" };
    if (/\bken.?trick|instinct trick|toggle instinct|ken\b/.test(s)) return { type: "kentrick" };
    if (/\bpassive|aggressive\b/.test(s) && /\bplaystyle|style\b/.test(s)) return { type: "playstyle" };

    // greetings
    if (/\b(yo|hey|hello|hi|wsp|sup)\b/.test(s)) return { type: "greet" };

    return { type: "free" }; // free-form
  }

  // ===== knowledge snippets =====
  const SNIP = {
    guards: (q) => {
      if (/\bsprite\b/.test(N(q))) return "There’s no Sprite race in Blox Fruits. Valid races include Angel, Cyborg, Draco, Ghoul, Rabbit.";
      if (/haki|aura/.test(N(q)))  return "Aura (Haki) lets you hit Elemental users — it doesn’t buff damage. Keep it on to bypass Elementals.";
      if (/\binstinct\b/.test(N(q)) && !/ken|trick/.test(N(q)))
        return "Instinct helps with dodging/reading, not stats. Use **Ken Tricking** (timed ON/OFF) to survive combos and punish endlag.";
      return null;
    },
    kentrickShort: [
      "⚡ Ken Tricking:",
      "1) Instinct OFF.",
      "2) Toggle ON as multi-hit/stun starts.",
      "3) Toggle OFF instantly to save dodges.",
      "4) Punish endlag (e.g., GH Z → C → X)."
    ].join("\n"),
    kentrickLong: [
      "⚡ Ken Tricking — Advanced",
      "• Time toggles vs Dough V / Dragon C / Ice V / Rumble AoE.",
      "• Single heavy hit: toggle ON right before contact; if late, reset.",
      "• Punish: dash-cancel in → Trident X or GH Z → C → X.",
      "• Anti-Ken: Cyborg V4 Aftershock breaks loops; bait toggles.",
      "• Drills: 10 rounds survive Dough V/C; 10 vs Ice V→punish Z."
    ].join("\n"),
    playstyleShort: [
      "🔥 Passive vs Aggressive:",
      "• Aggressive: rushdown, break Ken, punish endlag fast.",
      "• Passive: bait, hold spacing, counter on whiff."
    ].join("\n"),
    playstyleLong: [
      "🧩 Passive vs Aggressive — Deep Dive",
      "• Aggressive starters: Trident X / GH Z / Anchor Z.",
      "• Passive tools: range pokes, air-camping vs ground fruits.",
      "• Switch tempo after a big whiff; that wins high-bounty rounds.",
      "• Drills: 10 aggro-only, 10 passive-only; review 1 mistake/round."
    ].join("\n")
  };

  // ===== canned knowledge for entities (counters/usage/builds) =====
  const FACTS = {
    // Counters for fruits
    counters: {
      "buddha": "🙏 Vs Buddha — stay out of M1 range; poke from distance; use vertical movement; punish Z endlag; don’t chase.",
      "dough":  "🍩 Vs Dough — fight airborne; many routes are ground-based. Cyborg V4 Aftershock can break strings; punish C/V endlag.",
      "ice":    "❄️ Vs Ice — avoid ground trades; stay in air; punish missed V/Z with a fast starter (Trident X / GH Z).",
      "portal": "🌀 Vs Portal — don’t chase teleports; hold your starter for Rift recovery; punish missed V trap.",
      "kitsune":"🦊 Vs Kitsune — deny rushdowns with spacing; punish after X/air dashes; keep a quick stun ready.",
      "sand":   "🏜️ Vs Sand — sidestep C/V lines; punish after V endlag; don’t stand still in sand trails.",
      "dragon": "🐲 Vs Dragon — respect C wind-up; pre-position diagonally; punish after C or X whiff.",
      "gas":    "☁️ Vs Gas — avoid standing in gas zones; poke from range; punish when they re-enter.",
      "bomb":   "💣 Vs Bomb — don’t sit in primed zones; bait C, punish the recovery.",
      "gravity":"🪐 Vs Gravity — don’t wait for meteor impact; dash pre-landing and punish Z endlag.",
      "blizzard":"🌨️ Vs Blizzard — don’t tank the AoE; play edges and punish recovery.",
      "venom":  "☠️ Vs Venom — don’t overstay in clouds; reset and punish post-form cooldown.",
      "dark":   "🌑 Vs Dark — don’t get grabbed; keep lateral movement; punish missed pull.",
      "quake":  "🌊 Vs Quake — play above wave lines; punish quake gaps.",
      "rumble": "⚡ Vs Rumble — avoid long stuns by spacing; punish after big AoE."
    },
    // Counters for races/styles/swords if asked as “vs X”
    countersMeta: {
      "cyborg v4": "🤖 Vs Cyborg V4 — don’t commit during Aftershock; disengage during overheat; punish right after the effect ends or when they whiff a re-engage.",
      "angel v4":  "😇 Vs Angel V4 — deny their sustain by burst-punishing after heals; force cooldowns then go in.",
      "draco v4":  "🐉 Vs Draco V4 — respect roar/debuff; stay mobile; punish after roar window.",
      "ghoul v4":  "🧛 Vs Ghoul V4 — don’t feed lifesteal; kite and burst in short windows.",
      "rabbit v4": "🐇 Vs Rabbit V4 — don’t try to race speed; bait the dash then punish recovery.",
      "godhuman":  "👐 Vs Godhuman — don’t eat the Z opener; sidestep → punish; watch X armor frames.",
      "sanguine art":"🩸 Vs Sanguine — avoid vertical juggles; punish after aerial strings.",
      "cursed dual katana":"🗡️ Vs CDK — don’t get clipped by fast slashes; keep spacing; punish endlag after Z/X chains.",
      "spikey trident":"🪝 Vs Spikey Trident — don’t stand in pull line; jump/strafe; punish whiffed X.",
      "shark anchor":"⚓ Vs Shark Anchor — avoid close AoE; punish after Z/X when they commit."
    },
    // Usage / how to play entity
    usage: {
      "portal":  "Portal usage — mobility > chase. Use Z to set up Anchor/Sanguine, V for traps, and rifts to appear behind for clean starters.",
      "dough":   "Dough usage — set ground strings with V/C/X, but protect your endlag; mix in air movement to avoid predictable routes.",
      "ice":     "Ice usage — use V as the safe trap, convert to Z; avoid ground mirror trades; keep vertical control.",
      "buddha":  "Buddha usage — it’s beginner friendly for M1 pressure, but higher-level PvP will out-range you; learn to bait & punish.",
      "kitsune": "Kitsune usage — leverage speed to overwhelm; keep a reliable starter ready and avoid over-committing.",
      "cyborg v4":"Cyborg V4 usage — Aftershock to break pressure; don’t waste it; pair with a fast stun and capitalize during windows."
    },
    // Builds
    builds: {
      "fruit main": "Fruit Main: Max Fruit + Melee + Defense. Styles: Godhuman or Sanguine. Swords: Trident/Anchor for starters. Accessories: mobility/dodges.",
      "sword main": "Sword Main: Max Sword + Melee + Defense. Fruit for stun (Portal/Ice/Rumble). CDK/Anchor/Trident core.",
      "gun main":   "Gun Main: Needs reliable stuns (Dark/Ice/Rumble). Weapons: Acidum Rifle/Kabucha/Serpent Bow. Play at range, punish on stun."
    }
  };

  // ===== State =====
  let lastTopic = "misc";
  let lastQuestion = "";
  let deepMode = false;

  // ===== Main routing =====
  async function onSend() {
    const q = (input.value || "").trim();
    if (!q) return;
    add("user", q);
    input.value = "";
    lastQuestion = q;

    const removeTyping = typing();
    setTimeout(async () => {
      removeTyping();

      const guard = SNIP.guards(q);
      if (guard) return add("bot", guard);

      const intent = matchIntent(q);
      const entities = detectEntities(q); // list of canonicals

      // toggles
      if (intent.type === "toggle") {
        deepMode = intent.value === "on";
        return add("bot", `Deep mode: ${deepMode ? "ON" : "OFF"}.`);
      }

      // elaborate (use last topic/content)
      if (intent.type === "elaborate" || (deepMode && intent.type !== "greet")) {
        const long = elaborate(lastTopic, lastQuestion, entities);
        return long.length > 1000 || long.split("\n").length > 16
          ? await sayLong(long)
          : add("bot", long);
      }

      // counters
      if (intent.type === "counter") {
        lastTopic = "counters";
        const target = entities[0]; // first detected
        if (target) {
          const out = FACTS.counters[target] || FACTS.countersMeta[target];
          if (out) return add("bot", out + "  (say **elaborate** for the full plan)");
        }
        // Try KB or ask who
        const kb = retrieveKB(q);
        return kb ? add("bot", kb + "\nSay **elaborate** for more.") : add("bot", "Who you fighting? (fruit/race/style/weapon)");
      }

      // combos
      if (intent.type === "combo") {
        lastTopic = "combos";
        if (entities.includes("portal")) {
          return add("bot",
            "🌀 Portal combo: Portal Z → Shark Anchor Z → Sanguine Z → C → X\nTip: keep camera level after Anchor Z. Say **elaborate** for more routes."
          );
        }
        const kb = retrieveKB(q);
        if (kb) return add("bot", `⚔️ Combos\n${kb}\nSay **elaborate** for a bigger pack.`);
        return add("bot", [
          "⚔️ Try these:",
          "• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X",
          "• Ice V → (unawakened) Ice C → Ice Z → GH X → GH Z → GH C",
          "Say your fruit for tailored routes or say **elaborate**."
        ].join("\n"));
      }

      // usage / how to play X
      if (intent.type === "usage") {
        lastTopic = "usage";
        if (entities.length) {
          const target = entities[0];
          const tip = FACTS.usage[target];
          if (tip) return add("bot", tip + "  (say **elaborate** to dive deeper)");
        }
        return add("bot", "Tell me what you want to use (fruit/race/style/weapon) and I’ll coach it.");
      }

      // builds
      if (intent.type === "build") {
        lastTopic = "builds";
        const kb = retrieveKB("build");
        return add("bot", kb || FACTS.builds["fruit main"]);
      }

      // ken tricking
      if (intent.type === "kentrick") {
        lastTopic = "kentrick";
        return add("bot", SNIP.kentrickShort + "  (say **elaborate** for advanced timing)");
      }

      // playstyle
      if (intent.type === "playstyle") {
        lastTopic = "playstyles";
        return add("bot", SNIP.playstyleShort + "  (say **elaborate** for drills & switches)");
      }

      // greet
      if (intent.type === "greet") {
        lastTopic = "misc";
        return add("bot", pick([
          "Yo! What do you wanna grind: combos, counters, Ken Tricking, or builds?",
          "Hey! Say your fruit or who you’re fighting and I’ll tailor it.",
          "Wsp! Want counter tips, combo routes, or playstyle drills?"
        ]));
      }

      // free-form — handle entities if any
      if (intent.type === "free" && entities.length) {
        const target = entities[0];
        // If they mentioned a race like cyborg v4 without asking "counter", give relevant guidance
        if (target === "cyborg v4") {
          lastTopic = "usage";
          return add("bot",
            "Cyborg V4 tips — Save **Aftershock** to break pressure mid-string. Don’t waste it neutral. Pair with a fast starter (Trident X / GH Z) and punish right as their endlag opens. If they mirror Cyborg, disengage during their effect and re-engage after it ends."
          );
        }
        // general advice + ask if they want counters/combos/usage
        lastTopic = "misc";
        return add("bot", `You mentioned **${target}** — want **counters**, **combos**, or **how to use** it? Say “counter ${target}”, “${target} combo”, or “how to use ${target}”.`);
      }

      // KB fallback or small coach talk
      const kb = retrieveKB(q);
      if (kb) {
        lastTopic = "misc";
        return kb.length > 1000 ? await sayLong(kb) : add("bot", kb);
      }

      lastTopic = "misc";
      return add("bot", pick([
        "Bet — ask me to **counter** someone, drop a **combo** request, or say **Ken Tricking** for defense tech.",
        "Say your **fruit** or your **opponent** and I’ll tailor a plan.",
        "We can cook a build, routes, or matchup plan — your call."
      ]));
    }, 60);
  }

  // Elaborate builder (topic-aware, entity-aware)
  function elaborate(topic, lastQ, entities) {
    const e = (entities && entities[0]) || firstEntityIn(lastQ) || "";
    switch (topic) {
      case "kentrick":   return SNIP.kentrickLong;
      case "playstyles": return SNIP.playstyleLong;
      case "combos":
        if (e === "portal") {
          return [
            "🌀 Portal — Extended Routes",
            "• Z → Anchor Z → Sanguine Z → C → X (mobile-friendly core).",
            "• Z → Anchor Z → Anchor X → GH Z → GH C (ground punish alt).",
            "• Use rifts to appear behind; don’t chase. Keep camera level after Anchor Z.",
            "Drill: 20 reps hitting Sanguine after Anchor without drops."
          ].join("\n");
        }
        return [
          "⚔️ Combo Pack — Extended",
          "• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X",
          "• Ice V → (unawakened) Ice C → Ice Z → GH X → GH Z → GH C",
          "• DT X → Dough V → Dough X → Dough C → EClaw C → EClaw X",
          "Notes: respect endlag; don’t over-extend if finisher is down."
        ].join("\n");
      case "counters":
        // fruit/race detailed counters
        if (FACTS.counters[e] || FACTS.countersMeta[e]) {
          const base = FACTS.counters[e] || FACTS.countersMeta[e];
          return base + "\n\nDeep notes:\n• Track cooldowns & dodges.\n• Punish after whiffs, not mid-armor.\n• Control verticality against ground-focused kits.";
        }
        return "

