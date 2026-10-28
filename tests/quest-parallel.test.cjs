const test = require("node:test");
const assert = require("node:assert/strict");
const { load, observable: o } = require("./helpers.cjs");
function owner(adapter) {
  const token = {
    active: true,
    isCurrent() {
      return this.active;
    },
    onManual() {
      this.active = false;
      adapter.release(this, "Manual control");
    },
  };
  assert.equal(adapter.acquire(token), true);
  return token;
}
function farm(storage = {}) {
  const actions = [],
    plots = Array.from({ length: 5 }, () => ({
      berry: -1,
      isUnlocked: true,
      isSafeLocked: false,
      stage: () => 3,
    }));
  const farming = {
    canAccess: () => true,
    plotList: plots,
    berryInventory: [o(2), o(0)],
    plant(i, b) {
      actions.push(["plant", i, b]);
      plots[i].berry = b;
      this.berryInventory[b](this.berryInventory[b]() - 1);
    },
    harvest(i) {
      actions.push(["harvest", i]);
      plots[i].berry = -1;
      this.berryInventory[0](this.berryInventory[0]() + 2);
    },
  };
  const h = load(
    "simpleautofarmer.user.js",
    '<div id="shovelList"></div>',
    {
      App: { isUsingClient: true, game: { farming } },
      BerryType: { None: -1, Cheri: 0, Chesto: 1, 0: "Cheri", 1: "Chesto" },
      PlotStage: { Berry: 3 },
      FarmController: {
        selectedBerry: o(0),
        navigateIndex() {},
        BERRIES_PER_PAGE: 8,
      },
    },
    { autoFarmMutationPlan: [-1, -1, -1, 0, -1], ...storage },
  );
  h.w.initAutoFarm();
  return {
    ...h,
    actions,
    plots,
    farming,
    adapter: h.w.PokeAutomationAdapters?.adapters.farm,
  };
}
test("farm lease uses stock below default reserve, preserves protected occupied and designated plots and waits naturally", () => {
  const h = farm();
  assert.ok(h.adapter);
  const t = owner(h.adapter);
  h.plots[0].isSafeLocked = true;
  h.plots[1].berry = 1;
  h.plots[1].stage = () => 0;
  h.adapter.apply(t, { berryType: 0 });
  assert.deepEqual(h.actions, [
    ["plant", 2, 0],
    ["plant", 4, 0],
  ]);
  assert.equal(h.adapter.inspect().status, "waiting");
  h.adapter.apply(t, { berryType: 1 });
  assert.match(h.adapter.inspect().reason, /berry|stock/i);
  t.active = false;
  h.adapter.release(t);
  assert.equal(h.adapter.apply(t, { berryType: 0 }), false);
});
test("farm real manual handler cancels lease and applies requested toggle once", () => {
  const h = farm(),
    t = owner(h.adapter);
  h.w.document.getElementById("auto-plant-toggle").click();
  assert.equal(t.active, false);
  assert.equal(h.w.localStorage.getItem("autoPlantState"), "true");
});
function hatch() {
  const party = [1, 2, 3].map((id) => ({
      id,
      level: 100,
      breeding: false,
      isHatchable() {
        return !this.breeding;
      },
    })),
    queue = [[0, 99]],
    added = [],
    eggs = [{ isNone: () => false, canHatch: () => true }];
  const breeding = {
    canAccess: () => true,
    eggSlots: 1,
    eggList: eggs.map((e) => () => e),
    queueList: () => queue,
    hasFreeEggSlot: () => true,
    hasFreeQueueSlot: () => false,
    hatchPokemonEgg(i) {
      if (eggs[i].canHatch()) {
        eggs[i] = { isNone: () => true, canHatch: () => false };
      }
    },
    addPokemonToHatchery(p) {
      p.breeding = true;
      added.push(p.id);
      return true;
    },
  };
  const h = load(
    "enhancedautohatchery.user.js",
    '<button id="auto-hatch-start"></button>',
    {
      App: {
        isUsingClient: true,
        game: { breeding, party: { caughtPokemon: party } },
      },
      PokemonHelper: {
        getPokemonById: (id) => ({ type1: id === 2 ? 1 : 0, type2: -1 }),
      },
    },
  );
  h.w.registerQuestHatcheryAdapter();
  return {
    ...h,
    party,
    queue,
    added,
    breeding,
    adapter: h.w.PokeAutomationAdapters.adapters.hatchery,
  };
}
test("hatchery preserves native queue precedence, selects eligible matching species and keeps combat party", () => {
  const h = hatch(),
    t = owner(h.adapter);
  h.adapter.apply(t, { type: 1 });
  assert.deepEqual(h.added, []);
  h.queue.length = 0;
  h.adapter.apply(t, { type: 1 });
  assert.deepEqual(h.added, [2]);
  h.adapter.apply(t, {});
  h.adapter.apply(t, {});
  assert.equal(h.party.filter((p) => !p.breeding).length >= 2, true);
  assert.equal(h.w.localStorage.getItem("autoHatchState"), "false");
  t.active = false;
  h.adapter.release(t);
  assert.equal(h.adapter.apply(t, {}), false);
});
test("actual hatch toggle OFF during owned ON never turns restored OFF back ON", () => {
  const h = hatch(),
    t = owner(h.adapter);
  h.adapter.apply(t, {});
  h.w.toggleAutoHatch({
    target: h.w.document.getElementById("auto-hatch-start"),
  });
  assert.equal(t.active, false);
  assert.equal(h.w.hatchState, false);
  assert.equal(h.w.localStorage.getItem("autoHatchState"), "false");
});
function mine() {
  const actions = [],
    tools = {
      selectedToolType: 2,
      getTool: () => ({
        canUseTool: () => false,
        restoreRatePerSecond: () => 0.01,
        durability: 0,
        durabilityPerUse: 1,
      }),
    },
    underground = {
      canAccess: () => true,
      autoSearchMineType: 4,
      mine: null,
      tools,
      battery: { toJSON: () => ({}) },
      generateMine(type) {
        actions.push(type);
        this.mine = {
          timeUntilDiscovery: 5,
          completed: false,
          itemsFound: 0,
          itemsBuried: 1,
        };
      },
    };
  const h = load(
    "enhancedautomine.user.js",
    '<div id="mineModal"><div class="modal-body"></div></div>',
    {
      App: {
        isUsingClient: true,
        game: {
          underground,
          statistics: {
            undergroundLayersMined: o(0),
            undergroundItemsFound: o(0),
          },
        },
      },
      UndergroundItems: { list: [] },
      UndergroundToolType: { Chisel: 0, Hammer: 1 },
      Settings: { getSetting: () => ({ observableValue: o(false) }) },
    },
  );
  h.w.initAutoMine();
  return {
    ...h,
    underground,
    actions,
    adapter: h.w.PokeAutomationAdapters?.adapters.mine,
  };
}
test("mine owns timed native searches and restarts completed layers while respecting exhausted tools and settings", () => {
  const h = mine();
  assert.ok(h.adapter);
  const t = owner(h.adapter);
  h.adapter.apply(t, {});
  assert.deepEqual(h.actions, [4]);
  h.adapter.apply(t, {});
  assert.equal(h.actions.length, 1);
  h.underground.mine.timeUntilDiscovery = 0;
  h.tick();
  assert.match(h.adapter.inspect().reason, /recover/i);
  h.underground.mine.completed = true;
  h.tick();
  assert.deepEqual(h.actions, [4, 4]);
  assert.equal(h.w.localStorage.getItem("autoMineState"), "false");
  h.w.startAutoMine();
  assert.equal(t.active, false);
  assert.equal(h.w.mineState, false);
  assert.equal(h.timers.size, 0);
});
test("runner applies independent backgrounds and supplies battle route to hatch-only objectives from town", () => {
  const h = load("autoquestrunner.user.js", "", {
    Preload: { hideSplashScreen() {} },
  });
  h.run("AutoQuestRunner.init()");
  const r = h.w.AutoQuestRunner,
    applied = [];
  h.w.PokeAutomationAdapters.adapters.navigation = {
    acquire: () => true,
    apply: (t, x) => (applied.push(["navigation", x]), true),
    inspect: () => ({ status: "ready" }),
    release() {},
  };
  for (const name of ["farm", "hatchery", "mine"])
    h.w.PokeAutomationAdapters.adapters[name] = {
      acquire: () => true,
      apply: (t, x) => (applied.push([name, x]), true),
      inspect: () => ({ status: "ready" }),
      release() {},
    };
  r.start();
  const route = {
    id: "route:0:1",
    unlocked: true,
    target: { kind: "route", number: 1, region: 0 },
    capabilities: ["defeat"],
    rates: {},
  };
  const s = {
    epoch: 1,
    resources: {},
    quests: [
      {
        id: "h",
        known: true,
        active: true,
        type: "HatchEggsQuest",
        target: {},
        remaining: 10,
        claimed: false,
        reward: 10,
      },
    ],
    activities: [route],
    rates: {},
    commitments: {},
  };
  r.prepareSupplies = (s, p) => p;
  const plan = {
    primary: null,
    background: ["farm", "hatchery", "mine"].map((module) => ({
      id: module,
      module,
      target: { kind: module },
      questIds: ["h"],
    })),
    reasons: [],
  };
  r.executePlan(s, plan);
  assert.deepEqual(
    applied.map((a) => a[0]),
    ["farm", "hatchery", "mine", "navigation"],
  );
  assert.equal(applied[3][1].target.kind, "route");
  r.stop();
});
test("hatchery manual divergence stays OFF and runner is cancelled on reconciliation", () => {
  const h = hatch(),
    t = owner(h.adapter);
  h.adapter.apply(t, {});
  h.w.hatchState = false;
  h.adapter.apply(t, {});
  assert.equal(t.active, false);
  assert.equal(h.w.hatchState, false);
});
test("farm absent requested berry is blocked even while unrelated plants grow", () => {
  const h = farm(),
    t = owner(h.adapter);
  h.plots[0].berry = 0;
  h.plots[0].stage = () => 0;
  h.adapter.apply(t, { berryType: 1 });
  assert.equal(h.adapter.inspect().status, "blocked");
  assert.match(h.adapter.inspect().reason, /stock absent/);
});
test("runner releases backgrounds that no longer contribute to active quests", () => {
  const h = load("autoquestrunner.user.js", "", {
    Preload: { hideSplashScreen() {} },
  });
  h.run("AutoQuestRunner.init()");
  const r = h.w.AutoQuestRunner;
  let released = 0;
  h.w.PokeAutomationAdapters.adapters.navigation = {
    acquire: () => true,
    apply: () => true,
    inspect: () => ({ status: "ready" }),
    release() {},
  };
  h.w.PokeAutomationAdapters.adapters.hatchery = {
    acquire: () => true,
    apply: () => true,
    inspect: () => ({ status: "waiting" }),
    release() {
      released++;
    },
  };
  r.start(["navigation", "hatchery"]);
  r.executePlan(
    { epoch: 1, activities: [], quests: [], resources: {} },
    { primary: null, background: [], reasons: [] },
  );
  assert.equal(released, 1);
  assert.equal(
    r.acquired.some((e) => e.name === "hatchery"),
    false,
  );
});
test("hatchery retains at least half actual party attack when matching species dominates combat", () => {
  const h = hatch(),
    t = owner(h.adapter);
  h.queue.length = 0;
  h.party[0].attack = 1;
  h.party[1].attack = 100;
  h.party[2].attack = 1;
  h.adapter.apply(t, { type: 1 });
  assert.deepEqual(h.added, []);
});
test("release before first owned application preserves another component state", () => {
  const h = hatch(),
    t = owner(h.adapter);
  h.w.hatchState = true;
  t.active = false;
  h.adapter.release(t);
  assert.equal(h.w.hatchState, true);
  const m = mine(),
    u = owner(m.adapter);
  m.w.mineState = true;
  u.active = false;
  m.adapter.release(u);
  assert.equal(m.w.mineState, true);
});
test("farm point activity selects available native berry rather than requiring Cheri stock", () => {
  const h = farm(),
    t = owner(h.adapter);
  h.farming.berryInventory[0](0);
  h.farming.berryInventory[1](2);
  const activity = h.adapter
    .inspect()
    .activities.find((a) => a.capabilities.includes("farmPoints"));
  assert.ok(activity);
  h.adapter.apply(t, { berryType: activity.berryType });
  assert.equal(h.actions[0][2], 1);
});
test("missing optional hatchery module is explained without starting a spurious supporting route", () => {
  const h = load("autoquestrunner.user.js", "", {
    Preload: { hideSplashScreen() {} },
  });
  h.run("AutoQuestRunner.init()");
  const r = h.w.AutoQuestRunner;
  let moves = 0;
  h.w.PokeAutomationAdapters.adapters.navigation = {
    acquire: () => true,
    apply: () => {
      moves++;
      return true;
    },
    inspect: () => ({ status: "ready" }),
    release() {},
  };
  r.start();
  const s = {
    epoch: 1,
    resources: {},
    quests: [],
    activities: [
      {
        id: "route",
        unlocked: true,
        target: { kind: "route", number: 1, region: 0 },
      },
    ],
  };
  r.executePlan(s, {
    primary: null,
    background: [{ id: "hatchery", module: "hatchery" }],
    reasons: [],
  });
  assert.equal(moves, 0);
  assert.match(r.reason, /hatchery.*unavailable/i);
});
test("farm ownership cancellation listens only to farm controls", () => {
  const actions = [];
  const h = load(
    "simpleautofarmer.user.js",
    '<button id="auto-quest-runner"></button><div id="shovelList"></div>',
    {
      App: {
        isUsingClient: true,
        game: { farming: { plotList: [], berryInventory: [o(1)] } },
      },
      BerryType: { 0: "Cheri", Cheri: 0 },
      FarmController: {
        selectedBerry: o(0),
        navigateIndex() {},
        BERRIES_PER_PAGE: 8,
      },
    },
  );
  h.w.initAutoFarm();
  const t = owner(h.w.PokeAutomationAdapters.adapters.farm);
  h.w.document.getElementById("auto-quest-runner").click();
  assert.equal(t.active, true);
});
test("repeated breeding replenishment keeps half total attack across reconciliation ticks", () => {
  const h = hatch(),
    t = owner(h.adapter);
  h.queue.length = 0;
  h.party.push(
    ...[4, 5, 6].map((id) => ({
      id,
      level: 100,
      breeding: false,
      isHatchable() {
        return !this.breeding;
      },
    })),
  );
  h.party.forEach((p, i) => (p.attack = [30, 20, 5, 15, 15, 15][i]));
  h.w.PokemonHelper.getPokemonById = (id) => ({
    type1: id <= 3 ? 1 : 0,
    type2: -1,
  });
  h.adapter.apply(t, { type: 1 });
  h.adapter.apply(t, { type: 1 });
  assert.ok(
    h.party.filter((p) => !p.breeding).reduce((s, p) => s + p.attack, 0) >= 50,
  );
});

