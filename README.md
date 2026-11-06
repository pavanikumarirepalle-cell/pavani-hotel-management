# Pavani Online Hotel Room Booking Management System

A responsive hotel booking application built with HTML, CSS, vanilla JavaScript, Node.js, Express.js and MySQL (`mysql2`).

## Features

### Customer
- Register and log in; passwords are hashed with bcrypt.
- Edit name, email, phone and optionally change password.
- Search rooms by check-in, check-out and guest capacity.
- Book a room and view the server-calculated total.
- View booking history and cancel active reservations.

### Administrator
- Admin login configured with environment variables.
- Dashboard summary for customers, rooms, active bookings and booking value.
- Full CRUD for customers, rooms and bookings.
- Booking edits and creations validate availability and recalculate the amount.

### Booking and security rules
- A room is available only when its room status is `available` and no confirmed booking overlaps the requested dates.
- Date overlap is checked using `existing.check_in < requested.check_out AND existing.check_out > requested.check_in`. A guest checking out on the same date another guest checks in is allowed.
- Booking amounts are calculated on the server using the room's current nightly price and number of nights.
- Booking creation and admin booking changes use database transactions.
- Customer passwords are bcrypt-hashed. API queries use parameterized SQL.
- JWT sessions expire after 8 hours. Admin credentials are environment-configured, so the requested database remains exactly three tables.

> **Availability note:** The `rooms.status` field represents whether a room can be sold or is under maintenance. Date-specific occupancy is calculated from confirmed bookings; the application does not permanently mark a room unavailable after one reservation, because that would incorrectly block later dates.

## Project structure

```text
Pavani_Hotel_Booking_System/
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── database.sql
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Requirements

- Node.js 18 or later (20 LTS recommended)
- MySQL 8.x
- Visual Studio Code (recommended)

## Setup in Windows / VS Code

1. Extract `Pavani_Hotel_Booking_System.zip`.
2. Open the extracted `Pavani_Hotel_Booking_System` folder in VS Code.
3. Open MySQL Workbench and connect to your local MySQL server.
4. Open `database.sql` in Workbench and click the lightning-bolt **Execute** button. This creates `hotel_booking`, the three required tables and five optional sample rooms.
5. In VS Code, open **Terminal → New Terminal** and run:

   ```bash
   npm install
   ```

6. Create a `.env` file in the project root by copying `.env.example`. Update `DB_PASSWORD` to your MySQL password. Set a long, private `JWT_SECRET` (at least 24 characters), and change `ADMIN_PASSWORD`.

   Example:

   ```env
   PORT=3000
   NODE_ENV=development
   JWT_SECRET=use_a_long_random_secret_of_your_own
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   DB_NAME=hotel_booking
   ADMIN_EMAIL=admin@pavanihotel.com
   ADMIN_PASSWORD=ChooseYourOwnStrongPassword
   ADMIN_NAME=Pavani Hotel Admin
   ```

7. Start the application:

   ```bash
   npm start
   ```

   For development with automatic restart:

   ```bash
   npm run dev
   ```

8. Open **http://localhost:3000** in Chrome or Edge. Do not open `index.html` directly; the API must run through Express.

## First login

- Customer: select **Sign up**, create an account, then log in.
- Admin: click **Login → Admin**.
- Admin email/password are the values you set in `.env`. The example defaults are for local setup only; change the password before using the application.

## API overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Register customer |
| POST | `/api/auth/login` | Public | Customer/admin login |
| GET | `/api/auth/me` | Logged in | Current account |
| PUT | `/api/customers/profile` | Customer | Update profile |
| GET | `/api/rooms` | Public | Search available rooms |
| POST | `/api/bookings` | Customer | Create booking |
| GET | `/api/bookings/mine` | Customer | List own bookings |
| PATCH | `/api/bookings/:id/cancel` | Customer | Cancel own booking |
| GET | `/api/admin/summary` | Admin | Dashboard totals |
| GET/POST | `/api/admin/rooms` | Admin | Read/create rooms |
| PUT/DELETE | `/api/admin/rooms/:id` | Admin | Update/delete room |
| GET/POST | `/api/admin/customers` | Admin | Read/create customers |
| PUT/DELETE | `/api/admin/customers/:id` | Admin | Update/delete customer |
| GET/POST | `/api/admin/bookings` | Admin | Read/create bookings |
| PUT/DELETE | `/api/admin/bookings/:id` | Admin | Update/delete bookings |

`GET /api/health` checks the server and MySQL connection.

## Troubleshooting

- **Access denied for user:** check `DB_USER` and `DB_PASSWORD` in `.env`.
- **Unknown database:** execute `database.sql` in MySQL Workbench and confirm `DB_NAME=hotel_booking`.
- **ECONNREFUSED:** make sure the MySQL service is running and `DB_PORT` is correct.
- **Port already in use:** change `PORT=3001` in `.env`, restart, then visit `http://localhost:3001`.
- **npm start says missing script:** make sure the terminal is in the folder containing this project's `package.json`; run `dir` on Windows to verify.
- **Room cannot be deleted:** a room with booking history is protected by the foreign key. Change its status to `maintenance` instead.

## Important production notes

This is a local learning/demo project. Before public deployment, use HTTPS, secure HttpOnly/SameSite cookies instead of browser localStorage for tokens, CSRF protections where applicable, stronger rate limits, audit logging, secret management and a production-grade admin account store. Add payment-provider integration only through a compliant provider; this project does not collect card details.
