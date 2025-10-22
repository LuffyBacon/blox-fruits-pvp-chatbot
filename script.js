// -------------------- Blox GPT (Offline PvP Assistant) -------------------- //
// This is a standalone JS file — just drop it inside your project folder
// next to index.html and make sure <script src="script.js"></script> is included
// at the bottom of your HTML.

const chatBox = document.getElementById("chat-box");
const input   = document.getElementById("user-input");
const btn     = document.getElementById("send-btn");

// --- helper to show messages ---
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ---------------- Tiny intent engine ---------------- //
let lastIntent = null;
const normalize = s => (s || "").toLowerCase();

function replyFor(raw) {
  const q = normalize(raw);

  // greetings / small talk
  if (/(yo|yoo|wsp|sup|hello|hey|hi)\b/.test(q)) {
    lastIntent = "greet";
    return "Yo bro 👋 I’m Blox GPT — your PvP assistant! Ask me anything about combos, playstyles, or meta tips.";
  }
  if (/(thanks|thank you|ur cool|you're cool|love u|nice)/.test(q)) {
    lastIntent = "nice";
    return "Appreciate it 😎 now let’s cook some PvP wins.";
  }

  // playstyles
  if (/(passive|aggressive)(.*playstyle|style)?/.test(q)) {
    lastIntent = "playstyles";
    return [
      "🔥 **Passive vs Aggressive Playstyles**:",
      "• **Aggressive** → Rushdown style. Focus on fast combos, Ken breaks, and endlag punishes.",
      "• **Passive** → Bait and punish. Keep distance, poke, and counter when they miss.",
      "👉 Mix both styles mid-fight so your opponent never predicts you."
    ].join("\n");
  }

  // ken tricking
  if (/ken.?trick|instinct trick|teach.*ken/.test(q)) {
    lastIntent = "kentrick";
    return [
      "⚡ **Ken Tricking — How to Master It:**",
      "1️⃣ Keep Instinct **OFF** until the enemy starts a stun combo.",
      "2️⃣ Toggle it **ON** right as the hit lands — absorb it safely.",
      "3️⃣ Turn **OFF** instantly to save dodges.",
      "4️⃣ Counterattack during their endlag (e.g., GH Z → C → X).",
      "🎯 Drill daily vs Dough V or Ice V to sharpen timing."
    ].join("\n");
  }

  // elaborate
  if (/elaborate|more detail|go deeper|explain more|detail/.test(q)) {
    if (lastIntent === "kentrick") {
      return [
        "💥 **Ken Tricking Advanced:**",
        "• Watch animation & sound cues — never spam toggle.",
        "• Time activation for big AoE moves like Dragon C or Dough V.",
        "• After baiting a hit, dash-cancel and punish with your starter.",
        "• Cyborg V4 can break Ken loops — disengage and reset spacing."
      ].join("\n");
    }
    if (lastIntent === "playstyles") {
      return [
        "🧩 **Playstyle Training Drills:**",
        "• Aggro: 10 rounds forcing first engage; punish every endlag.",
        "• Passive: 10 rounds only reacting — no first strike.",
        "• Review each match and adjust timing & spacing."
      ].join("\n");
    }
    return "Tell me what to elaborate — Ken Tricking, playstyles, combos, or counters?";
  }

  // combos
  if (/combo|route/.test(q) || /portal.*combo/.test(q)) {
    lastIntent = "combos";
    if (/portal/.test(q)) {
      return [
        "🌀 **Portal Combo (Mobile-Friendly):**",
        "Portal Z → Shark Anchor Z → Sanguine Z → C → X",
        "Tip 🧠: Keep camera level after Anchor Z so all Sanguine hits connect cleanly."
      ].join("\n");
    }
    return [
      "⚔️ **Combo Routes to Try:**",
      "• Sand C → Sand V → Anchor Z → Anchor X → Sanguine Z → C → X",
      "• Ice V → Unawakened Ice C → Ice Z → GH X → GH Z → GH C",
      "• DT X → Dough V → Dough X → Dough C → EClaw C → EClaw X",
      "Ask for a fruit to get a specific route!"
    ].join("\n");
  }

  // counters
  if (/counter|how to beat|how do i beat|vs\b/.test(q)) {
    lastIntent = "counters";
    if (/\bbuddha\b/.test(q)) {
      return [
        "🙏 **Vs Buddha Tips:**",
        "• Stay out of M1 range; poke with fruit or gun.",
        "• Air-camp when needed; punish after Z endlag.",
        "• Don’t chase — let them whiff first."
      ].join("\n");
    }
    if (/\bdough\b/.test(q)) {
      return [
        "🍩 **Vs Dough Users:**",
        "• Stay airborne — their combos mostly ground-based.",
        "• Use Cyborg V4 Aftershock to interrupt routes.",
        "• Wait for animation endlag, then punish fast."
      ].join("\n");
    }
    return "Who you tryna counter — Buddha, Dough, Ice, or someone else?";
  }

  // fallback
  lastIntent = "misc";
  return "Bet bro 💪 ask me about **combos, counters, Ken Tricking, or playstyles** to get started!";
}

// ---------------- Wire up UI ---------------- //
btn.addEventListener("click", () => {
  const text = input.value.trim();
  if (!text) return;
  addMessage("user", text);
  input.value = "";

  const out = replyFor(text);
  addMessage("bot", out);
});

input.addEventListener("keydown", e => {
  if (e.key === "Enter") btn.click();
});
