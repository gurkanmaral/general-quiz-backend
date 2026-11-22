import { Hono, type Context } from 'hono';
import { and, asc, eq, or } from 'drizzle-orm';
import { CONTENT_PROBLEM_CODES, ReportBodySchema, type ReportBody, type ReportResponse } from '../../contracts';
import type { DbExecutor } from '../../db/client';
import { uuidv7 } from '../../db/ids';
import { problem } from '../../http/problem';
import type { RateLimit } from '../../http/rateLimit';
import { report } from './schema';

/** Supplied by the app (from `quizzes`) so reports only name Questions that exist. */
export type QuestionExists = (slug: string) => Promise<boolean>;

export async function createReport(db: DbExecutor, userId: string, body: ReportBody, now: Date): Promise<string> {
  const id = uuidv7(now.getTime());
  await db.insert(report).values({ id, userId, questionSlug: body.questionSlug, source: body.source, note: body.note || null, createdAt: now });
  return id;
}

export type OpenReport = { id: string; source: string; note: string | null; createdAt: Date };
export type ReportGroup = { questionSlug: string; reports: OpenReport[] };

/** Open reports grouped by Question, most-reported first (FR-38, `kno reports`). */
export async function listOpenReports(db: DbExecutor): Promise<ReportGroup[]> {
  const rows = await db.select().from(report).where(eq(report.status, 'open')).orderBy(asc(report.createdAt));
  const groups = new Map<string, OpenReport[]>();
  for (const row of rows) {
    const list = groups.get(row.questionSlug) ?? [];
    list.push({ id: row.id, source: row.source, note: row.note, createdAt: row.createdAt });
    groups.set(row.questionSlug, list);
  }
  return [...groups]
    .map(([questionSlug, reports]) => ({ questionSlug, reports }))
    .sort((a, b) => b.reports.length - a.reports.length || a.questionSlug.localeCompare(b.questionSlug));
}

/** Closes one open report by id, or every open report of a Question by its slug; returns how many. */
export async function resolveReports(db: DbExecutor, idOrSlug: string, now: Date): Promise<number> {
  const rows = await db
    .update(report)
    .set({ status: 'resolved', resolvedAt: now })
    .where(and(eq(report.status, 'open'), or(eq(report.id, idOrSlug), eq(report.questionSlug, idOrSlug))))
    .returning({ id: report.id });
  return rows.length;
}

export type ReportRouteDeps = {
  db: DbExecutor;
  now: () => Date;
  requireUser: (c: Context) => Promise<{ id: string }>;
  questionExists: QuestionExists;
  rateLimit: RateLimit;
};

/** `/api/v1/reports`: report a wrong Question (Story 6.1); signed-in and rate-limited. */
export function reportRoutes({ db, now, requireUser, questionExists, rateLimit }: ReportRouteDeps) {
  return new Hono().post('/', async (c) => {
    const user = await requireUser(c);
    const body = ReportBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return problem(c, {
        status: 400,
        code: CONTENT_PROBLEM_CODES.invalidReport,
        title: 'Invalid report',
        detail: 'Send { "questionSlug", "source": "daily" | "solo" | "lobby", "note"? } with a note of at most 500 characters.',
      });
    }
    if (!(await questionExists(body.data.questionSlug))) {
      return problem(c, { status: 404, code: CONTENT_PROBLEM_CODES.questionNotFound, title: 'Question not found' });
    }
    rateLimit(c, user.id, 'report');
    const id = await createReport(db, user.id, body.data, now());
    return c.json({ id } satisfies ReportResponse, 201);
  });
}
