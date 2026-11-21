/**
 * Score-only data helpers and per-label series grouping for the Benchmark chart, the cards and
 * the Use dialog. Series share one time axis and use each evaluation's stored Score. A record's
 * label — the tested Agent, the model it ran on and the thinking level — is what makes two scores
 * comparable, so it is what a series is keyed by and what a score change is measured within. The
 * Agent State version is not part of it: successive versions of one agent on one runtime are the
 * trend the loop exists to show, so they stay on one line, and each point carries its version in
 * the chart's bubble and in the evaluation table's own column.
 */
import type { LinePoint } from "@prismshadow/penguin-ui";
import type { Locale } from "./frame-facts";

/** Minimal evaluation shape needed to read a Score. */
export interface MetricSourceLike {
  score: number;
}

/** Each evaluation's stored Score; a non-finite malformed value is null. */
export function scoreValues(evaluations: readonly MetricSourceLike[]): (number | null)[] {
  return evaluations.map((e) =>
    typeof e.score === "number" && Number.isFinite(e.score) ? e.score : null,
  );
}

export interface ScoreScale {
  min: number;
  max: number;
  ticks: number[];
}

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const SCORE_PADDING = 10;
const SCORE_TICK_STEPS = [1, 2, 2.5, 5, 10, 20];

/**
 * The chart's Score domain: the observed min and max padded by 10, clamped to the valid 0..100
 * interval, then rounded outward to friendly ticks.
 */
export function scoreScale(values: readonly (number | null)[]): ScoreScale {
  const present = values.filter(
    (value): value is number => value !== null && value >= SCORE_MIN && value <= SCORE_MAX,
  );
  if (present.length === 0) {
    return { min: SCORE_MIN, max: SCORE_MAX, ticks: [0, 20, 40, 60, 80, 100] };
  }
  const paddedMin = Math.max(SCORE_MIN, Math.min(...present) - SCORE_PADDING);
  const paddedMax = Math.min(SCORE_MAX, Math.max(...present) + SCORE_PADDING);
  const step = SCORE_TICK_STEPS.find((candidate) => (paddedMax - paddedMin) / candidate <= 5) ?? 20;
  const min = Math.max(SCORE_MIN, Math.floor(paddedMin / step) * step);
  const max = Math.min(SCORE_MAX, Math.ceil(paddedMax / step) * step);
  const ticks = Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, index) => min + index * step,
  );
  return { min, max, ticks };
}

