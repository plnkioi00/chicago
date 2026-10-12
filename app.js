import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_L = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const hhmm = t => (t || "").slice(0, 5);
const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY = ymd(today);

function fmtTime(t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return m[2] === "00" ? `${h}${ap}` : `${h}:${m[2]}${ap}`; }
function timeRange(e) { const a = fmtTime(e.start_time), b = fmtTime(e.end_time); return a && b ? `${a} → ${b}` : a; }
function sourceOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const map = { "ra.co": "RA", "residentadvisor.net": "RA", "dice.fm": "DICE", "ticketmaster.com": "Ticketmaster", "livenation.com": "Live Nation", "eventbrite.com": "Eventbrite", "instagram.com": "IG", "posh.vip": "Posh", "shotgun.live": "Shotgun", "axs.com": "AXS", "seetickets.us": "See Tickets", "tixr.com": "Tixr" };
    for (const k in map) if (h === k || h.endsWith("." + k)) return map[k];
    return h.split(".").slice(-2, -1)[0] || h;
  } catch { return ""; }
}
const flyerUrl = e => e.flyer_path ? sb.storage.from("flyers").getPublicUrl(e.flyer_path).data.publicUrl : "";
const daysUntil = e => { const d = parseYmd(e.date); return d ? Math.round((d - today) / 86400000) : null; };
const sorted = a => a.slice().sort((x, y) => (x.date || "").localeCompare(y.date || "") || (x.start_time || "").localeCompare(y.start_time || ""));

/* ---------- state ---------- */
const S = {
  events: [], rsvps: [], names: {},
  month: new Date(today.getFullYear(), today.getMonth(), 1), sel: null,
  session: null, me: null, myName: "", isCrew: false, loaded: false, openId: null,
};
const goingFor = id => S.rsvps.filter(r => r.event_id === id);
const iGo = id => !!S.me && S.rsvps.some(r => r.event_id === id && r.user_id === S.me);

/* ---------- data ---------- */
async function loadAll() {
  const [ev, rs] = await Promise.all([
    sb.from("events").select("*").order("date"),
    sb.from("rsvps").select("event_id,user_id"),
  ]);
  if (ev.error) { $("#status").textContent = "Couldn't load raves. Refresh to try again."; }
  S.events = ev.data || [];
  S.rsvps = rs.data || [];
  S.loaded = true;
  if (S.me) {
    const ids = [...new Set(S.rsvps.map(r => r.user_id))];
    if (ids.length) {
      const { data } = await sb.from("profiles").select("id,display_name").in("id", ids);
      for (const p of data || []) S.names[p.id] = p.display_name || "Someone";
    }
  }
  render();
  if (S.openId && !$("#panel").hidden) {
    if (S.events.some(e => e.id === S.openId)) openDetail(S.openId); else closePanel();
  }
}
let reloadT;
const reloadSoon = () => { clearTimeout(reloadT); reloadT = setTimeout(loadAll, 250); };

async function refreshAuth(session) {
  S.session = session;
  S.me = session?.user?.id || null;
  S.isCrew = false; S.myName = "";
  if (S.me) {
    const [{ data: crew }, { data: prof }] = await Promise.all([
      sb.rpc("is_crew"),
      sb.from("profiles").select("display_name").eq("id", S.me).maybeSingle(),
    ]);
    S.isCrew = crew === true;
    S.myName = prof?.display_name || session.user.email.split("@")[0];
  }
  renderWho();
  await loadAll();
}

/* ---------- header ---------- */
function renderWho() {
  const w = $("#who");
  $("#addBtn").hidden = !S.isCrew;
  if (!S.me) { w.innerHTML = `<button class="btn" id="signInBtn">Sign in</button>`; $("#signInBtn").onclick = openSignIn; return; }
  w.innerHTML = `<span>Hey <b>${esc(S.myName)}</b></span>${S.isCrew ? `<span class="badge">Editor</span>` : `<button class="btn ghost" id="codeBtn">Editor code</button>`}<button class="btn ghost" id="outBtn">Sign out</button>`;
  $("#outBtn").onclick = () => sb.auth.signOut();
  if ($("#codeBtn")) $("#codeBtn").onclick = openCode;
}

