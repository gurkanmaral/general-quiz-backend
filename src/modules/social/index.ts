// Public interface of the social module (AD-2). Other modules import only from here.
export { createSocial, deleteSocialUserData, type Social, type SocialDeps } from './service';
export { friendsRoutes, linkRoutes, notificationRoutes, socialSettingsRoutes, type SocialRouteDeps } from './routes';
export { NotificationBus, type NotificationData } from './notifications';
export type { PlayerDirectory } from './friends';