/** Minimal evaluation shape a label is read from. */
export interface EvaluationLabelLike {
  /** The Agent under test; null or absent on records written before Benchmarks left the Agent. */
  agentId?: string | null;
  /** On the record and deliberately outside the key: a version is a point on a series. */
  version?: number | string;
  /** On the record and deliberately outside the key — see evaluationLabel. */
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

/** One evaluation's label: its series key, the text a legend prints, and whether it is untagged. */
export interface EvaluationLabel {
  /** Grouping key; "" for a record missing the tested Agent or the model. */
  key: string;
  /** Legend text, empty parts omitted; "" when the record is unlabeled. */
  text: string;
  unlabeled: boolean;
}

/**
 * The label of one evaluation: the tested Agent, the model and the thinking level. The Agent
 * State version is what a series is watched across, so it stays outside the key; so does the
 * provider, since a series has to be identifiable from its legend text. A record with no tested
 * Agent or no model is unlabeled, and all such records share one series.
 */
export function evaluationLabel(e: EvaluationLabelLike): EvaluationLabel {
  const agentId = e.agentId ?? "";
  const modelId = e.modelId ?? "";
  if (agentId === "" || modelId === "") return { key: "", text: "", unlabeled: true };
  const parts = [agentId, modelId, e.thinkingLevel ?? ""];
  return {
    key: parts.join("\u0000"),
    text: parts.filter((part) => part !== "").join(" · "),
    unlabeled: false,
  };
}

/** One chart series: the evaluations sharing one label. */
export interface EvaluationSeries {
  key: string;
  text: string;
  unlabeled: boolean;
  /** Positions on the time axis every series shares. */
  indices: number[];
}

/** Evaluations grouped by label, first appearance first; the unlabeled series trails. */
export function labelSeries(evaluations: readonly EvaluationLabelLike[]): EvaluationSeries[] {
  const map = new Map<string, EvaluationSeries>();
  evaluations.forEach((e, index) => {
    const label = evaluationLabel(e);
    let series = map.get(label.key);
    if (!series) {
      series = { key: label.key, text: label.text, unlabeled: label.unlabeled, indices: [] };
      map.set(label.key, series);
    }
    series.indices.push(index);
  });
  const all = [...map.values()];
  return [...all.filter((x) => !x.unlabeled), ...all.filter((x) => x.unlabeled)];
}

/**
 * The points one series' line is drawn through: its own evaluations in scoreboard order, each at
 * its own slot on the shared time axis, so the line runs over the slots other series hold.
 */
export function seriesPoints(
  evaluations: readonly MetricSourceLike[],
  series: EvaluationSeries,
): LinePoint[] {
  return series.indices.map((index) => ({ index, value: evaluations[index]!.score }));
}

/** Minimal evaluation shape for the list rows: the stored Score and when it was recorded. */
export interface TrendSourceLike extends MetricSourceLike {
  time: string;
}

/** Finite Scores in scoreboard order: a card's sparkline (a malformed value is skipped). */
export function sparklineSeries(evaluations: readonly MetricSourceLike[]): number[] {
  return scoreValues(evaluations).filter((v): v is number => v !== null);
}

export interface LatestScore {
  score: number;
  /** Change from the previous finite Score of the same label; null when that label has no earlier record. */
  delta: number | null;
  time: string;
}

/**
 * The newest finite Score, its time, and its change from the previous score of the same label;
 * a newest label seen for the first time reports no change rather than one against something else.
 */
export function latestWithDelta(
  evaluations: readonly (TrendSourceLike & EvaluationLabelLike)[],
): LatestScore | null {
  const scored = evaluations.filter((e) => typeof e.score === "number" && Number.isFinite(e.score));
  const last = scored[scored.length - 1];
  if (!last) return null;
  const key = evaluationLabel(last).key;
  let previous: (TrendSourceLike & EvaluationLabelLike) | undefined;
  for (let i = scored.length - 2; i >= 0; i -= 1) {
    if (evaluationLabel(scored[i]!).key === key) {
      previous = scored[i];
      break;
    }
  }
  return {
    score: last.score,
    delta: previous ? last.score - previous.score : null,
    time: last.time,
  };
}

/** The same, narrowed to one tested Agent: the baseline the Optimize tab works from. */
export function latestScoreOfAgent(
  evaluations: readonly (TrendSourceLike & EvaluationLabelLike)[],
  agentId: string,
): LatestScore | null {
  if (agentId === "") return null;
  return latestWithDelta(evaluations.filter((e) => (e.agentId ?? "") === agentId));
}

/** Ten points above the baseline as a whole number, capped at 100; 80 when nothing is scored yet. */
export function defaultTargetScore(baseline: number | null): number {
  if (baseline === null) return 80;
  return Math.min(100, Math.ceil(baseline) + 10);
}

/**
 * Whether a Benchmark survives the search box: a case-insensitive substring of its title (either
 * language), description or id, or of any tested Agent's id or name. An id evaluated by a
 * since-deleted Agent still matches on the id itself.
 */
export function matchesBenchmarkQuery(
  benchmark: {
    id: string;
    title: string;
    titleZh?: string;
    description?: string;
    descriptionZh?: string;
    agentIds?: readonly string[];
  },
  agents: readonly { agentId: string; name?: string }[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [
    benchmark.title,
    benchmark.titleZh ?? "",
    benchmark.description ?? "",
    benchmark.descriptionZh ?? "",
    benchmark.id,
  ];
  for (const agentId of benchmark.agentIds ?? []) {
    haystack.push(agentId);
    const name = agents.find((a) => a.agentId === agentId)?.name;
    if (name !== undefined) haystack.push(name);
  }
  return haystack.some((s) => s.toLowerCase().includes(q));
}

/** A Benchmark's title in the reader's language: `title_zh` for the Chinese interface when given. */
export function benchmarkTitle(
  benchmark: { title: string; titleZh?: string },
  locale: Locale,
): string {
  return locale === "zh" && benchmark.titleZh !== undefined && benchmark.titleZh !== ""
    ? benchmark.titleZh
    : benchmark.title;
}

/** A Benchmark's description in the reader's language: `description_zh` for the Chinese interface when given. */
export function benchmarkDescription(
  benchmark: { description?: string; descriptionZh?: string },
  locale: Locale,
): string | undefined {
  return locale === "zh" && benchmark.descriptionZh !== undefined
    ? benchmark.descriptionZh
    : benchmark.description;
}
