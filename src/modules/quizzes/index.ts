// Public interface of the quizzes module (AD-2). Other modules import only from here.
export { quizzesRoutes, soloGameRoutes, type QuizzesRouteDeps } from './routes';
export {
  createSoloGames,
  deleteQuizzesUserData,
  pickQuestions,
  soloPlayerIds,
  type EndedSoloGame,
  type GameEndedHook,
  type Random,
  type SoloGames,
  type SoloGamesDeps,
} from './games';
export {
  getPublishedQuestion,
  listPublishedQuizzes,
  publishedQuestionIndex,
  quizAwards,
  awardDefinitions,
  quizTitles,
  type AwardDefinition,
  type PublishedAward,
  publishedQuestionSlugs,
  syncPublishedQuizzes,
  type PublishedQuestion,
  type PublishedQuiz,
  type QuizzesSyncReport,
} from './service';
