require("dotenv").config();

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 24) {
  console.error("Set JWT_SECRET in .env (at least 24 characters).");
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "hotel_booking",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "frontend")));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}
function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies.token;
    if (!token) return res.status(401).json({ message: "Please log in to continue." });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      if (requiredRole && req.user.role !== requiredRole) {
        return res.status(403).json({ message: "You do not have permission for this action." });
      }
      next();
    } catch {
      return res.status(401).json({ message: "Your session has expired. Please log in again." });
    }
  };
}
const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(value));
const asPositiveInt = value => Number.isInteger(Number(value)) && Number(value) > 0;
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function roomIsFree(conn, roomId, checkIn, checkOut, excludeBookingId = null) {
  const params = [roomId, checkOut, checkIn];
  let sql = `SELECT COUNT(*) AS count FROM bookings
             WHERE room_id = ? AND status = 'confirmed'
             AND check_in < ? AND check_out > ?`;
  if (excludeBookingId) { sql += " AND booking_id <> ?"; params.push(excludeBookingId); }
  const [rows] = await conn.execute(sql, params);
  return Number(rows[0].count) === 0;
}
async function calculateAmount(conn, roomId, checkIn, checkOut) {
  const [rows] = await conn.execute("SELECT price, status FROM rooms WHERE room_id = ?", [roomId]);
  if (!rows.length) throw Object.assign(new Error("Room not found."), { status: 404 });
  if (rows[0].status !== "available") throw Object.assign(new Error("This room is currently under maintenance."), { status: 409 });
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  const nights = Math.round((end - start) / 86400000);
  if (nights < 1 || nights > 365) throw Object.assign(new Error("Choose a valid stay of 1 to 365 nights."), { status: 400 });
  return { nights, total: Number((Number(rows[0].price) * nights).toFixed(2)) };
}

// Health check
app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "connected" });
}));

// Customer registration and login
app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || String(name).trim().length < 2 || String(name).length > 100 ||
      !isEmail(email) || !/^[0-9+\-\s()]{7,20}$/.test(String(phone || "")) ||
      typeof password !== "string" || password.length < 8 || password.length > 72) {
    return res.status(400).json({ message: "Enter a valid name, email, phone number and password (at least 8 characters)." });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    const [result] = await pool.execute(
      "INSERT INTO customers (name,email,phone,password) VALUES (?,?,?,?)",
      [String(name).trim(), String(email).trim().toLowerCase(), String(phone).trim(), hash]
    );
    const user = { id: result.insertId, name: String(name).trim(), email: String(email).trim().toLowerCase(), role: "customer" };
    res.status(201).json({ message: "Registration successful.", token: signToken(user), user });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "That email address is already registered." });
    throw err;
  }
}));

app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const { email, password, role = "customer" } = req.body;
  if (!isEmail(email) || typeof password !== "string") return res.status(400).json({ message: "Enter a valid email and password." });

  if (role === "admin") {
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@pavanihotel.com").toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
    if (String(email).toLowerCase() !== adminEmail || password !== adminPassword) {
      return res.status(401).json({ message: "Invalid administrator credentials." });
    }
    const user = { id: 0, name: process.env.ADMIN_NAME || "Pavani Hotel Admin", email: adminEmail, role: "admin" };
    return res.json({ message: "Admin login successful.", token: signToken(user), user });
  }

  const [rows] = await pool.execute("SELECT customer_id, name, email, password FROM customers WHERE email = ?", [String(email).toLowerCase()]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }
  const user = { id: rows[0].customer_id, name: rows[0].name, email: rows[0].email, role: "customer" };
  res.json({ message: "Login successful.", token: signToken(user), user });
}));

app.get("/api/auth/me", auth(), asyncRoute(async (req, res) => {
  if (req.user.role === "admin") return res.json({ user: req.user });
  const [rows] = await pool.execute("SELECT customer_id, name, email, phone FROM customers WHERE customer_id = ?", [req.user.id]);
  if (!rows.length) return res.status(404).json({ message: "Customer account not found." });
  res.json({ user: { ...rows[0], id: rows[0].customer_id, role: "customer" } });
}));

