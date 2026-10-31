// A companion the GM writes in comes with a background, skills that suit it
// and the expertise its class gives. Before, add_companion took the first
// skills on the class's list in table order, left the background empty and
// wrote no expertise, so a rogue companion was trained in Acrobatics,
// Athletics, Deception and Insight whatever it was, and doubled none. On the
// Bonds Table (one for each viewport, where the signed-in player is the GM)
// the GM's console brings in a rogue for a scene; its sheet
// shows a background, six skills and two of them doubled.
import { check, eventually, openPanelTab, untilStill } from "../lib.mjs";

const scenario = {
  name: "companion-training",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base, viewport } = t;
    const tableId = ids.bondTables[viewport].id;
    const name = "Wren Ashby";
    const call = async (tool, args) => {
      const response = await api.post(`${base}/api/campaigns/${tableId}/dm/invoke`, { data: { name: tool, args } });
      const body = await response.json().catch(() => ({}));
      check(response.ok() && body.ok !== false, `${tool} ran (${response.status()}): ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    };
    await call("add_companion", { name, class: "rogue", race: "human", gender: "Female", personality: "Quiet, watchful, counts the exits.", kind: "guest", level: 1 });
    const table = await (await api.get(`${base}/api/campaigns/${tableId}`)).json();
    const wren = (table.sheets ?? []).find((sheet) => sheet.name === name);
    check(Boolean(wren?.background), `${name} has a background (${wren?.background})`);
    check(wren?.proficiencies?.skills?.length === 6, `four class skills and the background's two (${wren?.proficiencies?.skills})`);
    check(wren?.proficiencies?.expertise?.length === 2, `and expertise in two of them (${wren?.proficiencies?.expertise})`);

    await t.open(`/campaigns/${tableId}`);
    await openPanelTab(t, "party");
    const card = page.locator(`${root}[data-party-card="${wren.id}"]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 30_000, label: `${name}'s party card` });
    await untilStill(page);
    await t.tap(card.getByRole("button", { name: `Options for ${name}` }));
    await t.tap(page.getByRole("menuitem", { name: "View sheet" }));
    const dialog = page.getByRole("dialog").filter({ hasText: name }).first();
    await eventually(() => dialog.count(), { label: `${name}'s sheet` });
    await untilStill(page);
    await t.shot("sheet");
    const skills = dialog.getByText("Skills", { exact: true }).first();
    await skills.scrollIntoViewIfNeeded();
    await untilStill(page);
    await t.shot("skills");
    const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await untilStill(page);
    await t.shot("skills-day");
    await page.evaluate((mode) => (document.documentElement.dataset.theme = mode), theme);
    await page.keyboard.press("Escape");
    await call("dismiss_companion", { characterId: wren.id });
  },
};

export default scenario;
