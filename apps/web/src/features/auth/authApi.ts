import { z } from "zod";
import { getJson, postJson } from "../../lib/api/http";

const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().positive(),
  user: z.object({
    username: z.string(),
    displayName: z.string(),
    roles: z.array(z.string()),
  }),
});

export type AuthSession = z.infer<typeof authSessionSchema>;

export function login(
  username: string,
  password: string,
): Promise<AuthSession> {
  return postJson("/auth/login", authSessionSchema, { username, password });
}

export function refresh(refreshToken: string): Promise<AuthSession> {
  return postJson("/auth/refresh", authSessionSchema, { refreshToken });
}

export function logout(refreshToken: string): Promise<null> {
  return getJson("/auth/logout", z.null(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
}
