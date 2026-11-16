// Public interface of the daily module (AD-2). Other modules import only from here.
export { dailyRoutes } from './routes';
export {
  createDailyService,
  isAcceptableDailyDate,
  syncSchedule,
  type DailyService,
  type QuestionLookup,
  type ScheduleInput,
  type ScheduleSyncReport,
} from './service';
