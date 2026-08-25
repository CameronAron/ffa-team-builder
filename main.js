/* ============================================================
   FFA Team Builder — main.js
   ============================================================
   Data flow:
     pokemonData  -> loaded once from data/pokemon.json, read-only.
                     Each entry is expected to look like:
                       {
                         id, name, sprite, baseStatTotal,
                         types: ["fire", ...],
                         evolvesFrom: "charmander" | null,
                         evolvesTo: ["charizard", ...]   // usually 0 or 1, more if branching (e.g. Eevee)
                       }
                     If your pokemon.json predates the `types` /
                     `evolvesFrom` / `evolvesTo` fields, regenerate it
                     with the updated fetch-pokemon-data.js — Mono Type
                     Challenge and the Evolve/Devolve buttons need them.
     state        -> the single source of truth for everything the UI
                      renders (players/teams, effects list, settings)
     saveState()  -> persists `state` to localStorage
     render()     -> re-draws the whole UI from `state`
   ============================================================ */

const STORAGE_KEY = "ffaTeamBuilderState";
const NUM_PLAYERS = 4;
const TEAM_SIZE = 6;

const POKEMON_TYPES = [
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison",
  "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark",
  "Steel", "Fairy",
];
const TERA_TYPES = [...POKEMON_TYPES, "Stellar"];

let pokemonData = []; // loaded from data/pokemon.json
let state = null;

/* ---------------- Bootstrapping ---------------- */

async function init() {
  pokemonData = await fetch("data/pokemon.json?v=2").then((r) => r.json());

  populateDatalist();

  state = migrateState(loadState() ?? createDefaultState());

  render();
  bindTabs();
  bindGlobalControls();
}

function createDefaultState() {
  return {
    players: Array.from({ length: NUM_PLAYERS }, (_, i) => ({
      name: `Player ${i + 1}`,
      monoType: null,
      team: Array.from({ length: TEAM_SIZE }, () => null),
    })),
    effects: [
      { name: "Reroll", weight: 10 },
      { name: "Swap", weight: 5 },
      { name: "Evolve", weight: 3 },
      { name: "Devolve", weight: 2 },
    ],
    settings: {
      bstMax: { enabled: false, value: null },
      teraTypes: { enabled: false },
      monoType: { enabled: false },
    },
  };
}

// Fills in any fields that older saved states (from before a feature
// existed) won't have, so loading an old localStorage blob doesn't crash.
function migrateState(s) {
  if (!s.settings) s.settings = {};
  if (!s.settings.bstMax) s.settings.bstMax = { enabled: false, value: null };
  if (!s.settings.teraTypes) s.settings.teraTypes = { enabled: false };
  if (!s.settings.monoType) s.settings.monoType = { enabled: false };
  delete s.settings.autoApplyEffects; // removed setting — auto-apply is permanently off now

  s.players.forEach((p) => {
    if (p.monoType === undefined) p.monoType = null;
  });

  return s;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function populateDatalist() {
  const datalist = document.getElementById("pokemon-datalist");
  datalist.innerHTML = pokemonData
    .map((p) => `<option value="${capitalize(p.name)}">`)
    .join("");
}

/* ---------------- Random helpers ---------------- */

// Returns the pool of Pokémon eligible for `player` under the current
// settings (BST Max ceiling, Mono Type Challenge). Falls back to the
// full dataset if a filter would otherwise leave nothing to pick from,
// so generation never silently breaks.
// Side effect: if Mono Type Challenge is on and this player doesn't have
// a type locked in yet, one is assigned here.
function getEligiblePool(player) {
  if (state.settings.monoType.enabled && player && !player.monoType) {
    player.monoType = POKEMON_TYPES[Math.floor(Math.random() * POKEMON_TYPES.length)];
  }

  let pool = pokemonData;

  if (state.settings.bstMax.enabled && typeof state.settings.bstMax.value === "number") {
    const ceiling = state.settings.bstMax.value;
    pool = pool.filter((p) => typeof p.baseStatTotal === "number" && p.baseStatTotal <= ceiling);
  }

  if (state.settings.monoType.enabled && player && player.monoType) {
    const t = player.monoType.toLowerCase();
    pool = pool.filter((p) => Array.isArray(p.types) && p.types.some((pt) => pt.toLowerCase() === t));
  }

  if (pool.length === 0) pool = pokemonData;
  return pool;
}

// Builds the object that actually goes into a team slot: a shallow copy
// of the raw data entry (so we never mutate the shared pokemonData
// objects), plus a Tera Type if that setting is on.
function buildSlotMon(raw) {
  const mon = { ...raw };
  if (state.settings.teraTypes.enabled) {
    mon.teraType = TERA_TYPES[Math.floor(Math.random() * TERA_TYPES.length)];
  }
  return mon;
}

function randomPokemonFor(player) {
  const pool = getEligiblePool(player);
  const raw = pool[Math.floor(Math.random() * pool.length)];
  return buildSlotMon(raw);
}

function randomTeamFor(player) {
  // Sampling without replacement so one player's team has no duplicates.
  const pool = [...getEligiblePool(player)];
  const team = [];
  for (let i = 0; i < TEAM_SIZE && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const raw = pool.splice(idx, 1)[0];
    team.push(buildSlotMon(raw));
  }
  return team;
}

function findPokemonByName(name) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  return pokemonData.find((p) => p.name.toLowerCase() === target) ?? null;
}

