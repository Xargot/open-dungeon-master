import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMembers, setMemberHoldRolls, setMemberPartyOrder, setMemberRealDice } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { normalizePartyOrder } from "@/lib/party-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchMeSchema = z
  .object({
    useRealDice: z.boolean().optional(),
    // Shake to roll: park every roll for this player to release. Not gated
    // by the dice policy because the server still draws the numbers.
    holdRolls: z.boolean().optional(),
    // This member's own order for the Party panel's cards (issue 240):
    // sheet ids, first card first; an empty list restores the default.
    partyOrder: z.array(z.string().min(1).max(80)).max(60).optional(),
  })
  .refine((data) => data.useRealDice !== undefined || data.holdRolls !== undefined || data.partyOrder !== undefined);

// Per-member preferences: physical dice opt-in, hold-my-rolls, party order.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchMeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid member update." }, { status: 400 });
  }

  if (context.campaign.gameSettings.dicePolicy !== "real_allowed" && parsed.data.useRealDice) {
    return Response.json(
      { error: "This campaign does not allow physical dice." },
      { status: 400 },
    );
  }

  if (parsed.data.useRealDice !== undefined) {
    setMemberRealDice(campaignId, context.user.id, parsed.data.useRealDice);
  }
  if (parsed.data.holdRolls !== undefined) {
    setMemberHoldRolls(campaignId, context.user.id, parsed.data.holdRolls);
  }
  if (parsed.data.partyOrder !== undefined) {
    // Only this table's sheets, each once; a card that left is forgotten.
    const known = listSheets(campaignId).map((sheet) => sheet.id);
    setMemberPartyOrder(campaignId, context.user.id, normalizePartyOrder(parsed.data.partyOrder, known));
  }
  const member = listMembers(campaignId).find((entry) => entry.userId === context.user.id);
  publishPersisted(campaignId, "member_updated", { member });
  return Response.json({ member });
}