function attachRunner(h, type, target = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  h.w.Preload = { hideSplashScreen() {} };
  h.run(
    fs.readFileSync(path.join(__dirname, "../autoquestrunner.user.js"), "utf8"),
  );
  h.run("AutoQuestRunner.init()");
  h.w.App.game.quests = {
    questList: () => [
      {
        constructor: { name: type },
        amount: 10,
        pointsReward: 10,
        initial: o(0),
        focus: o(0),
        claimed: o(false),
        ...target,
      },
    ],
  };
  return h.w.AutoQuestRunner;
}

// Catches the points-only loop endlessly replanting the wrong berry while shiny work continues.
test("berry quest waits for existing crops then replants the requested berry alongside shiny and farm points", () => {
  const h = farm();
  h.farming.berryInventory[1](5);
  h.plots.forEach(p => { p.berry = 0; p.stage = () => 0; });
  h.plots[0].isSafeLocked = true;
  const r = attachRunner(h, "HarvestBerriesQuest", {berryType:1});
  const quests = h.w.App.game.quests.questList();
  for (const type of ["CatchShiniesQuest", "GainFarmPointsQuest"]) {
    quests.push({constructor:{name:type},amount:100,pointsReward:10,initial:o(0),focus:o(0),claimed:o(false)});
  }
  h.w.App.game.quests.questList = () => quests;
  const route = {id:"route:0:1",target:{kind:"route",number:1,region:0},unlocked:true,capabilities:["shiny"],rates:{}};
  const plan = () => {
    const s = r.readQuestSnapshot();
    s.activities.push(route);
    return {s, p:r.selectPlan(s,r.buildCandidates(s))};
  };
  const first = plan();
  assert.equal(first.p.primary.id, "route:0:1");
  assert.equal(first.p.background[0].berryType, 1);
  assert.ok(first.p.background[0].questIds.includes(first.s.quests[0].id));
  assert.ok(first.p.background[0].questIds.includes(first.s.quests[2].id));
  assert.equal(r.evaluateRefresh({...first.s,quests:[first.s.quests[0]]}, {refreshCost:0}).refresh, false);
  const t = owner(h.adapter);
  h.adapter.apply(t, {berryType:first.p.background[0].berryType});
  assert.deepEqual(h.actions, [], "growing crops are never uprooted");
  h.plots.forEach(p => { p.stage = () => 3; });
  const next = plan();
  assert.equal(next.p.background[0].berryType, 1);
  h.adapter.apply(t, {berryType:next.p.background[0].berryType});
  assert.deepEqual(h.actions, [["harvest",1],["plant",1,1],["harvest",2],["plant",2,1],["harvest",4],["plant",4,1]]);
  assert.equal(h.plots[0].berry, 0, "locked plot preserved");
  assert.equal(h.plots[3].berry, 0, "mutation plan preserved");
  assert.equal(h.farming.berryInventory[1](), 2);
  h.plots.forEach(p => { p.stage = () => 0; });
  const growing = plan();
  assert.equal(growing.p.primary.id, "route:0:1");
  assert.equal(growing.p.background[0].berryType, 1);
});

