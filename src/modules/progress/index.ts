// Public interface of the progress module (AD-2). Other modules import only from here.
export {
  SOLO_WIN_SHARE,
  createProgress,
  evaluateUnlocks,
  deleteProgressUserData,
  isWon,
  toQuizRecord,
  type Progress,
  type RecordedGame,
  type RecordedGameResult,
} from './service';
export { describeUnlockRule, isRuleMet, type RuleContext } from './unlocks';