// Customer profile
app.put("/api/customers/profile", auth("customer"), asyncRoute(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || String(name).trim().length < 2 || !isEmail(email) || !/^[0-9+\-\s()]{7,20}$/.test(String(phone || ""))) {
    return res.status(400).json({ message: "Enter a valid name, email and phone number." });
  }
  const values = [String(name).trim(), String(email).trim().toLowerCase(), String(phone).trim()];
  let sql = "UPDATE customers SET name=?, email=?, phone=?";
  if (password) {
    if (String(password).length < 8 || String(password).length > 72) return res.status(400).json({ message: "New password must contain 8 to 72 characters." });
    sql += ", password=?";
    values.push(await bcrypt.hash(password, 12));
  }
  sql += " WHERE customer_id=?";
  values.push(req.user.id);
  try {
    await pool.execute(sql, values);
    res.json({ message: "Profile updated successfully." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "That email address is already in use." });
    throw err;
  }
}));

// Rooms and date-based availability
app.get("/api/rooms", asyncRoute(async (req, res) => {
  const { checkIn, checkOut, capacity } = req.query;
  let sql = `SELECT r.room_id, r.room_number, r.room_type, r.price, r.capacity, r.status
             FROM rooms r WHERE r.status='available'`;
  const params = [];
  if (capacity) {
    if (!asPositiveInt(capacity)) return res.status(400).json({ message: "Capacity must be a positive number." });
    sql += " AND r.capacity >= ?";
    params.push(Number(capacity));
  }
  if (checkIn || checkOut) {
    if (!validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn) {
      return res.status(400).json({ message: "Enter valid check-in and check-out dates; check-out must be later." });
    }
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM bookings b WHERE b.room_id=r.room_id AND b.status='confirmed'
      AND b.check_in < ? AND b.check_out > ?
    )`;
    params.push(checkOut, checkIn);
  }
  sql += " ORDER BY r.price ASC";
  const [rows] = await pool.execute(sql, params);
  res.json({ rooms: rows });
}));

// Customer booking operations
app.post("/api/bookings", auth("customer"), asyncRoute(async (req, res) => {
  const { roomId, checkIn, checkOut } = req.body;
  if (!asPositiveInt(roomId) || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn) {
    return res.status(400).json({ message: "Select a room and valid check-in/check-out dates." });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [lockedRoom] = await conn.execute("SELECT room_id FROM rooms WHERE room_id=? FOR UPDATE", [Number(roomId)]);
    if (!lockedRoom.length) { await conn.rollback(); return res.status(404).json({ message: "Room not found." }); }
    const free = await roomIsFree(conn, Number(roomId), checkIn, checkOut);
    if (!free) { await conn.rollback(); return res.status(409).json({ message: "Sorry, this room has already been booked for overlapping dates." }); }
    const { total } = await calculateAmount(conn, Number(roomId), checkIn, checkOut);
    const [result] = await conn.execute(
      "INSERT INTO bookings (customer_id,room_id,check_in,check_out,total_amount,status) VALUES (?,?,?,?,?,'confirmed')",
      [req.user.id, Number(roomId), checkIn, checkOut, total]
    );
    await conn.commit();
    res.status(201).json({ message: "Room booked successfully.", bookingId: result.insertId, totalAmount: total });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
}));

app.get("/api/bookings/mine", auth("customer"), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.booking_id,b.check_in,b.check_out,b.total_amount,b.status,
            r.room_number,r.room_type,r.price
     FROM bookings b JOIN rooms r ON r.room_id=b.room_id
     WHERE b.customer_id=? ORDER BY b.created_at DESC`, [req.user.id]
  );
  res.json({ bookings: rows });
}));

