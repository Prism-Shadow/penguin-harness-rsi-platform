/**
 * The parts every start form shares — Create with AI, Import with an agent, Use's two tabs and
 * Ask AI:
 *
 * - the approval mode select, Approve everything (allow-all) unless changed, one of the four a new
 *   chat offers;
 * - the read-only prompt fold: what Start would send, written by the workbench's handler
 *   (`POST …/prompt` sends nothing), asked again a moment after the form stops changing, the last
 *   answer kept on screen meanwhile;
 * - Start itself, as the person who pressed it, through the Web App's own routes — the same ones
 *   its Send takes (PRFC-0036, the Agent tasks the page starts):
 *   1. the prompt, from the handler;
 *   2. the chosen Agent's Skills (`GET …/agents/:a/skills`): when one the task cannot do without is
 *      missing, nothing starts and the form offers Install, which installs the plugin that ships
 *      it on that Agent (`POST …/agents/:a/plugins`) — this plugin for the evaluation and design
 *      Skills, the method's toolkit for its optimizer — after which the person presses Start again;
 *   3. a new conversation on that Agent (`POST …/agents/:a/sessions`) with the form's approval
 *      mode and model;
 *   4. its first message (`POST /api/sessions/:id/tasks`): the prompt behind a `[use_skills]`
 *      block naming the Skills it preselects that the Agent has;
 *   5. the task recorded with the handler (`POST …/tasks`), so the page lists it.
 *   The task is then announced (the confirmation with Open chat) and the form closes; any refusal
 *   is said under the form.
 * - the examples that fill the form's text box, and the line naming who does the work.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  CopyButton,
  HelpFold,
  NoticeStrip,
  Select,
  Skeleton,
  Waiting,
} from "@prismshadow/penguin-ui";
import type { ApprovalMode, PromptRequest, WorkbenchTask, WorkbenchTaskRequest } from "../../api";
import { APPROVAL_MODES } from "../api";
import { useStrings, useWorkbench } from "../context";
import { DESIGN_SKILL, EVALUATION_SKILL, WORKBENCH_PLUGIN } from "../methods";
import { FailureLine, errorText } from "./failure";

/** How long the form has to sit still before the prompt is asked for again. */
const PREVIEW_DELAY_MS = 300;

export function ApprovalModeSelect({
  value,
  onChange,
  disabled,
}: {
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  disabled?: boolean;
}) {
  const s = useStrings();
  return (
    <Select
      label={s.form.approvalMode}
      hint={s.form.approvalModeHint}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ApprovalMode)}
    >
      {APPROVAL_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {s.form.approvalModes[mode]}
        </option>
      ))}
    </Select>
  );
}

/** The fields of a start form's request the handler builds the prompt from. */
export function promptFields(body: WorkbenchTaskRequest): PromptRequest {
  const { agentId: _agent, approvalMode: _mode, model: _model, ...prompt } = body;
  return prompt as PromptRequest;
}

/**
 * A message with a `[use_skills]` block naming `skills` in front of `text`, as the Web App's
 * composer writes one (AMSP's buildSkillsMessage); `text` alone when there are none.
 */
export function withSkills(skills: readonly string[], text: string): string {
  if (skills.length === 0) return text;
  const block = `[use_skills]\nskills: ${skills.join(", ")}\n[/use_skills]`;
  return text === "" ? block : `${block}\n\n${text}`;
}

