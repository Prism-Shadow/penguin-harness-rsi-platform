/**
 * A Benchmark case's files: the UI package's read-only browser over the case's two materials. The
 * tree's two top-level directories are the materials themselves — the task materials the tested
 * agent is given, and the rubric it never sees — both open from the start, each listed one
 * directory per level as it is opened.
 *
 * Row paths carry the material they belong to (`statement/README.md`), since the two are separate
 * file spaces whose paths would otherwise collide; every request splits the material back off. The
 * statement's own README opens by itself once its listing arrives. The files are read from the
 * server the case was listed from: this server, or a machine through the host's proxy.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  FileBrowser,
  Pill,
  type FileBrowserPreview,
  type FileBrowserPreviewKind,
  type FileTreeRow,
  type TreeToggle,
} from "@prismshadow/penguin-ui";
import type { CaseFileEntry, CaseMaterial, MergedCase } from "../../api";
import { useStrings, useWorkbench } from "../context";
import { formatBytes } from "../format";
import { errorText } from "./failure";

/** One row of the case tree: a shared tree row, the material it came from, and a file's size. */
export interface CaseTreeRow extends FileTreeRow {
  material: CaseMaterial;
  /** Bytes on a file row, 0 on a directory. */
  sizeBytes: number;
}

/** A material as the tree draws it: which one, and the name of the folder it stands under. */
export interface CaseMaterialSpec {
  material: CaseMaterial;
  label: string;
}

/** Listings by tree path; a missing key means "not fetched yet". */
export type Listings = ReadonlyMap<string, readonly CaseFileEntry[]>;

const MATERIAL_PATHS = ["statement", "rubric"];

const join = (base: string, name: string) => (base === "" ? name : `${base}/${name}`);

/**
 * The rows the tree draws, top to bottom: one directory row per material, then a depth-first walk
 * into every open directory whose listing has arrived. An open directory still loading contributes
 * its own row and no children (`loaded: false`).
 */
export function caseTreeRows(
  materials: readonly CaseMaterialSpec[],
  listings: Listings,
  expanded: ReadonlySet<string>,
): CaseTreeRow[] {
  const rows: CaseTreeRow[] = [];
  const walk = (material: CaseMaterial, dir: string, depth: number): void => {
    const entries = listings.get(dir) ?? [];
    for (const [index, entry] of entries.entries()) {
      const path = join(dir, entry.name);
      const isDir = entry.kind === "dir";
      const open = isDir && expanded.has(path);
      const children = isDir ? listings.get(path) : undefined;
      rows.push({
        path,
        name: entry.name,
        kind: entry.kind,
        depth,
        posInSet: index + 1,
        setSize: entries.length,
        expanded: open,
        loaded: !isDir || children !== undefined,
        empty: isDir && children !== undefined && children.length === 0,
        material,
        sizeBytes: entry.sizeBytes,
      });
      if (open && children !== undefined) walk(material, path, depth + 1);
    }
  };
  for (const [index, spec] of materials.entries()) {
    const children = listings.get(spec.material);
    const open = expanded.has(spec.material);
    rows.push({
      path: spec.material,
      name: spec.label,
      kind: "dir",
      depth: 0,
      posInSet: index + 1,
      setSize: materials.length,
      expanded: open,
      loaded: children !== undefined,
      empty: children !== undefined && children.length === 0,
      material: spec.material,
      sizeBytes: 0,
    });
    if (open && children !== undefined) walk(spec.material, spec.material, 1);
  }
  return rows;
}

/** The material a tree path belongs to, and the path inside it ("" for the material's own row). */
function splitTreePath(treePath: string): { material: CaseMaterial; path: string } {
  const cut = treePath.indexOf("/");
  const head = cut < 0 ? treePath : treePath.slice(0, cut);
  return {
    material: head === "rubric" ? "rubric" : "statement",
    path: cut < 0 ? "" : treePath.slice(cut + 1),
  };
}

