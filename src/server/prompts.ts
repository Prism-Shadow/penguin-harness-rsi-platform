/**
 * The request each task sends, built on the server from what its form carries: the person's words
 * first, then the fixed tail for the task's kind in the language of the page that asked
 * (strings.ts), and the Skills the conversation preselects. This is what the Web App used to
 * prefill a draft with (benchmark-prompts.ts, benchmark-import-prompt.ts); only the place it is
 * assembled moved.
 *
 * Every prompt names the Benchmark's folder, `BENCHMARK_DIR`, as this server holds it: the Agent
 * reads and writes there and never works the folder out from its App Data Dir. A copy only another
 * machine holds is named by the Skills' own rule instead (the tasks run on this server, PRFC-0036).
 */
import type {
  AskCaseFacts,
  AskEvaluationFacts,
  WorkbenchMethod,
  WorkbenchTaskKind,
} from "../api.js";
import {
  DEFAULT_TOOLKIT_PLUGIN,
  DESIGN_SKILL,
  EVALUATION_SKILL,
  OPTIMIZATION_SKILL,
} from "./methods.js";
import { EN_PROMPTS, ZH_PROMPTS, type ImportSourceKind, type PromptTable } from "./strings.js";

export type PromptLanguage = "en" | "zh";

export function promptsFor(language: PromptLanguage): PromptTable {
  return language === "zh" ? ZH_PROMPTS : EN_PROMPTS;
}

/** The person's draft, then the tail after a blank line; either may be empty. */
export function composePrompt(draft: string, tail: string): string {
  const body = draft.trim();
  const fixed = tail.trim();
  if (fixed === "") return body;
  if (body === "") return fixed;
  return `${body}\n\n${fixed}`;
}

/** The Benchmark folder under an App Data Dir: the Skills' rule when a request names none. */
const APP_DATA_BENCHMARKS = "<app_data_dir>/agents/system_agent/app/data/benchmark";

/**
 * One Benchmark's folder for a prompt (`BENCHMARK_DIR`): the absolute folder when this server
 * holds the copy, else the Skills' rule under the App Data Dir.
 */
export function benchmarkFolder(benchmarksDir: string, benchmarkId: string, heldHere: boolean) {
  return heldHere ? `${benchmarksDir}/${benchmarkId}` : `${APP_DATA_BENCHMARKS}/${benchmarkId}`;
}

const REPO_HOSTS = /^(www\.)?(github|gitlab|gitee|bitbucket)\.(com|org)$/i;

/**
 * Lightly classifies a pasted import source with the Skills import's heuristic: a link on a code
 * host (or any git remote) is a repository folder, a filesystem path is a local path, anything
 * else is a reference the Agent has to find. A miss only picks a different lead sentence.
 */
export function classifyImportSource(input: string): ImportSourceKind {
  const s = input.trim();
  if (/^git@[\w.-]+:/.test(s) || /\.git$/i.test(s)) return "repoFolderUrl";
  if (/^https?:\/\//i.test(s)) {
    try {
      if (REPO_HOSTS.test(new URL(s).hostname)) return "repoFolderUrl";
    } catch {
      // Malformed URL-ish input: a reference.
    }
    return "reference";
  }
  if (/^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\)/.test(s)) return "localPath";
  return "reference";
}

/** A task's request as its route validated it, with the facts the server looked up. */
export type TaskSpec =
  | { kind: "create"; targetAgentId: string; notes: string }
  | { kind: "import"; source: string }
  | {
      kind: "evaluate";
      benchmarkId: string;
      benchmarkDir: string;
      targetAgentId: string;
      runs: number;
      provider: string;
      modelId: string;
      notes: string;
    }
  | {
      kind: "optimize";
      method: WorkbenchMethod;
      benchmarkId: string;
      benchmarkDir: string;
      targetAgentId: string;
      provider: string;
      modelId: string;
      runs: number;
      roundLimit: number;
      targetScore: number;
      testRepetitions: number;
      notes: string;
    }
  | {
      kind: "ask";
      benchmarkId: string;
      benchmarkDir: string;
      question: string;
      evaluation?: AskEvaluationFacts;
      case?: AskCaseFacts;
    };