/* ---------- calendar ---------- */
function renderCal() {
  const m = S.month;
  $("#mlabel").textContent = `${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
  $("#dow").innerHTML = DOW.map((d, i) => `<div class="${i >= 5 ? "wk" : ""}">${d}</div>`).join("");
  const start = new Date(m); start.setDate(1 - m.getDay());
  const byDay = {};
  for (const e of S.events) (byDay[e.date] ||= []).push(e);
  const cells = Math.ceil((m.getDay() + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7) * 7;
  let html = "";
  for (let i = 0; i < cells; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = ymd(d), evs = sorted(byDay[k] || []);
    const cls = ["day"];
    if (d.getMonth() !== m.getMonth()) cls.push("out");
    if (d.getDay() === 5 || d.getDay() === 6) cls.push("weekend");
    if (k === TODAY) cls.push("today");
    if (k === S.sel) cls.push("sel");
    const label = `${DOW[d.getDay()]} ${MONTHS_L[d.getMonth()]} ${d.getDate()}${evs.length ? `, ${evs.length} event${evs.length > 1 ? "s" : ""}` : ""}`;
    html += `<button class="${cls.join(" ")}" data-day="${k}" aria-label="${esc(label)}"><span class="n">${d.getDate()}</span>`
      + evs.slice(0, 2).map(e => `<span class="chip ${iGo(e.id) ? "me" : ""}">${esc(e.title)}</span>`).join("")
      + (evs.length > 2 ? `<span class="more">+${evs.length - 2} more</span>` : "")
      + (evs.length ? `<span class="dots">${evs.slice(0, 3).map(e => `<i class="${iGo(e.id) ? "me" : ""}"></i>`).join("")}</span>` : "")
      + `</button>`;
  }
  $("#days").innerHTML = html;
}

/* ---------- agenda ---------- */
function stubHtml(e) {
  const d = parseYmd(e.date), n = daysUntil(e);
  const meta = [e.venue, timeRange(e)].filter(Boolean).join(" · ");
  const lineup = (e.lineup || []).filter(x => x && x !== e.title).join(", ");
  const g = goingFor(e.id).length;
  let pill = "";
  if (iGo(e.id)) pill = `<span class="pill me">You're going</span>`;
  else if (g) pill = `<span class="pill going">${g} going</span>`;
  else if (n !== null && n >= 0 && n <= 14) pill = `<span class="pill">${n === 0 ? "Tonight" : n === 1 ? "Tomorrow" : `In ${n}d`}</span>`;
  else if (e.source) pill = `<span class="pill src">${esc(e.source)}</span>`;
  return `<button class="stub ${n !== null && n < 0 ? "past" : ""}" data-id="${esc(e.id)}">
    <div class="when">${d ? `<span class="dw">${DOW[d.getDay()]}</span><span class="dd">${d.getDate()}</span><span class="mm">${MONTHS[d.getMonth()]}</span>` : `<span class="dd">?</span>`}</div>
    <div class="what">
      <span class="t">${esc(e.title)}</span>
      ${lineup ? `<span class="l">${esc(lineup)}</span>` : ""}
      ${meta ? `<span class="m">${esc(meta)}</span>` : ""}
    </div>
    <div class="side">
      ${e.flyer_path ? `<img class="thumb" src="${esc(flyerUrl(e))}" alt="" loading="lazy">` : ""}
      ${e.price ? `<span class="price">${esc(e.price)}</span>` : ""}
      ${pill}
    </div>
  </button>`;
}
function renderAgenda() {
  const list = $("#list");
  $("#clearSel").hidden = !S.sel;
  if (!S.loaded) { list.innerHTML = `<div class="empty"><h3>Loading the lineup…</h3></div>`; return; }
  let items, title;
  if (S.sel) {
    const d = parseYmd(S.sel);
    title = `${DOW[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    items = S.events.filter(e => e.date === S.sel);
  } else {
    const m = S.month, key = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
    const isNow = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();
    title = isNow ? "Coming up" : MONTHS_L[m.getMonth()];
    items = isNow ? S.events.filter(e => e.date >= TODAY) : S.events.filter(e => (e.date || "").startsWith(key));
  }
  $("#aTitle").textContent = title;
  items = sorted(items);
  if (items.length) { list.innerHTML = items.map(stubHtml).join(""); return; }
  const none = S.events.length === 0;
  const cta = S.isCrew
    ? `<button class="btn primary" data-add="${esc(S.sel || "")}">+ Add a rave</button>`
    : S.me ? `<p>Got the editor code? Tap “Editor code” up top to start adding raves.</p>`
    : `<button class="btn" data-signin="1">Sign in</button>`;
  list.innerHTML = `<div class="empty">
    <h3>${none ? "Nothing on the calendar yet" : "No raves here"}</h3>
    <p>${none ? "Editors drop a flyer screenshot or ticket link and it lands on the right night. Everyone else can sign in and tap I'm going." : "Pick another night."}</p>
    ${cta}
  </div>`;
}
function render() { renderCal(); renderAgenda(); }

/* ---------- panel ---------- */
let lastFocus = null, draft = null;
function openPanel(title, html) {
  lastFocus = document.activeElement;
  $("#pTitle").textContent = title;
  $("#pBody").innerHTML = html;
  $("#scrim").hidden = false; $("#panel").hidden = false;
  document.body.style.overflow = "hidden";
}
function closePanel() {
  $("#scrim").hidden = true; $("#panel").hidden = true;
  document.body.style.overflow = "";
  draft = null; S.openId = null; lastFocus?.focus?.();
}
const note = (id, msg, err = false) => { const el = $(id); if (el) { el.className = "note" + (err ? " err" : ""); el.innerHTML = msg; } };

/* sign in / create account (email + password) */
function openSignIn(mode = "in") {
  S.openId = null;
  const isNew = mode === "new";
  openPanel(isNew ? "Create account" : "Sign in", `
    <div class="tabs" role="tablist">
      <button role="tab" id="tabIn" aria-selected="${!isNew}">Sign in</button>
      <button role="tab" id="tabNew" aria-selected="${isNew}">Create account</button>
    </div>
    ${isNew ? `<label class="f">Name (what friends see)<input class="i" id="si_name" autocomplete="name" placeholder="Polina"></label>` : ""}
    <label class="f">Email<input class="i" id="si_email" type="email" autocomplete="email" placeholder="you@email.com"></label>
    <label class="f">Password<input class="i" id="si_pw" type="password" autocomplete="${isNew ? "new-password" : "current-password"}" placeholder="${isNew ? "At least 8 characters" : ""}"></label>
    <div class="actions"><button class="btn primary" id="si_go">${isNew ? "Create account" : "Sign in"}</button><span class="note" id="si_note"></span></div>`);
  $("#tabIn").onclick = () => openSignIn("in");
  $("#tabNew").onclick = () => openSignIn("new");
  const go = async () => {
    const email = $("#si_email").value.trim(), password = $("#si_pw").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return note("#si_note", "Enter a real email.", true);
    if (password.length < (isNew ? 8 : 1)) return note("#si_note", isNew ? "Password needs at least 8 characters." : "Enter your password.", true);
    $("#si_go").disabled = true; note("#si_note", `<span class="spin"></span>${isNew ? "Creating…" : "Signing in…"}`);
    let res;
    if (isNew) {
      const name = ($("#si_name")?.value || "").trim();
      res = await sb.auth.signUp({ email, password, options: { data: name ? { name } : {} } });
    } else {
      res = await sb.auth.signInWithPassword({ email, password });
    }
    $("#si_go").disabled = false;
    const { data, error } = res;
    if (error) {
      const m = (error.message || "").toLowerCase();
      return note("#si_note",
        m.includes("invalid login") ? "Wrong email or password."
        : m.includes("already registered") ? "That email already has an account. Sign in instead."
        : m.includes("not confirmed") ? "This account still needs email confirmation. Ask Polina to confirm it."
        : error.status === 429 ? "Too many tries. Wait a minute."
        : "Couldn't do that. Try again.", true);
    }
    if (isNew && data?.user && !data.session) {
      return note("#si_note", (data.user.identities || []).length === 0
        ? "That email already has an account. Sign in instead."
        : "Account made, but it needs email confirmation before you can sign in.", true);
    }
    closePanel();
  };
  $("#si_go").onclick = go;
  $("#si_pw").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

/* editor code */
function openCode() {
  S.openId = null;
  openPanel("Become an editor", `
    <p class="note">Editors can add, edit and delete raves. Ask Polina for the code.</p>
    <label class="f">Editor code<input class="i" id="ec_code" autocomplete="off" placeholder="AFTERS-XXXXXX"></label>
    <div class="actions"><button class="btn primary" id="ec_go">Unlock</button><span class="note" id="ec_note"></span></div>`);
  $("#ec_go").onclick = async () => {
    const code = $("#ec_code").value.trim();
    if (!code) return;
    $("#ec_go").disabled = true;
    const { data, error } = await sb.rpc("redeem_editor_code", { code });
    $("#ec_go").disabled = false;
    if (error) return note("#ec_note", /too_many/.test(error.message) ? "Too many wrong tries. Wait an hour." : "Couldn't check the code. Try again.", true);
    if (!data) return note("#ec_note", "That code isn't right.", true);
    S.isCrew = true; renderWho(); render(); closePanel();
  };
}

/* add / edit form */
function formHtml(e = {}) {
  return `
  <label class="f">Event / headliner<input class="i" id="f_title" value="${esc(e.title)}" placeholder="Skrillex"></label>
  <label class="f">Lineup (comma separated)<input class="i" id="f_lineup" value="${esc((e.lineup || []).join(", "))}" placeholder="Artist, Artist b2b Artist"></label>
  <div class="row">
    <label class="f">Venue<input class="i" id="f_venue" value="${esc(e.venue)}" placeholder="Smartbar"></label>
    <label class="f">City<input class="i" id="f_city" value="${esc(e.city ?? "Chicago")}"></label>
  </div>
  <div class="row">
    <label class="f">Date<input class="i" type="date" id="f_date" value="${esc(e.date)}"></label>
    <label class="f">Doors<input class="i" type="time" id="f_start" value="${esc(hhmm(e.start_time))}"></label>
    <label class="f">Ends<input class="i" type="time" id="f_end" value="${esc(hhmm(e.end_time))}"></label>
  </div>
  <div class="row">
    <label class="f">Price<input class="i" id="f_price" value="${esc(e.price)}" placeholder="$25+"></label>
    <label class="f">Genre<input class="i" id="f_genre" value="${esc(e.genre)}" placeholder="techno, dubstep…"></label>
  </div>
  <label class="f">Ticket link<input class="i" type="url" id="f_url" value="${esc(e.ticket_url)}" placeholder="https://"></label>
  <label class="f">Notes<textarea class="i" id="f_notes" placeholder="21+, presale, who's driving">${esc(e.notes)}</textarea></label>`;
}
function readForm() {
  const v = id => ($(id)?.value || "").trim();
  const url = v("#f_url");
  return {
    title: v("#f_title"),
    lineup: v("#f_lineup").split(",").map(s => s.trim()).filter(Boolean),
    venue: v("#f_venue") || null, city: v("#f_city") || null, date: v("#f_date"),
    start_time: v("#f_start") || null, end_time: v("#f_end") || null,
    price: v("#f_price") || null, genre: v("#f_genre") || null,
    ticket_url: url || null, source: url ? sourceOf(url) : null, notes: v("#f_notes") || null,
  };
}
function fillForm(r) {
  const set = (id, val) => { const el = $(id); if (el && val) el.value = val; };
  set("#f_title", r.title); set("#f_lineup", Array.isArray(r.lineup) ? r.lineup.join(", ") : r.lineup);
  set("#f_venue", r.venue); set("#f_city", r.city);
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) set("#f_date", r.date);
  if (/^\d{1,2}:\d{2}$/.test(r.start || "")) set("#f_start", r.start.padStart(5, "0"));
  if (/^\d{1,2}:\d{2}$/.test(r.end || "")) set("#f_end", r.end.padStart(5, "0"));
  set("#f_price", r.price); set("#f_genre", r.genre); set("#f_url", r.ticketUrl); set("#f_notes", r.notes);
}

function openAdd(prefillDate) {
  S.openId = null;
  draft = { mode: "shot", img: null, editId: null };
  openPanel("Add a rave", `
    <div class="tabs" role="tablist">
      <button role="tab" id="tabShot" aria-selected="true">Screenshot</button>
      <button role="tab" id="tabLink" aria-selected="false">Link</button>
    </div>
    <div id="srcShot">
      <div class="drop" id="drop">
        <span><strong>Paste</strong>, drop, or pick a flyer / story screenshot</span>
        <input type="file" id="file" accept="image/*">
        <div id="prevImg"></div>
      </div>
    </div>
    <div id="srcLink" hidden>
      <label class="f">Ticket or post link<input class="i" type="url" id="linkIn" placeholder="https://ra.co/events/…"></label>
      <label class="f">Caption or details (optional, helps for IG)<textarea class="i" id="capIn" placeholder="Paste the IG caption or event description"></textarea></label>
    </div>
    <div class="actions"><button class="btn primary" id="readBtn">Read it</button><span class="note" id="readNote">Fills in the details below. Check them before saving.</span></div>
    <div class="sep"></div>
    ${formHtml({ date: prefillDate || "" })}
    <div class="actions"><button class="btn primary" id="saveBtn">Save to calendar</button><button class="btn ghost" id="cancelBtn">Cancel</button><span class="note" id="saveNote"></span></div>`);
  const setTab = t => { draft.mode = t; $("#tabShot").setAttribute("aria-selected", t === "shot"); $("#tabLink").setAttribute("aria-selected", t === "link"); $("#srcShot").hidden = t !== "shot"; $("#srcLink").hidden = t !== "link"; };
  $("#tabShot").onclick = () => setTab("shot");
  $("#tabLink").onclick = () => setTab("link");
  $("#file").onchange = ev => { const f = ev.target.files?.[0]; if (f) takeImage(f); };
  const drop = $("#drop");
  drop.ondragover = ev => { ev.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = ev => { ev.preventDefault(); drop.classList.remove("over"); const f = [...(ev.dataTransfer?.files || [])].find(f => f.type.startsWith("image/")); if (f) takeImage(f); };
  $("#readBtn").onclick = readIt;
  $("#saveBtn").onclick = save;
  $("#cancelBtn").onclick = closePanel;
}

async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.86));
  } catch { return file; }
}
const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

async function takeImage(file) {
  if (!draft) return;
  draft.img = await shrink(file);
  const p = $("#prevImg"); if (p) p.innerHTML = `<img src="${URL.createObjectURL(draft.img)}" alt="Flyer preview">`;
  if (draft.mode !== "shot") $("#tabShot")?.click();
}
document.addEventListener("paste", ev => {
  if (!draft || draft.mode === "edit" || $("#panel").hidden) return;
  const f = [...(ev.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
  if (f) { ev.preventDefault(); takeImage(f); return; }
  const t = (ev.clipboardData?.getData("text") || "").trim();
  if (/^https?:\/\/\S+$/.test(t) && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
    ev.preventDefault(); $("#tabLink").click(); $("#linkIn").value = t;
  }
});

async function readIt() {
  const link = ($("#linkIn")?.value || "").trim(), text = ($("#capIn")?.value || "").trim();
  const useImg = draft.mode === "shot" && draft.img;
  if (!useImg && !link && !text) return note("#readNote", draft.mode === "shot" ? "Add a screenshot first." : "Paste a link or caption first.", true);
  $("#readBtn").disabled = true; note("#readNote", `<span class="spin"></span>Reading…`);
  try {
    const body = { today: TODAY };
    if (useImg) body.image = await toDataUrl(draft.img);
    else { if (link) body.link = link; if (text) body.text = text; }
    const { data, error } = await sb.functions.invoke("parse-event", { body });
    if (error) {
      let code = ""; try { code = (await error.context?.json?.())?.error || ""; } catch {}
      throw new Error(code || "failed");
    }
    fillForm(data.event || {});
    note("#readNote", data.pageLoaded === false && link && !useImg
      ? "That site blocked the read, so this is a best guess from the link. Paste the caption or a screenshot for better results."
      : "Filled in. Check the date and times, then save.");
  } catch (err) {
    const m = String(err.message);
    note("#readNote", m === "not_crew" ? "Only editors can auto-read."
      : m === "rate_limited" ? "OpenAI is rate limiting. Wait a minute, or fill it in by hand."
      : m === "missing_openai_key" ? "The OpenAI key isn't set up yet."
      : "Couldn't read that one. Fill in the details below.", true);
  } finally { $("#readBtn").disabled = false; }
}

async function save() {
  const data = readForm();
  if (!data.title) return note("#saveNote", "Give it a name or headliner.", true);
  if (!data.date) return note("#saveNote", "Pick a date so it lands on the calendar.", true);
  $("#saveBtn").disabled = true; note("#saveNote", `<span class="spin"></span>Saving…`);
  try {
    if (draft?.img) {
      const path = `${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("flyers").upload(path, draft.img, { contentType: "image/jpeg" });
      if (!up.error) data.flyer_path = path;
    }
    const res = draft?.editId
      ? await sb.from("events").update(data).eq("id", draft.editId)
      : await sb.from("events").insert(data);
    if (res.error) throw res.error;
    const d = parseYmd(data.date);
    S.month = new Date(d.getFullYear(), d.getMonth(), 1); S.sel = data.date;
    closePanel(); await loadAll();
  } catch (err) {
    $("#saveBtn").disabled = false;
    note("#saveNote", /row-level|permission/i.test(err?.message || "") ? "Only editors can save raves." : "Couldn't save. Check your connection and try again.", true);
  }
}

