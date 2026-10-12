// Each viewer's own order for the Party panel's cards (issue 240): the
// saved order comes first, newcomers land at the end, a card that left is
// forgotten, and a move or a drop puts one card where it was let go.
import assert from "node:assert/strict";
import {
  moveInPartyOrder,
  normalizePartyOrder,
  orderParty,
  placeInPartyOrder,
  samePartyOrder,
} from "../src/lib/party-order.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const ids = (list) => list.map((card) => card.id);

test("no saved order is the table's own order", () => {
  assert.deepEqual(ids(orderParty(cards, [])), ["a", "b", "c", "d"]);
});

test("the saved order comes first; cards it does not name follow in the order they arrived", () => {
  assert.deepEqual(ids(orderParty(cards, ["c", "a"])), ["c", "a", "b", "d"]);
  // A newcomer (a companion the story wrote in) lands at the end, never hidden.
  assert.deepEqual(ids(orderParty([...cards, { id: "e" }], ["d", "b"])), ["d", "b", "a", "c", "e"]);
});

test("a saved id for a card that left is ignored, and a repeated one counts once", () => {
  assert.deepEqual(ids(orderParty(cards, ["gone", "b", "b", "a"])), ["b", "a", "c", "d"]);
  assert.deepEqual(normalizePartyOrder(["gone", "b", "", "b", 7, "a"], ["a", "b", "c"]), ["b", "a"]);
  assert.deepEqual(normalizePartyOrder("not a list", ["a"]), []);
  assert.deepEqual(normalizePartyOrder(null, ["a"]), []);
});

test("one step up or down, and the ends hold", () => {
  assert.deepEqual(moveInPartyOrder(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveInPartyOrder(["a", "b", "c"], "a", 1), ["b", "a", "c"]);
  assert.deepEqual(moveInPartyOrder(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveInPartyOrder(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveInPartyOrder(["a", "b", "c"], "zz", 1), ["a", "b", "c"]);
  assert.deepEqual(moveInPartyOrder(["a", "b", "c"], "b", 0), ["a", "b", "c"]);
});

test("a drop puts the card just before or after the one it was let go over", () => {
  assert.deepEqual(placeInPartyOrder(["a", "b", "c", "d"], "d", "a", "before"), ["d", "a", "b", "c"]);
  assert.deepEqual(placeInPartyOrder(["a", "b", "c", "d"], "a", "c", "after"), ["b", "c", "a", "d"]);
  assert.deepEqual(placeInPartyOrder(["a", "b", "c", "d"], "a", "b", "before"), ["a", "b", "c", "d"]);
  assert.deepEqual(placeInPartyOrder(["a", "b", "c", "d"], "b", "b", "after"), ["a", "b", "c", "d"]);
  assert.deepEqual(placeInPartyOrder(["a", "b", "c"], "a", "zz", "after"), ["a", "b", "c"]);
});

test("same order is the same order", () => {
  assert.ok(samePartyOrder(["a", "b"], ["a", "b"]));
  assert.ok(!samePartyOrder(["a", "b"], ["b", "a"]));
  assert.ok(!samePartyOrder(["a"], ["a", "b"]));
});

test("the order is display only: the cards themselves are untouched", () => {
  const before = JSON.stringify(cards);
  orderParty(cards, ["d", "c", "b", "a"]);
  moveInPartyOrder(ids(cards), "a", 1);
  assert.equal(JSON.stringify(cards), before);
});

console.log(`test-party-order: ${passed} passed`);
