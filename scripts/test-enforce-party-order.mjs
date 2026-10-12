// Each member's own order for the Party panel's cards (issue 240), through
// the route the panel calls: kept per member and campaign, only this
// table's sheets, and nobody else's view moves.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-party-order");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { orderParty } = await import("../src/lib/party-order.ts");

const world = await openWorld();
const tavi = world.addHero({ name: "Tavi", class: "rogue", level: 3 });
const brannUser = world.addUser("brann");
const brann = world.addHero({ user: brannUser, name: "Brann", class: "fighter", level: 3 });
const kaelUser = world.addUser("kael");
const kael = world.addHero({ user: kaelUser, name: "Kael", class: "wizard", level: 3 });

const me = await world.route("campaigns/[campaignId]/members/me");
async function patch(user, body) {
  world.signIn(user);
  const response = await me.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}
const memberOf = (user) => listMembers(world.campaignId).find((member) => member.userId === user.id);
const shownTo = (user) => orderParty(world.sheets(), memberOf(user).partyOrder).map((sheet) => sheet.name);

await test("every member starts on the table's own order, oldest sheet first", async () => {
  for (const user of [world.owner, brannUser, kaelUser]) {
    assert.deepEqual(memberOf(user).partyOrder, []);
    assert.deepEqual(shownTo(user), ["Tavi", "Brann", "Kael"]);
  }
});

await test("a player's order is theirs: saved on their membership, and nobody else's view moves", async () => {
  const saved = await patch(brannUser, { partyOrder: [brann.id, kael.id, tavi.id] });
  assert.equal(saved.status, 200, saved.body.error);
  assert.deepEqual(saved.body.member.partyOrder, [brann.id, kael.id, tavi.id]);
  assert.deepEqual(shownTo(brannUser), ["Brann", "Kael", "Tavi"]);
  assert.deepEqual(shownTo(world.owner), ["Tavi", "Brann", "Kael"]);
  assert.deepEqual(shownTo(kaelUser), ["Tavi", "Brann", "Kael"]);
  // Two players, two orders, side by side.
  await patch(kaelUser, { partyOrder: [kael.id] });
  assert.deepEqual(shownTo(kaelUser), ["Kael", "Tavi", "Brann"]);
  assert.deepEqual(shownTo(brannUser), ["Brann", "Kael", "Tavi"]);
});

await test("only this table's sheets count, each once; a stranger's id and a repeat are dropped", async () => {
  const saved = await patch(brannUser, { partyOrder: ["not-a-sheet", kael.id, kael.id, brann.id] });
  assert.equal(saved.status, 200, saved.body.error);
  assert.deepEqual(saved.body.member.partyOrder, [kael.id, brann.id]);
  assert.deepEqual(shownTo(brannUser), ["Kael", "Brann", "Tavi"]);
});

await test("the other preferences still save on their own, and an empty patch is refused", async () => {
  const hold = await patch(brannUser, { holdRolls: true });
  assert.equal(hold.status, 200, hold.body.error);
  assert.equal(memberOf(brannUser).holdRolls, true);
  assert.deepEqual(memberOf(brannUser).partyOrder, [kael.id, brann.id], "an unrelated patch leaves the order alone");
  assert.equal((await patch(brannUser, {})).status, 400);
  assert.equal((await patch(brannUser, { partyOrder: "first" })).status, 400);
  assert.equal((await patch(brannUser, { partyOrder: [""] })).status, 400);
});

await test("an empty list restores the table's order", async () => {
  const reset = await patch(brannUser, { partyOrder: [] });
  assert.equal(reset.status, 200, reset.body.error);
  assert.deepEqual(reset.body.member.partyOrder, []);
  assert.deepEqual(shownTo(brannUser), ["Tavi", "Brann", "Kael"]);
});

await test("a card that leaves is forgotten; a newcomer lands at the end of a kept order", async () => {
  await patch(kaelUser, { partyOrder: [kael.id, brann.id, tavi.id] });
  const sheets = await import("../src/lib/db/sheets.ts");
  const kept = world.sheets().filter((sheet) => sheet.id !== brann.id);
  assert.deepEqual(orderParty(kept, memberOf(kaelUser).partyOrder).map((sheet) => sheet.name), ["Kael", "Tavi"]);
  const newcomer = world.addHero({ name: "Vex", class: "cleric", level: 3 });
  assert.deepEqual(shownTo(kaelUser), ["Kael", "Brann", "Tavi", "Vex"]);
  sheets.deleteSheetForUser(world.campaignId, world.sheet(newcomer.id).userId);
});

world.close();
finish();
