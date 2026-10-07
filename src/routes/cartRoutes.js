const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  updateCartQuantity,
} = require("../controllers/cartController");

// Lấy giỏ hàng của user
router.get("/", verifyToken, getCart);

// Thêm sản phẩm vào giỏ hàng
router.post("/", verifyToken, addToCart);

// Cập nhật số lượng sản phẩm trong giỏ hàng
router.put("/:itemId", verifyToken, updateCartItem);

// Xóa sản phẩm khỏi giỏ hàng
router.delete("/:itemId", verifyToken, removeFromCart);

// Cập nhật số lượng sản phẩm trong giỏ hàng
router.put("/:cartId", verifyToken, updateCartQuantity);

module.exports = router;
