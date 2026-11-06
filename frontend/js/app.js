const API = "/api";
const state = { token: localStorage.getItem("pavani_token"), user: JSON.parse(localStorage.getItem("pavani_user") || "null"), authMode: "login", adminTab: "rooms", editRecord: null, records: [] };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
const todayString = today.toISOString().slice(0,10);
$("#checkIn").min = todayString; $("#checkOut").min = todayString;
$("#year").textContent = new Date().getFullYear();

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(API + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2800); }
function setNotice(selector, message, type = "") { const el = $(selector); el.textContent = message; el.className = "notice " + type; }
function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModals() { $$(".modal").forEach(m => m.classList.add("hidden")); }
$$("[data-close]").forEach(btn => btn.addEventListener("click", closeModals));
$$(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) closeModals(); }));

function updateNavigation() {
  const loggedIn = !!state.user;
  $("#loginOpen").classList.toggle("hidden", loggedIn);
  $("#registerOpen").classList.toggle("hidden", loggedIn);
  $("#logoutBtn").classList.toggle("hidden", !loggedIn);
  $("#userLabel").textContent = loggedIn ? `Hello, ${state.user.name}` : "";
  $$(".customer-only").forEach(el => el.classList.toggle("hidden", !loggedIn || state.user.role !== "customer"));
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", !loggedIn || state.user.role !== "admin"));
  $("#my-bookings").classList.toggle("hidden", !loggedIn || state.user.role !== "customer");
  $("#admin").classList.toggle("hidden", !loggedIn || state.user.role !== "admin");
  if (loggedIn && state.user.role === "customer") loadMyBookings();
  if (loggedIn && state.user.role === "admin") loadAdmin();
}
function saveSession(data) {
  state.token = data.token; state.user = data.user;
  localStorage.setItem("pavani_token", state.token); localStorage.setItem("pavani_user", JSON.stringify(state.user));
  closeModals(); updateNavigation(); toast(data.message || "Welcome!");
}
function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem("pavani_token"); localStorage.removeItem("pavani_user");
  updateNavigation(); toast("You have been logged out.");
}
$("#logoutBtn").addEventListener("click", logout);

function setAuthMode(mode) {
  state.authMode = mode;
  $("#authTitle").textContent = mode === "register" ? "Create your account" : mode === "admin" ? "Administrator login" : "Sign in";
  $("#nameField").classList.toggle("hidden", mode !== "register");
  $("#phoneField").classList.toggle("hidden", mode !== "register");
  $$("[data-auth]").forEach(b => b.classList.toggle("active", b.dataset.auth === mode));
  $("#authForm button[type=submit]").textContent = mode === "register" ? "Create account" : "Continue";
  setNotice("#authMessage", "");
}
$("#loginOpen").addEventListener("click", () => { setAuthMode("login"); openModal("authModal"); });
$("#registerOpen").addEventListener("click", () => { setAuthMode("register"); openModal("authModal"); });
$$("[data-auth]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault(); const form = new FormData(e.currentTarget);
  const body = Object.fromEntries(form.entries());
  try {
    const endpoint = state.authMode === "register" ? "/auth/register" : "/auth/login";
    if (state.authMode === "admin") body.role = "admin";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
    saveSession(result);
  } catch (err) { setNotice("#authMessage", err.message, "error"); }
});

function validSearchDates() {
  const a = $("#checkIn").value, b = $("#checkOut").value;
  if (!a || !b || b <= a) { setNotice("#roomMessage", "Check-out date must be later than check-in date.", "error"); return false; }
  return true;
}
$("#checkIn").addEventListener("change", () => { $("#checkOut").min = $("#checkIn").value || todayString; if ($("#checkOut").value && $("#checkOut").value <= $("#checkIn").value) $("#checkOut").value = ""; });
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); if (validSearchDates()) loadRooms(); });

