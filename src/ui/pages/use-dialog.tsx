/**
 * Use one Benchmark: the dialog behind Use on a card and on the Benchmark's own page. A
 * segmented control picks what to use it for — Evaluate, which puts an agent on the frozen cases
 * and appends one labelled evaluation to the scoreboard, or Optimize, which improves an agent
 * against those scores. Both tabs are forms whose Start sends an `evaluate` or `optimize` task to
 * the agent that carries the work out, in a new conversation; the full prompt is folded underneath.
 *
 * A Benchmark can score several agents, so which one is under test is a choice here, preset to the
 * one tested last (else the Agent the list is filtered by, else the default). Two models are picked
 * apart: the conversation's, preset to the Project's default, and the one the tested agent runs on,
 * preset to the model of its latest scored evaluation here (else the Project's default) so a new
 * score joins that series; it follows the tested agent until it is picked by hand. The default
 * loop's baseline is the tested agent's newest score on the tested model.
 *
 * Optimize first picks the method: the default loop or one RSI toolkit per plugin of the library
 * (the Project's view lists them). Any other toolkit follows its own Skill for what it trains and
 * tests on and its budget, so it takes no round limit and no target, and runs per case give way to
 * test-set repetitions. With no toolkit listed the select says so and the tab is the default loop.
 * Mounted fresh per Benchmark.
 */
import { useEffect, useState } from "react";
import {
  FieldHint,
  FieldLabel,
  Input,
  Modal,
  NoticeStrip,
  Segmented,
  Select,
  Textarea,
} from "@prismshadow/penguin-ui";
import type {
  ApprovalMode,
  EvaluateTaskRequest,
  MergedBenchmark,
  ModelRef,
  OptimizeTaskRequest,
  WorkbenchMethod,
} from "../../api";
import { useAgentSkills } from "../agent-skills";
import { useStrings, useWorkbench } from "../context";
import { EVALUATION_SKILL, OPTIMIZATION_SKILL } from "../methods";
import { formatScore } from "../format";
import { benchmarkTitle, defaultTargetScore, latestScoreOfAgent } from "../metrics";
import { MAX_RUNS } from "./manual-create-dialog";
import { ApprovalModeSelect, PromptPreview, StartFooter, useStartTask } from "./start-task";

export type UseTab = "evaluate" | "optimize";

/** How many complete passes over the test set a toolkit makes per reported State, by default. */
export const DEFAULT_TEST_REPETITIONS = 3;

const digits = (v: string) => v.replace(/[^\d]/g, "");
const errorProp = (message: string | undefined) =>
  message !== undefined ? { error: message } : {};