test("berry transition leaves unrelated mature crops untouched without plantable stock", () => {
  const h = farm();
  h.plots.forEach(p => { p.berry = 0; });
  const t = owner(h.adapter);
  h.adapter.apply(t, {berryType:1});
  assert.equal(h.adapter.inspect().status, "blocked");
  assert.deepEqual(h.actions, []);
});

test("farm availability reaches refresh policy and rechecks each berry after stock and growth changes", () => {
  const h = farm();
  const r = attachRunner(h, "HarvestBerriesQuest", { berryType: 1 });
  const t = owner(h.adapter);
  h.adapter.apply(t, { berryType: 1 });
  const decision = () =>
    r.evaluateRefresh(r.readQuestSnapshot(), { refreshCost: 0, now: 1000000 });
  assert.equal(
    decision().refresh,
    true,
    "missing requested stock permits free fallback",
  );
  assert.match(
    r.selectPlan(r.readQuestSnapshot(), []).reasons.join(" "),
    /stock absent/,
  );
  h.farming.berryInventory[1](1);
  assert.equal(
    decision().refresh,
    false,
    "fresh stock revives objective before apply",
  );
  h.farming.berryInventory[1](0);
  h.plots[0].berry = 1;
  h.plots[0].stage = () => 0;
  assert.equal(
    decision().refresh,
    false,
    "requested growing plants are a natural wait",
  );
  h.plots[0].berry = 0;
  assert.equal(
    decision().refresh,
    true,
    "unrelated growth cannot realize this berry",
  );
  const snapshot = r.readQuestSnapshot();
  snapshot.quests[0].target.berryType = 0;
  assert.equal(r.evaluateRefresh(snapshot, { refreshCost: 0 }).refresh, false);
  assert.equal(
    r.evaluateRefresh(r.readQuestSnapshot(), { refreshCost: 1 }).refresh,
    false,
  );
});

