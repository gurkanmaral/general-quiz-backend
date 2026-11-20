import { Hono, type Context } from 'hono';
import {
  DAILY_PROBLEM_CODES,
  DailyAnswerBodySchema,
  DailyHistoryQuerySchema,
  DailyMergeBodySchema,
  DailyParamsSchema,
  type DailyAnswerResponse,
  type DailyHistoryResponse,
  type DailyMergeResponse,
} from '@general-quiz/contracts';
import { STREAK_REPAIR_DAYS } from '@general-quiz/shared';
import { problem } from '../../http/problem';
import { isAcceptableDailyDate, isAnswerable, isTodaySomewhere, type DailyService } from './service';

/** The signed-in player for a request, or a thrown 401 problem (from the accounts module, AD-12). */
export type RequireUser = (c: Context) => Promise<{ id: string }>;

function invalidDate(c: Context) {
  return problem(c, {
    status: 400,
    code: DAILY_PROBLEM_CODES.invalidDate,
    title: 'Invalid Daily Date',
    detail: 'dailyDate must be a YYYY-MM-DD date no later than today somewhere on Earth (UTC+14).',
  });
}

function invalidToday(c: Context, field: string) {
  return problem(c, {
    status: 400,
    code: DAILY_PROBLEM_CODES.invalidPlayedOn,
    title: 'Invalid local date',
    detail: `${field} must be your local date today as YYYY-MM-DD.`,
  });
}

function notScheduled(c: Context, dailyDate: string) {
  return problem(c, {
    status: 404,
    code: DAILY_PROBLEM_CODES.notScheduled,
    title: 'No Daily scheduled',
    detail: `No published Question is scheduled for ${dailyDate}.`,
  });
}

/** Daily routes, mounted at `/api/v1/daily`. Reads are public; answers and history need a session. */
export function dailyRoutes(service: DailyService, now: () => Date, requireUser: RequireUser) {
  return (
    new Hono()
      // Registered before `/:dailyDate` so "history" is not read as a date.
      .get('/history', async (c) => {
        const user = await requireUser(c);
        const query = DailyHistoryQuerySchema.safeParse(c.req.query());
        if (!query.success || !isTodaySomewhere(query.data.today, now())) return invalidToday(c, 'today');
        const history = await service.getHistory(user.id, query.data.today);
        return c.json(history satisfies DailyHistoryResponse);
      })
      .post('/merge', async (c) => {
        const user = await requireUser(c);
        const body = DailyMergeBodySchema.safeParse(await c.req.json().catch(() => undefined));
        if (!body.success) {
          return problem(c, {
            status: 400,
            code: DAILY_PROBLEM_CODES.invalidMerge,
            title: 'Invalid history',
            detail: 'Send { today, plays: [...] } with at most 2000 plays.',
          });
        }
        if (!isTodaySomewhere(body.data.today, now())) return invalidToday(c, 'today');
        const result = await service.merge(user.id, body.data.today, body.data.plays, now());
        return c.json(result satisfies DailyMergeResponse);
      })
      .get('/:dailyDate', async (c) => {
        const params = DailyParamsSchema.safeParse(c.req.param());
        if (!params.success || !isAcceptableDailyDate(params.data.dailyDate, now())) return invalidDate(c);
        const daily = await service.getDaily(params.data.dailyDate);
        if (!daily) return notScheduled(c, params.data.dailyDate);
        return c.json(daily);
      })
      .post('/:dailyDate/answer', async (c) => {
        const user = await requireUser(c);
        const at = now();
        const params = DailyParamsSchema.safeParse(c.req.param());
        if (!params.success || !isAcceptableDailyDate(params.data.dailyDate, at)) return invalidDate(c);
        const body = DailyAnswerBodySchema.safeParse(await c.req.json().catch(() => undefined));
        if (!body.success) {
          return problem(c, {
            status: 400,
            code: DAILY_PROBLEM_CODES.invalidAnswer,
            title: 'Invalid answer',
            detail: 'Send { selectedIndex: 0-3, playedOn: "YYYY-MM-DD" }.',
          });
        }
        if (!isTodaySomewhere(body.data.playedOn, at)) return invalidToday(c, 'playedOn');
        const { dailyDate } = params.data;
        if (!isAnswerable(dailyDate, body.data.playedOn)) {
          return problem(c, {
            status: 422,
            code: DAILY_PROBLEM_CODES.answerWindowClosed,
            title: 'Too late to answer',
            detail: `A Daily can be answered on its own date or up to ${STREAK_REPAIR_DAYS} days later.`,
          });
        }
        const result = await service.answer(user.id, dailyDate, body.data, at);
        if (!result.ok) {
          return result.reason === 'notScheduled'
            ? notScheduled(c, dailyDate)
            : problem(c, {
                status: 409,
                code: DAILY_PROBLEM_CODES.alreadyAnswered,
                title: 'Already answered',
                detail: `You already answered the Daily for ${dailyDate}; the first answer counts.`,
              });
        }
        const response: DailyAnswerResponse = { play: result.play, correctIndex: result.correctIndex, streak: result.streak };
        return c.json(response);
      })
  );
}