/** What a task sends: the message, the Skills it preselects, and those it cannot run without. */
export interface BuiltRequest {
  kind: WorkbenchTaskKind;
  prompt: string;
  /** Preselected (`[use_skills]`), each only when the Agent has it. */
  skills: string[];
  /** Of `skills`, the ones the task cannot do without: a missing one refuses the start. */
  required: string[];
}

/** The request for one task, in `language`, for Project `projectId` whose Benchmarks are in `benchmarksDir`. */
export function buildRequest(
  spec: TaskSpec,
  language: PromptLanguage,
  projectId: string,
  benchmarksDir: string,
): BuiltRequest {
  const t = promptsFor(language);
  switch (spec.kind) {
    case "create": {
      // The designer's own Skill, and the evaluator it delegates every trial evaluation to.
      const skills = [DESIGN_SKILL, EVALUATION_SKILL];
      return {
        kind: "create",
        prompt: composePrompt(spec.notes, t.aiCreateTail(spec.targetAgentId, benchmarksDir)),
        skills,
        required: skills,
      };
    }
    case "import": {
      const source = spec.source.trim();
      return {
        kind: "import",
        prompt: composePrompt(
          t.importPromptLead[classifyImportSource(source)](source),
          t.importPromptTail(projectId, benchmarksDir),
        ),
        // The request reads the Skill's import notes when the Agent has it and copes without.
        skills: [DESIGN_SKILL],
        required: [],
      };
    }
    case "evaluate":
      return {
        kind: "evaluate",
        prompt: composePrompt(
          spec.notes,
          t.evaluateTail({
            targetAgentId: spec.targetAgentId,
            benchmarkId: spec.benchmarkId,
            benchmarkDir: spec.benchmarkDir,
            runs: spec.runs,
            provider: spec.provider,
            modelId: spec.modelId,
          }),
        ),
        skills: [EVALUATION_SKILL],
        required: [EVALUATION_SKILL],
      };
    case "optimize": {
      if (spec.method.plugin === DEFAULT_TOOLKIT_PLUGIN) {
        const skills = [OPTIMIZATION_SKILL, EVALUATION_SKILL];
        return {
          kind: "optimize",
          prompt: composePrompt(
            spec.notes,
            t.optimizeTail({
              targetAgentId: spec.targetAgentId,
              benchmarkId: spec.benchmarkId,
              benchmarkDir: spec.benchmarkDir,
              runs: spec.runs,
              provider: spec.provider,
              modelId: spec.modelId,
              roundLimit: spec.roundLimit,
              targetScore: spec.targetScore,
            }),
          ),
          skills,
          required: skills,
        };
      }
      const skills = [spec.method.skill];
      return {
        kind: "optimize",
        prompt: composePrompt(
          spec.notes,
          t.rsiOptimizeTail({
            skill: spec.method.skill,
            targetAgentId: spec.targetAgentId,
            benchmarkId: spec.benchmarkId,
            benchmarkDir: spec.benchmarkDir,
            testRepetitions: spec.testRepetitions,
            provider: spec.provider,
            modelId: spec.modelId,
          }),
        ),
        skills,
        required: skills,
      };
    }
    case "ask": {
      const tail =
        spec.evaluation !== undefined
          ? t.askEvaluationTail({
              benchmarkId: spec.benchmarkId,
              benchmarkDir: spec.benchmarkDir,
              ...spec.evaluation,
            })
          : t.askCaseTail({
              benchmarkId: spec.benchmarkId,
              benchmarkDir: spec.benchmarkDir,
              caseId: spec.case!.caseId,
              latest: spec.case!.latest,
            });
      // A question names no Skill: it reads the files and explains.
      return { kind: "ask", prompt: composePrompt(spec.question, tail), skills: [], required: [] };
    }
  }
}