test("missing optional hatchery is unavailable until its adapter arrives", () => {
  const h = hatch();
  const adapter = h.adapter;
  delete h.w.PokeAutomationAdapters.adapters.hatchery;
  const r = attachRunner(h, "HatchEggsQuest");
  let snapshot = r.readQuestSnapshot();
  assert.equal(r.evaluateRefresh(snapshot, { refreshCost: 0 }).refresh, true);
  assert.match(
    r.selectPlan(snapshot, r.buildCandidates(snapshot)).reasons.join(" "),
    /hatchery.*unavailable/i,
  );
  h.w.PokeAutomationAdapters.adapters.hatchery = adapter;
  snapshot = r.readQuestSnapshot();
  assert.equal(r.evaluateRefresh(snapshot, { refreshCost: 0 }).refresh, false);
});

for (const [fixture, type, nativeKey] of [
  [hatch, "HatchEggsQuest", "breeding"],
  [mine, "MineLayersQuest", "underground"],
]) {
  test(`${nativeKey} availability recovers from previously blocked access without another apply`, () => {
    const h = fixture();
    const r = attachRunner(h, type);
    const token = owner(h.adapter);
    h[nativeKey].canAccess = () => false;
    h.adapter.apply(token, {});
    assert.equal(
      r.evaluateRefresh(r.readQuestSnapshot(), { refreshCost: 0 }).refresh,
      true,
    );
    h[nativeKey].canAccess = () => true;
    assert.equal(
      r.evaluateRefresh(r.readQuestSnapshot(), { refreshCost: 0 }).refresh,
      false,
    );
  });
}

