// The genre classes' at-will features cost what their catalog text says
// (issue 233, section 4; src/lib/srd/authored-effects-genre.ts):
//
//   - Afterimage, Slippery, Escape Artist, Rigging Runner: the move as a
//     bonus action; Under Fire only while an ally is down.
//   - Target Lock: a bonus action marks a foe; attacks on it deal +2.
//   - Feedback Loop strikes back; Penance Shared takes half of an ally's hit.
//   - Field Surgeon stabilizes and Heavy Hands grapples as a bonus action.
//
// Dice forced; every check reads a sheet, the turn budget or a refusal.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-genre-costs");
const world = await openWorld();
const kit = await combatKit(world);

const LONGSWORD = [{ name: "Longsword", qty: 1, equipped: true }];
const samurai = world.addHero({
  class: "street_samurai", subclass: "Chrome Dervish", level: 5, maxHp: 40, abilities: { str: 16 }, proficiencies: TRAINED, equipment: LONGSWORD,
  features: [{ name: "Target Lock" }, { name: "Afterimage" }],
});
const doc = world.addHero({
  class: "trauma_doc", subclass: "Combat Medevac", level: 5, maxHp: 30, abilities: { wis: 16 }, proficiencies: TRAINED,
  features: [{ name: "Field Surgeon" }, { name: "Under Fire" }],
});
const esper = world.addHero({
  class: "esper", subclass: "Mindburner", level: 5, maxHp: 30, abilities: { cha: 16 }, proficiencies: TRAINED,
  features: [{ name: "Feedback Loop" }],
});
const penitent = world.addHero({
  class: "penitent", level: 5, maxHp: 40, abilities: { con: 14 }, proficiencies: TRAINED, features: [{ name: "Penance Shared" }],
});
const enforcer = world.addHero({
  class: "enforcer", level: 5, maxHp: 40, abilities: { str: 16 }, proficiencies: TRAINED, features: [{ name: "Heavy Hands" }],
});
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 40, abilities: { str: 16 }, proficiencies: TRAINED, equipment: LONGSWORD });

// The class tables give some of these features above 5th level; the sheet
// carries the ones each check needs.
const NEEDS = {
  [samurai.id]: ["Target Lock", "Afterimage"],
  [doc.id]: ["Field Surgeon", "Under Fire"],
  [esper.id]: ["Feedback Loop"],
  [penitent.id]: ["Penance Shared"],
  [enforcer.id]: ["Heavy Hands"],
};
for (const [id, names] of Object.entries(NEEDS)) {
  const sheet = world.sheet(id);
  const missing = names.filter((name) => !sheet.features.some((feature) => feature.name === name));
  world.patch(id, { features: [...sheet.features, ...missing.map((name) => ({ name, classId: sheet.class }))] });
}

async function stage(first, count = 1) {
  await kit.endFight();
  await kit.fight(count);
  for (const hero of [samurai, doc, esper, penitent, enforcer, ally]) {
    world.patch(hero.id, { currentHp: world.sheet(hero.id).maxHp, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, ac: 12, acOverride: true });
  }
  const enemies = world.enemies();
  for (const enemy of enemies) kit.setEnemy(enemy.id, { maxHp: 200, ac: 10 });
  kit.place(enemies[0].id, 6, 5);
  if (first) {
    kit.place(first.id, 5, 5);
    kit.giveTurn(first.id);
  }
  return enemies;
}

const budget = () => world.encounter().turnBudget ?? {};

await test("Afterimage's Dash is a bonus action.", async () => {
  await stage(samurai);
  const out = await world.invoke("take_action", { characterId: samurai.id, action: "dash", bonus: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
});

await test("Under Fire's Dash is a bonus action only while an ally is down.", async () => {
  await stage(doc);
  const refused = await world.invoke("take_action", { characterId: doc.id, action: "dash", bonus: true });
  assert.equal(refused.ok, false, "Under Fire with nobody down");
  world.patch(ally.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  const out = await world.invoke("take_action", { characterId: doc.id, action: "dash", bonus: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
});

await test("Target Lock is a bonus action, and attacks on the locked foe deal +2.", async () => {
  const [locked, other] = await stage(samurai, 2);
  kit.place(other.id, 4, 5);
  const out = await world.invoke("use_resource", { characterId: samurai.id, resource: "Target Lock", targetEnemyId: locked.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  const before = kit.enemy(locked.id).currentHp;
  const hit = await kit.swing(samurai.id, locked.id, [15, 4]);
  assert.equal(hit.ok, true, hit.error);
  // Longsword 4 + Str 3 + the lock's 2.
  assert.equal(before - kit.enemy(locked.id).currentHp, 9);
  const plainBefore = kit.enemy(other.id).currentHp;
  assert.equal((await kit.swing(samurai.id, other.id, [15, 4])).ok, true);
  assert.equal(plainBefore - kit.enemy(other.id).currentHp, 7, "the lock rode an attack on another foe");
});

await test("Feedback Loop strikes back with Charisma in psychic damage, for the reaction.", async () => {
  const [enemy] = await stage(ally);
  await world.hitBy(esper.id, { enemyId: enemy.id, raw: 6, total: 18, vsAc: 12 });
  const before = kit.enemy(enemy.id).currentHp;
  const out = await world.invoke("use_reaction", { characterId: esper.id, feature: "Feedback Loop" });
  assert.equal(out.ok, true, out.error);
  assert.equal(before - kit.enemy(enemy.id).currentHp, 3);
  assert.ok(world.encounter().reactionsUsed.includes(esper.id));
});

await test("Penance Shared takes an adjacent ally's hit, halved.", async () => {
  const [enemy] = await stage(samurai);
  kit.place(penitent.id, 4, 5);
  kit.place(ally.id, 4, 6);
  await world.hitBy(ally.id, { enemyId: enemy.id, raw: 10, total: 18, vsAc: 12 });
  world.patch(ally.id, { currentHp: 30 });
  const { freshLastHit, writeLastHit } = await import("../src/lib/dm/last-hit.ts");
  writeLastHit(world.campaignId, { ...freshLastHit(world.campaignId, ally.id), after: { currentHp: 30, tempHp: 0, beastHp: null } });
  const out = await world.invoke("use_reaction", { characterId: penitent.id, feature: "Penance Shared", targetCharacterId: ally.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 40);
  assert.equal(world.sheet(penitent.id).currentHp, 35);
});

await test("Field Surgeon stabilizes with the bonus action.", async () => {
  await stage(doc);
  kit.place(ally.id, 4, 5);
  world.patch(ally.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  world.dice(15);
  const out = await world.invoke("stabilize", { characterId: ally.id, healerId: doc.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
});

await test("Heavy Hands grapples with the bonus action.", async () => {
  const [enemy] = await stage(enforcer);
  world.dice(18, 2, 2);
  const out = await world.invoke("take_action", { characterId: enforcer.id, action: "grapple", bonus: true, targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(budget().bonusUsed, true);
  assert.equal(budget().actionUsed, false);
});

world.close();
finish();
