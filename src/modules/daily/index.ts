// Public interface of the daily module (AD-2). Other modules import only from here.
export { dailyRoutes, type RequireUser } from './routes';
export {
  createDailyService,
  isAcceptableDailyDate,
  isAnswerable,
  isTodaySomewhere,
  syncSchedule,
  type DailyService,
  type QuestionLookup,
  type ScheduleInput,
  type ScheduleSyncReport,
} from './service';
