"use client";

import { Check, Loader2, Minus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { SectionHead } from "@/components/ui/SectionHead";
import { PanelError, kitButtonClass, panelField } from "./PanelKit";
import { PLAN_MAX_CHARS, waitingOn, type CoordinationEntry, type CoordinationPhase } from "@/lib/dm/coordination-logic";

// The plan the party is coordinating (issue 254), above the composer for
// every seat. Each player drafts a line per character they control, changes
// it until they mark it Ready, or passes; anyone in the plan may ask a
// companion for something; the lead can resolve it early (the missing pass)
// or set it aside. What each character means to do is shown to the whole
// party, so they can fit their moves together. Nothing reaches the DM until
// the plan resolves (src/lib/dm/coordination.ts).

const STATE_WORD: Record<CoordinationEntry["state"], string> = {
  waiting: "Waiting",
  drafting: "Drafting",
  ready: "Ready",
  pass: "Passed",
};

export function CoordinationPanel({
  campaignId,
  phase,
  meUserId,
  steersStory,
}: {
  campaignId: string;
  phase: CoordinationPhase;
  meUserId: string;
  steersStory: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const waiting = waitingOn(phase);
  const mine = phase.entries.some((entry) => !entry.companion && entry.userId === meUserId);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/coordination`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The plan did not change.");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the table.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const draftOf = (entry: CoordinationEntry) => drafts[entry.characterId] ?? entry.text;
  const setDraft = (entry: CoordinationEntry, text: string) =>
    setDrafts((current) => ({ ...current, [entry.characterId]: text.slice(0, PLAN_MAX_CHARS) }));
  const settle = async (entry: CoordinationEntry, state: "drafting" | "ready" | "pass") => {
    if (await send({ action: "plan", characterId: entry.characterId, text: draftOf(entry), state })) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[entry.characterId];
        return next;
      });
    }
  };

  return (
    <section className="panel ornate reveal mb-2 rounded-lg border-amber-500/40 p-3" data-coordination={phase.id} aria-label="Coordinated plan">
      <SectionHead
        title="The party acts together"
        glyph="tab-party"
        level="h3"
        aside={waiting.length ? `waiting on ${waiting.length}` : "all ready"}
      />
      <p className="mb-2 text-xs text-stone-400">
        {phase.prompt ? <span className="mr-1 font-serif italic text-amber-200/80">{phase.prompt}</span> : null}
        Say what each character does in the same moment, with any &quot;while&quot;, &quot;after&quot; or &quot;if&quot;. Nothing happens until
        every player is ready; then the DM resolves the plan as one moment.
      </p>
      <ul className="stagger space-y-2">
        {phase.entries.map((entry) => {
          const own = !entry.companion && entry.userId === meUserId;
          const settled = entry.state === "ready" || entry.state === "pass";
          return (
            <li
              key={entry.characterId}
              data-coordination-entry={entry.characterId}
              data-state={entry.state}
              className={cn(
                "rounded-md border px-2.5 py-2 transition-colors duration-200",
                entry.state === "ready" ? "border-emerald-700/50 bg-emerald-950/15" : "border-stone-800 bg-stone-950/40",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs">
                {entry.state === "ready" ? (
                  <Check className="motion-pop size-3.5 text-emerald-400" aria-hidden="true" />
                ) : entry.state === "pass" ? (
                  <Minus className="size-3.5 text-stone-500" aria-hidden="true" />
                ) : (
                  <span className="inline-block size-3.5 text-center text-[10px] leading-3 text-amber-300" aria-hidden="true">
                    ...
                  </span>
                )}
                <span className="font-medium text-stone-200">{entry.name}</span>
                <span className="text-[11px] text-stone-500">
                  {entry.companion
                    ? entry.text
                      ? `AI companion · asked by ${entry.requestedBy ?? "the party"}`
                      : "AI companion · acts as they see fit"
                    : STATE_WORD[entry.state]}
                </span>
              </div>

              {own && !settled ? (
                <div className="mt-1.5 space-y-1.5">
                  <textarea
                    value={draftOf(entry)}
                    onChange={(event) => setDraft(entry, event.target.value)}
                    rows={2}
                    maxLength={PLAN_MAX_CHARS}
                    placeholder={`What does ${entry.name} do? ("While Brann talks to the guard, I slip past to the gate.")`}
                    aria-label={`${entry.name}'s part in the plan`}
                    className={cn(panelField, "w-full resize-y text-xs")}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy || !draftOf(entry).trim()}
                      onClick={() => void settle(entry, "ready")}
                      className={kitButtonClass("primary")}
                      data-coordination-ready
                    >
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Ready
                    </button>
                    <button
                      type="button"
                      disabled={busy || draftOf(entry) === entry.text}
                      onClick={() => void settle(entry, "drafting")}
                      className={kitButtonClass("small")}
                    >
                      Share draft
                    </button>
                    <button type="button" disabled={busy} onClick={() => void settle(entry, "pass")} className={kitButtonClass("small")} data-coordination-pass>
                      Pass
                    </button>
                  </div>
                </div>
              ) : entry.text ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-stone-300" data-coordination-text>
                  {entry.text}
                </p>
              ) : null}

              {own && settled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ action: "plan", characterId: entry.characterId, state: "drafting" })}
                  className={cn(kitButtonClass("small"), "mt-1.5")}
                  data-coordination-change
                >
                  Change
                </button>
              ) : null}

              {entry.companion && mine ? (
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    value={draftOf(entry)}
                    onChange={(event) => setDraft(entry, event.target.value)}
                    maxLength={PLAN_MAX_CHARS}
                    placeholder={`Ask ${entry.name} to... (optional)`}
                    aria-label={`Ask ${entry.name} to`}
                    className={cn(panelField, "w-auto min-w-0 flex-1 text-xs")}
                  />
                  <button
                    type="button"
                    disabled={busy || draftOf(entry) === entry.text}
                    onClick={async () => {
                      if (await send({ action: "request", characterId: entry.characterId, text: draftOf(entry) })) {
                        setDrafts((current) => {
                          const next = { ...current };
                          delete next[entry.characterId];
                          return next;
                        });
                      }
                    }}
                    className={kitButtonClass("small", "shrink-0")}
                    data-coordination-request
                  >
                    {draftOf(entry).trim() ? "Ask" : "Withdraw"}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {steersStory ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ action: "resolve" })}
            className={kitButtonClass("small")}
            title={waiting.length ? `${waiting.join(", ")} will pass` : "Hand the plan to the DM now"}
            data-coordination-resolve
          >
            {waiting.length ? `Resolve now (${waiting.join(", ")} pass)` : "Resolve now"}
          </button>
          <button type="button" disabled={busy} onClick={() => void send({ action: "cancel" })} className={kitButtonClass("small")} data-coordination-cancel>
            Set aside
          </button>
        </div>
      ) : null}
      {error ? <PanelError className="mt-1.5">{error}</PanelError> : null}
    </section>
  );
}