async function loadRooms() {
  const params = new URLSearchParams();
  if ($("#checkIn").value) params.set("checkIn", $("#checkIn").value);
  if ($("#checkOut").value) params.set("checkOut", $("#checkOut").value);
  if ($("#capacity").value) params.set("capacity", $("#capacity").value);
  try {
    const data = await api("/rooms?" + params.toString());
    renderRooms(data.rooms);
    setNotice("#roomMessage", `${data.rooms.length} room(s) available for your search.`, "success");
  } catch (err) { setNotice("#roomMessage", err.message, "error"); }
}
function renderRooms(rooms) {
  const grid = $("#roomsGrid");
  if (!rooms.length) { grid.innerHTML = '<div class="empty-state">No rooms match these dates and guest requirements. Try another date range.</div>'; return; }
  grid.innerHTML = rooms.map((room, i) => `
    <article class="room-card">
      <div class="room-image" style="background:linear-gradient(135deg,${["#c8c4b7,#7e9588","#c9b9a4,#8c9a8e","#c5c7bc,#71877c"][i%3]})"><span>${["Ⅰ","Ⅱ","Ⅲ"][i%3]}</span></div>
      <div class="room-body"><span class="room-type">${escapeHtml(room.room_type.toUpperCase())}</span>
        <h3>Room ${escapeHtml(room.room_number)}</h3>
        <div class="room-meta"><span>♧ ${room.capacity} guests</span><span>Room #${escapeHtml(room.room_number)}</span></div>
        <div class="room-bottom"><div class="price">${money(room.price)} <small>/ night</small></div>
        <button class="btn btn-primary book-btn" data-room="${room.room_id}">Book now</button></div>
      </div>
    </article>`).join("");
  $$(".book-btn").forEach(btn => btn.addEventListener("click", () => bookRoom(Number(btn.dataset.room))));
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function bookRoom(roomId) {
  if (!state.user || state.user.role !== "customer") { setAuthMode("login"); openModal("authModal"); setNotice("#authMessage", "Please sign in as a customer to book a room."); return; }
  if (!validSearchDates()) return;
  const nights = Math.round((new Date($("#checkOut").value) - new Date($("#checkIn").value)) / 86400000);
  if (!confirm(`Confirm booking for ${nights} night(s)? The final amount is calculated by the server.`)) return;
  try {
    const result = await api("/bookings", { method: "POST", body: JSON.stringify({ roomId, checkIn: $("#checkIn").value, checkOut: $("#checkOut").value }) });
    toast(`${result.message} Total: ${money(result.totalAmount)}`);
    await loadRooms(); await loadMyBookings();
  } catch (err) { toast(err.message); }
}

async function loadMyBookings() {
  try {
    const data = await api("/bookings/mine");
    $("#myBookingsList").innerHTML = data.bookings.length ? data.bookings.map(b => `
      <div class="booking-card"><div><h3>${escapeHtml(b.room_type)} · Room ${escapeHtml(b.room_number)}</h3>
      <p>Booking #${b.booking_id} · ${b.check_in} to ${b.check_out}<br>Total: ${money(b.total_amount)}</p></div>
      <div><span class="status-pill ${b.status === "cancelled" ? "cancelled" : ""}">${b.status}</span>
      ${b.status === "confirmed" ? `<button class="small-btn delete cancel-booking" data-id="${b.booking_id}">Cancel</button>` : ""}</div></div>`).join("") : '<div class="empty-state">You have no bookings yet. Explore rooms above to plan your stay.</div>';
    $$(".cancel-booking").forEach(btn => btn.addEventListener("click", () => cancelBooking(btn.dataset.id)));
  } catch (err) { $("#myBookingsList").textContent = err.message; }
}
async function cancelBooking(id) {
  if (!confirm("Are you sure you want to cancel this reservation?")) return;
  try { const result = await api(`/bookings/${id}/cancel`, { method: "PATCH" }); toast(result.message); loadMyBookings(); loadRooms(); }
  catch (err) { toast(err.message); }
}

$("#profileOpen").addEventListener("click", async () => {
  try {
    const data = await api("/auth/me"), u = data.user;
    const form = $("#profileForm");
    ["name","email","phone"].forEach(k => form.elements[k].value = u[k] || "");
    form.elements.password.value = ""; setNotice("#profileMessage", ""); openModal("profileModal");
  } catch (err) { toast(err.message); }
});
$("#profileForm").addEventListener("submit", async e => {
  e.preventDefault(); const body = Object.fromEntries(new FormData(e.currentTarget).entries());
  try {
    await api("/customers/profile", { method: "PUT", body: JSON.stringify(body) });
    state.user.name = body.name; state.user.email = body.email;
    localStorage.setItem("pavani_user", JSON.stringify(state.user));
    updateNavigation(); closeModals(); toast("Profile updated.");
  } catch (err) { setNotice("#profileMessage", err.message, "error"); }
});

async function loadAdmin() {
  try {
    const s = await api("/admin/summary");
    $("#adminStats").innerHTML = [
      ["CUSTOMERS",s.customers],["ROOMS",s.rooms],["ACTIVE BOOKINGS",s.bookings],["BOOKING VALUE",money(s.revenue)]
    ].map(([label,value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
    await loadAdminTab(state.adminTab);
  } catch (err) { toast(err.message); }
}
$$(".tab").forEach(tab => tab.addEventListener("click", () => {
  state.adminTab = tab.dataset.tab; $$(".tab").forEach(t => t.classList.toggle("active", t === tab)); loadAdminTab(state.adminTab);
}));
async function loadAdminTab(tab) {
  const config = { rooms: ["/admin/rooms","rooms","Room management","room"], bookings: ["/admin/bookings","bookings","Booking management","booking"], customers: ["/admin/customers","customers","Customer management","customer"] }[tab];
  try {
    const data = await api(config[0]); state.records = data[config[1]];
    $("#adminTableTitle").textContent = config[2]; $("#addRecordBtn").textContent = "+ Add " + config[3];
    renderAdminTable(tab, state.records);
  } catch (err) { $("#adminTable").textContent = err.message; }
}
function renderAdminTable(tab, rows) {
  const table = $("#adminTable");
  if (!rows.length) { table.innerHTML = '<div class="empty-state">No records found.</div>'; return; }
  let headers, cells;
  if (tab === "rooms") {
    headers = ["ID","ROOM","TYPE","PRICE / NIGHT","CAPACITY","STATUS","ACTIONS"];
    cells = r => [r.room_id,r.room_number,r.room_type,money(r.price),r.capacity,r.status];
  } else if (tab === "customers") {
    headers = ["ID","NAME","EMAIL","PHONE","CREATED","ACTIONS"];
    cells = r => [r.customer_id,r.name,r.email,r.phone,String(r.created_at || "").slice(0,10)];
  } else {
    headers = ["ID","CUSTOMER","ROOM","CHECK-IN","CHECK-OUT","TOTAL","STATUS","ACTIONS"];
    cells = r => [r.booking_id,`${r.customer_name} (${r.email})`,`${r.room_type} #${r.room_number}`,r.check_in,r.check_out,money(r.total_amount),r.status];
  }
  table.innerHTML = `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => {
    const values = cells(r); const id = r[tab === "rooms" ? "room_id" : tab === "customers" ? "customer_id" : "booking_id"];
    return `<tr>${values.map(v=>`<td>${escapeHtml(v)}</td>`).join("")}<td><div class="table-actions"><button class="small-btn edit-record" data-id="${id}">Edit</button><button class="small-btn delete delete-record" data-id="${id}">Delete</button></div></td></tr>`;
  }).join("")}</tbody></table>`;
  $$(".edit-record").forEach(b => b.addEventListener("click", () => openRecordForm(tab, Number(b.dataset.id))));
  $$(".delete-record").forEach(b => b.addEventListener("click", () => deleteRecord(tab, Number(b.dataset.id))));
}
$("#addRecordBtn").addEventListener("click", () => openRecordForm(state.adminTab));
function openRecordForm(tab, id = null) {
  const record = id ? state.records.find(r => Number(r[tab === "rooms" ? "room_id" : tab === "customers" ? "customer_id" : "booking_id"]) === id) : null;
  state.editRecord = { tab, id };
  const fields = {
    rooms: [
      ["room_number","Room number","text"],["room_type","Room type","text"],["price","Price per night (₹)","number"],["capacity","Guest capacity","number"],["status","Status","select",["available","maintenance"]]
    ],
    customers: [["name","Full name","text"],["email","Email","email"],["phone","Phone","tel"],["password","Password (required for new customer)","password"]],
    bookings: [["customer_id","Customer ID","number"],["room_id","Room ID","number"],["check_in","Check-in","date"],["check_out","Check-out","date"],["status","Status","select",["confirmed","cancelled"]]]
  }[tab];
  $("#recordTitle").textContent = `${id ? "Edit" : "Add"} ${tab.slice(0,-1)}`;
  $("#recordForm").innerHTML = fields.map(([name,label,type,opts]) => {
    const value = record?.[name] ?? (name === "status" ? (tab === "rooms" ? "available" : "confirmed") : "");
    if (type === "select") return `<label>${label}<select name="${name}" required>${opts.map(o=>`<option ${o===value?"selected":""}>${o}</option>`).join("")}</select></label>`;
    const required = name === "password" && id ? "" : "required";
    return `<label>${label}<input name="${name}" type="${type}" ${type==="number"?"min='0' step='0.01'":""} value="${escapeHtml(name==="password"?"":value)}" ${required}></label>`;
  }).join("") + '<button class="btn btn-primary full-btn">Save record</button>';
  setNotice("#recordMessage", ""); openModal("recordModal");
  $("#recordForm").onsubmit = async e => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    if (tab === "rooms") { body.price = Number(body.price); body.capacity = Number(body.capacity); }
    if (tab === "bookings") { body.customer_id = Number(body.customer_id); body.room_id = Number(body.room_id); }
    try {
      const endpoint = `/admin/${tab}` + (id ? `/${id}` : "");
      await api(endpoint, { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
      closeModals(); toast(`${tab.slice(0,-1)} saved.`); loadAdmin();
    } catch (err) { setNotice("#recordMessage", err.message, "error"); }
  };
}
async function deleteRecord(tab, id) {
  if (!confirm(`Permanently delete this ${tab.slice(0,-1)} record?`)) return;
  try { await api(`/admin/${tab}/${id}`, { method: "DELETE" }); toast("Record deleted."); loadAdmin(); }
  catch (err) { toast(err.message); }
}

$("#menuToggle").addEventListener("click", () => $("#mainNav").classList.toggle("open"));
$("#mainNav").addEventListener("click", e => { if (e.target.tagName === "A") $("#mainNav").classList.remove("open"); });

(async function init() {
  if (state.token) {
    try { const data = await api("/auth/me"); state.user = data.user; localStorage.setItem("pavani_user", JSON.stringify(state.user)); }
    catch { logout(); }
  }
  updateNavigation(); loadRooms();
})();
