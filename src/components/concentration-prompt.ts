"use client";

import { appConfirm } from "@/components/ui/ConfirmDialog";
import type { ConcentrationSwap } from "@/lib/dm/concentration-confirm-logic";

// The actions route's question before a cast ends a running concentration
// spell (issue 252), asked in the table's own dialog. Resolves to the
// acknowledgment to send again with the same action, or null when the
// player keeps the spell they hold (nothing was posted or spent).
export async function askConcentrationSwap(data: unknown): Promise<ConcentrationSwap | null> {
  const swap = (data as { confirmConcentration?: ConcentrationSwap & { characterName?: string } } | null)?.confirmConcentration;
  if (!swap?.characterId || !swap.current || !swap.next) {
    return null;
  }
  const who = swap.characterName ? `${swap.characterName}'s` : "your";
  const yes = await appConfirm(
    `Casting ${swap.next} will end ${who} concentration on ${swap.current}, and its effects end with it. Cancel to keep ${swap.current}; nothing is spent.`,
    { title: `Replace ${swap.current}?`, actionLabel: `Cast ${swap.next}`, tone: "plain" },
  );
  return yes ? { characterId: swap.characterId, current: swap.current, next: swap.next } : null;
}

// Whether a refusal from the actions route is that question.
export function isConcentrationQuestion(status: number, data: unknown): boolean {
  return status === 409 && Boolean((data as { confirmConcentration?: unknown } | null)?.confirmConcentration);
}
