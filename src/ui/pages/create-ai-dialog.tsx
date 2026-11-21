/**
 * Create with AI: the Test Agent the cases are written for, what to test in the person's words (or an
 * example), the approval mode, and the full prompt folded underneath. Start sends it as a `create`
 * task to the Project's default Agent, whose benchmark-design Skill writes and calibrates the
 * Benchmark in a new conversation. Mounted only while open, so every opening starts blank.
 */
import { useState } from "react";
import { Modal, Select, Textarea } from "@prismshadow/penguin-ui";
import type { ApprovalMode, CreateTaskRequest } from "../../api";
import { useStrings, useWorkbench } from "../context";
import {
  ApprovalModeSelect,
  ByAgentLine,
  FormExamples,
  PromptPreview,
  StartFooter,
  useStartTask,
} from "./start-task";

export function CreateWithAiDialog({
  initialTarget,
  onClose,
}: {
  /** The Test Agent preselected: the one the list is filtered by, else the default Agent. */
  initialTarget: string;
  onClose: () => void;
}) {
  const s = useStrings();
  const wb = useWorkbench();
  const [target, setTarget] = useState(initialTarget);
  const [notes, setNotes] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("allow-all");
  const task = useStartTask(onClose);
  const agentId = wb.defaultAgentId;
  const examples = Object.entries(s.benchmark.aiCreateExamples).map(([key, ex]) => ({
    key,
    ...ex,
  }));

  const body: CreateTaskRequest | null =
    agentId === null || target === ""
      ? null
      : {
          kind: "create",
          agentId,
          targetAgentId: target,
          notes: notes.trim(),
          approvalMode,
          language: wb.locale,
        };
  const ready = body !== null && notes.trim() !== "" && !task.busy;

  return (
    <Modal
      open
      title={s.benchmark.aiCreateTitle}
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
        <p className="text-sm text-fg-muted">{s.benchmark.aiCreateDescription}</p>
        <Select
          size="sm"
          label={s.benchmark.targetAgent}
          hint={s.benchmark.targetAgentHint}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {wb.agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {wb.agentName(a.agentId)}
            </option>
          ))}
        </Select>
        <ByAgentLine agentId={agentId} />
        <Textarea
          rows={6}
          size="sm"
          value={notes}
          placeholder={s.form.placeholder}
          aria-label={s.form.promptLabel}
          className="max-h-[40vh]"
          onChange={(e) => setNotes(e.target.value)}
        />
        <FormExamples examples={examples} value={notes} onChange={setNotes} />
        <ApprovalModeSelect value={approvalMode} onChange={setApprovalMode} />
        <PromptPreview body={body} />
        {task.feedback}
      </div>
    </Modal>
  );
}
