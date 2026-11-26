/**
 * A start form's request as the prompt route reads it (`GET …/prompt?kind=…`, or the same fields
 * as a JSON body to `POST …/prompt`), checked and turned into the spec a prompt is built from
 * (prompts.ts). The page then starts the task itself, as the person who pressed Start (PRFC-0036,
 * the Agent tasks the page starts): the Agent, the approval mode and the model are the page's to
 * send, not the prompt's, so they are not read here.
 *
 * Anything out of shape is a 400 naming the field, as the start route of the server module
 * answered. A query carries strings only: the integer fields are read as integers, and the nested
 * ones (`testedModel`, `evaluation`, `case`) as JSON.
 */
import type { AskCaseFacts, AskEvaluationFacts, ModelRef, WorkbenchTaskKind } from "./api.js";
import { isValidId } from "./format/ids.js";
import { badRequest } from "./errors.js";
import { DEFAULT_TOOLKIT_PLUGIN } from "./methods.js";
import type { PromptLanguage, TaskSpec } from "./prompts.js";
import { optionalInteger, optionalString, requireString } from "./validate.js";

export const TASK_KINDS: readonly WorkbenchTaskKind[] = [
  "create",
  "import",
  "evaluate",
  "optimize",
  "ask",
];

/** A person's own text in a request: generous, but a form is not a corpus. */
const MAX_NOTES = 20_000;
const MAX_SHORT = 200;
const MAX_SOURCE = 4096;
const MAX_FACT_CASES = 200;
const MAX_FACT_RUNS = 1000;

/** The integer fields, read from a query's text. */
const INTEGER_FIELDS = ["runs", "roundLimit", "targetScore", "testRepetitions"] as const;
/** The nested fields, which a query carries as JSON. */
const JSON_FIELDS = ["testedModel", "evaluation", "case"] as const;

/** A request as the body reads, before the handler looked anything up. */
export type ParsedPrompt = { language: PromptLanguage } & (
  | { kind: "create"; targetAgentId: string; notes: string }
  | { kind: "import"; source: string }
  | {
      kind: "evaluate";
      benchmarkId: string;
      targetAgentId: string;
      runs: number;
      testedModel: ModelRef;
      notes: string;
    }
  | {
      kind: "optimize";
      benchmarkId: string;
      targetAgentId: string;
      method: string;
      /** The paper toolkit's Skill; null for the default loop, which names its own. */
      skill: string | null;
      testedModel: ModelRef;
      runs?: number;
      roundLimit?: number;
      targetScore?: number;
      testRepetitions?: number;
      notes: string;
    }
  | {
      kind: "ask";
      benchmarkId: string;
      question: string;
      evaluation?: AskEvaluationFacts;
      case?: AskCaseFacts;
    }
);

/**
 * A query's fields as a body: the integer fields as numbers when they are written as integers
 * (anything else stays text, which the check below refuses by name) and the nested ones parsed
 * as JSON (400 when they are not).
 */
export function promptQueryBody(query: Readonly<Record<string, string>>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...query };
  for (const key of INTEGER_FIELDS) {
    const raw = query[key];
    if (raw !== undefined && /^-?\d+$/.test(raw)) body[key] = Number(raw);
  }
  for (const key of JSON_FIELDS) {
    const raw = query[key];
    if (raw === undefined) continue;
    try {
      body[key] = JSON.parse(raw) as unknown;
    } catch {
      throw badRequest(`${key} must be JSON.`);
    }
  }
  return body;
}

function asObject(v: unknown, label: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw badRequest(`${label} must be an object.`);
  }
  return v as Record<string, unknown>;
}

function requireId(obj: Record<string, unknown>, key: string): string {
  const v = requireString(obj, key, { minLen: 1, maxLen: 100 });
  if (!isValidId(v)) throw badRequest(`${key} may only contain letters, digits, "_" and "-".`);
  return v;
}

function modelOf(raw: unknown, label: string): ModelRef {
  const m = asObject(raw, label);
  return {
    provider: requireString(m, "provider", {
      minLen: 1,
      maxLen: MAX_SHORT,
      label: `${label}.provider`,
    }),
    modelId: requireString(m, "modelId", {
      minLen: 1,
      maxLen: MAX_SHORT,
      label: `${label}.modelId`,
    }),
  };
}

function shortString(obj: Record<string, unknown>, key: string, label: string): string {
  return requireString(obj, key, { maxLen: MAX_NOTES, label });
}

