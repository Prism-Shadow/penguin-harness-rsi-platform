/**
 * The import dialog. Two paths, recommended first:
 *
 * - Import with an agent: a folder link in a repository such as Prism-Shadow/penguin-harness-benchmark,
 *   a local path or a description. Start sends it as an `import` task to the Project's default
 *   Agent, which fetches the package at a commit it pins and copies it in; the handler never fetches
 *   the link itself. The full prompt is folded underneath, a placeholder standing in for the source
 *   until one is typed.
 * - Upload zip: a package zip — what a Benchmark page's Export downloads — checked and written by
 *   the workbench's handler (`POST …/benchmarks/archive`). A taken id answers 409 `benchmark_exists`, and the
 *   overwrite confirm says what an overwrite costs; anything else refused is said under the button.
 *
 * Any member may take either path. Closing with a source typed asks first, and nothing closes the
 * dialog while an upload is in flight. Mounted only while open.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Button,
  ConfirmModal,
  HiddenFileInput,
  InfoPopover,
  Modal,
  Textarea,
  buttonClass,
  discardUnsaved,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import type { ApprovalMode, BenchmarkSummary, ImportTaskRequest } from "../../api";
import { ApiError, type BenchmarksApi } from "../api";
import { useStrings, useWorkbench } from "../context";
import type { Strings } from "../strings";
import { FailureLine, errorText } from "./failure";
import {
  ApprovalModeSelect,
  ByAgentLine,
  FormExamples,
  PromptPreview,
  useStartTask,
} from "./start-task";

/** Where the examples' packages are: the benchmark repository's `packages/<key>`. */
const EXAMPLES_REPO =
  "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages";

/** What one upload came to: written, refused for a taken id (the confirm's question), or refused with a reason. */
export type ArchiveUploadResult =
  | { kind: "imported"; benchmark: BenchmarkSummary }
  | { kind: "exists"; benchmarkId: string }
  | { kind: "refused"; text: string };

/**
 * Posts one zip. A 409 `benchmark_exists` is the overwrite question, about the id its
 * `details.benchmarkId` names (`fallbackId`, the picked file's stem, covers an answer without it).
 */
export async function uploadBenchmarkArchive(
  api: Pick<BenchmarksApi, "importArchive">,
  dataBase64: string,
  options: { overwrite: boolean; fallbackId: string },
  s: Strings,
): Promise<ArchiveUploadResult> {
  try {
    const { benchmark } = await api.importArchive({
      dataBase64,
      ...(options.overwrite ? { overwrite: true } : {}),
    });
    return { kind: "imported", benchmark };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === "benchmark_exists") {
      const named = e.details?.benchmarkId;
      return {
        kind: "exists",
        benchmarkId: typeof named === "string" && named !== "" ? named : options.fallbackId,
      };
    }
    return { kind: "refused", text: errorText(e, s) };
  }
}

/** A zip waiting on the overwrite confirm: the payload to resend, and the id it would replace. */
interface PendingOverwrite {
  dataBase64: string;
  benchmarkId: string;
}

const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** A zip was written; the dialog has said so already. */
  onImported: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const form = useFormDraft<string>("", { normalize: (text) => text.trim() });
  const source = form.draft;
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("allow-all");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (uploadError !== null) uploadErrorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [uploadError]);
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: uploading });
  const task = useStartTask(() => {
    // The source went with the task, so nothing typed is left to lose.
    discardUnsaved(form.scope);
    onClose();
  });

  const agentId = wb.defaultAgentId;
  const trimmed = source.trim();
  const bodyFor = (text: string): ImportTaskRequest | null =>
    agentId === null
      ? null
      : { kind: "import", agentId, source: text, approvalMode, language: wb.locale };
  const body = trimmed === "" ? null : bodyFor(trimmed);
  // The preview stands a placeholder in for the source until one is typed.
  const previewBody = bodyFor(trimmed || s.benchmark.importSourceToken);
  const examples = s.benchmark.importExamples.map((example) => ({
    ...example,
    prompt: `${EXAMPLES_REPO}/${example.key}`,
  }));

  const upload = async (dataBase64: string, fallbackId: string, overwrite: boolean) => {
    setUploading(true);
    setUploadError(null);
    const result = await uploadBenchmarkArchive(
      wb.api.benchmarks,
      dataBase64,
      { overwrite, fallbackId },
      s,
    );
    setUploading(false);
    if (result.kind === "imported") {
      setOverwriting(null);
      toastSuccess(s.benchmark.importDoneToast);
      onImported();
    } else if (result.kind === "exists") {
      setOverwriting({ dataBase64, benchmarkId: result.benchmarkId });
    } else {
      setOverwriting(null);
      setUploadError(result.text);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const fallbackId = file.name.replace(/\.zip$/i, "").replace(/-v\d{4}\.\d{2}\.\d{2}\.\d+$/, "");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void upload(dataUrl.slice(dataUrl.indexOf(",") + 1), fallbackId, false);
    };
    reader.onerror = () => setUploadError(s.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Modal
        open
        title={s.benchmark.importBenchmark}
        onClose={requestClose}
        widthClass="sm:max-w-lg"
      >
        <div className="space-y-4">
          <section>
            <h3 className="flex items-center gap-1 text-sm font-medium">
              {s.benchmark.importChatTitle}
              <InfoPopover label={s.benchmark.importChatTitle}>
                {s.benchmark.importChatWhy}
              </InfoPopover>
            </h3>
            <div className="mt-2.5 space-y-3">
              <Textarea
                label={s.benchmark.importSourceLabel}
                hint={s.benchmark.importSourceHint}
                size="sm"
                rows={3}
                value={source}
                onChange={(e) => form.setDraft(e.target.value)}
                placeholder={s.benchmark.importSourcePlaceholder}
              />
              <FormExamples examples={examples} value={source} onChange={form.setDraft} />
              <ApprovalModeSelect value={approvalMode} onChange={setApprovalMode} />
              <PromptPreview body={previewBody} />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={task.busy}
                  loadingLabel={s.form.starting}
                  disabled={body === null || task.busy}
                  onClick={() => body !== null && void task.start(body)}
                >
                  {s.form.start}
                </Button>
                <ByAgentLine agentId={agentId} />
              </div>
              {task.feedback}
            </div>
          </section>

          <section className="border-t border-line pt-4">
            <h3 className="flex items-center gap-1 text-sm font-medium">
              {s.benchmark.importUploadTitle}
              <InfoPopover label={s.benchmark.importUploadTitle}>
                {s.benchmark.importUploadInfo}
              </InfoPopover>
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">{s.benchmark.importUploadDesc}</p>
            <label
              className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
              {uploading ? s.benchmark.importUploading : s.benchmark.importUploadAction}
            </label>
            {uploadError !== null && (
              <div ref={uploadErrorRef}>
                <FailureLine text={uploadError} className="mt-1.5" />
              </div>
            )}
          </section>
        </div>
      </Modal>

      {/* The import dialog stays underneath; confirming resends the same zip with overwrite. */}
      <ConfirmModal
        open={overwriting !== null}
        title={s.benchmark.importOverwriteTitle}
        confirmLabel={s.benchmark.importOverwriteAction}
        cancelLabel={s.common.cancel}
        tone="danger"
        busy={uploading}
        onClose={() => setOverwriting(null)}
        onConfirm={() => {
          if (overwriting !== null)
            void upload(overwriting.dataBase64, overwriting.benchmarkId, true);
        }}
      >
        <p className="text-sm text-fg-muted">
          {overwriting !== null ? s.benchmark.importOverwriteBody(overwriting.benchmarkId) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
