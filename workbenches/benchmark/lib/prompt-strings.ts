/**
 * The requests the workbench's tasks send, in English and in Chinese: the fixed tails that name
 * the Skill to use and the parameters it requires (the Test Agent, the Benchmark and its folder
 * `BENCHMARK_DIR`, run and round counts, the target score, the model the Test Agent runs on), and
 * the import's lead sentences. A person's own words — the description, the note, the focus, the
 * question — come first and the tail after a blank line (composePrompt), so a one-line wish
 * arrives as a request the Skill can act on without asking anything back.
 *
 * Moved from the Web App's dictionaries (strings.ts / strings-en.ts, `S.benchmark.*Tail`,
 * `importPromptLead`, `importPromptTail`), where the page prefilled a draft with them; the handler
 * now builds the same request, which the page sends as its Start (PRFC-0036). The wording is
 * unchanged but for the app's name and the folder's owner, an Agent's workbench rather than the
 * Project. The two "Ask AI" tails name no Skill and ask for no change: they carry the facts
 * already on screen, formatted as the reader saw them.
 */

/** The facts an evaluation question carries; values arrive formatted as on screen. */
export interface AskEvaluationTailParams {
  benchmarkId: string;
  benchmarkDir: string;
  time: string;
  label: string;
  version: number | string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  score: string;
  cost: string;
  duration: string;
  summaryTitle: string;
  summary: string;
  cases: { id: string; score: string; cost: string; duration: string; sessionIds: string[] }[];
}

export interface AskCaseTailParams {
  benchmarkId: string;
  benchmarkDir: string;
  caseId: string;
  latest: { time: string; score: string; runs: { score: string; sessionId: string }[] } | null;
}

export interface EvaluateTailParams {
  targetAgentId: string;
  benchmarkId: string;
  benchmarkDir: string;
  runs: number;
  provider: string;
  modelId: string;
}

export interface OptimizeTailParams extends EvaluateTailParams {
  roundLimit: number;
  targetScore: number;
}

export interface RsiOptimizeTailParams {
  skill: string;
  targetAgentId: string;
  benchmarkId: string;
  benchmarkDir: string;
  testRepetitions: number;
  provider: string;
  modelId: string;
}

/** What the pasted import source is, as far as the lead sentence cares. */
export type ImportSourceKind = "repoFolderUrl" | "localPath" | "reference";

export interface PromptTable {
  askEvaluationTail: (p: AskEvaluationTailParams) => string;
  askCaseTail: (p: AskCaseTailParams) => string;
  aiCreateTail: (targetAgentId: string, benchmarksDir: string) => string;
  evaluateTail: (p: EvaluateTailParams) => string;
  optimizeTail: (p: OptimizeTailParams) => string;
  rsiOptimizeTail: (p: RsiOptimizeTailParams) => string;
  importPromptLead: Record<ImportSourceKind, (source: string) => string>;
  importPromptTail: (benchmarksDir: string) => string;
}

