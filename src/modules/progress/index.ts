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
export { RARITY_INTERVAL_MS, computeRarity, rarityOf, startRarityJob, type RankedAccountSource, type RarityReport } from './rarity';
export { equipTitle, getEquippedTitle, getEquippedTitles, profileAwards } from './profile';
export { playerRoutes, profileRoutes, type ProfileRouteDeps } from './routes';
