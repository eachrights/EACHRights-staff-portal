/*
 * Translates calendar events between the API's shape and the portal's shape.
 * Use it in workplanApi.js:
 *
 *   import { eventToApi, eventFromApi } from "./eventMapping";
 *
 *   listEvents:     GET /me/events?from&to, then (data.events || []).map(eventFromApi)
 *   saveEvent:      send eventToApi(payload): POST /me/events, or PUT /me/events/{id} when payload.id is set
 *
 * Portal event: { id, title, type: "Meeting" | "Training" | "Deadline" | "Field visit" | "Other", allDay,
 *                 start: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm", end: same, description }
 * API event:    { id, title, type: "meeting" | "training" | "deadline" | "field" | "other",
 *                 date, endDate, time, endTime, allDay, description }
 *
 * Needs the server's eventFields to store allDay and endTime.
 */
const TO_API = { Meeting: "meeting", Training: "training", Deadline: "deadline", "Field visit": "field", Other: "other" };
const FROM_API = { meeting: "Meeting", training: "Training", deadline: "Deadline", field: "Field visit", other: "Other" };

// "09:00" -> "10:00" (capped at 23:59). Used for older events saved without an end time.
const plusHour = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h >= 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export function eventToApi(e) {
  const start = String(e.start || "");
  const end = String(e.end || e.start || "");
  const allDay = Boolean(e.allDay);
  return {
    title: e.title,
    type: TO_API[e.type] || "other",
    allDay,
    date: start.slice(0, 10),
    endDate: end.slice(0, 10),
    time: allDay ? "" : start.slice(11, 16),
    endTime: allDay ? "" : end.slice(11, 16),
    description: e.description || "",
  };
}

export function eventFromApi(e) {
  const allDay = e.allDay ?? !e.time;
  const endDate = e.endDate || e.date;
  const endTime = e.endTime || (e.time ? plusHour(e.time) : "");
  return {
    id: e.id,
    title: e.title,
    type: FROM_API[e.type] || "Meeting",
    allDay,
    start: allDay ? e.date : `${e.date}T${e.time}`,
    end: allDay ? endDate : `${endDate}T${endTime}`,
    description: e.description || "",
  };
}