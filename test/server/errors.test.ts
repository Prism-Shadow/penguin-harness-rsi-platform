/**
 * What a refusal answers (the route group's error handler).
 *
 * - An HttpError of any copy — this plugin's own, or the host's, known by its brand — answers its
 *   status, code, message and details.
 * - Anything else, an error that merely carries a status and a code included, is 500 `internal`
 *   and says nothing more, as the host answers it.
 */
import { describe, expect, it } from "vitest";
import { WorkbenchError, errorFields } from "../../src/server/errors.js";

describe("refusals", () => {
  it("passes a branded HttpError through and answers a look-alike 500", () => {
    expect(
      errorFields(new WorkbenchError(409, "skill_missing", "Missing.", undefined, { skill: "a" })),
    ).toEqual({ status: 409, code: "skill_missing", message: "Missing.", details: { skill: "a" } });
    const hosts = Object.assign(Object.create({ [Symbol.for("penguin.http-error")]: true }), {
      status: 404,
      code: "agent_not_found",
      message: "Agent does not exist.",
    }) as unknown;
    expect(errorFields(hosts)).toEqual({
      status: 404,
      code: "agent_not_found",
      message: "Agent does not exist.",
    });
    const lookAlike = Object.assign(new Error("ENOENT /srv/secret"), { status: 404, code: "nope" });
    expect(errorFields(lookAlike)).toEqual({
      status: 500,
      code: "internal",
      message: "Internal server error.",
    });
  });
});
