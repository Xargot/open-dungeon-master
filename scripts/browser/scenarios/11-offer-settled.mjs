// Issue 239: settling a DM offer settles the story. The lead accepts the
// offer waiting on Tavi; the bar clears, and the chronicle shows one system
// line saying who accepted what and what it left on the sheet, in words
// (the marker the DM reads is never printed).
import { check, eventually } from "../lib.mjs";

export default {
  name: "offer-settled",
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    const bar = page.locator(`${root}.panel`).filter({ hasText: ids.offerSummary }).locator("visible=true").first();
    await eventually(() => bar.count(), { timeoutMs: 30_000, label: "the offer waiting on Tavi" });
    const accept = bar.getByRole("button", { name: /^accept$/i }).first();
    await eventually(() => accept.count(), { label: "the Accept button on the lead's own offer" });
    await t.shot("offered");
    await t.tap(accept);
    await eventually(() => bar.count().then((count) => count === 0), { label: "the bar clearing once accepted" });

    const log = page.locator(`${root}.cine-chronicle-log`).locator("visible=true").first();
    await eventually(() => log.count(), { timeoutMs: 30_000, label: "the chronicle beside the board" });
    const text = () => log.innerText().then((value) => value.replace(/\s+/g, " "));
    await eventually(async () => (await text()).includes("accepted the offer"), { label: "the settled offer on the scroll" });
    const shown = await text();
    check(
      shown.includes("Tavi Lockwhisper accepted the offer: Give Healing potion to Tavi Lockwhisper. Tavi Lockwhisper now carries Healing potion."),
      "the chronicle says who accepted what and what it left on the sheet",
    );
    check(!shown.includes("[Offer settled]"), "the marker the DM reads is not printed");

    // The sheet moved, and the row remembers how it went.
    const response = await api.get(`${base}/api/campaigns/${ids.campaignId}`);
    const data = await response.json();
    const tavi = (data.sheets ?? []).find((sheet) => sheet.id === ids.tavi);
    check(Boolean(tavi?.equipment?.some((item) => /healing potion/i.test(item.name))), "Tavi carries the potion");
    check((data.itemProposals ?? []).length === 0, "no offer is left waiting");
    await t.shot("settled");
  },
};
