const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/adminMiddleware");
const multer = require("multer");
const path = require("path");
const {
  getProductImage,
  uploadProductImage,
} = require("../controllers/imageController");

// Cấu hình multer để upload file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: function (req, file, cb) {
    // Tạo tên file unique bằng timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// Kiểm tra loại file
const fileFilter = (req, file, cb) => {
  // Chấp nhận chỉ image files
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh!"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // Giới hạn 5MB
  },
});

// Route để lấy ảnh
router.get("/:filename", getProductImage);

// Route để upload ảnh (yêu cầu đăng nhập)
router.post("/upload", verifyToken, upload.single("image"), uploadProductImage);

module.exports = router;
