import { useCallback, useEffect, useMemo, useState } from "react";
import { Fingerprint, Download, Trash2, Printer, Wifi, ScanLine } from "lucide-react";
import QRCode from "qrcode";
import { getAccess } from "../../access";
import { WEEKEND_DAYS, holidayName } from "../../holidays";
import RemotePanel from "../remote/RemotePanel";
import {
  getConfig,
  saveConfig,
  listHolidays,
  addHoliday,
  deleteHoliday,
  getToday,
  clock,
  getRecords,
  getDay,
  correctRecord,
  importPunches,
  getPasskeys,
  deletePasskey,
  getQr,
  rotateQr,
  listLeave,
  listLeaveRequests,
  requestLeave,
  cancelLeave,
  decideLeave,
} from "./attendanceApi";
import { passkeysSupported, registerThisDevice, getAssertion } from "./passkeyClient";

/* ---------- time helpers (all shown in Nairobi time) ---------- */

const TZ = "Africa/Nairobi";
const DAY_MS = 86400000;

// True when the portal is open in a phone's own browser
const onPhone = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// The printed QR opens this page with ?clock=<token>. Keep the token for the rest of the day and tidy the address bar.
const QR_KEY = "eachrights_clock_qr";
const QR_KEEP_MS = 12 * 3600 * 1000;
function readScan() {
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("clock");
    if (t) {
      localStorage.setItem(QR_KEY, JSON.stringify({ t, at: Date.now() }));
      url.searchParams.delete("clock");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
    // localStorage, not sessionStorage: it is also filled in by captureClockToken.js before the login page appears
    const saved = JSON.parse(localStorage.getItem(QR_KEY) || "null");
    if (saved && Date.now() - saved.at < QR_KEEP_MS) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const todayKey = () => dayKey(new Date().toISOString());
const dayLabel = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const addDays = (key, n) => new Date(+new Date(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const fullDate = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// Hours as a number (for example 7.5) shown as "7h 30m"
const hoursText = (h) => {
  if (!h || h <= 0) return "-";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// The API wants plain dates (YYYY-MM-DD) for from and to, not timestamps
function rangeDays(range) {
  const today = todayKey();
  if (range === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (range === "30d") return { from: addDays(today, -29), to: today };
  const dow = weekday(today);
  return { from: addDays(today, -((dow + 6) % 7)), to: today }; // week starts Monday
}

// Weekends and public holidays from the local holidays file. The leave form uses this to count working days.
const dayOff = (key) => ({ weekend: WEEKEND_DAYS.includes(weekday(key)), holiday: holidayName(key) });

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* ---------- shared Tailwind classes (green, like the file pages) ---------- */

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";
const BTN = `inline-flex items-center gap-2 rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center gap-2 rounded-lg border border-[#008060] bg-[#008060] px-4 py-2 text-sm text-white transition hover:bg-[#00664E] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const CARD = "rounded-2xl border border-[#E6ECE9] bg-white p-5";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-[#667085]";

const STATE_TAG = {
  present: { text: "Present", cls: "bg-[#E3F3EC] text-[#00664E]" },
  absent: { text: "Absent", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  weekend: { text: "Weekend", cls: "bg-[#F1F3F2] text-[#667085]" },
  holiday: { text: "Holiday", cls: "bg-[#EEF4FF] text-[#2E5AAC]" },
  leave: { text: "On leave", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  away: { text: "Away on duty", cls: "bg-[#EEF4FF] text-[#2E5AAC]" },
  remote: { text: "Remote", cls: "bg-[#E8F1FB] text-[#1F5FA8]" },
  upcoming: { text: "Upcoming", cls: "bg-[#F1F3F2] text-[#667085]" },
};
const LATE_CLS = "bg-[#FFF4E5] text-[#8A4B00]";

/* ---------- print: only the element with id="attendance-print" is printed ---------- */

const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden !important; }
  #attendance-print, #attendance-print * { visibility: visible !important; }
  #attendance-print {
    position: absolute !important;
    left: 0;
    top: 0;
    width: 100%;
    border: 0 !important;
    border-radius: 0 !important;
  }
}
`;

function PrintHeader({ title, subtitle, period }) {
  return (
    <div className="hidden px-1 pb-3 print:block">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-[#475467]">
        {subtitle ? `${subtitle} | ` : ""}
        {period} (Nairobi time) | Printed {fullDate(todayKey())}
      </p>
    </div>
  );
}

/* ---------- small pieces ---------- */

function Banner({ msg }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`mb-4 rounded-lg px-3 py-2 text-sm ${
        msg.ok ? "bg-[#E3F3EC] text-[#00664E]" : "bg-[#FDECEA] text-[#8A1C14]"
      }`}
    >
      {msg.text}
    </p>
  );
}

function Chip({ text, cls }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
}

function RangeSelect({ value, onChange }) {
  return (
    <select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Date range">
      <option value="week">This week</option>
      <option value="month">This month</option>
      <option value="30d">Last 30 days</option>
    </select>
  );
}

// Tells the person when today is a holiday, a weekend, a leave day, a trip or a remote day
function DayNote({ day }) {
  if (!day) return null;
  const tag = STATE_TAG[day.state];
  const text =
    day.state === "holiday"
      ? `Today is a public holiday${day.note ? `: ${day.note}` : ""}.`
      : day.state === "weekend"
      ? "Today is a weekend."
      : day.state === "leave"
      ? "You are on approved leave today."
      : day.state === "away"
      ? `You are away on duty today${day.note ? `: ${day.note}` : ""}.`
      : day.state === "remote"
      ? "You are working remotely today."
      : "";
  if (!text) return null;
  return (
    <p role="status" className={`mb-4 rounded-lg px-3 py-2 text-sm ${tag.cls}`}>
      {text}
    </p>
  );
}

function SummaryCards({ summary }) {
  if (!summary) return null;
  const items = [
    ["Present", summary.present, "text-[#00664E]"],
    ["Late", summary.late, "text-[#8A4B00]"],
    ["Absent", summary.absent, "text-[#8A1C14]"],
    ["On leave", summary.leave, "text-[#8A4B00]"],
    ["Away on duty", summary.away ?? 0, "text-[#2E5AAC]"],
    ["Remote", summary.remote ?? 0, "text-[#1F5FA8]"],
    ["Hours worked", Math.round(summary.hours * 10) / 10, ""],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7 print:hidden">
      {items.map(([label, value, cls]) => (
        <div key={label} className={CARD}>
          <p className="text-xs font-medium text-[#667085]">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// One row per day, newest first. Weekends, holidays, leave and absences all show up.
function HistoryTable({ days }) {
  const today = todayKey();
  const rows = [...days].reverse();
  if (!rows.length) return <p className="px-4 py-10 text-center text-sm text-[#667085]">No days in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Status</th>
            <th className={TH}>Clock in</th>
            <th className={TH}>Clock out</th>
            <th className={TH}>Hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const tag = STATE_TAG[d.state] || STATE_TAG.absent;
            const r = d.record;
            return (
              <tr
                key={d.date}
                className={`border-b border-[#EEF1F0] last:border-0 ${r ? "" : "bg-[#FAFBFA] text-[#667085]"}`}
              >
                <td className="whitespace-nowrap px-3 py-2.5">{dayLabel(d.date)}</td>
                <td className="px-3 py-2.5">
                  <Chip text={(d.state === "holiday" || d.state === "away") && d.note ? d.note : tag.text} cls={tag.cls} />
                  {r?.late && (
                    <>
                      {" "}
                      <Chip text="Late" cls={LATE_CLS} />
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">{r?.in ? timeOf(r.in) : "-"}</td>
                <td className="px-3 py-2.5">
                  {r?.out ? (
                    timeOf(r.out)
                  ) : r?.in ? (
                    d.date === today ? (
                      <span className="text-[#00664E]">In progress</span>
                    ) : (
                      <span className="text-[#B54708]">No clock-out</span>
                    )
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2.5 font-medium">{hoursText(r?.hours)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- download (CSV) ---------- */

function downloadCsv(head, lines, prefix) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [head, ...lines].map((row) => row.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDays(days, prefix) {
  downloadCsv(
    ["Date", "Status", "Note", "Clock in (EAT)", "Clock out (EAT)", "Hours", "Late"],
    days.map((d) => [
      d.date,
      STATE_TAG[d.state]?.text || d.state,
      d.note || "",
      d.record?.in ? timeOf(d.record.in) : "",
      d.record?.out ? timeOf(d.record.out) : "",
      d.record?.hours ?? "",
      d.record?.late ? "Yes" : "",
    ]),
    prefix
  );
}

const sourceLabel = (source) =>
  source === "scanner" ? "Office scanner" : source === "admin" ? "Corrected by admin" : source ? "Phone or laptop" : "-";

function exportDay(date, records) {
  downloadCsv(
    ["Date", "Name", "User ID", "Clock in (EAT)", "Clock out (EAT)", "Hours", "Late", "Source"],
    records.map((r) => [
      date,
      r.userName,
      r.userId,
      r.in ? timeOf(r.in) : "",
      r.out ? timeOf(r.out) : "",
      r.hours ?? "",
      r.late ? "Yes" : "",
      sourceLabel(r.source),
    ]),
    `team-attendance-${date}`
  );
}

/* ---------- my phone: fingerprint, face or PIN ---------- */

function PasskeyCard({ today, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  const load = useCallback(
    () =>
      getPasskeys()
        .then((r) => setItems(r.passkeys || []))
        .catch(() => setItems([])),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  // Nothing to show when passkeys are neither required nor already set up and this device can't do them
  if (!supported && !(items && items.length) && !today.requirePasskey) return null;

  async function onRegister() {
    setBusy(true);
    setMsg(null);
    try {
      await registerThisDevice();
      setMsg({ ok: true, text: "This device is registered. You will confirm with your fingerprint, face or PIN when you clock in." });
      await Promise.all([load(), onChange()]);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(p) {
    if (!window.confirm(`Remove ${p.label}? You will need to register a device again to clock in.`)) return;
    try {
      await deletePasskey(p.id);
      await Promise.all([load(), onChange()]);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <section className={`${CARD} mb-6`} aria-label="My phone">
      <h3 className="font-medium">My phone</h3>
      <p className="mt-1 text-sm text-[#667085]">
        {today.requirePasskey
          ? "To clock in you confirm with your fingerprint, face or screen PIN on a device you have registered."
          : "Register your phone so clocking in is confirmed with your fingerprint, face or screen PIN."}{" "}
        Your fingerprint never leaves your phone. If the clock page says your phone isn't registered, remove it here and
        register it again.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      {items && items.length > 0 && (
        <ul className="mb-3 divide-y divide-[#EEF1F0] text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 font-medium">{p.label}</span>
              <span className="text-xs text-[#667085]">Added {fullDate(dayKey(p.createdAt))}</span>
              <button className={`${BTN} px-3 py-1.5`} onClick={() => onRemove(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <button className={items?.length ? BTN : BTN_PRIMARY} onClick={onRegister} disabled={busy}>
          {busy ? "Waiting for your phone..." : items?.length ? "Register this device too" : "Register this device"}
        </button>
      ) : (
        <p className="text-sm text-[#8A4B00]">
          This browser can't use fingerprint or PIN here. Open the portal in Chrome or Safari over https.
        </p>
      )}
    </section>
  );
}

/* ---------- QR poster (administrator): print it and stick it up at the office ---------- */

// To use your own logo: save it in the portal's public folder (for example public/logo.png) and set this to "/logo.png".
// Leave it empty to use the green "E" mark from the login page.
const LOGO_SRC = "/logo.png";
const BRAND_FONT = '"Fraunces", Georgia, serif';

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// A QR code with the logo in the middle. "H" error correction lets the scanner ignore the covered centre.
async function makeQrImage(url) {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, {
    width: 900,
    margin: 0,
    errorCorrectionLevel: "H",
    color: { dark: "#0B2B24", light: "#FFFFFF" },
  });
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const box = Math.round(size * 0.19);
  const x = Math.round((size - box) / 2);
  const pad = 16;

  ctx.fillStyle = "#FFFFFF";
  roundedRect(ctx, x - pad, x - pad, box + pad * 2, box + pad * 2, 30);
  ctx.fill();

  const logo = LOGO_SRC ? await loadImage(LOGO_SRC) : null;
  if (logo) {
    const scale = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, x + (box - w) / 2, x + (box - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#008060";
    roundedRect(ctx, x, x, box, box, 24);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${Math.round(box * 0.7)}px ${BRAND_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", size / 2, size / 2 + box * 0.04);
  }
  return canvas.toDataURL("image/png");
}

// The poster is drawn on an A4 sheet (794 x 1123 px = 210 x 297 mm). On screen it is shown smaller; printing uses the full size.
const POSTER_CSS = `
.poster-frame { position: relative; width: 556px; height: 786px; margin: 0 auto; overflow: hidden; border-radius: 14px; box-shadow: 0 8px 30px rgba(11,43,36,.15); background: #fff; }
.poster-sheet { width: 794px; height: 1123px; transform: scale(0.7); transform-origin: top left; display: flex; flex-direction: column; background: #fff; color: #0B2B24; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  #attendance-print { width: 210mm !important; height: 297mm !important; overflow: hidden !important; border-radius: 0 !important; box-shadow: none !important; }
  #attendance-print .poster-sheet { transform: none !important; }
  #attendance-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

function PosterLogo({ size = 76 }) {
  return (
    <div
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
      className="flex items-center justify-center overflow-hidden bg-white shadow-md"
    >
      {LOGO_SRC ? (
        <img src={LOGO_SRC} alt="EACHRights" style={{ width: "80%", height: "80%", objectFit: "contain" }} />
      ) : (
        <span style={{ fontFamily: BRAND_FONT, fontSize: size * 0.62, fontWeight: 600, color: "#008060", lineHeight: 1 }}>E</span>
      )}
    </div>
  );
}

function PosterStep({ icon: Icon, title, text: caption }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div
        style={{ width: 70, height: 70, borderRadius: 35, background: "#E3F3EC", color: "#00664E", margin: "0 auto" }}
        className="flex items-center justify-center"
      >
        <Icon size={32} />
      </div>
      <p style={{ marginTop: 12, fontSize: 18, fontWeight: 700 }}>{title}</p>
      <p style={{ marginTop: 3, fontSize: 14, color: "#667085" }}>{caption}</p>
    </div>
  );
}

function QrScreen() {
  const [token, setToken] = useState(null);
  const [img, setImg] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    getQr()
      .then((r) => on && setToken(r.token))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let on = true;
    const url = `${window.location.origin}/clock?clock=${encodeURIComponent(token)}`;
    makeQrImage(url)
      .then((data) => on && setImg(data))
      .catch(() => on && setMsg({ ok: false, text: "Could not draw the QR code." }));
    return () => {
      on = false;
    };
  }, [token]);

  async function onRotate() {
    if (!window.confirm("Make a new QR code? The one already printed will stop working, so you will need to print and put up the new one.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await rotateQr();
      setToken(r.token);
      setMsg({ ok: true, text: "New QR code made. Print it and replace the old one." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <style>{POSTER_CSS}</style>

      <section className={`${CARD} mb-6 print:hidden`}>
        <h3 className="font-medium">QR poster</h3>
        <p className="mt-1 text-sm text-[#667085]">
          Print this A4 poster and put it up at the office. Staff scan it with their phone camera, which opens a clock page,
          then tap the button and confirm with their fingerprint, face or PIN. No password is needed. It only works while
          they are on the office network, so scanning it from home or on mobile data won't let anyone clock in. If a photo
          of the poster is ever shared around, make a new code. In the print window, choose A4, margins None, and turn on
          background graphics so the colours print.
        </p>
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={BTN_PRIMARY} onClick={() => window.print()} disabled={!img}>
            <Printer size={16} /> Print poster
          </button>
          <button className={BTN} onClick={onRotate} disabled={busy || !token}>
            Make a new code
          </button>
        </div>
      </section>

      <div className="overflow-x-auto pb-4">
        <div id="attendance-print" className="poster-frame">
          <div className="poster-sheet">
            {/* Header */}
            <div
              style={{
                position: "relative",
                overflow: "hidden",
                height: 250,
                padding: "46px 64px 0",
                color: "#fff",
                background: "linear-gradient(135deg, #008060 0%, #00664E 100%)",
                borderRadius: "0 0 56px 56px",
              }}
            >
              <div style={{ position: "absolute", right: -90, top: -130, width: 380, height: 380, borderRadius: 190, background: "rgba(255,255,255,0.08)" }} />
              <div style={{ position: "absolute", right: 120, bottom: -150, width: 260, height: 260, borderRadius: 130, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 20 }}>
                <PosterLogo />
                <div>
                  <p style={{ fontFamily: BRAND_FONT, fontSize: 44, fontWeight: 600, lineHeight: 1.05 }}>EACHRights</p>
                  <p style={{ marginTop: 6, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", opacity: 0.85 }}>Staff attendance</p>
                </div>
              </div>
              <p style={{ position: "relative", marginTop: 34, fontSize: 18, opacity: 0.92 }}>
                Advancing Rights. Strengthening Systems. Transforming Lives.
              </p>
            </div>

            {/* Headline */}
            <div style={{ marginTop: 38, textAlign: "center" }}>
              <p style={{ fontFamily: BRAND_FONT, fontSize: 60, fontWeight: 600, lineHeight: 1.05 }}>Clock in &amp; out</p>
              <p style={{ marginTop: 8, fontSize: 22, color: "#475467" }}>Scan with your phone camera</p>
            </div>

            {/* QR */}
            <div
              style={{
                position: "relative",
                width: 400,
                margin: "34px auto 0",
                padding: 26,
                background: "#fff",
                border: "4px solid #008060",
                borderRadius: 36,
                boxShadow: "0 18px 40px rgba(0,128,96,0.18)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: -19,
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "6px 24px",
                  borderRadius: 999,
                  background: "#008060",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: 3,
                }}
              >
                SCAN ME
              </span>
              {img ? (
                <img src={img} alt="QR code for clocking in" style={{ display: "block", width: 340, height: 340 }} />
              ) : (
                <div style={{ width: 340, height: 340 }} className="flex items-center justify-center text-sm text-[#667085]">
                  {msg ? "" : "Loading..."}
                </div>
              )}
            </div>

            {/* Steps */}
            <div style={{ display: "flex", gap: 16, padding: "38px 56px 0" }}>
              <PosterStep icon={Wifi} title="Connect" text="To the office Wi-Fi" />
              <PosterStep icon={ScanLine} title="Scan" text="This code with your camera" />
              <PosterStep icon={Fingerprint} title="Confirm" text="Fingerprint, face or PIN" />
            </div>

            {/* Footer */}
            <div style={{ marginTop: "auto", padding: "22px 64px 26px", textAlign: "center", background: "#EEF7F3" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#00664E" }}>Works on the office network only</p>
              <p style={{ marginTop: 4, fontSize: 13, color: "#475467" }}>
                First time? Sign in to the staff portal once and register your phone under Attendance, My phone.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- my attendance ---------- */

function MyAttendance() {
  const [today, setToday] = useState(null);
  const [data, setData] = useState(null);
  const [range, setRange] = useState("week");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [scan] = useState(readScan);
  const now = useNow();

  const loadToday = useCallback(
    () => getToday().then(setToday).catch((e) => setMsg({ ok: false, text: e.message })),
    []
  );
  const loadRecords = useCallback(() => {
    const { from, to } = rangeDays(range);
    return getRecords({ from, to })
      .then(setData)
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [range]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);
  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Refresh now and then so a scanner punch shows up without reloading
  useEffect(() => {
    const t = setInterval(() => {
      loadToday();
      loadRecords();
    }, 60000);
    return () => clearInterval(t);
  }, [loadToday, loadRecords]);

  // Re-check the office network as soon as the connection changes or the tab regains focus
  useEffect(() => {
    const refresh = () => {
      loadToday();
      loadRecords();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadToday, loadRecords]);

  const rec = today?.record;
  const clockedIn = !!rec?.in && !rec?.out;
  const finished = !!rec?.in && !!rec?.out;
  const action = rec?.in ? "out" : "in";
  const scanOk = !!scan && now - scan.at < QR_KEEP_MS;
  const needPhone = !!today?.requirePasskey && !today?.hasPasskey;
  const needQr = !!today?.requireQr && !scanOk;
  const todayDay = data?.days.find((d) => d.date === todayKey());
  const workedToday = rec?.in ? (rec.out ? rec.hours : (now - new Date(rec.in)) / 36e5) : 0;

  async function onClock() {
    setBusy(true);
    setMsg(null);
    try {
      const extra = {};
      if (today.requirePasskey || today.hasPasskey) extra.assertion = await getAssertion();
      if (scan && Date.now() - scan.at < QR_KEEP_MS) extra.qrToken = scan.t;
      const r = await clock(action, onPhone ? "phone" : "laptop", extra);
      setMsg({
        ok: true,
        text: action === "in" ? `Clocked in at ${timeOf(r.in)}.` : `Clocked out at ${timeOf(r.out)}.`,
      });
      await Promise.all([loadToday(), loadRecords()]);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const name = data?.days.find((d) => d.record)?.record.userName;

  return (
    <>
      <Banner msg={msg} />
      <DayNote day={todayDay} />

      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* CLOCK CARD */}
        <section className={CARD} aria-label="Clock in and out">
          {!today ? (
            <p className="text-sm text-[#667085]">Loading...</p>
          ) : (
            <div className="flex flex-wrap items-center gap-5">
              <button
                onClick={onClock}
                disabled={busy || !today.canClock || needPhone || needQr}
                className={`flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-full text-white transition disabled:opacity-60 motion-reduce:transition-none ${FOCUS} ${
                  action === "out" ? "bg-[#B54708] hover:bg-[#93390A]" : "bg-[#008060] hover:bg-[#00664E]"
                }`}
              >
                <Fingerprint size={34} />
                <span className="text-center text-sm font-medium">
                  {busy ? "Please wait..." : !rec?.in ? "Clock in" : finished ? "Clock out again" : "Clock out"}
                </span>
              </button>
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {now.toLocaleTimeString("en-GB", { timeZone: TZ })}
                </p>
                <p className="text-sm text-[#667085]">
                  {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}
                </p>
                <p className="mt-2 text-sm">
                  {clockedIn ? (
                    <span className="font-medium text-[#00664E]">
                      Clocked in since {timeOf(rec.in)} ({hoursText(workedToday)})
                    </span>
                  ) : finished ? (
                    <span className="font-medium text-[#00664E]">
                      Clocked out at {timeOf(rec.out)} after {hoursText(rec.hours)}
                    </span>
                  ) : (
                    <span className="text-[#475467]">Not clocked in.</span>
                  )}
                  {rec?.late && (
                    <>
                      {" "}
                      <Chip text="Late" cls={LATE_CLS} />
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[#667085]">
                  You can also press your finger on the office scanner when it is working. Both count toward your attendance.
                </p>
                {needQr && today.canClock && (
                  <p role="status" className="mt-2 rounded-lg bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
                    Scan the QR code at the office with your phone camera (while on the office Wi-Fi), then tap Clock in.
                  </p>
                )}
                {!today.canClock && today.reason && (
                  <p role="status" className="mt-2 rounded-lg bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
                    {today.reason}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* TODAY */}
        <section className={CARD} aria-label="Today">
          <h3 className="text-sm font-medium text-[#667085]">Today</h3>
          <p className="mt-1 text-2xl font-semibold">{hoursText(workedToday)}</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {!rec?.in && !rec?.out && <li className="text-[#667085]">No clock in yet.</li>}
            {rec?.in && (
              <li className="flex items-center gap-2">
                <i className="h-2 w-2 rounded-full bg-[#0F9F77]" />
                Clocked in at {timeOf(rec.in)}
              </li>
            )}
            {rec?.out && (
              <li className="flex items-center gap-2">
                <i className="h-2 w-2 rounded-full bg-[#B54708]" />
                Clocked out at {timeOf(rec.out)}
              </li>
            )}
          </ul>
          {today?.config && (
            <p className="mt-3 text-xs text-[#667085]">
              Working hours {today.config.workStart} to {today.config.workEnd}
            </p>
          )}
        </section>
      </div>

      {today && <PasskeyCard today={today} onChange={loadToday} />}

      <SummaryCards summary={data?.summary} />

      {/* HISTORY */}
      <section id="attendance-print" className="mb-6 rounded-2xl border border-[#E6ECE9] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6ECE9] px-5 py-3 print:hidden">
          <h3 className="font-medium">My history</h3>
          <div className="flex flex-wrap items-center gap-2">
            <RangeSelect value={range} onChange={setRange} />
            <button
              className={BTN}
              onClick={() => exportDays(data.days, "my-attendance")}
              disabled={!data?.days.length}
            >
              <Download size={16} /> Download CSV
            </button>
            <button className={BTN} onClick={() => window.print()} disabled={!data?.days.length}>
              <Printer size={16} /> Print
            </button>
          </div>
        </div>
        <PrintHeader
          title="My attendance"
          subtitle={name}
          period={`${fullDate(rangeDays(range).from)} to ${fullDate(rangeDays(range).to)}`}
        />
        {data ? <HistoryTable days={data.days} /> : <p className="px-4 py-10 text-center text-sm text-[#667085]">Loading...</p>}
      </section>
    </>
  );
}

/* ---------- team (administrator) ---------- */

// Add or correct one person's record for one day
function CorrectForm({ date, initial, onDone, onCancel }) {
  const known = !!initial?.userId;
  const [f, setF] = useState({
    userId: initial?.userId || "",
    userName: initial?.userName || "",
    in: initial?.in ? timeOf(initial.in) : "",
    out: initial?.out ? timeOf(initial.out) : "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    if (!f.userId.trim()) {
      setMsg({ ok: false, text: "Enter the person's user ID." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await correctRecord(f.userId.trim(), date, {
        in: f.in,
        out: f.out,
        ...(f.userName.trim() ? { userName: f.userName.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-4 print:hidden`}>
      <h3 className="font-medium">{known ? `Correct ${initial.userName || initial.userId}` : "Add a record"}</h3>
      <p className="mt-1 text-sm text-[#667085]">
        For {fullDate(date)}. Times are Nairobi time. Leave a time empty to clear it.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        {!known && (
          <>
            <label className="text-xs text-[#667085]">
              User ID
              <input className={`${INPUT} mt-1 block w-64`} value={f.userId} onChange={set("userId")} />
            </label>
            <label className="text-xs text-[#667085]">
              Name
              <input className={`${INPUT} mt-1 block w-48`} value={f.userName} onChange={set("userName")} />
            </label>
          </>
        )}
        <label className="text-xs text-[#667085]">
          Clock in
          <input type="time" className={`${INPUT} mt-1 block`} value={f.in} onChange={set("in")} />
        </label>
        <label className="text-xs text-[#667085]">
          Clock out
          <input type="time" className={`${INPUT} mt-1 block`} value={f.out} onChange={set("out")} />
        </label>
        <button className={BTN_PRIMARY} disabled={busy}>
          {busy ? "Saving..." : "Save record"}
        </button>
        <button type="button" className={BTN} onClick={onCancel}>
          Cancel
        </button>
      </form>
    </section>
  );
}

// One person's days over a range
function PersonHistory({ person, onClose }) {
  const [range, setRange] = useState("month");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let on = true;
    const { from, to } = rangeDays(range);
    setData(null);
    getRecords({ from, to, userId: person.userId })
      .then((r) => {
        if (!on) return;
        setError("");
        setData(r);
      })
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [range, person.userId]);

  return (
    <section className="mb-4 rounded-2xl border border-[#E6ECE9] bg-white print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6ECE9] px-5 py-3">
        <h3 className="font-medium">{person.userName || person.userId}</h3>
        <div className="flex items-center gap-2">
          <RangeSelect value={range} onChange={setRange} />
          <button className={BTN} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="p-5 pb-0">{error && <Banner msg={{ ok: false, text: error }} />}</div>
      {data && (
        <>
          <div className="px-5 pt-1">
            <SummaryCards summary={data.summary} />
          </div>
          <HistoryTable days={data.days} />
        </>
      )}
      {!data && !error && <p className="px-4 py-10 text-center text-sm text-[#667085]">Loading...</p>}
    </section>
  );
}

// Administrator: the phones someone has registered. Remove them when a phone is lost or the person leaves.
function PersonPhones({ person, onClose }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(
    () =>
      getPasskeys(person.userId)
        .then((r) => setItems(r.passkeys || []))
        .catch((e) => setMsg({ ok: false, text: e.message })),
    [person.userId]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function onRemove(p) {
    if (!window.confirm(`Remove ${p.label} for ${person.userName || person.userId}? They will not be able to clock in with it.`)) return;
    try {
      await deletePasskey(p.id, person.userId);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <section className={`${CARD} mb-4 print:hidden`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Phones registered by {person.userName || person.userId}</h3>
        <button className={BTN} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      {!items ? (
        <p className="text-sm text-[#667085]">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#667085]">No phones registered.</p>
      ) : (
        <ul className="divide-y divide-[#EEF1F0] text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 font-medium">{p.label}</span>
              <span className="text-xs text-[#667085]">
                Added {fullDate(dayKey(p.createdAt))}
                {p.lastUsedAt ? `, last used ${fullDate(dayKey(p.lastUsedAt))}` : ""}
              </span>
              <button className={`${BTN} px-3 py-1.5`} onClick={() => onRemove(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamAttendance() {
  const [date, setDate] = useState(todayKey());
  const [q, setQ] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // a record to correct, or {} to add a new one
  const [history, setHistory] = useState(null);
  const [phones, setPhones] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let on = true;
    setLoading(true);
    getDay(date)
      .then((r) => {
        if (!on) return;
        setError("");
        setRecords(r.records || []);
      })
      .catch((e) => on && setError(e.message))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [date, tick]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? records.filter((r) => `${r.userName} ${r.userId}`.toLowerCase().includes(needle)) : records;
  }, [records, q]);

  const stillIn = records.filter((r) => r.in && !r.out).length;
  const late = records.filter((r) => r.late).length;
  const isToday = date === todayKey();

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]">{error}</p>}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">Present</p>
          <p className="mt-1 text-2xl font-semibold">{records.length}</p>
        </div>
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">Late</p>
          <p className="mt-1 text-2xl font-semibold text-[#8A4B00]">{late}</p>
        </div>
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">{isToday ? "In the office now" : "No clock-out"}</p>
          <p className="mt-1 text-2xl font-semibold text-[#00664E]">{stillIn}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <input
          type="date"
          className={INPUT}
          value={date}
          max={todayKey()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Date"
        />
        <button className={BTN} onClick={() => setDate(addDays(date, -1))}>
          Previous day
        </button>
        <button className={BTN} onClick={() => setDate(addDays(date, 1))} disabled={date >= todayKey()}>
          Next day
        </button>
        <input
          type="search"
          className={`${INPUT} w-56`}
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search by name"
        />
        <span className="flex-1" />
        <button className={BTN} onClick={() => setEditing({})}>
          Add record
        </button>
        <button className={BTN} onClick={() => exportDay(date, filtered)} disabled={!filtered.length}>
          <Download size={16} /> Download CSV
        </button>
        <button className={BTN} onClick={() => window.print()} disabled={!filtered.length}>
          <Printer size={16} /> Print
        </button>
      </div>

      {editing && (
        <CorrectForm
          key={editing.userId || "new"}
          date={date}
          initial={editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setTick((t) => t + 1);
          }}
        />
      )}
      {history && <PersonHistory person={history} onClose={() => setHistory(null)} />}
      {phones && <PersonPhones person={phones} onClose={() => setPhones(null)} />}

      <div id="attendance-print" className="rounded-2xl border border-[#E6ECE9] bg-white">
        <PrintHeader title="Team attendance" subtitle={q.trim() ? `Filter: ${q.trim()}` : "All staff"} period={fullDate(date)} />
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-[#667085]">Loading...</p>
        ) : !filtered.length ? (
          <p className="px-4 py-10 text-center text-sm text-[#667085]">No attendance recorded on {fullDate(date)}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Clock in</th>
                  <th className={TH}>Clock out</th>
                  <th className={TH}>Hours</th>
                  <th className={TH}>Source</th>
                  <th className={`${TH} print:hidden`} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.userId} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{r.userName || r.userId}</span>
                      {r.late && (
                        <>
                          {" "}
                          <Chip text="Late" cls={LATE_CLS} />
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{r.in ? timeOf(r.in) : "-"}</td>
                    <td className="px-3 py-2.5">
                      {r.out ? (
                        timeOf(r.out)
                      ) : r.in ? (
                        isToday ? (
                          <span className="text-[#00664E]">In progress</span>
                        ) : (
                          <span className="text-[#B54708]">No clock-out</span>
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{hoursText(r.hours)}</td>
                    <td className="px-3 py-2.5 text-[#667085]">
                      {sourceLabel(r.source)}
                      {r.verified ? " (passkey)" : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right print:hidden">
                      <button className={`${BTN} px-3 py-1.5`} onClick={() => setEditing(r)}>
                        Correct
                      </button>{" "}
                      <button className={`${BTN} px-3 py-1.5`} onClick={() => setHistory(r)}>
                        History
                      </button>{" "}
                      <button className={`${BTN} px-3 py-1.5`} onClick={() => setPhones(r)}>
                        Phones
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- settings (administrator): working hours and public holidays ---------- */

function ClockingSettings() {
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const toForm = (c) => ({
    phoneClocking: !!c.phoneClocking,
    requirePasskey: !!c.requirePasskey,
    requireQr: !!c.requireQr,
    ips: (c.allowedIps || []).join("\n"),
    workStart: c.workStart,
    workEnd: c.workEnd,
    graceMinutes: String(c.graceMinutes),
  });

  useEffect(() => {
    let on = true;
    getConfig()
      .then((c) => on && setForm(toForm(c)))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const saved = await saveConfig({
        phoneClocking: form.phoneClocking,
        requirePasskey: form.requirePasskey,
        requireQr: form.requireQr,
        allowedIps: form.ips.split(/[\s,]+/).filter(Boolean),
        workStart: form.workStart,
        workEnd: form.workEnd,
        graceMinutes: Number(form.graceMinutes),
      });
      setForm(toForm(saved));
      setMsg({ ok: true, text: "Settings saved." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Clocking settings</h3>
      <p className="mt-1 text-sm text-[#667085]">
        Staff can clock in from a phone or laptop only when this is switched on and they are connected to the office
        network. Otherwise they use the office scanner.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      {!form ? (
        !msg && <p className="text-sm text-[#667085]">Loading...</p>
      ) : (
        <form className="space-y-4" onSubmit={onSave}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#008060]"
              checked={form.phoneClocking}
              onChange={(e) => setForm((f) => ({ ...f, phoneClocking: e.target.checked }))}
            />
            Allow clocking in from phones and laptops
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#008060]"
              checked={form.requirePasskey}
              onChange={(e) => setForm((f) => ({ ...f, requirePasskey: e.target.checked }))}
            />
            Require fingerprint, face or PIN on a registered phone
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#008060]"
              checked={form.requireQr}
              onChange={(e) => setForm((f) => ({ ...f, requireQr: e.target.checked }))}
            />
            Require scanning the printed QR code
          </label>
          <label className="block text-xs text-[#667085]">
            Office network addresses (one per line)
            <textarea
              className={`${INPUT} mt-1 block w-full max-w-md font-mono`}
              rows={4}
              value={form.ips}
              onChange={set("ips")}
              placeholder={"41.80.10.25\n41.80.10.0/24"}
            />
            <span className="mt-1 block">
              Use the office&apos;s public IP address (open a &quot;what is my IP&quot; page while on the office
              Wi-Fi), or a range such as 41.80.10.0/24. If the office also has an IPv6 address, add it too.
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#667085]">
              Work starts
              <input type="time" className={`${INPUT} mt-1 block`} value={form.workStart} onChange={set("workStart")} />
            </label>
            <label className="text-xs text-[#667085]">
              Work ends
              <input type="time" className={`${INPUT} mt-1 block`} value={form.workEnd} onChange={set("workEnd")} />
            </label>
            <label className="text-xs text-[#667085]">
              Grace period (minutes)
              <input
                type="number"
                min="0"
                max="120"
                className={`${INPUT} mt-1 block w-28`}
                value={form.graceMinutes}
                onChange={set("graceMinutes")}
              />
            </label>
          </div>
          <button className={BTN_PRIMARY} disabled={busy}>
            {busy ? "Saving..." : "Save settings"}
          </button>
        </form>
      )}
    </section>
  );
}

function HolidaySettings() {
  const thisYear = Number(todayKey().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ date: "", name: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      listHolidays(year)
        .then(setItems)
        .catch((e) => setMsg({ ok: false, text: e.message })),
    [year]
  );
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  async function onAdd(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await addHoliday({ date: form.date, name: form.name.trim() });
      setForm({ date: "", name: "" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(h) {
    if (!window.confirm(`Remove ${h.name} (${fullDate(h.date)})?`)) return;
    try {
      await deleteHoliday(h.date);
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Public holidays</h3>
        <select className={INPUT} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-sm text-[#667085]">
        Holidays are not counted as absences in attendance records.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onAdd}>
        <label className="text-xs text-[#667085]">
          Date
          <input
            type="date"
            className={`${INPUT} mt-1 block`}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            required
          />
        </label>
        <label className="text-xs text-[#667085]">
          Name
          <input
            className={`${INPUT} mt-1 block w-64`}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            maxLength={120}
            required
          />
        </label>
        <button className={BTN_PRIMARY} disabled={busy}>
          Add holiday
        </button>
      </form>

      {!items ? (
        <p className="mt-4 text-sm text-[#667085]">Loading...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-[#667085]">No holidays added for {year}.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#EEF1F0]">
          {items.map((h) => (
            <li key={h.date} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-[#667085]">{fullDate(h.date)}</span>
              <span className="flex-1 font-medium">{h.name}</span>
              <button
                className={`rounded-full p-2 text-[#667085] hover:bg-[#F1F3F2] hover:text-[#B42318] ${FOCUS}`}
                aria-label={`Remove ${h.name}`}
                onClick={() => onRemove(h)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SettingsPanel() {
  return (
    <>
      <ClockingSettings />
      <HolidaySettings />
    </>
  );
}

/* ---------- scanner import (administrator): manual fallback ---------- */

const DELIMS = [",", "\t", ";"];

function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = DELIMS.map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
}

// Understands 2026-10-31 08:02:11 and 31/10/2026 08:02 (day first). Treated as Nairobi time.
function parseWhen(s) {
  const pad = (v) => String(v).padStart(2, "0");
  let m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] || "00"}+03:00`;
  m = String(s).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6] || "00"}+03:00`;
  return null;
}

function ImportFile() {
  const [rows, setRows] = useState([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [idCol, setIdCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1); // -1 = no name column
  const [timeCol, setTimeCol] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const table = parseTable(await file.text());
    setRows(table);
    setMsg(null);
    setNameCol(-1);
    if (table.length) {
      // Guess: the time column is the first one that looks like a date and time
      const sample = table[Math.min(1, table.length - 1)];
      const t = sample.findIndex((c) => parseWhen(c));
      const tc = t >= 0 ? t : 1;
      setTimeCol(tc);
      setIdCol(tc === 0 ? 1 : 0);
      setHasHeader(!table[0].some((c) => parseWhen(c)));
    }
  }

  const body = hasHeader ? rows.slice(1) : rows;
  const labels = rows[0]?.map((c, i) => (hasHeader && c ? c : `Column ${i + 1}`)) || [];
  const punches = body
    .map((r) => {
      const userName = nameCol >= 0 ? (r[nameCol] || "").trim() : "";
      return {
        userId: (r[idCol] || "").trim(),
        ...(userName ? { userName } : {}),
        timestamp: parseWhen(r[timeCol] || ""),
      };
    })
    .filter((p) => p.userId && p.timestamp);
  const skipped = body.length - punches.length;

  async function onImport() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await importPunches(punches);
      setMsg({ ok: true, text: `Done. ${r.records} daily records were saved or updated.` });
      setRows([]);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const options = (extra) => (
    <>
      {extra}
      {labels.map((l, i) => (
        <option key={i} value={i}>
          {l}
        </option>
      ))}
    </>
  );

  return (
    <section className={CARD}>
      <h3 className="font-medium">Import from a scanner file</h3>
      <p className="mt-1 text-sm text-[#667085]">
        Punches normally arrive from the scanner by themselves. Use this only as a backup, for example to load a USB
        export after the scanner was offline for days. Times are read as Nairobi time. For each person and day, the
        earliest punch becomes the clock in and the latest becomes the clock out. Re-uploading a file is safe. The ID
        column must hold each person&apos;s portal user ID, otherwise their punches won&apos;t appear in their own
        attendance.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <input type="file" accept=".csv,.txt,.dat,.tsv" onChange={onFile} className="text-sm" aria-label="Scanner export file" />

      {rows.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-[#008060]"
              />
              First row is headings
            </label>
            <label className="flex items-center gap-2">
              User ID
              <select className={INPUT} value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>
                {options()}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Name
              <select className={INPUT} value={nameCol} onChange={(e) => setNameCol(Number(e.target.value))}>
                {options(<option value={-1}>None</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Date and time
              <select className={INPUT} value={timeCol} onChange={(e) => setTimeCol(Number(e.target.value))}>
                {options()}
              </select>
            </label>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-[#E6ECE9]">
            <table className="w-full text-xs">
              <tbody>
                {body.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-1.5">{r[idCol]}</td>
                    <td className="px-3 py-1.5">{r[timeCol]}</td>
                    <td className="px-3 py-1.5 text-[#667085]">
                      {parseWhen(r[timeCol] || "") ? "OK" : "Can't read this time"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-sm text-[#475467]">
            {punches.length} punches ready{skipped > 0 ? `, ${skipped} rows can't be read and will be skipped` : ""}.
          </p>
          <button className={`${BTN_PRIMARY} mt-3`} onClick={onImport} disabled={busy || !punches.length}>
            {busy ? "Importing..." : `Import ${punches.length} punches`}
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------- leave: requests, approvals, who is away ---------- */

const LEAVE_TYPES = ["Annual", "Sick", "Maternity", "Paternity", "Compassionate", "Study", "Unpaid", "Other"];

// Working days in a range: weekends and public holidays don't count against the person's leave
function workingDays(from, to) {
  if (!from || !to) return 0;
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const o = dayOff(k);
    if (!o.weekend && !o.holiday) n += 1;
  }
  return n;
}

const dateRange = (from, to) => (from === to ? fullDate(from) : `${fullDate(from)} to ${fullDate(to)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const LEAVE_STATUS_TAG = {
  pending: { text: "Waiting for approval", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  approved: { text: "Approved", cls: "bg-[#E3F3EC] text-[#00664E]" },
  rejected: { text: "Not approved", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  cancelled: { text: "Cancelled", cls: "bg-[#F1F3F2] text-[#667085]" },
};

function LeaveRequestForm({ onSent }) {
  const [form, setForm] = useState({ type: "Annual", from: "", to: "", reason: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === "from" && (!f.to || f.to < v) ? { to: v } : {}) }));
  };
  const days = workingDays(form.from, form.to);
  const backwards = !!form.from && !!form.to && form.to < form.from;

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.from || !form.to || backwards) return;
    if (days === 0) {
      setMsg({ ok: false, text: "Those dates are all weekends or public holidays, so there is nothing to take as leave." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await requestLeave({ type: form.type, from: form.from, to: form.to, reason: form.reason.trim() });
      setMsg({ ok: true, text: "Leave request sent. You will see the decision in the list below." });
      setForm({ type: form.type, from: "", to: "", reason: "" });
      onSent();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Request leave</h3>
      <p className="mt-1 text-sm text-[#667085]">
        An administrator or the CEO will approve or decline it. Weekends and public holidays are not counted.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <label className="text-xs text-[#667085]">
          Type
          <select className={`${INPUT} mt-1 block`} value={form.type} onChange={set("type")}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[#667085]">
          From
          <input type="date" className={`${INPUT} mt-1 block`} value={form.from} onChange={set("from")} required />
        </label>
        <label className="text-xs text-[#667085]">
          To
          <input type="date" className={`${INPUT} mt-1 block`} value={form.to} onChange={set("to")} required />
        </label>
        <label className="min-w-[200px] flex-1 text-xs text-[#667085]">
          Reason (optional)
          <input className={`${INPUT} mt-1 block w-full`} value={form.reason} onChange={set("reason")} maxLength={300} />
        </label>
        <button className={BTN_PRIMARY} disabled={busy || backwards || !form.from || !form.to}>
          {busy ? "Sending..." : "Send request"}
        </button>
      </form>
      {backwards && <p className="mt-2 text-sm text-[#8A1C14]">The end date is before the start date.</p>}
      {!backwards && form.from && form.to && (
        <p className="mt-2 text-sm text-[#475467]">
          {dateRange(form.from, form.to)}: {plural(days, "working day")}
        </p>
      )}
    </section>
  );
}

function MyLeaveRequests({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const today = todayKey();

  useEffect(() => {
    let on = true;
    listLeaveRequests({ scope: "me" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  const canCancel = (r) => r.status === "pending" || (r.status === "approved" && r.from > today);

  async function onCancel(r) {
    if (!window.confirm(`Cancel your ${r.type.toLowerCase()} leave request for ${dateRange(r.from, r.to)}?`)) return;
    try {
      await cancelLeave(r.id);
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  const rows = [...(items || [])].sort((a, b) => b.from.localeCompare(a.from));

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">My leave requests</h3>
      {msg && (
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">You haven&apos;t asked for leave yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Type</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH}>Status</th>
                <th className={TH}>Note</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = LEAVE_STATUS_TAG[r.status] || LEAVE_STATUS_TAG.pending;
                return (
                  <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-2.5 font-medium">{r.type}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                    <td className="px-3 py-2.5">{r.days ?? workingDays(r.from, r.to)}</td>
                    <td className="px-3 py-2.5">
                      <Chip {...tag} />
                      {r.decidedBy && r.status !== "pending" && (
                        <span className="mt-0.5 block text-xs text-[#667085]">by {r.decidedBy}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#667085]">{r.decisionNote || "-"}</td>
                    <td className="px-3 py-2.5 text-right">
                      {canCancel(r) && (
                        <button className={`${BTN} px-3 py-1.5`} onClick={() => onCancel(r)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Administrators and the CEO: requests waiting for a decision
function LeaveApprovals({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let on = true;
    listLeaveRequests({ scope: "all", status: "pending" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  async function decide(r, decision) {
    let note = "";
    if (decision === "rejected") {
      note = window.prompt(`Reason for not approving ${r.name}'s leave (optional)`);
      if (note === null) return; // cancelled
    }
    setBusyId(r.id);
    setMsg(null);
    try {
      await decideLeave(r.id, { decision, note: note.trim() });
      setMsg({ ok: true, text: `${r.name}'s leave ${decision === "approved" ? "approved" : "not approved"}.` });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  const rows = [...(items || [])].sort((a, b) => a.from.localeCompare(b.from));

  return (
    <section className={`${CARD} mb-6`}>
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Waiting for your approval</h3>
        {rows.length > 0 && <Chip text={String(rows.length)} cls="bg-[#FFF4E5] text-[#8A4B00]" />}
      </div>
      {msg && (
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">No requests are waiting.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Type</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH}>Reason</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5">{r.type}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                  <td className="px-3 py-2.5">{r.days ?? workingDays(r.from, r.to)}</td>
                  <td className="px-3 py-2.5 text-[#667085]">{r.reason || "-"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button
                      className={`${BTN_PRIMARY} px-3 py-1.5`}
                      disabled={busyId === r.id}
                      onClick={() => decide(r, "approved")}
                    >
                      Approve
                    </button>{" "}
                    <button
                      className={`${BTN} px-3 py-1.5`}
                      disabled={busyId === r.id}
                      onClick={() => decide(r, "rejected")}
                    >
                      Decline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Everyone: approved leave, so people can see who is away
function WhoIsOnLeave({ tick }) {
  const [view, setView] = useState("upcoming");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const today = todayKey();

  useEffect(() => {
    let on = true;
    setItems(null);
    const range =
      view === "past" ? { from: addDays(today, -90), to: addDays(today, -1) } : { from: today, to: addDays(today, 90) };
    listLeave({ scope: "all", ...range })
      .then((r) => {
        if (!on) return;
        setError("");
        setItems(r);
      })
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [view, today, tick]);

  const rows = [...(items || [])].sort((a, b) =>
    view === "past" ? b.to.localeCompare(a.to) : a.from.localeCompare(b.from) || a.name.localeCompare(b.name)
  );
  const showType = rows.some((l) => l.type);
  const onNow = rows.filter((l) => l.from <= today && today <= l.to).length;
  const stateOf = (l) =>
    l.to < today
      ? { text: "Returned", cls: "bg-[#F1F3F2] text-[#667085]" }
      : l.from <= today
      ? { text: "On leave now", cls: "bg-[#FFF4E5] text-[#8A4B00]" }
      : { text: "Upcoming", cls: "bg-[#EEF4FF] text-[#2E5AAC]" };

  return (
    <section className={`${CARD} mb-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Who is on leave</h3>
          {view === "upcoming" && onNow > 0 && <Chip text={`${onNow} away now`} cls="bg-[#FFF4E5] text-[#8A4B00]" />}
        </div>
        <select className={INPUT} value={view} onChange={(e) => setView(e.target.value)} aria-label="Show leave">
          <option value="upcoming">Now and the next 90 days</option>
          <option value="past">Past 90 days</option>
        </select>
      </div>
      {error && (
        <div className="mt-3">
          <Banner msg={{ ok: false, text: error }} />
        </div>
      )}
      {!items && !error ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">
          {view === "past" ? "Nobody was on leave in the past 90 days." : "Nobody is on leave in this period."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                {showType && <th className={TH}>Type</th>}
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={`${l.userId}|${l.from}|${i}`} className="border-b border-[#EEF1F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium">{l.name}</td>
                  {showType && <td className="px-3 py-2.5">{l.type || "-"}</td>}
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(l.from, l.to)}</td>
                  <td className="px-3 py-2.5">{workingDays(l.from, l.to)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Chip {...stateOf(l)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Leave first, then remote work (RemotePanel brings its own heading and sections)
function LeavePanel({ canApprove }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return (
    <>
      {canApprove && <LeaveApprovals tick={tick} onChange={refresh} />}
      <LeaveRequestForm onSent={refresh} />
      <MyLeaveRequests tick={tick} onChange={refresh} />
      <WhoIsOnLeave tick={tick} />
      <RemotePanel canApprove={canApprove} />
    </>
  );
}

/* ---------- page ---------- */

export default function Attendance() {
  const [tab, setTab] = useState("mine");
  const [access, setAccess] = useState({ isAdmin: false });

  useEffect(() => {
    let mounted = true;
    getAccess()
      .then((r) => mounted && setAccess(r))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Administrators and the CEO approve leave. If getAccess() returns canApproveLeave, that wins.
  const canApprove = access.canApproveLeave ?? !!access.isAdmin;

  const tabBtn = (key, label) => (
    <button
      key={key}
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`-mb-px border-b-2 px-4 py-2 text-sm ${FOCUS} ${
        tab === key
          ? "border-[#008060] font-medium text-[#00664E]"
          : "border-transparent text-[#667085] hover:text-[#0B2B24]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 text-[#0B2B24] lg:p-6">
      <style>{PRINT_CSS}</style>

      <div className="mb-5">
        <h2 className="text-2xl font-semibold">Attendance</h2>
        <p className="text-sm text-[#667085]">
          Clock in from the office network or at the office scanner. Times are in Nairobi time.
        </p>
      </div>

      <div className="mb-5 flex overflow-x-auto border-b border-[#E6ECE9]" role="tablist">
        {tabBtn("mine", "My attendance")}
        {tabBtn("leave", "Leave")}
        {access.isAdmin && tabBtn("team", "Team")}
        {access.isAdmin && tabBtn("settings", "Settings")}
        {access.isAdmin && tabBtn("qr", "QR poster")}
        {access.isAdmin && tabBtn("scanner", "Scanner import")}
      </div>

      {tab === "leave" ? (
        <LeavePanel canApprove={canApprove} />
      ) : access.isAdmin && tab === "team" ? (
        <TeamAttendance />
      ) : access.isAdmin && tab === "settings" ? (
        <SettingsPanel />
      ) : access.isAdmin && tab === "qr" ? (
        <QrScreen />
      ) : access.isAdmin && tab === "scanner" ? (
        <ImportFile />
      ) : (
        <MyAttendance />
      )}
    </div>
  );
}
