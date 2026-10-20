/*
 * Client for the M&E dashboard. It reuses the same Cognito session and
 * base URL as the rest of the portal (see api.js).
 */
import { API_BASE_URL, SessionError, apiRequest, getCognitoSession } from "./components/api";

export const api = apiRequest;

export async function downloadCsv(path, filename) {
  const session = await getCognitoSession();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${session.getIdToken().getJwtToken()}` },
  });

  if (response.status === 401) throw new SessionError();

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${response.status})`);
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
