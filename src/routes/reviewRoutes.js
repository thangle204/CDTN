const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
} = require("../controllers/reviewController");

// Lấy tất cả reviews của một sản phẩm
router.get("/product/:productId", getProductReviews);

// Thêm review mới (yêu cầu đăng nhập)
router.post("/", verifyToken, createReview);

// Cập nhật review (yêu cầu đăng nhập)
router.put("/:reviewId", verifyToken, updateReview);

// Xóa review (yêu cầu đăng nhập)
router.delete("/:reviewId", verifyToken, deleteReview);

module.exports = router;
