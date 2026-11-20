// Public interface of the progress module (AD-2). Other modules import only from here.
export {
  SOLO_WIN_SHARE,
  createProgress,
  deleteProgressUserData,
  isWon,
  toQuizRecord,
  type Progress,
  type RecordedGame,
} from './service';
