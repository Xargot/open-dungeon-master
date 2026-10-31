// Loot the model named that no list holds carries no stats, and nothing at the
// table said so or offered a way to give it some. On the Command Table the
// lead gives Pip such an item, then opens Adjust stats: the item says it has
// no stats at this table and offers "Give it stats", a link that opens the
// lead's newest workshop in a new tab with an item of that name drafted. A
// workshop item of the name is kept, and the next Adjust no longer marks it.
// Each viewport names its own item, since viewports share one world.
import { check, eventually, untilStill } from "../lib.mjs";

const scenario = {
  name: "give-item-stats",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const table = ids.commandTableId;
    const item = viewport === "phone" ? "Lantern of Echoes" : "Ring of Whispers";
    const sheetOf = async () => {
      const body = await (await api.get(`${base}/api/campaigns/${table}`)).json();
      return (body.sheets ?? []).find((sheet) => sheet.id === ids.pip);
    };
    const pip = await sheetOf();
    const given = await api.patch(`${base}/api/campaigns/${table}/sheets/${ids.pip}`, {
      data: { equipment: [...pip.equipment, { name: item, qty: 1 }], reason: "Found in the barrow" },
    });
    check(given.ok(), `Pip is given the ${item} (${given.status()})`);
    const listed = await (await api.get(`${base}/api/workshops`)).json();
    if (!(listed.workshops ?? []).length) {
      const made = await api.post(`${base}/api/workshops`, { data: { title: "Odds and Ends" } });
      check(made.ok(), `a workshop for the lead (${made.status()})`);
    }

    await t.open(`/campaigns/${table}`);
    const card = page.locator(`${root}[data-party-card="${ids.pip}"]`).locator("visible=true").first();
    for (const selector of [`${root}[data-tour="tab-party"]`, `${root}.cine-party button`]) {
      if (await card.count()) break;
      const door = page.locator(selector).locator("visible=true").first();
      if (await door.count()) {
        await t.tap(door);
        await eventually(() => card.count(), { timeoutMs: 800 }).catch(() => 0);
      }
    }
    await eventually(() => card.count(), { timeoutMs: 30_000, label: "Pip's party card" });
    await untilStill(page);
    const adjust = async () => {
      await t.tap(card.getByRole("button", { name: /^Options for / }));
      await t.tap(page.getByRole("menuitem", { name: "Adjust stats" }));
      const dialog = page.getByRole("dialog", { name: /^Adjust / });
      await eventually(() => dialog.count(), { label: "the Adjust dialog" });
      return dialog;
    };

    let dialog = await adjust();
    const give = dialog.getByRole("link", { name: /^Give it stats/ });
    await eventually(() => give.count(), { label: `Give it stats under the ${item}` });
    const href = (await give.getAttribute("href")) ?? "";
    check(href.includes("system=homebrew") && href.includes(`item=${encodeURIComponent(item)}`), `the link drafts the ${item} in the workshop (${href})`);
    check((await give.getAttribute("target")) === "_blank", "it opens in a new tab, so the table stays put");
    check((await dialog.getByText("No stats at this table yet.").count()) === 1, "only the item with no stats is marked");
    if (viewport === "phone") {
      const box = await give.boundingBox();
      check(Boolean(box && box.height >= 24), `a link a finger can press (${box?.height}px)`);
    }
    await give.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("give-stats");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("give-stats-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);

    if (!t.app) {
      const opened = page.context().waitForEvent("page");
      await t.tap(give);
      const tab = await opened;
      const name = tab.getByLabel("Name", { exact: true }).first();
      await eventually(async () => (await name.inputValue().catch(() => "")) === item, { timeoutMs: 30_000, label: `the workshop's item editor named ${item}` });
      await tab.close();
    }

    const kept = await api.post(`${base}/api/homebrew`, {
      data: { kind: "item", name: item, data: { desc: "It hums.", itemKind: "magic_item", rarity: "uncommon", requiresAttunement: false, effects: [{ kind: "ac_bonus", amount: 1 }] } },
    });
    check(kept.ok(), `the workshop keeps the ${item} (${kept.status()})`);
    await page.keyboard.press("Escape");
    await eventually(async () => !(await dialog.count()), { label: "the dialog closing" });
    const carried = (await sheetOf()).equipment.find((line) => line.name === item);
    check(Boolean(carried?.gear), `Pip's ${item} reads its stats`);
    dialog = await adjust();
    await untilStill(page);
    check((await dialog.getByRole("link", { name: /^Give it stats/ }).count()) === 0, `the ${item} is no longer marked`);
    await page.keyboard.press("Escape");
  },
};

export default scenario;
