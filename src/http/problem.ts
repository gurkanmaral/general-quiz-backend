import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Problem } from '@general-quiz/contracts';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export type ProblemInput = {
  status: ContentfulStatusCode;
  /** Stable, machine-readable code such as `daily.invalidDate`. */
  code: string;
  title: string;
  detail?: string;
};

/** RFC 9457 problem details; `type` is derived from the stable `code`. */
export function problemBody(input: ProblemInput, instance?: string): Problem {
  return {
    type: `urn:kno:problem:${input.code}`,
    title: input.title,
    status: input.status,
    code: input.code,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(instance ? { instance } : {}),
  };
}

export function problem(c: Context, input: ProblemInput): Response {
  return c.body(JSON.stringify(problemBody(input, c.req.path)), input.status, { 'Content-Type': PROBLEM_CONTENT_TYPE });
}