export const EN_PROMPTS: PromptTable = {
  askEvaluationTail: (p: AskEvaluationTailParams): string =>
    "Explain the result of the Benchmark evaluation below. Read and analyze only: change neither this Benchmark nor the tested agent.\n\n" +
    `- benchmark_id: \`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR: \`${p.benchmarkDir}\` (the scoreboard is \`${p.benchmarkDir}/scoreboard.yaml\`)\n` +
    `- Evaluated at: ${p.time}\n` +
    `- Series label: ${p.label}\n` +
    `- Tested version: v${p.version}\n` +
    `- Evaluation runtime: provider \`${p.provider}\` / model_id \`${p.modelId}\` / thinking_level \`${p.thinkingLevel}\`\n` +
    `- Total score ${p.score}; cost ${p.cost}; duration ${p.duration}\n` +
    (p.summaryTitle !== "" ? `- Summary title: ${p.summaryTitle}\n` : "") +
    (p.summary !== "" ? `- Summary: ${p.summary}\n` : "") +
    "- Per-case scores (score, cost, duration, and the Session id of every run):\n" +
    p.cases
      .map(
        (c) =>
          `  - \`${c.id}\`: ${c.score}; ${c.cost}; ${c.duration}; Session ` +
          (c.sessionIds.length > 0
            ? c.sessionIds.map((id) => `\`${id}\``).join(", ")
            : "not recorded"),
      )
      .join("\n") +
    "\n\nRead this record in scoreboard.yaml, and the Traces of the Sessions listed above as far as you need them. Then say how these scores came about, " +
    "which cases are weakest and exactly why, and what to do next (which part of the tested agent to change, or which evidence to gather first).",
  askCaseTail: (p: AskCaseTailParams): string =>
    "Explain what the Benchmark case below tests and what a strong answer looks like. A case is frozen once it exists: read and analyze only, and do not change this Benchmark.\n\n" +
    `- benchmark_id: \`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR: \`${p.benchmarkDir}\`\n` +
    `- case_id: \`${p.caseId}\`\n` +
    `- Statement: \`${p.benchmarkDir}/${p.caseId}/statement/README.md\`\n` +
    `- Rubric: \`${p.benchmarkDir}/${p.caseId}/rubric/README.md\`\n` +
    (p.latest === null
      ? "- This Benchmark has no evaluations yet.\n"
      : `- The latest evaluation (${p.latest.time}) averaged ${p.latest.score} on this case\n` +
        p.latest.runs
          .map((r, i) => `  - Run #${i + 1}: ${r.score}; Session \`${r.sessionId}\`\n`)
          .join("")) +
    "\nRead both READMEs above (and the Traces of the Sessions listed, if there are any). Then say what capability this case actually tests, " +
    "what a strong answer looks like (the decisions and the artifact it takes), and which rubric items separate excellent work from merely passing work.",
  aiCreateTail: (targetAgentId: string, benchmarksDir: string): string =>
    "Use the `benchmark-design` Skill: as the Builder, design and calibrate a Benchmark for the Test Agent below without changing that agent itself.\n\n" +
    `- test_agent_id: \`${targetAgentId}\`\n` +
    "- benchmark_id: keep the one named above if any; otherwise derive a short semantic id (letters, digits, `_` and `-` only)\n" +
    "- case count: about 3 — few and hard, each with at least one decision that separates following the motions from actually doing the work (the draft above wins when it names one)\n" +
    "- techniques: hidden preconditions, vague or incomplete input, sources that contradict each other, strict deliverables; no difficulty from piling on rows or rules\n" +
    "- desired_baseline_score: `<50` (the draft above wins when it names one)\n" +
    "- pilot_iteration_limit: `4` (the draft above wins when it names one)\n\n" +
    `A Benchmark sits beside agents, not under one: its folder BENCHMARK_DIR is \`${benchmarksDir}/<benchmark_id>/\`, in the Self-Evolution Workbench's data folder (never inside the tested agent's Agent State). Create it with ` +
    '`benchmark_config.toml` (id equal to the directory name, title, description, version set to today\'s date version `"YYYY.MM.DD.1"`, status, runs = 1 and an `[origin]` table with `kind = "agent"`; it records no agent), ' +
    "one `CASE-NNN-<slug>/` per case (`statement/README.md` is the statement, `rubric/README.md` the scoring rubric, 100 points per case, nothing from the rubric leaking into the statement) " +
    "and `scoreboard.yaml` (initially `evaluations: []`; every evaluation records the tested `agent_id`, its `version`, the paired `provider` / `model_id` and the `thinking_level`). " +
    "Every trial evaluation goes through `run_subagent`, and the subagent's prompt must say to use the `agent-evaluation` Skill — never score a run yourself and never bypass that Skill; " +
    "calibrate difficulty case by case, " +
    "freeze the final revision, append the Formal Baseline to scoreboard.yaml, and finish by reporting the Benchmark id, the baseline score and the per-case scores.",
  evaluateTail: (p: EvaluateTailParams): string =>
    "Use the `agent-evaluation` Skill to evaluate the Test Agent on this frozen Benchmark.\n\n" +
    `- test_agent_id: \`${p.targetAgentId}\`\n` +
    `- benchmark_id: \`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR: \`${p.benchmarkDir}\`\n` +
    `- runs: \`${p.runs}\`\n` +
    `- provider: \`${p.provider}\`\n` +
    `- model_id: \`${p.modelId}\`\n\n` +
    "Evaluate the full Case × runs matrix through `run_subagent`, one self-spawned subagent per matrix cell (omit `agent_id`), and say in every subagent's prompt to use the `agent-evaluation` Skill — never score a run yourself and never bypass that Skill. " +
    "The tested model is the provider and model above, which need not be the model this conversation runs on: pass them as `provider` and `model_id` in every request. " +
    "The thinking level is the one the tested agent is configured with. Require every returned result to agree on " +
    "`agent_id`, `provider`, `model_id` and `thinking_level`, and stop rather than merge two labels into one record. Average the runs per case and the cases " +
    "per evaluation as the scoreboard contract specifies, then append exactly ONE evaluation to `scoreboard.yaml`, labelled with `agent_id`, `version`, " +
    "`provider` / `model_id` and `thinking_level`. Change neither the tested agent nor the Benchmark. " +
    "Finish by reporting the total score, the per-case scores and the label the evaluation was recorded under.",
  optimizeTail: (p: OptimizeTailParams): string =>
    "Use the `agent-optimization` Skill to improve the Test Agent against its frozen Benchmark.\n\n" +
    `- test_agent_id: \`${p.targetAgentId}\`\n` +
    `- benchmark_id: \`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR: \`${p.benchmarkDir}\`\n` +
    `- runs: \`${p.runs}\`\n` +
    `- provider: \`${p.provider}\`\n` +
    `- model_id: \`${p.modelId}\`\n` +
    `- desired_score: \`>=${p.targetScore}\`\n` +
    `- candidate_round_limit: \`${p.roundLimit}\`\n\n` +
    "Each round, state one falsifiable hypothesis from the current Reference and make one bounded change; evaluate the full Case × runs matrix through `run_subagent`, saying in every subagent's prompt to use the `agent-evaluation` Skill — never score a run yourself and never bypass that Skill; " +
    "the Reference is the tested agent's complete evaluation of its current Agent State on the provider and model above, and every candidate is evaluated on that same provider, model_id and thinking_level; keep the version and append an evaluation carrying `agent_id`, `version`, `provider` / `model_id` and `thinking_level` " +
    "to scoreboard.yaml only when the total score is strictly higher than the Reference, otherwise roll back. " +
    "Finish by reporting the scores before and after, the retained version, and each round's change and decision.",
  rsiOptimizeTail: (p: RsiOptimizeTailParams): string =>
    `Use the \`${p.skill}\` Skill to run its method on the Test Agent, starting from this Benchmark.\n\n` +
    `- test_agent_id: \`${p.targetAgentId}\`\n` +
    `- benchmark_id: \`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR: \`${p.benchmarkDir}\`\n` +
    `- test_repetitions: \`${p.testRepetitions}\`\n` +
    `- provider: \`${p.provider}\`\n` +
    `- model_id: \`${p.modelId}\`\n\n` +
    "Run the method as the Skill defines it: the data it trains and tests on, its budget, how it measures and what it records are the Skill's to decide. " +
    "The Test Agent runs on exactly this provider and model, at the thinking level it is configured with. " +
    "`test_repetitions` is how many complete times each State you report, the baseline and the final one, is tested on the test set. " +
    "Ask me only for inputs the method requires and I have not given, " +
    "and finish by reporting the baseline score, the final score, the retained version and what the method changed.",
  importPromptLead: {
    repoFolderUrl: (s: string): string =>
      `Import the Benchmark package at this repository folder into the Self-Evolution Workbench: ${s}.`,
    localPath: (s: string): string => `Import the Benchmark package under this local path: ${s}.`,
    reference: (s: string): string => `Find and import this Benchmark as a package: ${s}.`,
  },
  importPromptTail: (benchmarksDir: string): string =>
    [
      "If the `benchmark-design` Skill is available, read the import instructions in `reference/package.md`. For a repository, use `git ls-remote` to pin the branch or tag to a 40-character commit and fetch the selected package. Extract a local zip into a temporary directory first.",
      'Check `benchmark_config.toml` (`status = "published"`) and every `CASE-*/statement/README.md` and `CASE-*/rubric/README.md`. Read all files; refuse symlinks, executables and unrelated content.',
      `Copy the manifest and \`CASE-*/\` folders directly into the Self-Evolution Workbench's Benchmark folder BENCHMARK_DIR, \`${benchmarksDir}/<id>/\`, preserving the package's id, version and cases. Do not copy its \`scoreboard.yaml\` or \`.jobs/\`. Create \`scoreboard.yaml\` containing \`evaluations: []\`.`,
      'Update `[origin]`: for a repository, set `kind = "git"` and record `url`, `ref` (the commit), `path` and `imported_at`; for a local source, set `kind = "zip"` and the import time. Ask me before overwriting an existing directory. Never replace a Benchmark while it is being evaluated.',
      "Verify the copied manifest and case count, then report the id, title, version, case count and path. Importing does not run an evaluation.",
    ].join("\n"),
};

