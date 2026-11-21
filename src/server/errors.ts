/**
 * A refusal this plugin answers with: an HTTP status, a stable code, an English message and, on
 * the errors that have them, the facts a client acts on (`details`). The host turns it into
 * `{ error: { code, message, details? } }` because it carries the host's HttpError brand — a key in
 * the global symbol registry, which every copy of the host's class stamps and reads (the server's
 * http/errors.ts `isHttpError`) — so no copy of the host's class is needed here.
 */

const HTTP_ERROR_BRAND = Symbol.for("penguin.http-error");

export type ErrorDetails = Readonly<Record<string, string>>;

export class WorkbenchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    // The host's brand check reads the fields and the name of its own class.
    this.name = "HttpError";
  }
}
Object.defineProperty(WorkbenchError.prototype, HTTP_ERROR_BRAND, { value: true });

export function badRequest(message: string): WorkbenchError {
  return new WorkbenchError(400, "bad_request", message);
}

export function notFound(message: string): WorkbenchError {
  return new WorkbenchError(404, "not_found", message);
}

/**
 * The status, code, message and details of anything thrown: an HttpError of any copy (ours, the
 * host's) by its brand, as the host's own handler reads one; anything else — an error that merely
 * has those fields included — is a 500 that says nothing more.
 */
export function errorFields(err: unknown): {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetails;
} {
  const e = err as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    details?: unknown;
    [HTTP_ERROR_BRAND]?: unknown;
  };
  if (
    e !== null &&
    typeof e === "object" &&
    e[HTTP_ERROR_BRAND] === true &&
    typeof e.status === "number" &&
    e.status >= 400 &&
    e.status < 600 &&
    typeof e.code === "string" &&
    typeof e.message === "string"
  ) {
    const details =
      e.details !== null && typeof e.details === "object" ? (e.details as ErrorDetails) : undefined;
    return {
      status: e.status,
      code: e.code,
      message: e.message,
      ...(details !== undefined ? { details } : {}),
    };
  }
  return { status: 500, code: "internal", message: "Internal server error." };
}
