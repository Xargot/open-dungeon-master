// The MCP write tools: odm_write_lore (create/patch/delete on the lore
// binder) and odm_get_facts (the tracked fact register). Both are thin
// drivers of routes that already check story authority, so the tests here
// drive workbenchCall into the real route handlers: what the tool sends,
// what the guard refuses before the route, and what the route's own
// permissions and validation do with what passes the guard.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-lore-tools-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { insertFact } = await import("../src/lib/db/facts.ts");
const { workbenchCall, workbenchTools } = await import("../src/lib/agents/workbench.ts");

const routes = {
  lore: await import("../src/app/api/campaigns/[campaignId]/lore/route.ts"),
  entry: await import("../src/app/api/campaigns/[campaignId]/lore/[entryId]/route.ts"),
  facts: await import("../src/app/api/campaigns/[campaignId]/facts/route.ts"),
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const lead = createUser("lore-lead", "x");
const player = createUser("lore-player", "x");
const campaign = createCampaign(lead.id, {
  title: "The Hollow Stars",
  description: "",
  theme: "",
  maxPlayers: 2,
  startingLevel: 3,
  difficulty: "normal",
});
// The player is a member but does not steer the story.
await joinMember(player.id);
setCampaignStatus(campaign.id, "active");

async function joinMember(userId) {
  const { joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
  joinByInviteCode(userId, campaign.inviteCode);
}

const leadGrant = createConnectionGrant({
  userId: lead.id,
  name: "lead's agent",
  scopes: ["read", "campaigns"],
  campaignId: campaign.id,
}).grant;
const playerGrant = createConnectionGrant({
  userId: player.id,
  name: "player's agent",
  scopes: ["read", "campaigns"],
  campaignId: campaign.id,
}).grant;

// workbenchCall reaches routes over loopback fetch; here fetch goes straight
// to the route handlers, signed in with the session the grant minted.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  // Background work a write kicks off (a PDF ingest reaching for an
  // embedding model) fetches elsewhere with no auth; pass it through
  // untouched instead of clobbering the signed-in caller.
  if (!/^\/api\/campaigns\//.test(target.pathname)) {
    return originalFetch(url, init);
  }
  globalThis.__odmTestToken = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const entry = /\/lore\/([A-Za-z0-9_-]+)$/.exec(target.pathname);
  const base = /\/api\/campaigns\/([A-Za-z0-9_-]+)(\/lore|\/facts)?$/.exec(target.pathname);
  assert.ok(base || entry, `unexpected path ${target.pathname}`);
  const campaignId = entry ? (await baseOf(target)).match[1] : base[1];
  const method = init.method ?? "GET";
  const params = entry
    ? Promise.resolve({ campaignId, entryId: entry[1] })
    : Promise.resolve({ campaignId });
  const handler = entry ? routes.entry[method] : base[2] === "/lore" ? routes.lore[method] : routes.facts[method];
  assert.ok(handler, `no ${method} handler for ${target.pathname}`);
  return handler(new Request(target, { method, headers: init.headers, body: init.body }), { params });

  async function baseOf(target) {
    return { match: /\/api\/campaigns\/([A-Za-z0-9_-]+)\/lore\//.exec(target.pathname) };
  }
};

try {
  await test("the tools are exposed on the right scopes", () => {
    const leadTools = workbenchTools(leadGrant).map((tool) => tool.name);
    assert.ok(leadTools.includes("odm_write_lore") && leadTools.includes("odm_get_facts"));
    const playerTools = workbenchTools(playerGrant).map((tool) => tool.name);
    // Scopes decide what is listed, exactly as for odm_get_invite; the write
    // itself is refused later, at the route's story-authority check.
    assert.ok(playerTools.includes("odm_get_facts") && playerTools.includes("odm_write_lore"));
  });

  await test("create puts an entry in the binder, with its tags", async () => {
    const outcome = await workbenchCall(leadGrant, "odm_write_lore", {
      campaignId: campaign.id,
      action: "create",
      category: "magic",
      title: "The Lantern Between Worlds",
      body: "The light that holds the sky up, beneath the harbor.",
      tags: ["lantern", "stars"],
    });
    assert.equal(outcome.isError, false, outcome.text.slice(0, 300));
    const entry = JSON.parse(outcome.text).entry;
    assert.equal(entry.pinned, false, "created entries never start pinned");
    assert.deepEqual(entry.tags, ["lantern", "stars"]);
    const binder = JSON.parse((await workbenchCall(leadGrant, "odm_lore", { campaignId: campaign.id })).text);
    assert.ok(binder.entries.some((candidate) => candidate.id === entry.id));
  });

  await test("create is refused before the route without category, title or body", async () => {
    const base = { campaignId: campaign.id, action: "create" };
    for (const args of [
      base,
      { ...base, title: "No body", body: "B" },
      { ...base, category: "history", body: "No title" },
      { ...base, category: "history", title: "No category" },
      { ...base, category: "npc", title: "Bad category", body: "B" },
    ]) {
      const outcome = await workbenchCall(leadGrant, "odm_write_lore", args);
      assert.equal(outcome.isError, true, JSON.stringify(args));
      assert.match(outcome.text, /category|id/);
    }
  });

  await test("patch changes only what it sends, and pinned is a patch field", async () => {
    const created = JSON.parse(
      (
        await workbenchCall(leadGrant, "odm_write_lore", {
          campaignId: campaign.id,
          action: "create",
          category: "history",
          title: "The Great Compass Goes Out",
          body: "Vicar Osseth said the stars are being rewritten.",
        })
      ).text,
    ).entry;
    const patched = await workbenchCall(leadGrant, "odm_write_lore", {
      campaignId: campaign.id,
      action: "patch",
      id: created.id,
      pinned: true,
      tags: ["compass"],
    });
    assert.equal(patched.isError, false, patched.text.slice(0, 300));
    const entry = JSON.parse(patched.text).entry;
    assert.equal(entry.title, "The Great Compass Goes Out", "patch keeps what it did not send");
    assert.equal(entry.pinned, true);
    assert.deepEqual(entry.tags, ["compass"]);
    const noId = await workbenchCall(leadGrant, "odm_write_lore", { campaignId: campaign.id, action: "patch", title: "x" });
    assert.equal(noId.isError, true);
    assert.match(noId.text, /id/);
  });

  await test("delete is refused without confirm, then removes the entry", async () => {
    const created = JSON.parse(
      (
        await workbenchCall(leadGrant, "odm_write_lore", {
          campaignId: campaign.id,
          action: "create",
          category: "other",
          title: "Bramble",
          body: "A clockwork guide in need of repair.",
        })
      ).text,
    ).entry;
    const refused = await workbenchCall(leadGrant, "odm_write_lore", {
      campaignId: campaign.id,
      action: "delete",
      id: created.id,
    });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /confirm/);
    const still = JSON.parse((await workbenchCall(leadGrant, "odm_lore", { campaignId: campaign.id })).text);
    assert.ok(still.entries.some((candidate) => candidate.id === created.id));
    const deleted = await workbenchCall(leadGrant, "odm_write_lore", {
      campaignId: campaign.id,
      action: "delete",
      id: created.id,
      confirm: true,
    });
    assert.equal(deleted.isError, false, deleted.text.slice(0, 300));
    const after = JSON.parse((await workbenchCall(leadGrant, "odm_lore", { campaignId: campaign.id })).text);
    assert.ok(!after.entries.some((candidate) => candidate.id === created.id));
  });

  await test("the routes' own authority holds when the guard passes: a player's agent cannot write lore", async () => {
    const outcome = await workbenchCall(playerGrant, "odm_write_lore", {
      campaignId: campaign.id,
      action: "create",
      category: "history",
      title: "Not mine",
      body: "A player's agent should never get this far.",
    });
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /HTTP 403/);
  });

  await test("odm_get_facts reads the party-visible register and hides DM-only facts", async () => {
    insertFact({ campaignId: campaign.id, category: "world", subject: "Lumenport", fact: "The party defeated two Void-Weaver Stalkers.", knownBy: "party", source: "manual" });
    insertFact({ campaignId: campaign.id, category: "world", subject: "The Vicars", fact: "The Vicars knew the portents stopped.", knownBy: "dm", source: "manual" });
    const party = JSON.parse((await workbenchCall(leadGrant, "odm_get_facts", { campaignId: campaign.id })).text);
    assert.equal(party.lead, true);
    assert.ok(party.facts.some((fact) => fact.fact.includes("Void-Weaver Stalkers")));
    assert.ok(!party.facts.some((fact) => fact.fact.includes("Vicars knew")), "DM-only facts stay out without secrets");
    const secrets = JSON.parse((await workbenchCall(leadGrant, "odm_get_facts", { campaignId: campaign.id, secrets: true })).text);
    assert.ok(secrets.facts.some((fact) => fact.fact.includes("Vicars knew")), "the lead asking for secrets sees them");
  });

  await test("a player's agent reads party facts and is refused secrets", async () => {
    const party = JSON.parse((await workbenchCall(playerGrant, "odm_get_facts", { campaignId: campaign.id })).text);
    assert.equal(party.lead, false);
    assert.ok(party.facts.some((fact) => fact.fact.includes("Void-Weaver Stalkers")));
    assert.ok(!party.facts.some((fact) => fact.fact.includes("Vicars knew")));
    const refused = await workbenchCall(playerGrant, "odm_get_facts", { campaignId: campaign.id, secrets: true });
    assert.equal(refused.isError, false, "the route filters instead of refusing");
    const facts = JSON.parse(refused.text).facts;
    assert.ok(!facts.some((fact) => fact.fact.includes("Vicars knew")));
  });

  await test("odm_get_facts counts as a read and odm_write_lore as a write for throttling", async () => {
    const { isReadTool } = await import("../src/lib/agents/activity.ts");
    assert.ok(isReadTool("odm_get_facts"));
    assert.ok(!isReadTool("odm_write_lore"));
  });

  console.log(`${passed} MCP lore tools tests passed`);
} finally {
  globalThis.fetch = originalFetch;
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  removeTempDir(dir);
}