/* ---------------- Weighted effect roll ---------------- */

function rollEffect() {
  const effects = state.effects.filter((e) => e.weight > 0);
  if (effects.length === 0) return null;

  const total = effects.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * total;
  for (const e of effects) {
    if (r < e.weight) return e.name;
    r -= e.weight;
  }
  return effects[effects.length - 1].name; // floating point fallback
}

/* ---------------- Rendering ---------------- */

function render() {
  renderEffectsTable();
  renderPlayers();
  renderSettings();
}

function renderEffectsTable() {
  const tbody = document.getElementById("effects-tbody");
  tbody.innerHTML = "";

  state.effects.forEach((effect, idx) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = effect.name;

    const weightTd = document.createElement("td");
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.min = "0";
    weightInput.step = "1";
    weightInput.value = effect.weight;
    weightInput.addEventListener("change", () => {
      effect.weight = Math.max(0, Number(weightInput.value) || 0);
      saveState();
    });
    weightTd.appendChild(weightInput);

    const actionTd = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      state.effects.splice(idx, 1);
      saveState();
      render();
    });
    actionTd.appendChild(removeBtn);

    tr.append(nameTd, weightTd, actionTd);
    tbody.appendChild(tr);
  });
}

function renderPlayers() {
  const container = document.getElementById("players-container");
  container.innerHTML = "";

  state.players.forEach((player, pIdx) => {
    const card = document.createElement("div");
    card.className = "player-card";

    // ---- header ----
    const header = document.createElement("div");
    header.className = "player-card-header";

    const nameInput = document.createElement("input");
    nameInput.className = "player-name-input";
    nameInput.type = "text";
    nameInput.value = player.name;
    nameInput.addEventListener("change", () => {
      player.name = nameInput.value.trim() || `Player ${pIdx + 1}`;
      saveState();
    });
    header.appendChild(nameInput);

    if (state.settings.monoType.enabled) {
      const typeSelect = document.createElement("select");
      typeSelect.className = "mono-type-select";
      typeSelect.title = "Locked type for this player's team";
      typeSelect.innerHTML =
        `<option value="">Type…</option>` +
        POKEMON_TYPES.map(
          (t) => `<option value="${t}"${player.monoType === t ? " selected" : ""}>${t}</option>`
        ).join("");
      typeSelect.addEventListener("change", () => {
        player.monoType = typeSelect.value || null;
        saveState();
      });
      header.appendChild(typeSelect);
    }

    const genBtn = document.createElement("button");
    genBtn.className = "btn-secondary";
    genBtn.textContent = "Generate";
    genBtn.addEventListener("click", () => {
      player.team = randomTeamFor(player);
      saveState();
      render();
    });
    header.appendChild(genBtn);

    card.appendChild(header);

    // ---- team grid ----
    const teamGrid = document.createElement("div");
    teamGrid.className = "team-grid";

    player.team.forEach((mon, sIdx) => {
      teamGrid.appendChild(renderSlot(player, pIdx, mon, sIdx));
    });

    card.appendChild(teamGrid);
    container.appendChild(card);
  });
}

