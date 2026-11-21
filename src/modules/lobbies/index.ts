// Public interface of the lobbies module (AD-2). Other modules import only from here.
export { LobbyActor, DISCONNECT_GRACE_MS, IDLE_CLOSE_MS, systemClock, type Clock, type LobbyEnv, type LobbyQuiz } from './actor';
export { createLobbyHub, type LobbyHub, type LobbyTransport, type HubDeps } from './hub';
export { lobbyRoutes, type LobbyRouteDeps } from './routes';
export { attachLobbySockets } from './sockets';
