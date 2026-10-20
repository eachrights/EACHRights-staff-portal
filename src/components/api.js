import { userPool } from "../cognito";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export class SessionError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionError";
  }
}

/* Resolves with the current valid Cognito session, or rejects with SessionError */
export function getCognitoSession() {
  return new Promise((resolve, reject) => {
    const currentUser = userPool.getCurrentUser();

    if (!currentUser) return reject(new SessionError());

    currentUser.getSession((error, session) => {
      if (error || !session || !session.isValid()) {
        return reject(new SessionError());
      }

      resolve(session);
    });
  });
}

/* JSON request with the Cognito ID token attached */
export async function apiRequest(path, { method = "GET", body } = {}) {
  const session = await getCognitoSession();
  const token = session.getIdToken().getJwtToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) throw new SessionError();

  if (!response.ok) {
    throw new Error(
      data?.message || data?.error || `Request failed with status ${response.status}`
    );
  }

  return data;
}
