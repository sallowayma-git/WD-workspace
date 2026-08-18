export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { username: string; displayName: string; roles: string[] };
};

let accessToken: string | null = null;
const refreshTokenKey = "assistant-workbench.refresh-token";

export function getAccessToken(): string | null {
  return accessToken;
}

export function saveSession(session: AuthSession): void {
  accessToken = session.accessToken;
  sessionStorage.setItem(refreshTokenKey, session.refreshToken);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(refreshTokenKey);
}

export function clearSession(): void {
  accessToken = null;
  sessionStorage.removeItem(refreshTokenKey);
}
