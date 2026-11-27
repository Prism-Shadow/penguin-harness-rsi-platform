/**
 * A refusal the handler answers with: an HTTP status, a stable code, an English message and, on
 * the errors that have them, the facts a client acts on (`details`). It is answered as
 * `{ error: { code, message, details? } }`, the host's own error shape, so the page reads the
 * handler's refusals and the host's alike.
 */
import type { WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

export type ErrorDetails = Readonly<Record<string, string>>;

export class WorkbenchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = "WorkbenchError";
  }
}

export function badRequest(message: string): WorkbenchError {
  return new WorkbenchError(400, "bad_request", message);
}

export function notFound(message: string): WorkbenchError {
  return new WorkbenchError(404, "not_found", message);
}

/** The response for anything thrown: a WorkbenchError as it says, anything else a bare 500. */
export function errorResponse(err: unknown, log: (line: string) => void): WorkbenchResponse {
  if (err instanceof WorkbenchError) {
    const { status, code, message, details } = err;
    return {
      status,
      body: { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    };
  }
  log(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  return { status: 500, body: { error: { code: "internal", message: "Internal server error." } } };
}
