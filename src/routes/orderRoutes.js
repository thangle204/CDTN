const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/adminMiddleware");
const {
  getMyOrders,
  createOrder,
  getAllOrders,
  updateOrderStatus,
  getAdminStats
} = require("../controllers/orderController");

// Route lấy đơn hàng của user
router.get("/my-orders", verifyToken, getMyOrders);

// Route tạo đơn hàng mới
router.post("/", verifyToken, createOrder);

// Admin: Lấy tất cả đơn hàng
router.get("/all", verifyToken, isAdmin, getAllOrders);

router.get("/admin/stats", verifyToken, isAdmin, getAdminStats);
// Admin: Cập nhật trạng thái đơn hàng
router.put("/:orderId/status", verifyToken, isAdmin, updateOrderStatus);

module.exports = router;
