"use client";

import { useCallback, useState } from "react";
import type { HandLayout } from "@/lib/battlemap/hand-layout";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The player's arrangement of one character's Hand (issue 231): the sheet's
// own, with a change shown the moment it is made and kept until the sheet
// that carries it comes back. A refused or failed save puts the last saved
// one back and says why.
export function useHandLayout(campaignId: string, sheet: CharacterSheet | null) {
  const [pending, setPending] = useState<{ sheetId: string; layout: HandLayout | null; seen: string } | null>(null);
  const savedJson = JSON.stringify(sheet?.handLayout ?? null);
  // Once the sheet carries something other than what it carried when the
  // change was made (the save landing, or another screen's), it is the truth.
  const local = pending && sheet && pending.sheetId === sheet.id && pending.seen === savedJson ? pending : null;
  const layout: HandLayout | null = local ? local.layout : (sheet?.handLayout ?? null);

  const save = useCallback(
    async (next: HandLayout | null): Promise<string | null> => {
      if (!sheet) return "There is no character to arrange.";
      setPending({ sheetId: sheet.id, layout: next, seen: savedJson });
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/sheet/hand`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: sheet.id, layout: next }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setPending(null);
          return data.error || "Could not save your hand.";
        }
        return null;
      } catch {
        setPending(null);
        return "Could not reach the server; your hand is as it was.";
      }
    },
    [campaignId, sheet, savedJson],
  );

  return { layout, save };
}
