import type { SendFriendRequestBody } from '@general-quiz/contracts';
import type { Db, DbExecutor } from '../../db/client';
import { createFriends, deleteFriendsUserData, type PlayerDirectory, type SendRequestResult } from './friends';
import { createNotifications, deleteNotificationsUserData } from './notifications';

export type SocialDeps = {
  directory: PlayerDirectory;
  now?: () => Date;
};

/** The social module: Friends (Story 4.1) and Notifications (Story 4.2). */
export function createSocial(db: Db, deps: SocialDeps) {
  const now = deps.now ?? (() => new Date());
  const friends = createFriends(db, deps.directory, now);
  const notifications = createNotifications(db, deps.directory, now);
  return {
    friends,
    notifications,
    friendsList: (userId: string) => friends.list(userId),
    /** Sends a Friend Request; a new request notifies the recipient (FR-26). */
    async sendFriendRequest(fromId: string, target: SendFriendRequestBody): Promise<SendRequestResult> {
      const result = await friends.sendRequest(fromId, target);
      if (result.ok && result.status === 'requested' && result.created) await notifications.notify(result.player.id, 'friendRequest', fromId, {});
      return result;
    },
    acceptFriendRequest: (userId: string, requestId: string) => friends.accept(userId, requestId),
    /** Profile visibility (FR-20): Friends may see each other's Profiles. */
    areFriends: (userId: string, otherId: string) => friends.areFriends(userId, otherId),
  };
}
export type Social = ReturnType<typeof createSocial>;

/** Account deletion (FR-4): every social row of the player. */
export async function deleteSocialUserData(db: DbExecutor, userId: string): Promise<void> {
  await deleteNotificationsUserData(db, userId);
  await deleteFriendsUserData(db, userId);
}
