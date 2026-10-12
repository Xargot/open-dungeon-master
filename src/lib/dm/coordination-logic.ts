// Coordinate actions (issue 254): the party stages what its characters mean
// to do in the same moment, outside a fight, and the AI DM resolves the
// whole plan as one beat. Before this the only tools were the spotlight
// (answers posted as they came, counted per player, companions left out) and
// the coalescing of messages that happened to land together.
//
// A phase is opened by whoever steers the story, over the characters it
// names. Each player drafts a line per character they control, can change
// it, and marks it Ready or passes. A companion is not a gate: a player may
// stage a request for it ("cover the exit"), and the DM plays it from its own
// sheet when the plan resolves. Nothing is posted and no DM turn wakes until
// every player's character is Ready or passed, or the lead resolves it with
// whoever is missing passed. The plan is frozen at that moment, posted as
// each character's own action, and one DM turn reads it with the block
// below. Pure, and free of alias imports, so scripts/test-coordination.mjs
// reads it directly.

export const PLAN_MAX_CHARS = 600;
// A phase nobody has touched for this long lapses on the next read, so a
// table that wandered off is never left unable to act.
export const COORDINATION_IDLE_MS = 2 * 60 * 60 * 1000;

export type CoordinationEntryState = "waiting" | "drafting" | "ready" | "pass";

export type CoordinationEntry = {
  characterId: string;
  name: string;
  // The player who controls the character; null for an AI companion.
  userId: string | null;
  companion: boolean;
  // The draft: what the character means to do, in the player's words, with
  // any "while", "after" or "if" it depends on.
  text: string;
  state: CoordinationEntryState;
  // A companion's staged request: who asked for it.
  requestedBy: string | null;
  updatedAt: string;
};

export type CoordinationStatus = "drafting" | "resolved" | "cancelled";

export type CoordinationPhase = {
  id: string;
  campaignId: string;
  status: CoordinationStatus;
  openedBy: string;
  prompt: string;
  entries: CoordinationEntry[];
  createdAt: string;
  updatedAt: string;
  // The seq of the first line the resolution posted; the DM's block is read
  // until a narration lands after it.
  resolvedSeq: number | null;
  // Why it ended other than by resolving: "cancelled", "lapsed", "fight".
  outcome: string;
};

// Every player's character has said Ready or passed; companions never wait.
export function humansSettled(phase: Pick<CoordinationPhase, "entries">): boolean {
  return phase.entries.every((entry) => entry.companion || entry.state === "ready" || entry.state === "pass");
}

// Who the plan still waits on, by character name.
export function waitingOn(phase: Pick<CoordinationPhase, "entries">): string[] {
  return phase.entries
    .filter((entry) => !entry.companion && entry.state !== "ready" && entry.state !== "pass")
    .map((entry) => entry.name);
}

const clamp = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, PLAN_MAX_CHARS);

// A player's own character: its draft and its state. Refused for a character
// the player does not control, a companion (staged by request instead), an
// empty Ready, and a phase no longer drafting.
export function stagePlan(
  phase: CoordinationPhase,
  input: { characterId: string; userId: string; text?: string; state: "drafting" | "ready" | "pass" },
  now: string,
): { phase: CoordinationPhase } | { error: string } {
  if (phase.status !== "drafting") {
    return { error: "This plan has already been resolved or set aside." };
  }
  const entry = phase.entries.find((candidate) => candidate.characterId === input.characterId);
  if (!entry) {
    return { error: "That character is not part of this plan." };
  }
  if (entry.companion) {
    return { error: `${entry.name} is an AI companion; stage a request for them instead.` };
  }
  if (entry.userId !== input.userId) {
    return { error: `Only ${entry.name}'s player stages their part.` };
  }
  const text = input.text === undefined ? entry.text : clamp(input.text);
  if (input.state === "ready" && !text) {
    return { error: `Say what ${entry.name} does before marking it ready, or pass.` };
  }
  return {
    phase: {
      ...phase,
      updatedAt: now,
      entries: phase.entries.map((candidate) =>
        candidate.characterId === entry.characterId
          ? { ...candidate, text, state: input.state, updatedAt: now }
          : candidate,
      ),
    },
  };
}