function stringList(raw: unknown, label: string, max: number): string[] {
  if (!Array.isArray(raw)) throw badRequest(`${label} must be an array of strings.`);
  if (raw.length > max) throw badRequest(`${label} must hold at most ${max} entries.`);
  return raw.map((item, i) => {
    if (typeof item !== "string" || item.length > MAX_SHORT) {
      throw badRequest(`${label}[${i}] must be a string of at most ${MAX_SHORT} characters.`);
    }
    return item;
  });
}

function evaluationFacts(raw: unknown): AskEvaluationFacts {
  const e = asObject(raw, "evaluation");
  const version = e.version;
  if (typeof version !== "number" && typeof version !== "string") {
    throw badRequest("evaluation.version must be a number or a string.");
  }
  if (!Array.isArray(e.cases) || e.cases.length > MAX_FACT_CASES) {
    throw badRequest(`evaluation.cases must be an array of at most ${MAX_FACT_CASES} cases.`);
  }
  return {
    time: shortString(e, "time", "evaluation.time"),
    label: shortString(e, "label", "evaluation.label"),
    version,
    provider: shortString(e, "provider", "evaluation.provider"),
    modelId: shortString(e, "modelId", "evaluation.modelId"),
    thinkingLevel: shortString(e, "thinkingLevel", "evaluation.thinkingLevel"),
    score: shortString(e, "score", "evaluation.score"),
    cost: shortString(e, "cost", "evaluation.cost"),
    duration: shortString(e, "duration", "evaluation.duration"),
    summaryTitle: shortString(e, "summaryTitle", "evaluation.summaryTitle"),
    summary: shortString(e, "summary", "evaluation.summary"),
    cases: e.cases.map((item: unknown, i: number) => {
      const c = asObject(item, `evaluation.cases[${i}]`);
      return {
        id: shortString(c, "id", `evaluation.cases[${i}].id`),
        score: shortString(c, "score", `evaluation.cases[${i}].score`),
        cost: shortString(c, "cost", `evaluation.cases[${i}].cost`),
        duration: shortString(c, "duration", `evaluation.cases[${i}].duration`),
        sessionIds: stringList(c.sessionIds, `evaluation.cases[${i}].sessionIds`, MAX_FACT_RUNS),
      };
    }),
  };
}

function caseFacts(raw: unknown): AskCaseFacts {
  const c = asObject(raw, "case");
  const caseId = requireString(c, "caseId", { minLen: 1, maxLen: 100, label: "case.caseId" });
  if (!/^CASE-[A-Za-z0-9_-]+$/.test(caseId)) throw badRequest("case.caseId must be a case id.");
  if (c.latest === null || c.latest === undefined) return { caseId, latest: null };
  const latest = asObject(c.latest, "case.latest");
  if (!Array.isArray(latest.runs) || latest.runs.length > MAX_FACT_RUNS) {
    throw badRequest(`case.latest.runs must be an array of at most ${MAX_FACT_RUNS} runs.`);
  }
  return {
    caseId,
    latest: {
      time: shortString(latest, "time", "case.latest.time"),
      score: shortString(latest, "score", "case.latest.score"),
      runs: latest.runs.map((item: unknown, i: number) => {
        const r = asObject(item, `case.latest.runs[${i}]`);
        return {
          score: shortString(r, "score", `case.latest.runs[${i}].score`),
          sessionId: shortString(r, "sessionId", `case.latest.runs[${i}].sessionId`),
        };
      }),
    },
  };
}

