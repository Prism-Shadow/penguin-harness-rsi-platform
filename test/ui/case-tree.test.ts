/**
 * A case's file tree: two top-level directories, one per material, over listings fetched one
 * directory per level.
 *
 * - Given open directories with their listings, every row is walked and its path names the
 *   material it came from, so the two file spaces cannot collide.
 * - Given a closed material, its row stays and its children do not.
 * - Given an open directory whose listing has not arrived, it reports itself unloaded; a listed
 *   one holding nothing reports itself empty.
 * - Every row states its position among its siblings, and a file row carries its size.
 */
import { describe, expect, it } from "vitest";
import type { CaseFileEntry } from "../../src/api";
import { caseTreeRows, type CaseMaterialSpec } from "../../src/ui/pages/case-browser";

const MTIME = "2026-09-12T00:00:00.000Z";
const dir = (name: string): CaseFileEntry => ({ name, kind: "dir", sizeBytes: 0, mtime: MTIME });
const file = (name: string, sizeBytes = 12): CaseFileEntry => ({
  name,
  kind: "file",
  sizeBytes,
  mtime: MTIME,
});

const MATERIALS: CaseMaterialSpec[] = [
  { material: "statement", label: "Task materials" },
  { material: "rubric", label: "Scoring rubric" },
];

const LISTINGS = new Map<string, CaseFileEntry[]>([
  ["statement", [dir("assets"), file("README.md")]],
  ["statement/assets", [file("chart.png", 2048)]],
  ["rubric", [file("README.md")]],
]);

describe("a case's file tree", () => {
  it("walks every open directory and names each row's material in its path", () => {
    const expanded = new Set(["statement", "statement/assets", "rubric"]);
    expect(
      caseTreeRows(MATERIALS, LISTINGS, expanded).map((r) => [r.path, r.kind, r.depth, r.material]),
    ).toEqual([
      ["statement", "dir", 0, "statement"],
      ["statement/assets", "dir", 1, "statement"],
      ["statement/assets/chart.png", "file", 2, "statement"],
      ["statement/README.md", "file", 1, "statement"],
      ["rubric", "dir", 0, "rubric"],
      ["rubric/README.md", "file", 1, "rubric"],
    ]);
  });

  it("keeps a closed material's row and none of its children", () => {
    const rows = caseTreeRows(MATERIALS, LISTINGS, new Set(["rubric"]));
    expect(rows.map((r) => r.path)).toEqual(["statement", "rubric", "rubric/README.md"]);
    expect(rows[0]).toMatchObject({ expanded: false, loaded: true, empty: false });
  });

  it("reports an open directory still being listed as unloaded, and an empty one as empty", () => {
    const expanded = new Set(["statement", "statement/assets", "rubric"]);
    const rows = caseTreeRows(MATERIALS, new Map([["statement", [dir("assets")]]]), expanded);
    expect(rows.map((r) => [r.path, r.loaded, r.expanded])).toEqual([
      ["statement", true, true],
      ["statement/assets", false, true],
      ["rubric", false, true],
    ]);
    const empty = caseTreeRows(MATERIALS, new Map([["statement", []]]), new Set(["statement"]));
    expect(empty[0]).toMatchObject({ path: "statement", loaded: true, empty: true });
  });

  it("states each row's place among its siblings and a file's size", () => {
    const expanded = new Set(["statement", "statement/assets", "rubric"]);
    const rows = caseTreeRows(MATERIALS, LISTINGS, expanded);
    expect(rows.map((r) => `${r.posInSet}/${r.setSize}`)).toEqual([
      "1/2",
      "1/2",
      "1/1",
      "2/2",
      "2/2",
      "1/1",
    ]);
    const sizes = new Map(rows.map((r) => [r.path, r.sizeBytes] as const));
    expect(sizes.get("statement/assets/chart.png")).toBe(2048);
    expect(sizes.get("statement/assets")).toBe(0);
  });
});