// A player's request for an AI companion ("cover the exit"). Any player in
// the plan may stage one; an empty one withdraws it.
export function stageRequest(
  phase: CoordinationPhase,
  input: { characterId: string; text: string; requestedBy: string },
  now: string,
): { phase: CoordinationPhase } | { error: string } {
  if (phase.status !== "drafting") {
    return { error: "This plan has already been resolved or set aside." };
  }
  const entry = phase.entries.find((candidate) => candidate.characterId === input.characterId);
  if (!entry || !entry.companion) {
    return { error: "Requests are for the AI companions in the plan." };
  }
  const text = clamp(input.text);
  return {
    phase: {
      ...phase,
      updatedAt: now,
      entries: phase.entries.map((candidate) =>
        candidate.characterId === entry.characterId
          ? { ...candidate, text, state: text ? "ready" : "waiting", requestedBy: text ? input.requestedBy : null, updatedAt: now }
          : candidate,
      ),
    },
  };
}

// The plan as it is resolved: whoever had not settled passes, so a lead's
// "resolve now" names the missing rather than waiting on them forever.
export function frozenEntries(phase: Pick<CoordinationPhase, "entries">): CoordinationEntry[] {
  return phase.entries.map((entry) =>
    entry.companion || entry.state === "ready" || entry.state === "pass" ? entry : { ...entry, state: "pass" as const },
  );
}

export function lapsed(phase: Pick<CoordinationPhase, "status" | "updatedAt">, now: number): boolean {
  return phase.status === "drafting" && now - Date.parse(phase.updatedAt) > COORDINATION_IDLE_MS;
}

// What the DM reads with the turn the plan wakes: every frozen intention,
// attributed, and how to resolve them.
export function coordinationBlock(phase: Pick<CoordinationPhase, "entries" | "prompt">, playerOf: (userId: string) => string): string {
  const entries = frozenEntries(phase);
  const acting = entries.filter((entry) => !entry.companion && entry.state === "ready" && entry.text);
  const passed = entries.filter((entry) => !entry.companion && entry.state === "pass");
  const asked = entries.filter((entry) => entry.companion && entry.text);
  const helpers = entries.filter((entry) => entry.companion && !entry.text);
  const lines = [
    "COORDINATED ACTIONS: the party staged these together, outside a fight, and they happen in the same moment. Resolve them as ONE scene beat: honor the timing each one states (while, after, if), roll what needs a roll, and let the world and any enemies react where the fiction says they would. Being declared together guarantees no success. If a fight breaks out, start it as usual and say which declarations could not be carried out.",
    ...(phase.prompt ? [`The lead asked: ${phase.prompt}`] : []),
    ...acting.map((entry) => `- ${entry.name} (${entry.userId ? playerOf(entry.userId) : "player"}): ${entry.text}`),
    ...(passed.length ? [`- Passed (do nothing special this moment): ${passed.map((entry) => entry.name).join(", ")}`] : []),
    ...asked.map(
      (entry) =>
        `- ${entry.name} (AI companion, yours to play from their own sheet): asked${entry.requestedBy ? ` by ${entry.requestedBy}` : ""} to ${entry.text}. They act once, in this beat, with their own legal resources.`,
    ),
    ...(helpers.length
      ? [`- ${helpers.map((entry) => entry.name).join(", ")} (AI companion${helpers.length === 1 ? "" : "s"}): may support the plan as they see fit, once, from their own sheet${helpers.length === 1 ? "" : "s"}.`]
      : []),
  ];
  return lines.join("\n");
}

// The table note a fight or a lapse leaves when it sets an unresolved plan
// aside: what was staged and did not happen.
export function setAsideNote(phase: Pick<CoordinationPhase, "entries">, reason: "fight" | "lapsed" | "cancelled"): string {
  const staged = phase.entries.filter((entry) => entry.text && (entry.companion || entry.state === "ready" || entry.state === "drafting"));
  const why =
    reason === "fight"
      ? "A fight began before the party's coordinated plan was resolved"
      : reason === "lapsed"
        ? "The party's coordinated plan sat untouched and lapsed"
        : "The lead set the party's coordinated plan aside";
  return staged.length
    ? `${why}; none of it was carried out (${staged.map((entry) => `${entry.name}: ${entry.text}`).join("; ")}).`
    : `${why}.`;
}
