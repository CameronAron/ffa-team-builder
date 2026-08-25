/* ============================================================
   FFA Team Builder — main.js
   ============================================================
   Data flow:
     pokemonData  -> loaded once from data/pokemon.json, read-only
     state        -> the single source of truth for everything
                      the UI renders (players/teams + effects list)
     saveState()  -> persists `state` to localStorage
     render()     -> re-draws the whole UI from `state`

   Everything the user does (generate, roll an effect, edit a
   slot, add/remove an effect) mutates `state` and then calls
   saveState() + render(). Keeping it this centralized is what
   would make it straightforward to swap localStorage for a
   synced backend later, if you ever revisit multiplayer.
   ============================================================ */

const STORAGE_KEY = "ffaTeamBuilderState";
const NUM_PLAYERS = 4;
const TEAM_SIZE = 6;

let pokemonData = []; // loaded from data/pokemon.json
let state = null;

/* ---------------- Bootstrapping ---------------- */

async function init() {
  pokemonData = await fetch("data/pokemon.json").then((r) => r.json());

  populateDatalist();

  state = loadState() ?? createDefaultState();

  render();
  bindGlobalControls();
}

function createDefaultState() {
  return {
    players: Array.from({ length: NUM_PLAYERS }, (_, i) => ({
      name: `Player ${i + 1}`,
      team: Array.from({ length: TEAM_SIZE }, () => null),
    })),
    effects: [
      { name: "Reroll", weight: 10 },
      { name: "Swap", weight: 5 },
      { name: "Evolve", weight: 3 },
      { name: "Devolve", weight: 2 },
    ],
  };
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

function randomPokemon() {
  return pokemonData[Math.floor(Math.random() * pokemonData.length)];
}

function randomTeam() {
  // Sampling without replacement so one player's team has no duplicates.
  const pool = [...pokemonData];
  const team = [];
  for (let i = 0; i < TEAM_SIZE && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    team.push(pool.splice(idx, 1)[0]);
  }
  return team;
}

function findPokemonByName(name) {
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

function randomFilledSlot() {
  const candidates = [];
  state.players.forEach((player, pIdx) => {
    player.team.forEach((mon, sIdx) => {
      if (mon) candidates.push({ pIdx, sIdx });
    });
  });
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* Applies the named effect to current state, mutating it.
   Returns a short human-readable description of what happened,
   for the log. Unknown / custom effect names fall through to a
   generic message since there's no predefined action for them. */
function applyEffect(name) {
  switch (name) {
    case "Reroll": {
      const target = randomFilledSlot();
      if (!target) return "Reroll: no Pokémon on the field yet.";
      const { pIdx, sIdx } = target;
      const newMon = randomPokemon();
      state.players[pIdx].team[sIdx] = newMon;
      return `Reroll: ${state.players[pIdx].name}'s slot ${sIdx + 1} became ${capitalize(newMon.name)}.`;
    }

    case "Swap": {
      const a = randomFilledSlot();
      const b = randomFilledSlot();
      if (!a || !b) return "Swap: not enough Pokémon on the field yet.";
      const temp = state.players[a.pIdx].team[a.sIdx];
      state.players[a.pIdx].team[a.sIdx] = state.players[b.pIdx].team[b.sIdx];
      state.players[b.pIdx].team[b.sIdx] = temp;
      return `Swap: exchanged ${state.players[a.pIdx].name} slot ${a.sIdx + 1} with ${state.players[b.pIdx].name} slot ${b.sIdx + 1}.`;
    }

    case "Evolve":
    case "Devolve":
      // pokemon.json currently only stores name + sprite, so there's no
      // evolvesFrom/evolvesTo chain to act on yet. Once you add that data
      // to the JSON (e.g. from PokeAPI's evolution-chain endpoint), this
      // is the spot to look up the target's evolvesTo/evolvesFrom and
      // swap the slot to that Pokémon, similar to the Reroll case above.
      return `${name}: rolled, but no evolution-chain data is loaded yet — no automatic action taken.`;

    default:
      return `Rolled: ${name} — this is a custom effect with no built-in action; apply it manually.`;
  }
}

/* ---------------- Rendering ---------------- */

function render() {
  renderEffectsTable();
  renderPlayers();
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
    removeBtn.className = "danger";
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

    const genBtn = document.createElement("button");
    genBtn.className = "secondary";
    genBtn.textContent = "Generate";
    genBtn.addEventListener("click", () => {
      player.team = randomTeam();
      saveState();
      render();
    });

    header.append(nameInput, genBtn);
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

  if (mon) {
    const img = document.createElement("img");
    img.src = mon.sprite;
    img.alt = mon.name;
    slot.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "empty-sprite";
    slot.appendChild(placeholder);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("list", "pokemon-datalist");
  input.placeholder = "Choose Pokémon";
  input.value = mon ? capitalize(mon.name) : "";
  input.addEventListener("change", () => {
    const match = findPokemonByName(input.value);
    if (match) {
      player.team[sIdx] = match;
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

  const actions = document.createElement("div");
  actions.className = "slot-actions";

  const rerollBtn = document.createElement("button");
  rerollBtn.className = "secondary";
  rerollBtn.textContent = "🎲";
  rerollBtn.title = "Reroll just this slot";
  rerollBtn.addEventListener("click", () => {
    player.team[sIdx] = randomPokemon();
    saveState();
    render();
  });

  const clearBtn = document.createElement("button");
  clearBtn.className = "danger";
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear this slot";
  clearBtn.addEventListener("click", () => {
    player.team[sIdx] = null;
    saveState();
    render();
  });

  actions.append(rerollBtn, clearBtn);
  slot.appendChild(actions);

  return slot;
}

/* ---------------- Effect log ---------------- */

function logEffect(message) {
  const log = document.getElementById("effect-log");
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = message;
  log.prepend(entry);

  // Keep the log from growing forever.
  while (log.children.length > 8) {
    log.removeChild(log.lastChild);
  }
}

/* ---------------- Global controls ---------------- */

function bindGlobalControls() {
  document.getElementById("generate-all-btn").addEventListener("click", () => {
    state.players.forEach((p) => (p.team = randomTeam()));
    saveState();
    render();
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("Reset all teams and effects to defaults?")) return;
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
    const description = applyEffect(name);
    saveState();
    render();
    logEffect(description);
  });
}

/* ---------------- Utils ---------------- */

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

init();