app.patch("/api/bookings/:id/cancel", auth("customer"), asyncRoute(async (req, res) => {
  if (!asPositiveInt(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
  const [result] = await pool.execute(
    "UPDATE bookings SET status='cancelled' WHERE booking_id=? AND customer_id=? AND status='confirmed'",
    [req.params.id, req.user.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: "Active booking not found." });
  res.json({ message: "Booking cancelled. The room is now available for those dates." });
}));

// Admin dashboard and complete CRUD
app.get("/api/admin/summary", auth("admin"), asyncRoute(async (_req, res) => {
  const [[customers]] = await pool.query("SELECT COUNT(*) AS total FROM customers");
  const [[rooms]] = await pool.query("SELECT COUNT(*) AS total FROM rooms");
  const [[bookings]] = await pool.query("SELECT COUNT(*) AS total FROM bookings WHERE status='confirmed'");
  const [[revenue]] = await pool.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM bookings WHERE status='confirmed'");
  res.json({ customers: customers.total, rooms: rooms.total, bookings: bookings.total, revenue: revenue.total });
}));

app.get("/api/admin/customers", auth("admin"), asyncRoute(async (_req, res) => {
  const [rows] = await pool.query("SELECT customer_id,name,email,phone,created_at FROM customers ORDER BY customer_id DESC");
  res.json({ customers: rows });
}));
app.post("/api/admin/customers", auth("admin"), asyncRoute(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !isEmail(email) || !/^[0-9+\-\s()]{7,20}$/.test(String(phone || "")) || typeof password !== "string" || password.length < 8 || password.length > 72)
    return res.status(400).json({ message: "Enter valid customer details and a password of at least 8 characters." });
  try {
    const [result] = await pool.execute("INSERT INTO customers(name,email,phone,password) VALUES(?,?,?,?)",
      [String(name).trim(),String(email).toLowerCase(),String(phone).trim(),await bcrypt.hash(password,12)]);
    res.status(201).json({ message: "Customer created.", customerId: result.insertId });
  } catch (err) { if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Email already exists." }); throw err; }
}));
app.put("/api/admin/customers/:id", auth("admin"), asyncRoute(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!asPositiveInt(req.params.id) || !name || !isEmail(email) || !/^[0-9+\-\s()]{7,20}$/.test(String(phone || "")))
    return res.status(400).json({ message: "Enter valid customer details." });
  const values = [String(name).trim(),String(email).toLowerCase(),String(phone).trim()];
  let sql = "UPDATE customers SET name=?,email=?,phone=?";
  if (password) { if (String(password).length < 8 || String(password).length > 72) return res.status(400).json({message:"Password must be at least 8 characters."}); sql += ",password=?"; values.push(await bcrypt.hash(password,12)); }
  sql += " WHERE customer_id=?"; values.push(req.params.id);
  try { const [result] = await pool.execute(sql,values); if (!result.affectedRows) return res.status(404).json({message:"Customer not found."}); res.json({message:"Customer updated."}); }
  catch(err) { if(err.code==="ER_DUP_ENTRY") return res.status(409).json({message:"Email already exists."}); throw err; }
}));
app.delete("/api/admin/customers/:id", auth("admin"), asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM customers WHERE customer_id=?", [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ message: "Customer not found." });
  res.json({ message: "Customer and their booking records deleted." });
}));

