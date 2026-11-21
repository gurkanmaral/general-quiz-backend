import type { SendFriendRequestBody } from '@general-quiz/contracts';
import type { Db, DbExecutor } from '../../db/client';
import { createFriends, deleteFriendsUserData, type PlayerDirectory } from './friends';

export type SocialDeps = {
  directory: PlayerDirectory;
  now?: () => Date;
};

/** The social module: Friends (Story 4.1). */
export function createSocial(db: Db, deps: SocialDeps) {
  const now = deps.now ?? (() => new Date());
  const friends = createFriends(db, deps.directory, now);
  return {
    friends,
    friendsList: (userId: string) => friends.list(userId),
    sendFriendRequest: (fromId: string, target: SendFriendRequestBody) => friends.sendRequest(fromId, target),
    acceptFriendRequest: (userId: string, requestId: string) => friends.accept(userId, requestId),
    /** Profile visibility (FR-20): Friends may see each other's Profiles. */
    areFriends: (userId: string, otherId: string) => friends.areFriends(userId, otherId),
  };
}
export type Social = ReturnType<typeof createSocial>;

/** Account deletion (FR-4): every social row of the player. */
export async function deleteSocialUserData(db: DbExecutor, userId: string): Promise<void> {
  await deleteFriendsUserData(db, userId);
}
