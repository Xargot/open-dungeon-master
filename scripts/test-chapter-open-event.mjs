// Chapter 1 is created lazily (ensureOpenChapter): by the setup job queued
// when a campaign starts, or by the first read of /chapters. A table whose
// snapshot was taken before that saw no chapter until its next reload (PR
// #259's report: "The story has not begun" under a story that had). The
// creation now publishes chapter_updated like every other chapter change;
// the table's stream upserts it and the Story panel refetches.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-chapter-open-event-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { ensureOpenChapter, getOpenChapter, listChapters } = await import("../src/lib/db/chapters.ts");
const { listEventsSince } = await import("../src/lib/events.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  const lead = createUser("chapter-lead", "x");
  const campaign = createCampaign(lead.id, {
    title: "The Quiet Ford",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
  });
  setCampaignStatus(campaign.id, "active");
  const chapterEvents = () => listEventsSince(campaign.id, 0).filter((event) => event.type === "chapter_updated");

  test("a campaign starts with no chapter and no chapter event", () => {
    assert.equal(getOpenChapter(campaign.id), null);
    assert.deepEqual(chapterEvents(), []);
  });

  test("creating the open chapter publishes it to the table", () => {
    const chapter = ensureOpenChapter(campaign.id);
    assert.equal(chapter.index, 1);
    assert.equal(chapter.status, "open");
    const events = chapterEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.chapter.id, chapter.id, "the event carries the chapter the stream upserts");
    assert.equal(events[0].payload.chapter.index, 1);
  });

  test("asking again returns the same chapter and publishes nothing more", () => {
    const again = ensureOpenChapter(campaign.id);
    assert.equal(again.id, getOpenChapter(campaign.id).id);
    assert.equal(listChapters(campaign.id).length, 1);
    assert.equal(chapterEvents().length, 1);
  });

  console.log(`test-chapter-open-event: ${passed} passed`);
} finally {
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  removeTempDir(dir);
}
