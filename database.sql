CREATE DATABASE IF NOT EXISTS hotel_booking
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotel_booking;

CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rooms (
  room_id INT AUTO_INCREMENT PRIMARY KEY,
  room_number VARCHAR(20) NOT NULL UNIQUE,
  room_type VARCHAR(60) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  capacity INT NOT NULL,
  status ENUM('available','maintenance') NOT NULL DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_room_price CHECK (price >= 0),
  CONSTRAINT chk_room_capacity CHECK (capacity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  room_id INT NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('confirmed','cancelled') NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id)
    REFERENCES customers(customer_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_booking_room FOREIGN KEY (room_id)
    REFERENCES rooms(room_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_booking_dates CHECK (check_out > check_in),
  CONSTRAINT chk_booking_amount CHECK (total_amount >= 0),
  INDEX idx_room_dates_status (room_id, check_in, check_out, status),
  INDEX idx_customer_bookings (customer_id, status)
) ENGINE=InnoDB;

-- Optional sample rooms. Remove this INSERT block if you want an empty rooms table.
INSERT IGNORE INTO rooms (room_number, room_type, price, capacity, status) VALUES
('101','Standard',1800.00,2,'available'),
('102','Deluxe',2800.00,2,'available'),
('201','Family Suite',4500.00,4,'available'),
('202','Executive',3800.00,3,'available'),
('301','Premium Suite',6000.00,4,'available');
