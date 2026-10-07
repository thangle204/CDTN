const db = require("../config/db");
const bcrypt = require("bcryptjs");

const getAllUsers = async (req, res) => {
  try {
    console.log("Getting all users, requested by:", req.user.user_id);

    const [users] = await db.query(
      "SELECT user_id, username, email, full_name, phone, address, role, created_at FROM users"
    );

    console.log("Found users:", users.length);

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Error getting all users:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách người dùng",
      error: error.message,
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log("Deleting user:", userId, "by admin:", req.user.user_id);

    // Kiểm tra xem user có tồn tại không
    const [user] = await db.query("SELECT role FROM users WHERE user_id = ?", [
      userId,
    ]);

    if (!user[0]) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy người dùng",
      });
    }

    // Không cho phép xóa tài khoản admin
    if (user[0].role.toLowerCase() === "admin") {
      return res.status(403).json({
        success: false,
        message: "Không thể xóa tài khoản admin",
      });
    }

    // Xóa user
    await db.query("DELETE FROM users WHERE user_id = ?", [userId]);

    res.json({
      success: true,
      message: "Xóa người dùng thành công",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi xóa người dùng",
      error: error.message,
    });
  }
};

const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    console.log("Getting profile for user_id:", userId);

    const [user] = await db.query(
      "SELECT user_id, username, email, full_name, phone, address, role, created_at FROM users WHERE user_id = ?",
      [userId]
    );

    console.log("User data from DB:", user[0]);

    if (!user[0]) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin người dùng",
      });
    }

    // Trả về đúng tên trường như trong database
    res.json({
      success: true,
      data: {
        user_id: user[0].user_id,
        username: user[0].username,
        email: user[0].email,
        full_name: user[0].full_name,
        phone: user[0].phone || null,
        address: user[0].address || null,
        role: user[0].role,
        created_at: user[0].created_at,
      },
    });
  } catch (error) {
    console.error("Lỗi khi lấy thông tin user:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy thông tin người dùng",
      error: error.message,
    });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { full_name, phone, address } = req.body;

    console.log("Updating profile for user_id:", userId, "with data:", {
      full_name,
      phone,
      address,
    });

    // ĐÃ SỬA: Bỏ cập nhật trường 'role = ?' để tránh lỗi sập server và bảo mật tài khoản
    await db.query(
      "UPDATE users SET full_name = ?, phone = ?, address = ? WHERE user_id = ?",
      [full_name, phone, address, userId]
    );

    // Lấy thông tin user sau khi cập nhật
    const [updatedUser] = await db.query(
      "SELECT user_id, username, email, full_name, phone, address, role, created_at FROM users WHERE user_id = ?",
      [userId]
    );

    console.log("Updated user data từ DB:", updatedUser[0]);

    res.json({
      success: true,
      message: "Cập nhật thông tin thành công",
      data: {
        user_id: updatedUser[0].user_id,
        username: updatedUser[0].username,
        email: updatedUser[0].email,
        full_name: updatedUser[0].full_name,
        phone: updatedUser[0].phone || null,
        address: updatedUser[0].address || null,
        role: updatedUser[0].role,
        created_at: updatedUser[0].created_at,
      },
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật thông tin user:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi cập nhật thông tin",
      error: error.message,
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { currentPassword, newPassword } = req.body;

    // Lấy mật khẩu hiện tại
    const [user] = await db.query(
      "SELECT password FROM users WHERE user_id = ?",
      [userId]
    );

    // Kiểm tra mật khẩu hiện tại
    const isValid = await bcrypt.compare(currentPassword, user[0].password);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Mật khẩu hiện tại không đúng",
      });
    }

    // Mã hóa mật khẩu mới
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Cập nhật mật khẩu
    await db.query("UPDATE users SET password = ? WHERE user_id = ?", [
      hashedPassword,
      userId,
    ]);

    res.json({
      success: true,
      message: "Đổi mật khẩu thành công",
    });
  } catch (error) {
    console.error("Lỗi khi đổi mật khẩu:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi đổi mật khẩu",
      error: error.message,
    });
  }
};

module.exports = {
  getAllUsers,
  deleteUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
};
