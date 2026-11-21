/**
 * An Agent as the page draws it: its own picture when the Project's view names one (the host's
 * avatar route, keyed by the picture's revision), else — or once the picture fails to load — the
 * UI package's tinted tile. A row of them stands for the Agents a Benchmark has tested.
 */
import { useState } from "react";
import { AgentAvatar } from "@prismshadow/penguin-ui";
import { useWorkbench } from "../context";

/** The Agent tile's corner at `size` px: the default tile's `rx="5"` on its 24-unit box. */
const tileRadius = (size: number): number => (size * 5) / 24;

export function AgentPicture({
  agentId,
  machineId = null,
  size,
}: {
  agentId: string;
  machineId?: string | null;
  size: number;
}) {
  const wb = useWorkbench();
  const src = wb.agentPicture(agentId, machineId);
  /** The picture that failed to load: a new one is tried afresh. */
  const [failed, setFailed] = useState<string | null>(null);
  if (src !== undefined && src !== failed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailed(src)}
        className="shrink-0 object-cover"
        style={{ width: size, height: size, borderRadius: tileRadius(size) }}
      />
    );
  }
  return <AgentAvatar id={agentId} name={wb.agentName(agentId)} size={size} className="shrink-0" />;
}

/** Up to `max` Agents side by side, overlapping, and a "+n" for the rest. */
export function AgentPictureStack({
  agentIds,
  max,
  size,
}: {
  agentIds: readonly string[];
  max: number;
  size: number;
}) {
  const shown = agentIds.slice(0, max);
  const rest = agentIds.length - shown.length;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="flex -space-x-1" aria-hidden>
        {shown.map((agentId) => (
          <span
            key={agentId}
            className="flex shrink-0 ring-2 ring-canvas"
            style={{ borderRadius: tileRadius(size) }}
          >
            <AgentPicture agentId={agentId} size={size} />
          </span>
        ))}
      </span>
      {rest > 0 && <span className="text-xs tabular-nums text-fg-subtle">{`+${rest}`}</span>}
    </span>
  );
}
