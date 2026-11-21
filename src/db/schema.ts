// Every module's tables, for the Drizzle client and drizzle-kit. Modules still own their own tables (AD-2).
export { knoQuizzes, contentStatus, quizKind, questionDifficulty, quiz, question, soloGameStatus, soloGame, soloAnswer, awardKind, award } from '../modules/quizzes/schema';
export { knoDaily, rotation, scheduleEntry, answer, fallbackAssignment } from '../modules/daily/schema';
export { knoAccounts, user, session, account, verification } from '../modules/accounts/schema';
export { knoProgress, quizRecord, correctQuestion, userAward, rarity, equippedTitle } from '../modules/progress/schema';
export { knoSocial, playerLink, friendRequest, friendship, notification, nudge, socialSettings } from '../modules/social/schema';
export { knoLobbies, lobbyGame, lobbyGamePlayer } from '../modules/lobbies/schema';
export { knoContent, reportSource, reportStatus, report } from '../modules/content/schema';
