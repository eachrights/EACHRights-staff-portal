import { userPool } from "../cognito";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

// Debug logging only while developing (npm run dev). Responses can contain staff data.
const DEBUG = Boolean(import.meta.env.DEV);

export class SessionError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionError";
    this.code = "UNAUTHORIZED";
  }
}

/* Error thrown for any non-OK API response. Keeps the server's code and HTTP status,
   so callers can react to codes such as DEVICE_ALREADY_USED or NOT_IN_OFFICE. */
export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (code) this.code = code;
  }
}

/* Get the current valid Cognito session */
export function getCognitoSession() {
  return new Promise((resolve, reject) => {
    const currentUser = userPool.getCurrentUser();

    if (!currentUser) {
      return reject(new SessionError());
    }

    currentUser.getSession((error, session) => {
      if (error || !session || !session.isValid()) {
        return reject(new SessionError());
      }

      resolve(session);
    });
  });
}

/* Make authenticated API requests and diagnose unexpected responses */
export async function apiRequest(path, { method = "GET", body } = {}) {
  const session = await getCognitoSession();
  const token = session.getIdToken().getJwtToken();

  // Ensure the API path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;

  if (DEBUG) {
    console.log("========== EACHRights API DEBUG ==========");
    console.log("API BASE URL:", API_BASE_URL);
    console.log("API REQUEST URL:", url);
    console.log("API METHOD:", method);
  }

  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error("API NETWORK ERROR:", error);
    throw new ApiError(
      "Cannot connect to the API. Check your internet connection and API Gateway URL.",
      { code: "NETWORK" }
    );
  }

  // No content (for example some DELETE responses).
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  const responseText = await response.text();

  if (DEBUG) {
    console.log("API STATUS:", response.status);
    console.log("API CONTENT TYPE:", contentType);
    console.log("API RESPONSE:", responseText.slice(0, 1000));
    console.log("==========================================");
  }

  if (response.status === 401) {
    throw new SessionError();
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(
      `The API returned ${contentType || "an unknown content type"} instead of JSON. HTTP ${response.status}. Check API Gateway routing and the API URL.`,
      { status: response.status, code: "NOT_JSON" }
    );
  }

  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new ApiError("The API returned invalid JSON.", {
      status: response.status,
      code: "BAD_JSON",
    });
  }

  if (!response.ok) {
    throw new ApiError(
      data?.message ||
        data?.error ||
        `API request failed with status ${response.status}`,
      { status: response.status, code: data?.code }
    );
  }

  return data;
}