test("mine search availability is checked fresh before and after native search support arrives", () => {
  const h = mine();
  const r = attachRunner(h, "MineLayersQuest");
  const generate = h.underground.generateMine;
  delete h.underground.generateMine;
  assert.equal(
    r.evaluateRefresh(r.readQuestSnapshot(), { refreshCost: 0 }).refresh,
    true,
  );
  h.underground.generateMine = generate;
  assert.equal(
    r.evaluateRefresh(r.readQuestSnapshot(), { refreshCost: 0 }).refresh,
    false,
  );
});

// Catches stock being treated as usable despite every usable planting place being unavailable.
for (const state of ["protected", "committed", "locked"]) {
  test(`farm ${state} plots with stock permit free fallback without uprooting`, () => {
    const h = farm(state === "committed" ? {autoFarmMutationPlan:[0,0,0,0,0]} : {});
    for (const p of h.plots) {
      if (state === "protected") p.isSafeLocked = true;
      if (state === "locked") p.isUnlocked = false;
    }
    const r = attachRunner(h, "HarvestBerriesQuest", {berryType:0});
    const t = owner(h.adapter);
    assert.equal(r.evaluateRefresh(r.readQuestSnapshot(), {refreshCost:0,now:1000000}).refresh, true);
    h.adapter.apply(t,{berryType:0});
    assert.equal(h.adapter.inspect().status, "blocked");
    assert.deepEqual(h.actions, []);
  });
}

