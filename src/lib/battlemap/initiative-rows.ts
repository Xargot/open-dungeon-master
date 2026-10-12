// The initiative order as the trackers draw it. Thief's Reflexes gives the
// thief a second entry in the first round (an order entry with `reflex`, the
// same character id at initiative - 10: src/lib/dm/encounter-logic.ts
// withReflexTurns), so a row is keyed by its position, never by the id, and
// the row the pointer rests on is found by position first.
//
// Pure: the public encounter's order in, indexes and labels out;
// scripts/test-hand-engine.mjs drives it.

export type OrderRow = { id: string; name: string; reflex?: boolean; extra?: string };

// The React key of a row: its id and its place, so a combatant with two turns
// keeps two rows.
export function orderRowKey(row: OrderRow, index: number): string {
  return `${row.id}-${index}${row.reflex ? "-reflex" : ""}`;
}

// The row the pointer rests on. A player's order leaves hidden combatants
// out, so the engine's turn index can point past them; then the engine's
// `acting` name finds the row. When the index already lands on the acting
// combatant it wins, which keeps a thief's two rows apart.
export function currentOrderIndex(
  order: OrderRow[],
  turnIndex: number,
  acting: { name: string } | null | undefined,
): number {
  if (!acting) return turnIndex;
  if (order[turnIndex]?.name === acting.name) return turnIndex;
  return order.findIndex((row) => row.name === acting.name);
}

// The tag a reflex row carries.
export const REFLEX_LABEL = "Thief's Reflexes";

// What a second row for the same character says: Thief's Reflexes' second
// turn in the first round, or an extra turn taken at once (Strength before
// Death, issue 233), which names the feature it comes from.
export function extraTurnTag(row: { reflex?: boolean; extra?: string }): { short: string; title: string } | null {
  if (!row.reflex) return null;
  return row.extra
    ? { short: "extra", title: `${row.extra}: an extra turn, taken now` }
    : { short: "2nd", title: `${REFLEX_LABEL}: a second turn this round` };
}
