import { Hono } from 'hono';
import { DAILY_PROBLEM_CODES, DailyParamsSchema } from '@general-quiz/contracts';
import { problem } from '../../http/problem';
import { isAcceptableDailyDate, type DailyService } from './service';

/** Public Daily routes, mounted at `/api/v1/daily`. */
export function dailyRoutes(service: DailyService, now: () => Date) {
  return new Hono().get('/:dailyDate', async (c) => {
    const params = DailyParamsSchema.safeParse(c.req.param());
    if (!params.success || !isAcceptableDailyDate(params.data.dailyDate, now())) {
      return problem(c, {
        status: 400,
        code: DAILY_PROBLEM_CODES.invalidDate,
        title: 'Invalid Daily Date',
        detail: 'dailyDate must be a YYYY-MM-DD date that is today somewhere on Earth.',
      });
    }
    const daily = await service.getDaily(params.data.dailyDate);
    if (!daily) {
      return problem(c, {
        status: 404,
        code: DAILY_PROBLEM_CODES.notScheduled,
        title: 'No Daily scheduled',
        detail: `No published Question is scheduled for ${params.data.dailyDate}.`,
      });
    }
    return c.json(daily);
  });
}
