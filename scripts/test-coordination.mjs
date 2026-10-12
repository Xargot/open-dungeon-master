// Coordinate actions (issue 254): a plan staged by several players and
// resolved as one DM beat. Nothing reaches the DM until every player's
// character is ready or passed, a player with two characters readies each,
// a companion never holds the plan up, the plan resolves once however many
// readies land, the lead can resolve it early or set it aside, a fight or a
// lapse sets it aside with what did not happen said, and a character in the
// plan cannot post a move around it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import {
  coordinationBlock,
  frozenEntries,
  humansSettled,
  lapsed,
  setAsideNote,
  stagePlan,
  stageRequest,
} from "../src/lib/dm/coordination-logic.ts";

const { test, finish } = suite("test-coordination");

const entry = (overrides) => ({ name: "X", userId: "u1", companion: false, text: "", state: "waiting", requestedBy: null, updatedAt: "2026-10-11T00:00:00.000Z", ...overrides });
const phaseOf = (entries) => ({ id: "p", campaignId: "c", status: "drafting", openedBy: "u1", prompt: "", entries, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z", resolvedSeq: null, outcome: "" });

await test("The rules: a player stages only their own characters, ready needs words, companions never gate.", () => {
  const phase = phaseOf([
    entry({ characterId: "a", name: "Tavi", userId: "u1" }),
    entry({ characterId: "b", name: "Brann", userId: "u2" }),
    entry({ characterId: "m", name: "Mara", userId: null, companion: true }),
  ]);
  assert.match(stagePlan(phase, { characterId: "b", userId: "u1", text: "x", state: "ready" }, "t").error, /Only Brann's player/);
  assert.match(stagePlan(phase, { characterId: "a", userId: "u1", text: "  ", state: "ready" }, "t").error, /before marking it ready/);
  assert.match(stagePlan(phase, { characterId: "m", userId: "u1", text: "x", state: "ready" }, "t").error, /AI companion/);
  const tavi = stagePlan(phase, { characterId: "a", userId: "u1", text: "While Brann talks, I slip past.", state: "ready" }, "t").phase;
  assert.equal(humansSettled(tavi), false);
  const both = stagePlan(tavi, { characterId: "b", userId: "u2", state: "pass" }, "t").phase;
  assert.equal(humansSettled(both), true, "a companion with no request does not hold the plan");
  const asked = stageRequest(both, { characterId: "m", text: "cover the exit", requestedBy: "kaleb" }, "t").phase;
  const block = coordinationBlock(asked, (id) => (id === "u1" ? "kaleb" : "dana"));
  assert.match(block, /Tavi \(kaleb\): While Brann talks, I slip past\./);
  assert.match(block, /Passed .*Brann/);
  assert.match(block, /Mara \(AI companion.*asked by kaleb to cover the exit/);
  assert.match(block, /ONE scene beat/);
  assert.equal(frozenEntries(phaseOf([entry({ characterId: "a", state: "drafting" })]))[0].state, "pass", "an unsettled player passes when resolved");
  assert.equal(lapsed({ status: "drafting", updatedAt: "2026-10-11T00:00:00.000Z" }, Date.parse("2026-10-11T03:00:00.000Z")), true);
  assert.match(setAsideNote(asked, "fight"), /A fight began.*none of it was carried out.*Tavi: While Brann talks/);
});

const world = await openWorld();
const route = await world.route("campaigns/[campaignId]/coordination");
const actions = await world.route("campaigns/[campaignId]/actions");
const { countMessages, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { coordinationForPrompt, currentCoordination } = await import("../src/lib/dm/coordination.ts");

const tavi = world.addHero({ name: "Tavi", class: "rogue", level: 3 });
const brann = world.addHero({ name: "Brann", class: "fighter", level: 3 });
// A second character for Brann's player, and an AI companion.
const pip = world.addHero({ name: "Pip", class: "bard", level: 3, user: { id: brann.userId } });
const mara = world.addHero({ name: "Mara", class: "cleric", level: 3 });
getDatabase().prepare(`UPDATE character_sheets SET is_companion = 1 WHERE id = ?`).run(mara.id);

const userById = (id) => ({ id, username: id === world.owner.id ? world.owner.username : "dana" });
async function post(user, body) {
  world.signIn(user);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}
async function act(user, characterId, content, kind = "do") {
  world.signIn(user);
  const response = await actions.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, characterId, content }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("Only whoever steers the story opens a plan; the whole party joins when none are named.", async () => {
  const refused = await post(userById(brann.userId), { action: "open" });
  assert.equal(refused.status, 403);
  const opened = await post(world.owner, { action: "open", prompt: "Getting past the gate guard" });
  assert.equal(opened.status, 200, opened.json.error);
  assert.deepEqual(opened.json.phase.entries.map((entry) => entry.name).sort(), ["Brann", "Mara", "Pip", "Tavi"]);
  assert.equal(opened.json.phase.entries.find((entry) => entry.name === "Mara").companion, true);
  assert.equal((await post(world.owner, { action: "open" })).status, 409, "one plan at a time");
});

await test("A character in the plan cannot post a move around it; table talk is free.", async () => {
  const held = await act(world.owner, tavi.id, "I run for the gate.");
  assert.equal(held.status, 409);
  assert.equal(held.json.coordinating, true);
  assert.equal((await act(world.owner, tavi.id, "brb, coffee", "ooc")).status, 202);
});

await test("Nothing reaches the DM until every player's character is ready; drafts can change.", async () => {
  const before = countMessages(world.campaignId);
  let staged = await post(world.owner, { action: "plan", characterId: tavi.id, text: "While Brann distracts the guard, I slip past to the gate.", state: "ready" });
  assert.equal(staged.status, 200, staged.json.error);
  staged = await post(world.owner, { action: "plan", characterId: tavi.id, state: "drafting" });
  assert.equal(staged.json.phase.entries.find((entry) => entry.characterId === tavi.id).state, "drafting", "Change reopens it");
  staged = await post(world.owner, { action: "plan", characterId: tavi.id, text: "While Brann distracts the guard, I slip past to the side door.", state: "ready" });
  staged = await post(userById(brann.userId), { action: "plan", characterId: brann.id, text: "I tell the guard a long story about my cousin's goat.", state: "ready" });
  assert.equal(staged.json.phase.status, "drafting", "Pip's player has not readied Pip yet");
  assert.equal(countMessages(world.campaignId), before, "nothing posted while the plan drafts");
  staged = await post(world.owner, { action: "request", characterId: mara.id, text: "watch the road behind us" });
  assert.equal(staged.json.phase.status, "drafting", "the companion request did not resolve the plan");
  const resolved = await post(userById(brann.userId), { action: "plan", characterId: pip.id, state: "pass" });
  assert.equal(resolved.json.phase.status, "resolved");
  assert.equal(currentCoordination(world.campaignId), null);
  const posted = listRecentMessages(world.campaignId, 5);
  assert.ok(posted.some((message) => message.characterId === tavi.id && /side door/.test(message.content)), "Tavi's final draft was not posted");
  assert.ok(posted.some((message) => message.characterId === brann.id && /goat/.test(message.content)));
  assert.ok(!posted.some((message) => message.characterId === pip.id), "a pass posts nothing");
  assert.ok(posted.some((message) => message.authorType === "system" && /acts together/.test(message.content) && /asked Mara to watch the road behind us/.test(message.content)));
  const block = coordinationForPrompt(world.campaignId);
  assert.match(block, /Tavi .*side door/);
  assert.match(block, /Mara \(AI companion/);
  assert.match(block, /Passed .*Pip/);
});

await test("The plan resolves once: a late ready and a lead's resolve replay nothing.", async () => {
  const count = countMessages(world.campaignId);
  const late = await post(world.owner, { action: "plan", characterId: tavi.id, text: "again", state: "ready" });
  assert.equal(late.status, 409);
  assert.equal((await post(world.owner, { action: "resolve" })).status, 409);
  assert.equal(countMessages(world.campaignId), count);
});

await test("Once the DM narrates past it, the plan leaves the prompt.", async () => {
  world.say("dm", "The guard laughs at the goat story as Tavi slips through the side door.");
  assert.equal(coordinationForPrompt(world.campaignId), null);
});

await test("The lead resolves early with the missing passed, or sets the plan aside.", async () => {
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I check the lock.", state: "ready" });
  const early = await post(world.owner, { action: "resolve" });
  assert.equal(early.json.phase.status, "resolved");
  assert.match(coordinationForPrompt(world.campaignId), /Passed .*Brann/);
  world.say("dm", "The lock is old.");
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I wait.", state: "ready" });
  const cancelled = await post(world.owner, { action: "cancel" });
  assert.equal(cancelled.json.phase.status, "cancelled");
  assert.match(listRecentMessages(world.campaignId, 1)[0].content, /set the party's coordinated plan aside/);
  assert.equal((await act(world.owner, tavi.id, "I walk on.")).status, 202, "the table plays on as before");
});

await test("A fight that begins sets an unresolved plan aside, saying what did not happen.", async () => {
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I pick the lock.", state: "ready" });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.equal(currentCoordination(world.campaignId), null);
  assert.match(listRecentMessages(world.campaignId, 3).map((message) => message.content).join(" "), /A fight began.*Tavi: I pick the lock/);
  assert.equal((await post(world.owner, { action: "open" })).status, 409, "no plan while initiative runs");
});

world.close();
finish();
