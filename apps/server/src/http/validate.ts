import type { Context } from "hono";
import type { z } from "zod";
import { badRequest } from "../errors.ts";

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  return parseWith(schema, body);
}

export function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    // The client shows `message` as is, so it names the first problem rather than a bare "Validation failed".
    const first = issues[0];
    const message = first ? `${first.path ? `${first.path}: ` : ""}${first.message}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ""}` : "Validation failed";
    throw badRequest(message, issues);
  }
  return result.data;
}