/** The prompt Start would send for `body`: the last answer, while a newer one is being written. */
function usePromptPreview(body: WorkbenchTaskRequest | null): {
  prompt: string | null;
  failed: boolean;
} {
  const wb = useWorkbench();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const key = body === null ? null : JSON.stringify(promptFields(body));
  useEffect(() => {
    if (key === null) return;
    const ask = ++seq.current;
    const timer = window.setTimeout(() => {
      wb.api.prompt(JSON.parse(key) as PromptRequest).then(
        (res) => {
          if (ask !== seq.current) return;
          setPrompt(res.prompt);
          setFailed(false);
        },
        () => {
          if (ask === seq.current) setFailed(true);
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, wb.api]);
  return { prompt, failed };
}

/** The folded full prompt, read-only, with a copy button. */
export function PromptPreview({ body }: { body: WorkbenchTaskRequest | null }) {
  const s = useStrings();
  const { prompt, failed } = usePromptPreview(body);
  return (
    <HelpFold title={s.form.fullPrompt} flush>
      {prompt !== null ? (
        <div className="relative">
          <pre
            data-testid="prompt-preview"
            className="max-h-48 overflow-auto rounded-md border border-line bg-surface-muted p-2 pr-8 font-sans text-xs leading-relaxed whitespace-pre-wrap text-fg"
          >
            {prompt}
          </pre>
          <div className="absolute top-1.5 right-1.5">
            <CopyButton text={prompt} label={s.form.copyPrompt} />
          </div>
        </div>
      ) : failed ? (
        <FailureLine text={s.form.previewUnavailable} />
      ) : (
        <Waiting label={s.form.previewLoading} className="space-y-1.5">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </Waiting>
      )}
    </HelpFold>
  );
}

/** Why a task could not start for want of a Skill: the Agent, the Skill and the plugin that has it. */
interface MissingSkill {
  agentId: string;
  skill: string;
  plugin: string;
}

export interface StartTask {
  busy: boolean;
  start: (body: WorkbenchTaskRequest) => Promise<void>;
  /** What the form shows under its fields after a Start that did not go through. */
  feedback: ReactNode;
}

/**
 * Start for one form. `onStarted` closes it; the confirmation itself is the workbench's, so it
 * outlives the form.
 */
export function useStartTask(onStarted: (task: WorkbenchTask) => void): StartTask {
  const s = useStrings();
  const wb = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingSkill | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const shown = error !== null || missing !== null || installed !== null;
  // The notice lands at the foot of a dialog whose body may scroll: bring it into view.
  useEffect(() => {
    if (shown) feedbackRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown, error, missing, installed]);

  /** The plugin that ships `skill` for this request: the method's own for its optimizer. */
  const pluginFor = (body: WorkbenchTaskRequest, skill: string): string => {
    if (body.kind === "optimize" && skill !== EVALUATION_SKILL) return body.method;
    const known = wb.context.skillPlugins[skill];
    if (known !== undefined) return known;
    return skill === EVALUATION_SKILL || skill === DESIGN_SKILL ? WORKBENCH_PLUGIN : "";
  };

  const start = async (body: WorkbenchTaskRequest) => {
    setBusy(true);
    setError(null);
    setMissing(null);
    setInstalled(null);
    try {
      const built = await wb.api.prompt(promptFields(body));
      const skills = await wb.skills.read(body.agentId);
      const lacking = built.required.find((skill) => !skills.includes(skill));
      if (lacking !== undefined) {
        setMissing({ agentId: body.agentId, skill: lacking, plugin: pluginFor(body, lacking) });
        return;
      }
      const approvalMode = body.approvalMode ?? "allow-all";
      const { session } = await wb.host.createSession(body.agentId, {
        approvalMode,
        ...(body.model !== undefined ? { model: body.model } : {}),
      });
      const text = withSkills(
        built.skills.filter((skill) => skills.includes(skill)),
        built.prompt,
      );
      // A Session that healed into a new id on start is the same conversation.
      const { sessionId } = await wb.host.sendTask(session.sessionId, text);
      const request = {
        sessionId: sessionId || session.sessionId,
        kind: body.kind,
        ...("benchmarkId" in body ? { benchmarkId: body.benchmarkId } : {}),
        agentId: body.agentId,
        approvalMode,
      };
      // The conversation runs whether or not the record lands; the list then misses it.
      const record = await wb.api.recordTask(request).then(
        (res) => res.task,
        () => ({ ...request, createdAt: new Date().toISOString() }),
      );
      const task: WorkbenchTask = { ...record, state: "running", pendingApprovals: 0 };
      wb.started(task);
      onStarted(task);
    } catch (e) {
      setError(errorText(e, s));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (missing === null) return;
    setInstalling(true);
    setError(null);
    try {
      await wb.host.installPlugins(missing.agentId, [missing.plugin]);
      wb.skills.forget(missing.agentId);
      setInstalled(missing.plugin);
      setMissing(null);
    } catch (e) {
      setError(errorText(e, s));
    } finally {
      setInstalling(false);
    }
  };

  const feedback = shown ? (
    <div ref={feedbackRef} className="space-y-2">
      {missing !== null && (
        <NoticeStrip
          tone="attention"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1">
            {s.tasks.skillMissing(missing.skill, missing.plugin)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            loading={installing}
            disabled={missing.plugin === ""}
            onClick={() => void install()}
          >
            {s.tasks.install}
          </Button>
        </NoticeStrip>
      )}
      {installed !== null && (
        <NoticeStrip tone="success" className="rounded-md border px-3 py-2 text-xs">
          {s.tasks.installed(installed)}
        </NoticeStrip>
      )}
      {error !== null && <FailureLine text={error} />}
    </div>
  ) : null;

  return { busy, start, feedback };
}

/** The form's footer: Cancel, and Start, live once the form is complete. */
export function StartFooter({
  onCancel,
  onStart,
  ready,
  busy,
  cancelDisabled,
}: {
  onCancel: () => void;
  onStart: () => void;
  ready: boolean;
  busy: boolean;
  cancelDisabled?: boolean;
}) {
  const s = useStrings();
  return (
    <>
      <Button size="sm" onClick={onCancel} disabled={cancelDisabled}>
        {s.common.cancel}
      </Button>
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        loadingLabel={s.form.starting}
        disabled={!ready}
        onClick={onStart}
      >
        {s.form.start}
      </Button>
    </>
  );
}

/** One example: a label, a muted line, and the text it puts in the box. */
export interface FormExample {
  key: string;
  label: string;
  description?: string;
  prompt: string;
}

const exampleClass =
  "min-w-0 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-60";
const exampleIdleClass = "border-line hover:bg-surface-muted";
const exampleSelectedClass = "border-line-emphasis bg-surface-muted";

/** The examples under a form's text box; a click replaces the text, and the one in effect is pressed. */
export function FormExamples({
  examples,
  value,
  onChange,
  disabled,
}: {
  examples: readonly FormExample[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const s = useStrings();
  if (examples.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-fg-muted">{s.form.examplesTitle}</div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {examples.map((ex) => {
          const selected = value === ex.prompt;
          return (
            <button
              key={ex.key}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(ex.prompt)}
              className={`${exampleClass} ${selected ? exampleSelectedClass : exampleIdleClass}`}
            >
              <div className="truncate text-xs font-medium text-fg">{ex.label}</div>
              {ex.description !== undefined && (
                <div className="truncate text-xs text-fg-muted">{ex.description}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Who does the work: the Agent a task without a picker goes to. */
export function ByAgentLine({ agentId }: { agentId: string | null }) {
  const s = useStrings();
  const wb = useWorkbench();
  return agentId !== null ? (
    <p className="text-sm text-fg-muted">{s.form.byAgent(wb.agentName(agentId))}</p>
  ) : (
    <p className="text-sm text-tone-attention-fg">{s.form.noAgent}</p>
  );
}
