// Every module's tables, for the Drizzle client and drizzle-kit. Modules still own their own tables (AD-2).
export { knoQuizzes, contentStatus, quiz, question } from '../modules/quizzes/schema';
export { knoDaily, rotation, scheduleEntry } from '../modules/daily/schema';
