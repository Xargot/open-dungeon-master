"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { memo, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import type { HandCard, HandCardType, HandCost } from "@/lib/battlemap/hand";
import { previewRows, type HandAim, type PreviewRow } from "@/lib/battlemap/hand-play";

// One card of the Hand and the outcome preview that floats over it. Styles
// are in src/app/styles/hand.css; the tilt, the sheen and the art parallax
// come from the shared pointer module through the motion-card class, so
// nothing here listens to the pointer.

const TYPE_LABEL: Record<HandCardType, string> = {
  attack: "Attack",
  rider: "Rider",
  spell: "Spell",
  control: "Control",
  mend: "Mend",
  ward: "Ward",
  feature: "Feature",
  basic: "Basic",
};

const TYPE_TONE: Record<HandCardType, string> = {
  attack: "#ff9d5c",
  rider: "#f4d47a",
  spell: "#b8a6f5",
  control: "#b8a6f5",
  mend: "#7ed6a4",
  ward: "#9fe3f5",
  feature: "#f4d47a",
  basic: "#d6cfc2",
};

const COST_SHORT: Record<HandCost, string> = {
  action: "Action",
  bonus: "Bonus",
  reaction: "Reaction",
  rider: "Rider",
  free: "Free",
};

export function typeLabel(type: HandCardType): string {
  return TYPE_LABEL[type];
}

export function typeTone(type: HandCardType): string {
  return TYPE_TONE[type];
}

export function HandPreviewRows({ rows }: { rows: PreviewRow[] }) {
  return (
    <span className="hand-rows">
      {rows.map((row, index) => (
        <span key={row.key} className="hand-row" style={{ "--i": index } as CSSProperties}>
          <span className="hand-row-key">{row.key}</span>
          {/* Keyed by what it says, so a number that changes with the target
              arrives as a new one (hand-motion.css) instead of cutting. */}
          <span key={row.value} className="hand-row-value" data-tone={row.tone}>
            {row.value}
          </span>
        </span>
      ))}
    </span>
  );
}

// The committed card, face up over the hand while the table takes it in: the
// mockup's card-play and card-spend, both in hand-motion.css. Decoration only,
// the fan's own card is the one a screen reader hears about.
export function HandPlayedCard({ card }: { card: HandCard }) {
  return (
    <div className="hand-played" aria-hidden="true">
      <span className="hand-played-top">
        <span className="hand-cost" data-cost={card.cost}>
          {COST_SHORT[card.cost]}
        </span>
        <span className="hand-range">{card.range}</span>
      </span>
      <span className="hand-played-name">{card.name}</span>
      {card.dice ? (
        <span className="hand-dice" data-heals={card.heals ? "true" : undefined}>
          {card.dice}
        </span>
      ) : null}
    </div>
  );
}