app.get("/api/admin/rooms", auth("admin"), asyncRoute(async (_req, res) => {
  const [rows] = await pool.query("SELECT * FROM rooms ORDER BY room_number");
  res.json({ rooms: rows });
}));
app.post("/api/admin/rooms", auth("admin"), asyncRoute(async (req, res) => {
  const { room_number, room_type, price, capacity, status = "available" } = req.body;
  if (!room_number || !room_type || !Number.isFinite(Number(price)) || Number(price) < 0 || !asPositiveInt(capacity) || !["available","maintenance"].includes(status))
    return res.status(400).json({ message: "Enter a room number, type, non-negative price, capacity and valid status." });
  try {
    const [result] = await pool.execute("INSERT INTO rooms(room_number,room_type,price,capacity,status) VALUES(?,?,?,?,?)",
      [String(room_number).trim(),String(room_type).trim(),Number(price),Number(capacity),status]);
    res.status(201).json({ message: "Room added.", roomId: result.insertId });
  } catch (err) { if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Room number already exists." }); throw err; }
}));
app.put("/api/admin/rooms/:id", auth("admin"), asyncRoute(async (req, res) => {
  const { room_number, room_type, price, capacity, status } = req.body;
  if (!asPositiveInt(req.params.id) || !room_number || !room_type || !Number.isFinite(Number(price)) || Number(price) < 0 || !asPositiveInt(capacity) || !["available","maintenance"].includes(status))
    return res.status(400).json({ message: "Enter valid room details." });
  try {
    const [result] = await pool.execute("UPDATE rooms SET room_number=?,room_type=?,price=?,capacity=?,status=? WHERE room_id=?",
      [String(room_number).trim(),String(room_type).trim(),Number(price),Number(capacity),status,req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Room not found." });
    res.json({ message: "Room updated." });
  } catch (err) { if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Room number already exists." }); throw err; }
}));
app.delete("/api/admin/rooms/:id", auth("admin"), asyncRoute(async (req, res) => {
  try {
    const [result] = await pool.execute("DELETE FROM rooms WHERE room_id=?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Room not found." });
    res.json({ message: "Room deleted." });
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2") return res.status(409).json({ message: "This room has booking history. Keep it and set its status to maintenance instead." });
    throw err;
  }
}));

app.get("/api/admin/bookings", auth("admin"), asyncRoute(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT b.booking_id,b.customer_id,b.room_id,b.check_in,b.check_out,b.total_amount,b.status,
            c.name AS customer_name,c.email,r.room_number,r.room_type
     FROM bookings b JOIN customers c ON c.customer_id=b.customer_id
     JOIN rooms r ON r.room_id=b.room_id ORDER BY b.created_at DESC`
  );
  res.json({ bookings: rows });
}));
app.post("/api/admin/bookings", auth("admin"), asyncRoute(async (req, res) => {
  const { customer_id, room_id, check_in, check_out, status = "confirmed" } = req.body;
  if (!asPositiveInt(customer_id) || !asPositiveInt(room_id) || !validDate(check_in) || !validDate(check_out) || check_out <= check_in || !["confirmed","cancelled"].includes(status))
    return res.status(400).json({ message: "Enter valid customer, room, dates and status." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [lockedRoom] = await conn.execute("SELECT room_id FROM rooms WHERE room_id=? FOR UPDATE", [room_id]);
    if (!lockedRoom.length) { await conn.rollback(); return res.status(404).json({message:"Room not found."}); }
    const [[customer]] = await conn.execute("SELECT customer_id FROM customers WHERE customer_id=?", [customer_id]);
    if (!customer) { await conn.rollback(); return res.status(404).json({message:"Customer not found."}); }
    let total = 0;
    if (status === "confirmed") {
      if (!(await roomIsFree(conn, room_id, check_in, check_out))) { await conn.rollback(); return res.status(409).json({message:"Room is not available for those dates."}); }
      total = (await calculateAmount(conn, room_id, check_in, check_out)).total;
    }
    const [result] = await conn.execute("INSERT INTO bookings(customer_id,room_id,check_in,check_out,total_amount,status) VALUES(?,?,?,?,?,?)",
      [customer_id,room_id,check_in,check_out,total,status]);
    await conn.commit(); res.status(201).json({message:"Booking created.",bookingId:result.insertId});
  } catch(err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));
app.put("/api/admin/bookings/:id", auth("admin"), asyncRoute(async (req, res) => {
  const { customer_id, room_id, check_in, check_out, status } = req.body;
  if (!asPositiveInt(req.params.id) || !asPositiveInt(customer_id) || !asPositiveInt(room_id) || !validDate(check_in) || !validDate(check_out) || check_out <= check_in || !["confirmed","cancelled"].includes(status))
    return res.status(400).json({message:"Enter valid booking details."});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [lockedRoom] = await conn.execute("SELECT room_id FROM rooms WHERE room_id=? FOR UPDATE", [room_id]);
    if (!lockedRoom.length) { await conn.rollback(); return res.status(404).json({message:"Room not found."}); }
    const [[customer]] = await conn.execute("SELECT customer_id FROM customers WHERE customer_id=?", [customer_id]);
    if (!customer) { await conn.rollback(); return res.status(404).json({message:"Customer not found."}); }
    let total = 0;
    if (status === "confirmed") {
      if (!(await roomIsFree(conn, room_id, check_in, check_out, Number(req.params.id)))) {
        await conn.rollback(); return res.status(409).json({message:"Room is not available for those dates."});
      }
      total = (await calculateAmount(conn, room_id, check_in, check_out)).total;
    }
    const [result] = await conn.execute("UPDATE bookings SET customer_id=?,room_id=?,check_in=?,check_out=?,total_amount=?,status=? WHERE booking_id=?",
      [customer_id,room_id,check_in,check_out,total,status,req.params.id]);
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({message:"Booking not found."}); }
    await conn.commit(); res.json({message:"Booking updated."});
  } catch(err) { await conn.rollback(); throw err; } finally { conn.release(); }
}));
app.delete("/api/admin/bookings/:id", auth("admin"), asyncRoute(async (req, res) => {
  const [result] = await pool.execute("DELETE FROM bookings WHERE booking_id=?", [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({message:"Booking not found."});
  res.json({message:"Booking record deleted."});
}));

// Friendly fallback and central error handler
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "frontend", "index.html")));
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: status === 500 ? "Server error. Check the server console and database connection." : err.message });
});

async function start() {
  try {
    await pool.query("SELECT 1");
    app.listen(PORT, () => console.log(`Pavani Hotel Booking System running at http://localhost:${PORT}`));
  } catch (err) {
    console.error("Could not connect to MySQL. Check your .env settings and run database.sql.", err.message);
    process.exit(1);
  }
}
start();