export const ZH_PROMPTS: PromptTable = {
  askEvaluationTail: (p: AskEvaluationTailParams): string =>
    "请解释下面这次 Benchmark 评估的结果。只做阅读与分析：不要修改这套 Benchmark，也不要修改被测智能体。\n\n" +
    `- benchmark_id：\`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR：\`${p.benchmarkDir}\`（记分板为 \`${p.benchmarkDir}/scoreboard.yaml\`）\n` +
    `- 评估时间：${p.time}\n` +
    `- 系列标签：${p.label}\n` +
    `- 被测版本：v${p.version}\n` +
    `- 评测 Runtime：provider \`${p.provider}\` / model_id \`${p.modelId}\` / thinking_level \`${p.thinkingLevel}\`\n` +
    `- 总分 ${p.score}；成本 ${p.cost}；耗时 ${p.duration}\n` +
    (p.summaryTitle !== "" ? `- 评估说明标题：${p.summaryTitle}\n` : "") +
    (p.summary !== "" ? `- 评估说明：${p.summary}\n` : "") +
    "- 逐题结果（分数、成本、耗时，以及逐次运行的 Session id）：\n" +
    p.cases
      .map(
        (c) =>
          `  - \`${c.id}\`：${c.score}；${c.cost}；${c.duration}；Session ` +
          (c.sessionIds.length > 0 ? c.sessionIds.map((id) => `\`${id}\``).join("、") : "未记录"),
      )
      .join("\n") +
    "\n\n请读取 scoreboard.yaml 里这条记录，并按需读取上列 Session 的 Trace，然后说明：这些分数是怎么来的、" +
    "哪几道题最薄弱及其具体原因，以及下一步建议（改被测智能体的哪一处，或先补哪一类证据）。",
  askCaseTail: (p: AskCaseTailParams): string =>
    "请解释下面这道 Benchmark 题目考的是什么、怎样才算答好。题目创建即冻结，只做阅读与分析，不要修改这套 Benchmark。\n\n" +
    `- benchmark_id：\`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR：\`${p.benchmarkDir}\`\n` +
    `- case_id：\`${p.caseId}\`\n` +
    `- 题干：\`${p.benchmarkDir}/${p.caseId}/statement/README.md\`\n` +
    `- 评分细则：\`${p.benchmarkDir}/${p.caseId}/rubric/README.md\`\n` +
    (p.latest === null
      ? "- 这套 Benchmark 还没有评估记录。\n"
      : `- 最近一次评估（${p.latest.time}）在这道题上的平均分 ${p.latest.score}\n` +
        p.latest.runs
          .map((r, i) => `  - 第 ${i + 1} 次运行：${r.score}；Session \`${r.sessionId}\`\n`)
          .join("")) +
    "\n请读取上面两个 README（以及上列 Session 的 Trace，如果有），然后说明：这道题实际考察什么能力、" +
    "一份好答案长什么样（关键决定与产物），以及评分细则靠哪些条目把优秀与及格区分开。",
  aiCreateTail: (targetAgentId: string, benchmarksDir: string): string =>
    "请使用 `benchmark-design` Skill，作为 Builder 为下面的被测智能体设计并校准一套 Benchmark，不要修改被测智能体本身。\n\n" +
    `- test_agent_id：\`${targetAgentId}\`\n` +
    "- benchmark_id：上文已指定则沿用，否则按场景取一个简短的语义化 id（仅字母、数字、`_` 和 `-`）\n" +
    "- 题量：3 道左右——少而难，每题至少有一个能把「照着做」和「真会做」分开的决定点（上文另有要求时以上文为准）\n" +
    "- 出题手法：隐藏的先验条件、模糊或不完整的输入、互相冲突的材料、严格的交付格式；不要靠堆行数、堆规则来加难度\n" +
    "- desired_baseline_score：`<50`（上文另有要求时以上文为准）\n" +
    "- pilot_iteration_limit：`4`（上文另有要求时以上文为准）\n\n" +
    `Benchmark 与 Agent 平级：它的目录 BENCHMARK_DIR 为 \`${benchmarksDir}/<benchmark_id>/\`，在自进化工作台的数据目录里（不在被测智能体的 Agent State 内）。在其中创建 \`benchmark_config.toml\`` +
    '（id 与目录名相同、title、description、version 为当天的日期版本 `"YYYY.MM.DD.1"`、status、runs = 1，以及 `kind = "agent"` 的 `[origin]` 表；不记录被测智能体）、' +
    "每题一个 `CASE-NNN-<slug>/`（`statement/README.md` 为题干，`rubric/README.md` 为评分细则，每题满分 100 分，细则不得泄露到题干）" +
    "以及 `scoreboard.yaml`（初始为 `evaluations: []`；每条 evaluation 记录被测的 `agent_id`、`version`、成对的 `provider` / `model_id` 与 `thinking_level`）。" +
    "每一次试测都必须通过 `run_subagent` 派发子会话，并在子会话的 prompt 里写明使用 `agent-evaluation` Skill——不要自己打分，也不要绕过这个技能；" +
    "逐题试测以校准难度，定稿后冻结并把 Formal Baseline 追加进 scoreboard.yaml，最后报告 Benchmark id、基线分数与各题分数。",
  evaluateTail: (p: EvaluateTailParams): string =>
    "请使用 `agent-evaluation` Skill，在这套已冻结的 Benchmark 上评估被测智能体。\n\n" +
    `- test_agent_id：\`${p.targetAgentId}\`\n` +
    `- benchmark_id：\`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR：\`${p.benchmarkDir}\`\n` +
    `- runs：\`${p.runs}\`\n` +
    `- provider：\`${p.provider}\`\n` +
    `- model_id：\`${p.modelId}\`\n\n` +
    "通过 `run_subagent` 按完整的 Case × runs 矩阵评测，每个矩阵单元一个自调用的子会话（省略 `agent_id`），并在每个子会话的 prompt 里写明使用 `agent-evaluation` Skill——不要自己打分，也不要绕过这个技能。" +
    "被测模型就是上面这组 provider 与模型，不一定是本会话自己的模型：把它们作为每个请求的 `provider` 与 `model_id`。" +
    "思考等级取被测智能体配置的等级。校验每条返回结果的 `agent_id`、`provider`、`model_id` 与 `thinking_level` 完全一致，" +
    "不一致就停下、不要把不同标签混成一条。按记分契约求各题（runs 平均）与整体（各题平均）的分数，" +
    "然后只向 `scoreboard.yaml` 追加一条 evaluation，记上 `agent_id`、`version`、`provider` / `model_id` 与 `thinking_level` 作为标签。" +
    "不修改被测智能体，也不修改 Benchmark。结束时报告总分、各题分数与本条记录的标签。",
  optimizeTail: (p: OptimizeTailParams): string =>
    "请使用 `agent-optimization` Skill，针对已冻结的 Benchmark 优化被测智能体。\n\n" +
    `- test_agent_id：\`${p.targetAgentId}\`\n` +
    `- benchmark_id：\`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR：\`${p.benchmarkDir}\`\n` +
    `- runs：\`${p.runs}\`\n` +
    `- provider：\`${p.provider}\`\n` +
    `- model_id：\`${p.modelId}\`\n` +
    `- desired_score：\`>=${p.targetScore}\`\n` +
    `- candidate_round_limit：\`${p.roundLimit}\`\n\n` +
    "每轮从当前 Reference 出发提出一个可证伪的假设、只做一个有界改动；通过 `run_subagent` 评测完整的 Case × runs 矩阵，每个子会话的 prompt 里都写明使用 `agent-evaluation` Skill——不要自己打分，也不要绕过这个技能；" +
    "Reference 是被测智能体当前 Agent State 在上面这组 provider 与模型上的完整评估，每个候选都在同一组 provider、model_id 与 thinking_level 上评测；仅当总分严格高于 Reference 时保留该版本，" +
    "并把记有 `agent_id`、`version`、`provider` / `model_id` 与 `thinking_level` 的 evaluation 追加到 scoreboard.yaml，否则回滚。" +
    "结束时报告优化前后的分数、保留的版本号，以及每轮的改动与取舍。",
  rsiOptimizeTail: (p: RsiOptimizeTailParams): string =>
    `请使用 \`${p.skill}\` 技能，从这套 Benchmark 出发对被测智能体运行它的方法。\n\n` +
    `- test_agent_id：\`${p.targetAgentId}\`\n` +
    `- benchmark_id：\`${p.benchmarkId}\`\n` +
    `- BENCHMARK_DIR：\`${p.benchmarkDir}\`\n` +
    `- test_repetitions：\`${p.testRepetitions}\`\n` +
    `- provider：\`${p.provider}\`\n` +
    `- model_id：\`${p.modelId}\`\n\n` +
    "按技能的定义运行这个方法：在哪些数据上训练和测试、预算多少、怎样测量、记录什么，都以技能为准。" +
    "被测智能体固定使用这组 provider 与模型，思考等级沿用它自己的配置。" +
    "`test_repetitions` 是你报告的每个 State（基线与最终版本）在测试集上完整测试的次数。" +
    "只问我方法必需而我没给的输入；结束时报告基线分、最终分、保留的版本与方法改了什么。",
  importPromptLead: {
    repoFolderUrl: (s: string): string =>
      `把这个仓库文件夹里的 Benchmark 包导入自进化工作台：${s}。`,
    localPath: (s: string): string => `导入这个本地路径下的 Benchmark 包：${s}。`,
    reference: (s: string): string => `找到这个 Benchmark，并把它作为包导入：${s}。`,
  },
  importPromptTail: (benchmarksDir: string): string =>
    [
      "若有 `benchmark-design` 技能，先读 `reference/package.md` 的导入说明。仓库来源先用 `git ls-remote` 将分支或标签固定到 40 位提交号，只获取所选包；本地 zip 先解压到临时目录。",
      '检查包内的 `benchmark_config.toml`（`status = "published"`）及各个 `CASE-*/statement/README.md`、`CASE-*/rubric/README.md`。读完所有文件，拒绝符号链接、可执行文件及无关内容。',
      `在自进化工作台的 Benchmark 目录 BENCHMARK_DIR，即 \`${benchmarksDir}/<id>/\` 中直接复制清单和各个 \`CASE-*/\`，保留包的 id、版本与题目；不要复制上游的 \`scoreboard.yaml\` 或 \`.jobs/\`。新建 \`scoreboard.yaml\`，内容为 \`evaluations: []\`。`,
      '更新清单的 `[origin]`：仓库来源用 `kind = "git"`，记录 `url`、`ref`（提交号）、`path` 和 `imported_at`；本地来源用 `kind = "zip"` 与导入时间。目标目录已存在时先问我，未经同意不得覆盖；仍在评估的目录不得替换。',
      "核对复制后的清单和题数，报告 id、标题、版本、题数与路径。导入不运行评估。",
    ].join("\n"),
};
