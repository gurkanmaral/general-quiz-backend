// Public interface of the social module (AD-2). Other modules import only from here.
export { createSocial, deleteSocialUserData, type Social, type SocialDeps } from './service';
export { friendsRoutes, linkRoutes, type SocialRouteDeps } from './routes';
export type { PlayerDirectory } from './friends';
