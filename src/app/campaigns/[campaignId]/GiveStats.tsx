"use client";

import { Hammer } from "lucide-react";
import { useEffect, useState } from "react";
import { kitButtonClass } from "./PanelKit";
import { textKey } from "@/lib/language/text-logic";

// Loot the model named that no list holds carries no stats: a "Ring of
// Whispers" is a name and nothing more. A workshop item of the same name,
// written by whoever runs the table, gives it its stats on the next read
// (hydrateHomebrewGear), the copies already carried included. The lead's
// Adjust dialog marks such items and opens that editor with the name in it,
// in a new tab, so the table stays where it was.

export type UnknownGear = { names: string[]; canAuthor: boolean; workshopId: string | null };

export function useUnknownGear(campaignId: string, sheetId: string): UnknownGear | null {
  const [found, setFound] = useState<UnknownGear | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/campaigns/${campaignId}/sheets/${sheetId}/unknown-gear`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: UnknownGear | null) => {
        if (live && body && Array.isArray(body.names)) setFound(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [campaignId, sheetId]);
  return found;
}

export function GiveStats({ name, gear }: { name: string; gear: UnknownGear | null }) {
  if (!gear || !gear.names.some((entry) => textKey(entry) === textKey(name))) {
    return null;
  }
  return (
    <p className="reveal flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-[11px] text-stone-400">
      <span>No stats at this table yet.</span>
      {!gear.canAuthor ? (
        <span>The table&apos;s host or GM can give it some in their workshop.</span>
      ) : gear.workshopId ? (
        <a
          href={`/workshop/${gear.workshopId}?system=homebrew&item=${encodeURIComponent(name)}`}
          target="_blank"
          rel="noopener"
          className={kitButtonClass("small", "gap-1 py-0.5")}
        >
          <Hammer className="size-3.5" aria-hidden="true" />
          Give it stats
          <span className="sr-only"> (opens the workshop in a new tab)</span>
        </a>
      ) : (
        <a href="/workshop" target="_blank" rel="noopener" className={kitButtonClass("link")}>
          Make a workshop to give it stats
        </a>
      )}
    </p>
  );
}
