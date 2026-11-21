import type { SendFriendRequestBody } from '@general-quiz/contracts';
import type { Db, DbExecutor } from '../../db/client';
import { createFriends, deleteFriendsUserData, type PlayerDirectory, type SendRequestResult } from './friends';
import { createNotifications, deleteNotificationsUserData } from './notifications';
import { createNudges, deleteNudgesUserData } from './nudges';

export type SocialDeps = {
  directory: PlayerDirectory;
  now?: () => Date;
};

/** The social module: Friends (4.1), Notifications (4.2), Nudges (4.4). */
export function createSocial(db: Db, deps: SocialDeps) {
  const now = deps.now ?? (() => new Date());
  const notifications = createNotifications(db, deps.directory, now);
  const nudges = createNudges(db, notifications, now);
  const friends = createFriends(db, deps.directory, now, nudges);
  return {
    friends,
    notifications,
    nudges,
    friendsList: (userId: string, today: string) => friends.list(userId, today),
    /** Sends a Friend Request; a new request notifies the recipient (FR-26). */
    async sendFriendRequest(fromId: string, target: SendFriendRequestBody): Promise<SendRequestResult> {
      const result = await friends.sendRequest(fromId, target);
      if (result.ok && result.status === 'requested' && result.created) await notifications.notify(result.player.id, 'friendRequest', fromId, {});
      return result;
    },
    /** A Lobby Invite to a Friend (FR-29); false when they are not Friends. */
    async inviteToLobby(fromId: string, toId: string, lobby: { code: string; quizTitle: { en: string; tr?: string } }): Promise<boolean> {
      if (!(await friends.areFriends(fromId, toId))) return false;
      await notifications.notify(toId, 'lobbyInvite', fromId, { code: lobby.code, quizTitle: lobby.quizTitle });
      return true;
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
  await deleteNudgesUserData(db, userId);
  await deleteFriendsUserData(db, userId);
}
