import { allocateSeq, campaignSeats, combatOwnsFloor, getFloor, listMembers, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { nowIso } from "@/lib/db/core";
import { dmNarratedSince, insertCoordination, latestCoordination, planStillPosted, saveCoordination } from "@/lib/db/coordination";
import { claimNarrationSeq } from "@/lib/dm/narration-slot";
import { requestDmTurn } from "@/lib/dm/loop";
import { hasHumanDm, narratorIsAi } from "@/lib/dm/viewer";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import {
  coordinationBlock,
  frozenEntries,
  humansSettled,
  lapsed,
  setAsideNote,
  stagePlan,
  stageRequest,
  type CoordinationEntry,
  type CoordinationPhase,
} from "@/lib/dm/coordination-logic";

// Coordinate actions (issue 254), the server half: opening a plan, staging,
// resolving it into one DM turn, and setting it aside. The rules are in
// src/lib/dm/coordination-logic.ts. Every change is published as
// coordination_updated with the phase (or null), so every seat, a reload
// included, draws the same plan.

function publish(campaignId: string, phase: CoordinationPhase | null) {
  publishPersisted(campaignId, "coordination_updated", { phase });
}

// A table note, posted like the server's other lines.
function tableNote(campaignId: string, content: string) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({ campaignId, seq, authorType: "system", glyph: "cue-bell", content });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

function setAside(phase: CoordinationPhase, reason: "fight" | "lapsed" | "cancelled"): CoordinationPhase {
  const ended = saveCoordination({ ...phase, status: "cancelled", outcome: reason, updatedAt: nowIso() });
  tableNote(phase.campaignId, setAsideNote(phase, reason));
  publish(phase.campaignId, null);
  return ended;
}

// The plan the table is drafting now, or null. A fight that began, or a plan
// untouched for two hours, sets it aside here, on whichever read comes first,
// so a plan can never hold a table that has moved on.
export function currentCoordination(campaignId: string): CoordinationPhase | null {
  const phase = latestCoordination(campaignId);
  if (!phase || phase.status !== "drafting") {
    return null;
  }
  if (getActiveEncounter(campaignId) || combatOwnsFloor(getFloor(campaignId))) {
    setAside(phase, "fight");
    return null;
  }
  if (lapsed(phase, Date.now())) {
    setAside(phase, "lapsed");
    return null;
  }
  return phase;
}

// Whether the table may coordinate at all: the AI narrates it, and no fight
// owns the floor.
export function coordinationRefusal(campaign: Campaign): string | null {
  if (!narratorIsAi(campaign.gameSettings.dmMode) || hasHumanDm(campaignSeats(campaign))) {
    return "Coordinated actions are for a table the AI narrates; a DM in the seat already takes the party's moves together.";
  }
  if (campaign.status !== "active") {
    return "The adventure has not started yet.";
  }
  if (getActiveEncounter(campaign.id) || combatOwnsFloor(getFloor(campaign.id))) {
    return "A fight is running; the initiative order takes the turns now.";
  }
  return null;
}

export function openCoordination(
  campaign: Campaign,
  openedBy: string,
  input: { characterIds: string[]; prompt: string },
): { phase: CoordinationPhase } | { error: string; status: number } {
  const refusal = coordinationRefusal(campaign);
  if (refusal) {
    return { error: refusal, status: 409 };
  }
  if (currentCoordination(campaign.id)) {
    return { error: "The party is already coordinating; resolve or set aside that plan first.", status: 409 };
  }
  const wanted = new Set(input.characterIds);
  const sheets = listSheets(campaign.id).filter((sheet) => !wanted.size || wanted.has(sheet.id));
  const now = nowIso();
  const entries: CoordinationEntry[] = sheets.map((sheet) => ({
    characterId: sheet.id,
    name: sheet.name,
    userId: sheet.isCompanion ? null : sheet.userId,
    companion: Boolean(sheet.isCompanion),
    text: "",
    state: "waiting" as const,
    requestedBy: null,
    updatedAt: now,
  }));
  if (!entries.some((entry) => !entry.companion)) {
    return { error: "Pick at least one player's character to coordinate.", status: 400 };
  }
  const phase = insertCoordination({ campaignId: campaign.id, openedBy, prompt: input.prompt.trim().slice(0, 300), entries });
  publish(campaign.id, phase);
  return { phase };
}

// A player's own character, or a request for a companion; resolves the plan
// when this was the last player it waited on.
export function stageCoordination(
  campaignId: string,
  userId: string,
  input:
    | { kind: "plan"; characterId: string; text?: string; state: "drafting" | "ready" | "pass" }
    | { kind: "request"; characterId: string; text: string; requestedBy: string },
): { phase: CoordinationPhase } | { error: string; status: number } {
  const phase = currentCoordination(campaignId);
  if (!phase) {
    return { error: "The party is not coordinating right now.", status: 409 };
  }
  if (input.kind === "request" && !phase.entries.some((entry) => !entry.companion && entry.userId === userId)) {
    return { error: "Only a player in the plan may ask a companion for something.", status: 403 };
  }
  const now = nowIso();
  const staged =
    input.kind === "plan"
      ? stagePlan(phase, { characterId: input.characterId, userId, text: input.text, state: input.state }, now)
      : stageRequest(phase, { characterId: input.characterId, text: input.text, requestedBy: input.requestedBy }, now);
  if ("error" in staged) {
    return { error: staged.error, status: 400 };
  }
  const saved = saveCoordination(staged.phase);
  if (humansSettled(saved)) {
    return { phase: resolveCoordination(saved) };
  }
  publish(campaignId, saved);
  return { phase: saved };
}

// Freezes the plan and hands it to the DM: each player's line is posted as
// their character's own action, a companion's request stays in the plan the
// DM reads, and ONE turn is requested. Synchronous up to that request, so two
// readies landing together resolve it once; a phase no longer drafting is
// returned as it is (a retry replays nothing).
export function resolveCoordination(phase: CoordinationPhase): CoordinationPhase {
  const latest = latestCoordination(phase.campaignId);
  if (!latest || latest.id !== phase.id || latest.status !== "drafting") {
    return latest ?? phase;
  }
  const entries = frozenEntries(phase);
  claimNarrationSeq(phase.campaignId);
  let firstSeq: number | null = null;
  for (const entry of entries) {
    if (entry.companion || entry.state !== "ready" || !entry.text || !entry.userId) {
      continue;
    }
    const seq = allocateSeq(phase.campaignId);
    firstSeq ??= seq;
    const message = insertCampaignMessage({
      campaignId: phase.campaignId,
      seq,
      authorType: "player",
      userId: entry.userId,
      characterId: entry.characterId,
      content: entry.text,
    });
    publishWithSeq(phase.campaignId, seq, "message_added", { message });
  }
  const passed = entries.filter((entry) => !entry.companion && entry.state === "pass").map((entry) => entry.name);
  const asked = entries.filter((entry) => entry.companion && entry.text);
  const noteSeq = allocateSeq(phase.campaignId);
  firstSeq ??= noteSeq;
  const note = insertCampaignMessage({
    campaignId: phase.campaignId,
    seq: noteSeq,
    authorType: "system",
    glyph: "cue-bell",
    content: [
      "The party acts together; the DM resolves the plan as one moment.",
      ...asked.map((entry) => `${entry.requestedBy ?? "The party"} asked ${entry.name} to ${entry.text}.`),
      ...(passed.length ? [`Passed: ${passed.join(", ")}.`] : []),
    ].join(" "),
  });
  publishWithSeq(phase.campaignId, noteSeq, "message_added", { message: note });
  const resolved = saveCoordination({ ...phase, entries, status: "resolved", resolvedSeq: firstSeq, updatedAt: nowIso() });
  publish(phase.campaignId, null);
  requestDmTurn(phase.campaignId);
  return resolved;
}

export function cancelCoordination(campaignId: string): CoordinationPhase | null {
  const phase = currentCoordination(campaignId);
  return phase ? setAside(phase, "cancelled") : null;
}

// The block the DM reads with the turn a resolved plan woke, until it has
// narrated past the plan (src/lib/dm/prompt.ts).
export function coordinationForPrompt(campaignId: string): string | null {
  const phase = latestCoordination(campaignId);
  if (!phase || phase.status !== "resolved" || phase.resolvedSeq === null) {
    return null;
  }
  if (dmNarratedSince(campaignId, phase.resolvedSeq) || !planStillPosted(campaignId, phase.resolvedSeq)) {
    return null;
  }
  const names = new Map(listMembers(campaignId).map((member) => [member.userId, member.username]));
  return coordinationBlock(phase, (userId) => names.get(userId) ?? "player");
}

// Whether a player's own move should go into the plan instead: their
// character is in the plan being drafted.
export function inCoordination(campaignId: string, characterId: string): CoordinationPhase | null {
  const phase = currentCoordination(campaignId);
  return phase && phase.entries.some((entry) => !entry.companion && entry.characterId === characterId) ? phase : null;
}
