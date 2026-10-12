import { effectiveSpeedWord } from "@/lib/speed-tier";

// What the last calls at the Fast tier actually ran at, per connection and
// role, for the admin panel (issue 255): asked for Fast, and what the
// provider says it gave. Process memory only; a restart starts it empty.

export type SpeedChannel = "story" | "utility" | "agent-story" | "agent-utility";

export type SpeedNote = {
  model: string;
  // What the provider reported, in words; null when it reported nothing.
  effective: "fast" | "standard" | null;
  // The provider's own word for it ("priority", "default").
  reported: string | null;
  // Set when the Fast request itself was refused and the call went out at
  // standard speed instead (ODM's fallback policy), with the reason.
  refused?: string;
  at: number;
};

const store = (globalThis as { __odmSpeedStatus?: Map<SpeedChannel, SpeedNote> }).__odmSpeedStatus ??=
  new Map<SpeedChannel, SpeedNote>();

export function noteSpeed(
  channel: SpeedChannel,
  input: { model: string; reported?: string | null; refused?: string },
): void {
  store.set(channel, {
    model: input.model,
    effective: input.refused ? "standard" : effectiveSpeedWord(input.reported ?? null),
    reported: input.reported ?? null,
    ...(input.refused ? { refused: input.refused.slice(0, 300) } : {}),
    at: Date.now(),
  });
}

export function speedStatus(): Partial<Record<SpeedChannel, SpeedNote>> {
  return Object.fromEntries(store.entries());
}
