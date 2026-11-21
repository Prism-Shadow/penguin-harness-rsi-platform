/**
 * Ask AI from a Benchmark's evaluation dialog or case dialog: a question (opening on the
 * dialog's default one, with examples), the approval mode, and the full prompt folded underneath.
 * The facts already on screen — the evaluation's numbers as the dialog prints them, or the case's
 * newest results — go with the question, so the answer is read out of the files rather than
 * guessed. Start sends an `ask` task to the Project's default Agent, which reads and changes nothing.
 */
import { useState } from "react";
import { Modal, Textarea } from "@prismshadow/penguin-ui";
import type { ApprovalMode, AskCaseFacts, AskEvaluationFacts, AskTaskRequest } from "../../api";
import { useStrings, useWorkbench } from "../context";
import {
  ApprovalModeSelect,
  ByAgentLine,
  FormExamples,
  PromptPreview,
  StartFooter,
  useStartTask,
  type FormExample,
} from "./start-task";

export type AskSubject =
  | { evaluation: AskEvaluationFacts; case?: undefined }
  | { case: AskCaseFacts; evaluation?: undefined };

export function AskDialog({
  benchmarkId,
  subject,
  onClose,
}: {
  benchmarkId: string;
  subject: AskSubject;
  onClose: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const table =
    subject.evaluation !== undefined
      ? s.benchmark.askEvaluationExamples
      : s.benchmark.askCaseExamples;
  const examples: FormExample[] = Object.entries(table).map(([key, ex]) => ({ key, ...ex }));
  const [question, setQuestion] = useState(table.explain.prompt);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("allow-all");
  const task = useStartTask(onClose);
  const agentId = wb.defaultAgentId;

  const body: AskTaskRequest | null =
    agentId === null
      ? null
      : {
          kind: "ask",
          agentId,
          benchmarkId,
          question: question.trim(),
          approvalMode,
          language: wb.locale,
          ...(subject.evaluation !== undefined
            ? { evaluation: subject.evaluation }
            : { case: subject.case }),
        };
  const ready = body !== null && question.trim() !== "" && !task.busy;

  return (
    <Modal
      open
      title={
        subject.evaluation !== undefined ? s.benchmark.askEvaluationTitle : s.benchmark.askCaseTitle
      }
      onClose={onClose}
      widthClass="sm:max-w-xl"
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
        <p className="text-sm text-fg-muted">
          {subject.evaluation !== undefined
            ? s.benchmark.askEvaluationDescription
            : s.benchmark.askCaseDescription}
        </p>
        <ByAgentLine agentId={agentId} />
        <Textarea
          rows={4}
          size="sm"
          value={question}
          placeholder={s.form.placeholder}
          aria-label={s.form.promptLabel}
          className="max-h-[40vh]"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <FormExamples examples={examples} value={question} onChange={setQuestion} />
        <ApprovalModeSelect value={approvalMode} onChange={setApprovalMode} />
        <PromptPreview body={body} />
        {task.feedback}
      </div>
    </Modal>
  );
}