function HandCardFaceInner({
  card,
  index,
  offset,
  step,
  picked,
  attached,
  played,
  aim,
  conditions,
  waiting = false,
  onPick,
}: {
  card: HandCard;
  index: number;
  // Seats from the middle of the fan, and the degrees between neighbours.
  offset: number;
  step: number;
  picked: boolean;
  // A rider that will ride the next attack.
  attached: boolean;
  played: boolean;
  // Who the preview's odds are worked against, and the conditions on the
  // character holding the hand.
  aim: HandAim | null;
  conditions: string[];
  // The only thing holding this card is that it is somebody else's turn.
  // Such a card is still read like a playable one: its preview opens, and
  // the hand's header, not a tooltip on every card, says whose turn it is.
  waiting?: boolean;
  onPick: (card: HandCard) => void;
}) {
  // Announce opening before Preact mounts the tooltip’s dismissal listener.
  const [previewOpen, setPreviewOpen] = useState(false);
  const rows = useMemo(() => previewRows(card, aim, conditions), [card, aim, conditions]);
  const aimName = aim && card.target === "enemy" && aim.kind === "enemy" ? aim.name : "";
  const slotStyle = {
    "--i": index,
    "--rot": `${(offset * step).toFixed(2)}deg`,
    "--ty": `${(offset * offset * 3.6 * Math.min(1, step / 4.4)).toFixed(1)}px`,
  } as CSSProperties;
  const button = (
    <button
      type="button"
      className="hand-card motion-card"
      data-type={card.type}
      data-tilt="16"
      data-picked={picked ? "true" : undefined}
      data-spent={card.spent ? "true" : undefined}
      data-played={played ? "true" : undefined}
      // aria-disabled, not disabled: a spent card still takes a press and a
      // hover, which is how it says why it cannot be played.
      aria-disabled={card.disabled ? "true" : undefined}
      aria-pressed={card.type === "rider" ? attached : undefined}
      aria-label={`${card.name}, ${COST_SHORT[card.cost]}${card.disabled ? `. ${card.disabled}` : ""}`}
      onClick={() => onPick(card)}
    >
      <span className="hand-card-frame" />
      <span className="hand-card-foil" />
      <span className="hand-card-sheen" />
      <span className="hand-card-ribbon">{TYPE_LABEL[card.type]}</span>
      <span className="hand-card-corner" data-at="tl" />
      <span className="hand-card-corner" data-at="br" />
      <span className="hand-card-body">
        <span className="hand-card-top">
          <span className="hand-cost" data-cost={card.cost}>
            {COST_SHORT[card.cost]}
          </span>
          <span className="hand-range">{card.range}</span>
        </span>
        <span className="hand-art">
          <GameIcon icon={card.icon} size="size-[52px] max-sm:size-9" className="hand-art-icon" />
        </span>
        <span className="hand-name">{card.name}</span>
        <span className="hand-numbers">
          {card.dice ? (
            <span className="hand-dice" data-heals={card.heals ? "true" : undefined}>
              {card.dice}
            </span>
          ) : null}
          <span className="hand-roll">{card.roll}</span>
        </span>
        <span className="hand-rules">{card.rules}</span>
        <span className="hand-foot">
          <span className="hand-resource">{card.resource}</span>
          <span className="hand-cond">{card.condition}</span>
        </span>
      </span>
    </button>
  );
  return (
    <div className="hand-slot" style={slotStyle}>
      {/* Portal full text outside the clipped fan; keep the trigger mounted when a card is spent. */}
      <RadixTooltip.Provider delayDuration={300}>
        <RadixTooltip.Root open={previewOpen} onOpenChange={setPreviewOpen}>
          <RadixTooltip.Trigger asChild>{button}</RadixTooltip.Trigger>
          <RadixTooltip.Portal>
            <RadixTooltip.Content
              side="top"
              sideOffset={8}
              collisionPadding={8}
              data-native-board-occluder
              style={{ maxWidth: "min(24rem, calc(100vw - 16px))", maxHeight: "min(70vh, 32rem, var(--radix-tooltip-content-available-height, 70vh))", overflowWrap: "anywhere", animation: "none" }}
              className="z-[70] w-max overflow-y-auto rounded-md border border-stone-600/60 bg-stone-950 p-3 text-xs leading-relaxed text-stone-200 shadow-elev-2"
            >
              <span className="block text-sm font-semibold text-amber-100">{aimName ? card.name + " · " + aimName : card.name}</span>
              <span className="mt-1 block text-stone-400">{[COST_SHORT[card.cost], card.range, card.resource].filter(Boolean).join(" · ")}</span>
              {card.dice || card.roll ? <span className="mt-1 block">{[card.dice, card.roll].filter(Boolean).join(" · ")}</span> : null}
              <span className="mt-2 block whitespace-pre-wrap">{card.description || card.rules}</span>
              {card.condition ? <span className="mt-2 block text-amber-200">{card.condition}</span> : null}
              {card.disabled && !waiting ? (
                <span className="mt-2 block text-amber-200">{card.disabled}</span>
              ) : (
                <span className="mt-2 block"><HandPreviewRows rows={rows} /></span>
              )}
            </RadixTooltip.Content>
          </RadixTooltip.Portal>
        </RadixTooltip.Root>
      </RadixTooltip.Provider>
    </div>
  );
}

export const HandCardFace = memo(HandCardFaceInner);
