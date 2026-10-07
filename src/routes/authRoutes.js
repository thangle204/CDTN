const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const isAdmin = require("../middleware/adminMiddleware");
const {
  register,
  login,
  getUserProfile,
  updateUserProfile,
  deleteUserAccount,
  updatePasswordByUserId,
} = require("../controllers/authController");

// Routes
router.post("/register", register);
router.post("/login", login);
router.get("/profile", verifyToken, getUserProfile);
router.put("/profile", verifyToken, updateUserProfile);
router.delete("/profile", verifyToken, deleteUserAccount);
router.put("/update-password/:id", updatePasswordByUserId);

// Admin routes
router.get("/admin/users", verifyToken, isAdmin, async (req, res) => {
  try {
    // TODO: Thêm logic lấy danh sách users từ database
    res.json({ message: "Lấy danh sách người dùng thành công" });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server" });
  }
});

module.exports = router;
