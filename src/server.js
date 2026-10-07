require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connection = require("./config/db");
const colors = require("colors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();

// Middleware cơ bản
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("Đã tạo thư mục uploads:", uploadsDir);
}

// Log thông tin uploads directory
console.log("Đường dẫn thư mục uploads:", uploadsDir);
fs.readdir(uploadsDir, (err, files) => {
  if (err) {
    console.error("Lỗi khi đọc thư mục uploads:", err);
  } else {
    console.log("Danh sách file trong thư mục uploads:", files);
  }
});

// Cấu hình CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    return res.status(200).json({});
  }
  next();
});

// Phục vụ file tĩnh - đặt trước các routes
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/images", express.static(path.join(__dirname, "public", "images")));
// Log mọi request để debug
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Kiểm tra kết nối database trước khi xử lý request
app.use(async (req, res, next) => {
  try {
    const conn = await connection.getConnection();
    await conn.ping();
    conn.release();
    next();
  } catch (error) {
    console.error("Lỗi kết nối database:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi kết nối database",
    });
  }
});

// Import routes
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const ImageRoutes = require("./routes/ImageRoutes");
const userRoutes = require("./routes/userRoutes");

// Dùng routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/images", ImageRoutes);

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "../build")));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../build/index.html"));
});

// Error handling cho multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File quá lớn. Giới hạn là 5MB",
      });
    }
  }
  next(error);
});

// Xử lý lỗi 404
app.use((req, res, next) => {
  console.log("404 Not Found:", req.originalUrl);
  res.status(404).json({
    success: false,
    message: "Không tìm thấy tài nguyên",
  });
});

// Xử lý lỗi chung
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    message: "Lỗi server",
    error: err.message,
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server đang chạy trên port ${PORT}`);
});