/** A digits-only field as an integer within [min, max], or null. */
function intIn(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

const modelKey = (ref: ModelRef): string => JSON.stringify([ref.provider, ref.modelId]);
const sameModel = (a: ModelRef, b: ModelRef) =>
  a.provider === b.provider && a.modelId === b.modelId;

export function UseDialog({
  benchmark,
  onClose,
  initialTab = "evaluate",
}: {
  benchmark: MergedBenchmark;
  onClose: () => void;
  initialTab?: UseTab;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const { models, defaultModel, methods } = wb.context;
  const [tab, setTab] = useState<UseTab>(initialTab);
  const lastTested =
    [...benchmark.evaluations].reverse().find((e) => (e.agentId ?? "") !== "")?.agentId ?? null;
  const [testAgentId, setTestAgentId] = useState(
    lastTested ?? wb.route.agentId ?? wb.defaultAgentId ?? "",
  );
  const listed = (ref: ModelRef) => models.some((m) => sameModel(m, ref));
  const lastScored =
    testAgentId === ""
      ? undefined
      : [...benchmark.evaluations]
          .reverse()
          .find((e) => (e.agentId ?? "") === testAgentId && Number.isFinite(e.score));
  // A model the Project no longer lists is not offered: a run on it could not start.
  const lastScoredModel =
    lastScored !== undefined && listed(lastScored)
      ? { provider: lastScored.provider, modelId: lastScored.modelId }
      : null;
  /** The tested model picked by hand; null while it follows the tested agent. */
  const [testModelPick, setTestModelPick] = useState<ModelRef | null>(null);
  const testModel = testModelPick ?? lastScoredModel ?? defaultModel ?? null;
  const baseline =
    testModel === null
      ? null
      : latestScoreOfAgent(
          benchmark.evaluations.filter((e) => sameModel(e, testModel)),
          testAgentId,
        );
  const defaultTarget = defaultTargetScore(baseline?.score ?? null);
  const [evaluatorId, setEvaluatorId] = useState<string | null>(wb.defaultAgentId);
  const [optimizerId, setOptimizerId] = useState<string | null>(wb.defaultAgentId);
  const [sessionModel, setSessionModel] = useState<ModelRef | null>(defaultModel);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("allow-all");
  // Clamped: benchmark_config.toml is hand-editable, and a larger count there would open the
  // dialog on a field its own bound rejects.
  const [runs, setRuns] = useState(String(Math.min(benchmark.runs ?? 1, MAX_RUNS)));
  const [testRepetitions, setTestRepetitions] = useState(String(DEFAULT_TEST_REPETITIONS));
  const [note, setNote] = useState("");
  const [roundLimit, setRoundLimit] = useState("3");
  const [targetScore, setTargetScore] = useState(String(defaultTarget));
  /** The target follows the baseline until the field is edited by hand. */
  const [targetTouched, setTargetTouched] = useState(false);
  const [focus, setFocus] = useState("");
  const [methodPlugin, setMethodPlugin] = useState<string | null>(methods[0]?.plugin ?? null);
  const method: WorkbenchMethod | null =
    methods.find((m) => m.plugin === methodPlugin) ?? methods[0] ?? null;
  const isDefaultMethod = method === null || method.kind === "default";
  const optimizerSkill = method?.skill ?? OPTIMIZATION_SKILL;
  const task = useStartTask(onClose);

  useEffect(() => {
    if (!targetTouched) setTargetScore(String(defaultTarget));
  }, [defaultTarget, targetTouched]);

  const skillsOf = {
    evaluator: useAgentSkills(wb.skills, evaluatorId),
    optimizer: useAgentSkills(wb.skills, optimizerId),
  };
  /** Whether the Agent's Skills, once read, lack `skill`: unknown ones warn of nothing. */
  const lacksSkill = (skills: readonly string[] | undefined, skill: string): boolean =>
    skills !== undefined && !skills.includes(skill);

  const runsValue = intIn(runs, 1, MAX_RUNS);
  const repetitionsValue = intIn(testRepetitions, 1, MAX_RUNS);
  const roundsValue = intIn(roundLimit, 1, MAX_RUNS);
  const targetValue = intIn(targetScore, 1, 100);
  const runnerId = tab === "evaluate" ? evaluatorId : optimizerId;
  const usesRuns = tab === "evaluate" || isDefaultMethod;
  const complete =
    runnerId !== null &&
    testAgentId !== "" &&
    testModel !== null &&
    (usesRuns ? runsValue !== null : repetitionsValue !== null) &&
    (tab === "evaluate" || !isDefaultMethod || (roundsValue !== null && targetValue !== null));

  const base = {
    benchmarkId: benchmark.id,
    targetAgentId: testAgentId,
    approvalMode,
    language: wb.locale,
    ...(sessionModel !== null ? { model: sessionModel } : {}),
  };
  const body: EvaluateTaskRequest | OptimizeTaskRequest | null =
    runnerId === null || testModel === null || testAgentId === ""
      ? null
      : tab === "evaluate"
        ? {
            ...base,
            kind: "evaluate",
            agentId: runnerId,
            runs: runsValue ?? benchmark.runs ?? 1,
            testedModel: testModel,
            ...(note.trim() !== "" ? { notes: note.trim() } : {}),
          }
        : {
            ...base,
            kind: "optimize",
            agentId: runnerId,
            method: method?.plugin ?? "",
            ...(method !== null && method.kind === "paper" ? { skill: method.skill } : {}),
            testedModel: testModel,
            ...(isDefaultMethod
              ? {
                  runs: runsValue ?? benchmark.runs ?? 1,
                  roundLimit: roundsValue ?? 3,
                  targetScore: targetValue ?? defaultTarget,
                }
              : { testRepetitions: repetitionsValue ?? DEFAULT_TEST_REPETITIONS }),
            ...(focus.trim() !== "" ? { notes: focus.trim() } : {}),
          };
  const ready = complete && body !== null && !task.busy;

  const agentOptions = wb.agents.map((a) => (
    <option key={a.agentId} value={a.agentId}>
      {wb.agentName(a.agentId)}
    </option>
  ));
  const modelField = (
    label: string,
    hint: string,
    value: ModelRef | null,
    onChange: (ref: ModelRef) => void,
  ) =>
    models.length === 0 ? (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <p className="text-xs text-fg-subtle">{s.form.modelsEmpty}</p>
        <FieldHint>{hint}</FieldHint>
      </div>
    ) : (
      <Select
        label={label}
        hint={hint}
        value={value === null ? "" : modelKey(value)}
        onChange={(e) => {
          const picked = models.find((m) => modelKey(m) === e.target.value);
          if (picked !== undefined)
            onChange({ provider: picked.provider, modelId: picked.modelId });
        }}
      >
        {models.map((m) => (
          <option key={modelKey(m)} value={modelKey(m)}>
            {`${m.displayName ?? m.modelId} · ${m.provider}`}
          </option>
        ))}
      </Select>
    );
  const missingSkillStrip = (missing: boolean, message: string) =>
    missing ? (
      <NoticeStrip tone="attention" className="rounded-md border px-3 py-2 text-xs">
        {message}
      </NoticeStrip>
    ) : null;
  const testedAgentSelect = (hint: string) => (
    <Select
      label={s.benchmark.testedAgent}
      hint={hint}
      value={testAgentId}
      onChange={(e) => setTestAgentId(e.target.value)}
    >
      {agentOptions}
    </Select>
  );
  const testedModelField = () =>
    modelField(s.benchmark.testedModel, s.benchmark.testedModelHint, testModel, setTestModelPick);
  const runsInput = (hint: string) => (
    <Input
      label={s.benchmark.runsField}
      hint={hint}
      inputMode="numeric"
      value={runs}
      onChange={(e) => setRuns(digits(e.target.value))}
      {...errorProp(runsValue === null ? s.benchmark.invalidRuns : undefined)}
    />
  );

  return (
    <Modal
      open
      title={s.benchmark.useTitle(benchmarkTitle(benchmark, wb.locale))}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <StartFooter
          onCancel={onClose}
          onStart={() => body !== null && void task.start(body)}
          ready={ready}
          busy={task.busy}
        />
      }
    >
      <div className="space-y-3">
        <Segmented
          cols={2}
          value={tab}
          onChange={setTab}
          options={[
            { value: "evaluate" as UseTab, label: s.benchmark.evaluate },
            { value: "optimize" as UseTab, label: s.benchmark.optimize },
          ]}
        />
        {tab === "evaluate" ? (
          <>
            <p className="text-sm text-fg-muted">{s.benchmark.evaluateDescription}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {testedAgentSelect(s.benchmark.evaluateTestedAgentHint)}
              {testedModelField()}
              <Select
                label={s.benchmark.evaluatorAgent}
                hint={s.benchmark.evaluatorAgentHint}
                value={evaluatorId ?? ""}
                onChange={(e) => setEvaluatorId(e.target.value)}
              >
                {agentOptions}
              </Select>
              {modelField(
                s.benchmark.evaluateSessionModel,
                s.benchmark.evaluateSessionModelHint,
                sessionModel,
                setSessionModel,
              )}
              {runsInput(s.benchmark.evaluateRunsHint)}
              <ApprovalModeSelect value={approvalMode} onChange={setApprovalMode} />
            </div>
            {missingSkillStrip(
              lacksSkill(skillsOf.evaluator, EVALUATION_SKILL),
              s.benchmark.evaluatorMissingSkill,
            )}
            <Textarea
              label={s.benchmark.evaluateNoteField}
              placeholder={s.benchmark.evaluateNotePlaceholder}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </>
        ) : (
          <>
            {method !== null ? (
              <Select
                label={s.benchmark.methodField}
                info={s.benchmark.methodHint}
                {...((wb.locale === "zh" ? method.hintZh : method.hint) !== ""
                  ? { hint: wb.locale === "zh" ? method.hintZh : method.hint }
                  : {})}
                value={method.plugin}
                onChange={(e) => setMethodPlugin(e.target.value)}
              >
                {methods.map((m) => (
                  <option key={m.plugin} value={m.plugin}>
                    {wb.locale === "zh" ? m.labelZh : m.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Select
                label={s.benchmark.methodField}
                info={s.benchmark.methodHint}
                value=""
                disabled
              >
                <option value="">{s.benchmark.methodsNone}</option>
              </Select>
            )}
            {isDefaultMethod && (
              <>
                <p className="text-sm text-fg-muted">{s.benchmark.optimizeDescription}</p>
                {baseline === null ? (
                  <NoticeStrip tone="attention" className="rounded-md border px-3 py-2 text-xs">
                    {s.benchmark.noBaseline}
                  </NoticeStrip>
                ) : (
                  <p className="text-xs text-fg-muted">
                    {s.benchmark.baselineLine(
                      formatScore(baseline.score),
                      targetValue ?? defaultTarget,
                    )}
                  </p>
                )}
              </>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {testedAgentSelect(s.benchmark.testedAgentHint)}
              {testedModelField()}
              <Select
                label={s.benchmark.optimizerAgent}
                hint={
                  isDefaultMethod
                    ? s.benchmark.optimizerAgentHint
                    : s.benchmark.methodOptimizerHint(optimizerSkill)
                }
                value={optimizerId ?? ""}
                onChange={(e) => setOptimizerId(e.target.value)}
              >
                {agentOptions}
              </Select>
              {modelField(
                s.benchmark.sessionModel,
                s.benchmark.sessionModelHint,
                sessionModel,
                setSessionModel,
              )}
            </div>
            {missingSkillStrip(
              lacksSkill(skillsOf.optimizer, optimizerSkill),
              isDefaultMethod
                ? s.benchmark.optimizerMissingSkill
                : s.benchmark.methodMissingSkill(method?.plugin ?? "", optimizerSkill),
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {isDefaultMethod ? (
                <>
                  {runsInput(s.benchmark.optimizeRunsHint)}
                  <Input
                    label={s.benchmark.roundLimitField}
                    hint={s.benchmark.roundLimitHint}
                    inputMode="numeric"
                    value={roundLimit}
                    onChange={(e) => setRoundLimit(digits(e.target.value))}
                    {...errorProp(roundsValue === null ? s.benchmark.invalidRuns : undefined)}
                  />
                  <Input
                    label={s.benchmark.targetScoreField}
                    hint={s.benchmark.targetScoreHint}
                    inputMode="numeric"
                    value={targetScore}
                    onChange={(e) => {
                      setTargetTouched(true);
                      setTargetScore(digits(e.target.value));
                    }}
                    {...errorProp(targetValue === null ? s.benchmark.invalidScore : undefined)}
                  />
                </>
              ) : (
                <>
                  <Input
                    label={s.benchmark.testRepetitionsField}
                    hint={s.benchmark.testRepetitionsHint}
                    inputMode="numeric"
                    value={testRepetitions}
                    onChange={(e) => setTestRepetitions(digits(e.target.value))}
                    {...errorProp(repetitionsValue === null ? s.benchmark.invalidRuns : undefined)}
                  />
                  <p className="text-xs text-fg-muted sm:col-span-2 sm:self-center">
                    {s.benchmark.methodBudgetHint}
                  </p>
                </>
              )}
            </div>
            <ApprovalModeSelect value={approvalMode} onChange={setApprovalMode} />
            <Textarea
              label={s.benchmark.focusField}
              placeholder={s.benchmark.focusPlaceholder}
              rows={3}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
            />
          </>
        )}
        <PromptPreview body={body} />
        {task.feedback}
      </div>
    </Modal>
  );
}
