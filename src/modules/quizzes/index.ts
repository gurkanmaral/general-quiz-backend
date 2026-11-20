// Public interface of the quizzes module (AD-2). Other modules import only from here.
export { quizzesRoutes, type QuizzesRouteDeps } from './routes';
export {
  getPublishedQuestion,
  listPublishedQuizzes,
  publishedQuestionSlugs,
  syncPublishedQuizzes,
  type PublishedQuestion,
  type PublishedQuiz,
  type QuizzesSyncReport,
} from './service';
