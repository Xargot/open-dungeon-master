// Each viewer's own order for the Party panel's cards (issue 240).
//
// A player keeps the cards they use most where they can find them: their
// own characters first, an AI companion lower. The order is theirs alone
// (campaign_members.party_order_json, one per member and campaign), so it
// follows their account between devices and changes nothing for anyone
// else: not the fight's initiative, not the travel formation, not another
// player's panel. Pure, with no "@/" imports, so scripts/test-party-order.mjs
// loads it directly.

// A saved order is a list of sheet ids, first card first. Unknown ids (a
// character that left) are dropped; a repeated id counts once.
export function normalizePartyOrder(saved: unknown, knownIds: readonly string[]): string[] {
  if (!Array.isArray(saved)) {
    return [];
  }
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of saved) {
    const id = String(entry ?? "");
    if (!id || !known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    order.push(id);
  }
  return order;
}

// The cards as the viewer sees them: the saved order first, then every card
// the saved order does not name in the order they arrived, so a newcomer
// (a new character, a companion the story wrote in) lands at the end and
// nothing is ever hidden. An empty saved order is the campaign's own.
export function orderParty<T extends { id: string }>(cards: readonly T[], saved: readonly string[]): T[] {
  if (!saved.length) {
    return [...cards];
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const placed = new Set<string>();
  const ordered: T[] = [];
  for (const id of saved) {
    const card = byId.get(id);
    if (card && !placed.has(id)) {
      placed.add(id);
      ordered.push(card);
    }
  }
  for (const card of cards) {
    if (!placed.has(card.id)) {
      ordered.push(card);
    }
  }
  return ordered;
}

// One step up (-1) or down (+1); the ends hold. Returns the same list when
// nothing moves, so a caller can skip a save.
export function moveInPartyOrder(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  const to = from + Math.sign(delta);
  if (from < 0 || to < 0 || to >= ids.length || delta === 0) {
    return [...ids];
  }
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// A drop: the card goes just before or just after the card it was let go
// over. Dropping a card on itself changes nothing.
export function placeInPartyOrder(
  ids: readonly string[],
  id: string,
  targetId: string,
  side: "before" | "after",
): string[] {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) {
    return [...ids];
  }
  const without = ids.filter((entry) => entry !== id);
  const at = without.indexOf(targetId) + (side === "after" ? 1 : 0);
  without.splice(at, 0, id);
  return without;
}

export function samePartyOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