/** Reads a start form's prompt request; anything out of shape is a 400 naming the field. */
export function parsePromptRequest(body: Record<string, unknown>): ParsedPrompt {
  const kind = body.kind;
  if (typeof kind !== "string" || !(TASK_KINDS as readonly string[]).includes(kind)) {
    throw badRequest(`kind must be one of ${TASK_KINDS.join(", ")}.`);
  }
  const language = body.language ?? "en";
  if (language !== "en" && language !== "zh") throw badRequest('language must be "en" or "zh".');
  const notes = optionalString(body, "notes", { maxLen: MAX_NOTES }) ?? "";
  switch (kind as WorkbenchTaskKind) {
    case "create":
      return { language, kind: "create", targetAgentId: requireId(body, "targetAgentId"), notes };
    case "import": {
      const source = requireString(body, "source", { maxLen: MAX_SOURCE });
      if (source.trim() === "") throw badRequest("source must not be blank.");
      return { language, kind: "import", source };
    }
    case "evaluate": {
      const runs = optionalInteger(body, "runs", 1, 1000);
      if (runs === undefined) throw badRequest("runs must be an integer between 1 and 1000.");
      return {
        language,
        kind: "evaluate",
        benchmarkId: requireId(body, "benchmarkId"),
        targetAgentId: requireId(body, "targetAgentId"),
        runs,
        testedModel: modelOf(body.testedModel, "testedModel"),
        notes,
      };
    }
    case "optimize": {
      const method = requireString(body, "method", { minLen: 1, maxLen: MAX_SHORT });
      const isDefault = method === DEFAULT_TOOLKIT_PLUGIN;
      const runs = optionalInteger(body, "runs", 1, 1000);
      const roundLimit = optionalInteger(body, "roundLimit", 1, 100);
      const targetScore = optionalInteger(body, "targetScore", 1, 100);
      const testRepetitions = optionalInteger(body, "testRepetitions", 1, 100);
      if (isDefault && (roundLimit === undefined || targetScore === undefined)) {
        throw badRequest("The default loop takes roundLimit and targetScore.");
      }
      return {
        language,
        kind: "optimize",
        benchmarkId: requireId(body, "benchmarkId"),
        targetAgentId: requireId(body, "targetAgentId"),
        method,
        // A paper's toolkit runs through the Skill the page read from its library entry.
        skill: isDefault ? null : requireId(body, "skill"),
        testedModel: modelOf(body.testedModel, "testedModel"),
        ...(runs !== undefined ? { runs } : {}),
        ...(roundLimit !== undefined ? { roundLimit } : {}),
        ...(targetScore !== undefined ? { targetScore } : {}),
        ...(testRepetitions !== undefined ? { testRepetitions } : {}),
        notes,
      };
    }
    case "ask": {
      const question = requireString(body, "question", { maxLen: MAX_NOTES });
      const hasEvaluation = body.evaluation !== undefined && body.evaluation !== null;
      const hasCase = body.case !== undefined && body.case !== null;
      if (hasEvaluation === hasCase) {
        throw badRequest("An ask names exactly one of evaluation and case.");
      }
      return {
        language,
        kind: "ask",
        benchmarkId: requireId(body, "benchmarkId"),
        question,
        ...(hasEvaluation ? { evaluation: evaluationFacts(body.evaluation) } : {}),
        ...(hasCase ? { case: caseFacts(body.case) } : {}),
      };
    }
  }
}

/** The Benchmark a request is about, when it names one. */
export function benchmarkOf(request: ParsedPrompt): string | undefined {
  return "benchmarkId" in request ? request.benchmarkId : undefined;
}

/** The spec the prompt is built from: the request with the Benchmark's folder and run count. */
export function specOf(
  request: ParsedPrompt,
  benchmarkDir: string | undefined,
  benchmarkRuns: number,
): TaskSpec {
  const dir = benchmarkDir ?? "";
  switch (request.kind) {
    case "create":
      return { kind: "create", targetAgentId: request.targetAgentId, notes: request.notes };
    case "import":
      return { kind: "import", source: request.source };
    case "evaluate":
      return {
        kind: "evaluate",
        benchmarkId: request.benchmarkId,
        benchmarkDir: dir,
        targetAgentId: request.targetAgentId,
        runs: request.runs,
        provider: request.testedModel.provider,
        modelId: request.testedModel.modelId,
        notes: request.notes,
      };
    case "optimize":
      return {
        kind: "optimize",
        method: { plugin: request.method, skill: request.skill ?? "" },
        benchmarkId: request.benchmarkId,
        benchmarkDir: dir,
        targetAgentId: request.targetAgentId,
        provider: request.testedModel.provider,
        modelId: request.testedModel.modelId,
        runs: request.runs ?? benchmarkRuns,
        roundLimit: request.roundLimit ?? 0,
        targetScore: request.targetScore ?? 0,
        testRepetitions: request.testRepetitions ?? 3,
        notes: request.notes,
      };
    case "ask":
      return {
        kind: "ask",
        benchmarkId: request.benchmarkId,
        benchmarkDir: dir,
        question: request.question,
        ...(request.evaluation !== undefined ? { evaluation: request.evaluation } : {}),
        ...(request.case !== undefined ? { case: request.case } : {}),
      };
  }
}
