const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/adminMiddleware");
const userController = require("../controllers/userController");

// Lấy danh sách tất cả users (chỉ admin)
router.get("/", [verifyToken, isAdmin], userController.getAllUsers);

// Xóa user (chỉ admin)
router.delete("/:userId", [verifyToken, isAdmin], userController.deleteUser);

// Lấy thông tin user
router.get("/profile", verifyToken, userController.getUserProfile);

// Cập nhật thông tin user
router.put("/profile", verifyToken, userController.updateUserProfile);

// Đổi mật khẩu
router.put("/change-password", verifyToken, userController.changePassword);

module.exports = router;