/* detail */
function openDetail(id) {
  const e = S.events.find(x => x.id === id); if (!e) return;
  draft = null; S.openId = id;
  const d = parseYmd(e.date), n = daysUntil(e);
  const going = goingFor(id);
  const mine = iGo(id);
  const lineup = (e.lineup || []).filter(Boolean);
  const names = going.map(r => r.user_id === S.me ? "You" : (S.names[r.user_id] || "Someone"));
  openPanel(d ? `${DOW[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}` : "Event", `
    ${e.flyer_path ? `<img class="flyer" src="${esc(flyerUrl(e))}" alt="Flyer for ${esc(e.title)}">` : ""}
    <div>
      <h3 class="d-title">${esc(e.title)}</h3>
      ${lineup.length ? `<p class="d-lineup">${esc(lineup.join(" · "))}</p>` : ""}
    </div>
    <div class="actions">
      ${S.me ? `<button class="btn ${mine ? "going" : "primary"}" id="goBtn">${mine ? "✓ You're going" : "I'm going!"}</button>` : `<button class="btn primary" id="goSignIn">Sign in to say you're going</button>`}
      ${e.ticket_url ? `<a class="btn" href="${esc(e.ticket_url)}" target="_blank" rel="noopener">Tickets on ${esc(e.source || sourceOf(e.ticket_url) || "site")} ↗</a>` : ""}
    </div>
    <dl class="facts">
      ${e.venue || e.city ? `<dt>Where</dt><dd>${esc([e.venue, e.city].filter(Boolean).join(", "))}</dd>` : ""}
      ${timeRange(e) ? `<dt>Time</dt><dd>${esc(timeRange(e))}</dd>` : ""}
      ${n !== null ? `<dt>Countdown</dt><dd>${n < 0 ? `${-n} days ago` : n === 0 ? "Tonight" : n === 1 ? "Tomorrow" : `${n} days`}</dd>` : ""}
      ${e.price ? `<dt>Price</dt><dd>${esc(e.price)}</dd>` : ""}
      ${e.genre ? `<dt>Sound</dt><dd>${esc(e.genre)}</dd>` : ""}
      ${e.notes ? `<dt>Notes</dt><dd>${esc(e.notes)}</dd>` : ""}
      <dt>Going</dt><dd>${!going.length ? "Nobody yet" : S.me ? `<div class="crew">${names.map(x => `<span>${esc(x)}</span>`).join("")}</div>` : `${going.length} ${going.length === 1 ? "person" : "people"}`}</dd>
    </dl>
    ${S.isCrew ? `<div class="actions"><button class="btn ghost" id="editBtn">Edit</button><button class="btn danger" id="delBtn">Delete</button></div><div id="confirmSlot"></div>` : ""}
    <span class="note" id="dNote"></span>`);
  if ($("#goSignIn")) $("#goSignIn").onclick = openSignIn;
  if ($("#goBtn")) $("#goBtn").onclick = async () => {
    $("#goBtn").disabled = true;
    const res = mine
      ? await sb.from("rsvps").delete().eq("event_id", id).eq("user_id", S.me)
      : await sb.from("rsvps").insert({ event_id: id });
    if (res.error) { $("#goBtn").disabled = false; return note("#dNote", "Couldn't update. Try again.", true); }
    await loadAll();
  };
  if ($("#editBtn")) $("#editBtn").onclick = () => openEdit(e);
  if ($("#delBtn")) $("#delBtn").onclick = () => {
    $("#confirmSlot").innerHTML = `<div class="confirm"><span>Delete “${esc(e.title)}” for everyone?</span><button class="btn danger" id="yesDel">Delete</button><button class="btn ghost" id="noDel">Keep it</button></div>`;
    $("#noDel").onclick = () => { $("#confirmSlot").innerHTML = ""; };
    $("#yesDel").onclick = async () => {
      const { error } = await sb.from("events").delete().eq("id", id);
      if (error) return note("#dNote", "Couldn't delete. Try again.", true);
      if (e.flyer_path) sb.storage.from("flyers").remove([e.flyer_path]);
      closePanel(); await loadAll();
    };
  };
}
function openEdit(e) {
  S.openId = null;
  draft = { mode: "edit", img: null, editId: e.id };
  openPanel("Edit rave", `${formHtml(e)}
    <div class="actions"><button class="btn primary" id="saveBtn">Save changes</button><button class="btn ghost" id="cancelBtn">Cancel</button><span class="note" id="saveNote"></span></div>`);
  $("#saveBtn").onclick = save;
  $("#cancelBtn").onclick = () => openDetail(e.id);
}

/* ---------- wiring ---------- */
$("#prev").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); S.sel = null; render(); };
$("#next").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); S.sel = null; render(); };
$("#todayBtn").onclick = () => { S.month = new Date(today.getFullYear(), today.getMonth(), 1); S.sel = null; render(); };
$("#addBtn").onclick = () => openAdd(S.sel);
$("#clearSel").onclick = () => { S.sel = null; render(); };
$("#days").onclick = ev => {
  const b = ev.target.closest("[data-day]"); if (!b) return;
  const k = b.dataset.day; S.sel = S.sel === k ? null : k;
  const d = parseYmd(k); if (d.getMonth() !== S.month.getMonth()) S.month = new Date(d.getFullYear(), d.getMonth(), 1);
  render();
};
$("#list").onclick = ev => {
  const s = ev.target.closest("[data-id]"); if (s) return openDetail(s.dataset.id);
  const a = ev.target.closest("[data-add]"); if (a) return openAdd(a.dataset.add);
  if (ev.target.closest("[data-signin]")) openSignIn();
};
$("#closeP").onclick = closePanel; $("#scrim").onclick = closePanel;
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !$("#panel").hidden) closePanel(); });

render();
renderWho();

sb.channel("afters")
  .on("postgres_changes", { event: "*", schema: "public", table: "events" }, reloadSoon)
  .on("postgres_changes", { event: "*", schema: "public", table: "rsvps" }, reloadSoon)
  .subscribe();

let lastUser;
sb.auth.onAuthStateChange((_evt, session) => {
  const uid = session?.user?.id || null;
  if (uid === lastUser && _evt !== "INITIAL_SESSION") return;
  lastUser = uid;
  setTimeout(() => refreshAuth(session), 0);
});
