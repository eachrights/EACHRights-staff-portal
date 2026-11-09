// API helpers for remote work requests. src/pages/remote/remoteApi.js
// Matches remoteRoutes.mjs:
//   GET  /me/remote?scope=all&status=    my requests (administrator or CEO can add scope=all)
//   POST /me/remote                      { startDate, endDate, reason }
//   POST /me/remote/{id}/cancel
//   POST /me/remote/{id}/approve | reject   administrator or CEO { note } (required when rejecting)
//   GET  /me/remote/people?from&to       approved remote days for everyone
//
// Needs `call` and `query` to be exported from ../attendance/attendanceApi.js
// (put the word "export" in front of those two declarations).
import { call, query } from "../attendance/attendanceApi";

// Give API records the field names the Attendance page uses (same as leave).
const toUiRemote = (r) => ({
  ...r,
  from: r.startDate,
  to: r.endDate,
  name: r.userName,
  decidedBy: r.reviewedBy,
  decisionNote: r.reviewNote,
});

// My requests (scope "me") or everyone's (scope "all", administrator or CEO).
export async function listRemoteRequests({ scope = "me", status } = {}) {
  const result = await call(`/me/remote?${query({ scope: scope === "all" ? "all" : undefined, status })}`);
  return (result?.requests || []).map(toUiRemote);
}

// Approved remote days for everyone, limited to { from, to } (YYYY-MM-DD).
export async function listRemote({ from, to } = {}) {
  const result = await call(`/me/remote/people?${query({ from, to })}`);
  return (result?.people || []).map(toUiRemote);
}

export const requestRemote = ({ from, to, reason }) =>
  call("/me/remote", { method: "POST", body: JSON.stringify({ startDate: from, endDate: to, reason }) });

export const cancelRemote = (id) =>
  call(`/me/remote/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({}) });

// decision: "approve" | "approved" | "reject" | "rejected". The API needs a note when rejecting.
export const decideRemote = (id, { decision, note } = {}) => {
  const action = String(decision).startsWith("approve") ? "approve" : String(decision).startsWith("reject") ? "reject" : "";
  if (!action) return Promise.reject(new Error("Choose approve or reject."));
  return call(`/me/remote/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note: note || (action === "reject" ? "Not approved." : "") }),
  });
};