const parentDir = (path: string) => {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
};
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The directories above a path, outermost first: "a/b/c.txt" → ["a", "a/b"]. */
function ancestorDirs(path: string): string[] {
  const segments = path.split("/").filter((s) => s !== "");
  const out: string[] = [];
  for (let i = 1; i < segments.length; i += 1) out.push(segments.slice(0, i).join("/"));
  return out;
}

/** A reference inside a file, resolved against the directory that file sits in. */
function resolveRelative(baseDir: string, ref: string): string {
  const out = ref.startsWith("/") || baseDir === "" ? [] : baseDir.split("/");
  for (const segment of ref.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

const TEXT_EXTS = new Set(
  "txt json js mjs cjs ts tsx jsx py sh bash yaml yml toml css csv log xml ini conf rs go java c h cpp hpp sql rb php gitignore env html htm".split(
    " ",
  ),
);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

/** How the read-only browser previews a file, from its name. */
function previewKindOf(name: string): FileBrowserPreviewKind {
  const dot = name.lastIndexOf(".");
  const ext = (dot >= 0 ? name.slice(dot + 1) : name).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "md";
  return TEXT_EXTS.has(ext) ? "text" : "unsupported";
}

export function CaseBrowser({ benchmarkId, item }: { benchmarkId: string; item: MergedCase }) {
  const s = useStrings();
  const wb = useWorkbench();
  const caseId = item.id;
  const machineId = item.machineId;
  const [listings, setListings] = useState<Listings>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(MATERIAL_PATHS));
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [listError, setListError] = useState<string | null>(null);
  const [toggled, setToggled] = useState<TreeToggle | null>(null);
  const [preview, setPreview] = useState<FileBrowserPreview | null>(null);
  const previewRequest = useRef(0);
  const dirRequest = useRef<Map<string, number>>(new Map());
  const readmeOpened = useRef(false);

  const fileUrl = useCallback(
    (material: CaseMaterial, path: string, mode: "raw" | "preview" | "download" = "raw") =>
      wb.api.caseFileUrl(benchmarkId, caseId, material, path, machineId, mode),
    [wb.api, benchmarkId, caseId, machineId],
  );

  const loadDir = useCallback(
    async (treePath: string): Promise<readonly CaseFileEntry[] | null> => {
      const { material, path } = splitTreePath(treePath);
      const seq = (dirRequest.current.get(treePath) ?? 0) + 1;
      dirRequest.current.set(treePath, seq);
      const current = () => dirRequest.current.get(treePath) === seq;
      setLoadingDirs((prev) => new Set(prev).add(treePath));
      try {
        const res = await wb.api.caseFiles(benchmarkId, caseId, material, path, machineId);
        if (!current()) return null;
        setListings((m) => new Map(m).set(treePath, res.entries));
        setListError(null);
        return res.entries;
      } catch (error) {
        if (current()) setListError(errorText(error, s));
        return null;
      } finally {
        if (current()) {
          setLoadingDirs((prev) => {
            const next = new Set(prev);
            next.delete(treePath);
            return next;
          });
        }
      }
    },
    [wb.api, benchmarkId, caseId, machineId, s],
  );

  /** Opens a file in the preview pane: the text kinds are read, the rest are served by URL. */
  const openFile = useCallback(
    async (treePath: string): Promise<void> => {
      const { material, path } = splitTreePath(treePath);
      const name = baseName(path);
      const kind = previewKindOf(name);
      const base: FileBrowserPreview = {
        path: treePath,
        name,
        kind,
        url: fileUrl(material, path),
        downloadUrl: fileUrl(material, path, "download"),
      };
      const request = ++previewRequest.current;
      if (kind !== "text" && kind !== "md") {
        setPreview(base);
        return;
      }
      setPreview({ ...base, loading: true });
      try {
        const response = await fetch(fileUrl(material, path, "preview"), {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(String(response.status));
        const content = await response.text();
        if (request !== previewRequest.current) return;
        setPreview({
          ...base,
          content,
          truncated: response.headers.get("x-content-truncated") === "1",
        });
      } catch {
        if (request !== previewRequest.current) return;
        setPreview({ ...base, error: s.benchmark.caseFileUnavailable });
      }
    },
    [fileUrl, s],
  );

  useEffect(() => {
    void loadDir("rubric");
    // The statement's README is what the case is about, so it opens by itself; the rubric side
    // has no such preview, or the two listings would race for the pane.
    void loadDir("statement").then((entries) => {
      if (entries === null || readmeOpened.current) return;
      const readme = entries.find((e) => e.kind === "file" && e.name.toLowerCase() === "readme.md");
      if (readme === undefined) return;
      readmeOpened.current = true;
      void openFile(join("statement", readme.name));
    });
  }, [loadDir, openFile]);

  const toggleDir = (dir: string): void => {
    const open = !expanded.has(dir);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(dir);
      else next.delete(dir);
      return next;
    });
    setToggled((last) => ({ dir, open, serial: (last?.serial ?? 0) + 1 }));
    if (open && !listings.has(dir)) void loadDir(dir);
  };

  /** Opens a file and makes its row reachable: a link can point into a directory never listed. */
  const openAndReveal = (treePath: string): void => {
    const dirs = ancestorDirs(treePath);
    setExpanded((prev) => new Set([...prev, ...dirs]));
    for (const dir of dirs) if (!listings.has(dir)) void loadDir(dir);
    void openFile(treePath);
  };

  const resolveRef = useCallback(
    (ref: string): { url: string; treePath?: string } | null => {
      if (preview === null) return null;
      const { material, path } = splitTreePath(preview.path);
      const target = resolveRelative(parentDir(path), ref);
      return { url: fileUrl(material, target), treePath: join(material, target) };
    },
    [preview, fileUrl],
  );

  const materials: CaseMaterialSpec[] = [
    { material: "statement", label: s.benchmark.taskMaterials },
    { material: "rubric", label: s.benchmark.rubric },
  ];

  const headerPath = (): string | undefined => {
    if (preview === null) return undefined;
    const { material, path } = splitTreePath(preview.path);
    return `${material === "rubric" ? s.benchmark.rubric : s.benchmark.taskMaterials} / ${path}`;
  };

  const rowTrailing = (row: CaseTreeRow): ReactNode => {
    // The rubric is what the case is scored against and the tested agent never sees it: the badge
    // says so where the folder is.
    if (row.depth === 0) {
      return row.material === "rubric" ? (
        <span className="shrink-0">
          <Pill>{s.benchmark.agentHidden}</Pill>
        </span>
      ) : null;
    }
    if (row.kind !== "file") return null;
    return (
      <span className="shrink-0 font-mono text-xs text-fg-subtle">
        {formatBytes(row.sizeBytes)}
      </span>
    );
  };

  return (
    <FileBrowser
      rows={caseTreeRows(materials, listings, expanded)}
      treeLabel={s.files.treeLabel}
      selectedPath={preview?.path ?? null}
      loadingDirs={loadingDirs}
      toggled={toggled}
      rowTrailing={rowTrailing}
      treeLoading={listings.size === 0 && listError === null}
      treeError={listError}
      headerFallback={caseId}
      headerPath={headerPath()}
      preview={preview}
      emptyPreview={s.benchmark.caseFileUnavailable}
      emptyDirLabel={s.files.empty}
      truncatedLabel={s.files.previewTruncated}
      unsupportedLabel={s.files.previewUnsupported}
      downloadLabel={s.files.download}
      resolveRef={resolveRef}
      // One width per language, so opening a folder never moves the preview beside the tree.
      treeWidth={wb.locale === "en" ? 380 : 270}
      treeMaxHeight={53}
      previewHeight={52}
      minHeight={58}
      onToggleDir={toggleDir}
      onOpenFile={openAndReveal}
    />
  );
}