function renderSlot(player, pIdx, mon, sIdx) {
  const slot = document.createElement("div");
  slot.className = "slot-card";

  const spriteFrame = document.createElement("div");
  spriteFrame.className = "sprite-frame";

  if (mon) {
    const img = document.createElement("img");
    img.src = mon.sprite;
    img.alt = mon.name;
    spriteFrame.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "empty-sprite";
    spriteFrame.appendChild(placeholder);
  }
  slot.appendChild(spriteFrame);

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("list", "pokemon-datalist");
  input.placeholder = "Choose Pokémon";
  input.value = mon ? capitalize(mon.name) : "";
  input.title = mon ? capitalize(mon.name) : "";
  input.addEventListener("change", () => {
    const match = findPokemonByName(input.value);
    if (match) {
      player.team[sIdx] = buildSlotMon(match);
    } else if (input.value.trim() === "") {
      player.team[sIdx] = null;
    } else {
      // Typed something that doesn't match any known Pokémon —
      // revert the box rather than silently accepting bad data.
      input.value = mon ? capitalize(mon.name) : "";
      return;
    }
    saveState();
    render();
  });
  slot.appendChild(input);

  if (mon && mon.teraType) {
    const badge = document.createElement("div");
    badge.className = "type-badge";
    badge.dataset.type = mon.teraType.toLowerCase();
    badge.textContent = `Tera: ${mon.teraType}`;
    slot.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "slot-actions";

  const rerollBtn = document.createElement("button");
  rerollBtn.className = "btn-secondary";
  rerollBtn.textContent = "🎲";
  rerollBtn.title = "Reroll just this slot";
  rerollBtn.addEventListener("click", () => {
    player.team[sIdx] = randomPokemonFor(player);
    saveState();
    render();
  });
  actions.appendChild(rerollBtn);

  const canEvolve = !!(mon && Array.isArray(mon.evolvesTo) && mon.evolvesTo.length > 0);
  const evolveBtn = document.createElement("button");
  evolveBtn.className = "btn-evolve";
  evolveBtn.textContent = "▲";
  evolveBtn.title = canEvolve
    ? `Evolve into ${mon.evolvesTo.map(capitalize).join(" / ")}`
    : "No evolution available";
  evolveBtn.disabled = !canEvolve;
  evolveBtn.addEventListener("click", () => {
    if (!canEvolve) return;
    const nextName = mon.evolvesTo[Math.floor(Math.random() * mon.evolvesTo.length)];
    const raw = findPokemonByName(nextName);
    if (!raw) return;
    const newMon = { ...raw };
    if (mon.teraType) newMon.teraType = mon.teraType;
    player.team[sIdx] = newMon;
    saveState();
    render();
  });
  actions.appendChild(evolveBtn);

  const canDevolve = !!(mon && mon.evolvesFrom);
  const devolveBtn = document.createElement("button");
  devolveBtn.className = "btn-devolve";
  devolveBtn.textContent = "▼";
  devolveBtn.title = canDevolve ? `Devolve into ${capitalize(mon.evolvesFrom)}` : "No prior evolution";
  devolveBtn.disabled = !canDevolve;
  devolveBtn.addEventListener("click", () => {
    if (!canDevolve) return;
    const raw = findPokemonByName(mon.evolvesFrom);
    if (!raw) return;
    const newMon = { ...raw };
    if (mon.teraType) newMon.teraType = mon.teraType;
    player.team[sIdx] = newMon;
    saveState();
    render();
  });
  actions.appendChild(devolveBtn);

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn-danger";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear this slot";
  clearBtn.addEventListener("click", () => {
    player.team[sIdx] = null;
    saveState();
    render();
  });
  actions.appendChild(clearBtn);

  slot.appendChild(actions);

  return slot;
}

function renderSettings() {
  document.getElementById("bst-max-toggle").checked = state.settings.bstMax.enabled;
  const bstInput = document.getElementById("bst-max-value");
  bstInput.value = state.settings.bstMax.value ?? "";
  bstInput.disabled = !state.settings.bstMax.enabled;

  document.getElementById("tera-types-toggle").checked = state.settings.teraTypes.enabled;
  document.getElementById("mono-type-toggle").checked = state.settings.monoType.enabled;
}

/* ---------------- Effect log ---------------- */

function logEffect(message) {
  const log = document.getElementById("effect-log");
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = message;
  log.appendChild(entry); // flex-direction: column-reverse puts newest on top

  while (log.children.length > 8) {
    log.removeChild(log.firstChild);
  }
}

/* ---------------- Tabs ---------------- */

function bindTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${btn.dataset.tab}`);
      });
    });
  });
}

/* ---------------- Global controls ---------------- */

function bindGlobalControls() {
  document.getElementById("generate-all-btn").addEventListener("click", () => {
    state.players.forEach((p) => (p.team = randomTeamFor(p)));
    saveState();
    render();
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("Reset all teams, effects, and settings to defaults?")) return;
    state = createDefaultState();
    saveState();
    render();
  });

  document.getElementById("add-effect-btn").addEventListener("click", () => {
    const nameInput = document.getElementById("new-effect-name");
    const weightInput = document.getElementById("new-effect-weight");
    const name = nameInput.value.trim();
    const weight = Math.max(0, Number(weightInput.value) || 0);
    if (!name) return;

    state.effects.push({ name, weight });
    nameInput.value = "";
    weightInput.value = "1";
    saveState();
    render();
  });

  document.getElementById("roll-effect-btn").addEventListener("click", () => {
    const name = rollEffect();
    if (!name) {
      logEffect("No effects with weight > 0 to roll.");
      return;
    }
    // Rolling only announces the result — it's on you to act on it (e.g.
    // via the per-slot 🎲/▲/▼ buttons). Nothing in `state` changes here.
    logEffect(`Rolled: ${name}`);
  });

  // ---- Settings tab ----

  document.getElementById("bst-max-toggle").addEventListener("change", (e) => {
    state.settings.bstMax.enabled = e.target.checked;
    saveState();
    render();
  });

  document.getElementById("bst-max-value").addEventListener("change", (e) => {
    const val = Number(e.target.value);
    state.settings.bstMax.value = e.target.value === "" || Number.isNaN(val) ? null : val;
    saveState();
  });

  document.getElementById("tera-types-toggle").addEventListener("change", (e) => {
    state.settings.teraTypes.enabled = e.target.checked;
    saveState();
  });

  document.getElementById("mono-type-toggle").addEventListener("change", (e) => {
    state.settings.monoType.enabled = e.target.checked;
    saveState();
    render();
  });
}

/* ---------------- Utils ---------------- */

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

init();
