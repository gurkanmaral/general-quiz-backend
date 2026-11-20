// Public interface of the quizzes module (AD-2). Other modules import only from here.
export {
  getPublishedQuestion,
  publishedQuestionSlugs,
  syncPublishedQuizzes,
  type PublishedQuestion,
  type PublishedQuiz,
  type QuizzesSyncReport,
} from './service';