// Catches counting noncombat species toward the active subregion's reserve.
test("hatchery preserves the sole Magikarp Jump combatant while allowing typed noncombat breeding", () => {
  const h = hatch(), t = owner(h.adapter);
  h.queue.length = 0;
  h.party.forEach((p,i) => {p.id = [129,1,4][i];p.attack = [10,100,100][i];});
  h.w.player = {region:6,subregion:1};
  h.w.App.game.party.partyPokemonActiveInSubRegion = (region,subregion) => {
    assert.equal(region,6); assert.equal(subregion,1);
    return h.party.filter(p => Math.floor(p.id) === 129);
  };
  h.w.PokemonHelper.getPokemonById = id => ({type1:id===129 ? 1 : 0,type2:-1});
  h.adapter.apply(t,{type:1});
  assert.deepEqual(h.added, []);
  h.adapter.apply(t,{type:0});
  assert.deepEqual(h.added,[1,4]);
  assert.equal(h.party[0].breeding,false);
});

// Catches unnecessary full-party attack calculation while no new breeder can be added.
for (const state of ["full", "queued"]) {
  test(`hatchery ${state} capacity exits before native attack scan`, () => {
    const h = hatch(), t = owner(h.adapter);
    let scans=0;
    h.w.App.game.party.calculateOnePokemonAttack = () => {scans++;return 1;};
    if (state === "full") {h.queue.length=0;h.breeding.hasFreeEggSlot=()=>false;}
    h.adapter.apply(t,{});
    assert.equal(scans,0);
    assert.deepEqual(h.added,[]);
  });
}

// Catches selecting the first stocked berry when only a later berry exceeds the active reserve.
test("farm point lease selects stock above the active mutation reserve", () => {
  const h = farm({autoFarmPlanReserve:10});
  h.plots.forEach((plot,index) => {plot.isSafeLocked = index !== 0;});
  h.farming.berryInventory[0](1);
  h.farming.berryInventory[1](20);
  h.w.document.getElementById("auto-farm-plan-toggle").click();
  assert.equal(h.w.localStorage.getItem("autoFarmPlanState"), "true");
  const activity = h.adapter.inspect().activities.find(a=>a.capabilities.includes("farmPoints"));
  assert.equal(activity.status, "ready");
  const t = owner(h.adapter);
  h.adapter.apply(t, {});
  assert.deepEqual(h.actions, [["plant",0,1]]);
  assert.equal(h.farming.berryInventory[0](),1);
  assert.equal(h.farming.berryInventory[1](),19);
  assert.equal(h.adapter.inspect().status,"waiting");
});
