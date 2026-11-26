/**
 * Request validation, one basic shape per helper, each refusing with a 400 (the host's
 * library/http validate.ts, which a workbench cannot import).
 */
import { isValidId } from "./format/ids.js";
import { WorkbenchError, badRequest } from "./errors.js";

/**
 * A path segment that must be an id: alphanumeric, `_` and `-`. Anything else is a 404 before
 * any path is built from it, so an encoded `/` or `..` can never reach the filesystem.
 */
export function requireValidId(segment: string | undefined): string {
  if (segment === undefined || segment === "" || !isValidId(segment)) {
    throw new WorkbenchError(
      404,
      "not_found",
      "Resource does not exist or you do not have access.",
    );
  }
  return segment;
}

/** The JSON request body as an object; anything else is a 400. */
export function objectBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export interface StringRule {
  minLen?: number;
  maxLen?: number;
  /** The field's name in messages (defaults to its key). */
  label?: string;
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  rule: StringRule = {},
): string {
  const v = obj[key];
  const label = rule.label ?? key;
  if (typeof v !== "string") throw badRequest(`${label} must be a string.`);
  if (rule.minLen !== undefined && v.length < rule.minLen) {
    throw badRequest(`${label} must be at least ${rule.minLen} characters.`);
  }
  if (rule.maxLen !== undefined && v.length > rule.maxLen) {
    throw badRequest(`${label} must be at most ${rule.maxLen} characters.`);
  }
  return v;
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  rule: StringRule = {},
): string | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return requireString(obj, key, rule);
}

/** A required Markdown body: present, within the cap, and not blank. */
export function requireText(
  obj: Record<string, unknown>,
  key: string,
  maxLen: number,
  label = key,
): string {
  const v = requireString(obj, key, { maxLen, label });
  if (v.trim() === "") throw badRequest(`${label} must not be blank.`);
  return v;
}

/** An optional integer within [min, max]. */
export function optionalInteger(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  label = key,
): number | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(`${label} must be an integer between ${min} and ${max}.`);
  }
  return v;
}

/** An http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
