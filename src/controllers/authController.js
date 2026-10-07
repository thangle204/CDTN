const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const register = async (req, res) => {
  try {
    const { email, password, fullName, username } = req.body;
    console.log(req.body);

    // Validate input
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    // Kiểm tra email đã tồn tại
    const [existingUsers] = await db.query(
      "SELECT user_id FROM users WHERE email = ?",
      [email]
    );
    console.log(22);
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email đã được sử dụng",
      });
    }
    console.log(30);
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log(32);
    // Thêm user mới
    const [result] = await db.query(
      "INSERT INTO users (email, username, password, full_name, role) VALUES (?, ?, ?, ?, 'customer')",
      [email, username, hashedPassword, fullName]
    );
    console.log(38);
    res.status(201).json({
      success: true,
      message: "Đăng ký tài khoản thành công",
      data: {
        id: result.insertId,
        email,
        fullName,
        role: "user",
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Kiểm tra email và password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    // Tìm user theo email
    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    const user = users[0];

    // Kiểm tra mật khẩu
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    // Tạo token với đầy đủ thông tin
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log("Token created with user_id:", user.user_id);

    res.json({
      success: true,
      message: "Đăng nhập thành công",
      data: {
        token,
        user: {
          user_id: user.user_id,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi đăng nhập",
      error: error.message,
    });
  }
};

// Lấy thông tin người dùng
const getUserProfile = async (req, res) => {
  try {
    // Lấy user_id từ token đã decode trong middleware
    const userId = req.user.user_id;

    const [user] = await db.query(
      "SELECT user_id, username, email, full_name, phone, address, role, created_at FROM users WHERE user_id = ?",
      [userId]
    );

    if (!user[0]) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin người dùng",
      });
    }

    res.json({
      success: true,
      data: {
        user_id: user[0].user_id,
        username: user[0].username,
        email: user[0].email,
        fullName: user[0].full_name,
        phone: user[0].phone,
        address: user[0].address,
        role: user[0].role,
        createdAt: user[0].created_at,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy thông tin người dùng",
    });
  }
};

// Cập nhật thông tin người dùng
const updateUserProfile = async (req, res) => {
  const userId = req.user.user_id;
  const { username, email, fullName, phone, address } = req.body;

  try {
    await db.query(
      "UPDATE users SET username = ?, email = ?, full_name = ?, phone = ?, address = ? WHERE user_id = ?",
      [username, email, fullName, phone, address, userId]
    );

    res.json({
      success: true,
      message: "Cập nhật thông tin thành công",
      data: {
        user_id: userId,
        username,
        email,
        fullName,
        phone,
        address,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi cập nhật thông tin",
    });
  }
};

// Xóa tài khoản
const deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user.user_id;

    await db.query("DELETE FROM users WHERE user_id = ?", [userId]);

    res.json({
      success: true,
      message: "Xóa tài khoản thành công",
    });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa tài khoản",
    });
  }
};

const updatePasswordByUserId = async (req, res) => {
  const { id } = req.params; // Lấy user_id từ URL
  const { newPassword } = req.body; // Nhận mật khẩu mới từ body

  if (!newPassword)
    return res.status(400).json({ error: "Thiếu mật khẩu mới" });

  const hashedPassword = await bcrypt.hash(newPassword, 10); // 🔥 Mã hóa mật khẩu mới

  db.query(
    "UPDATE users SET password = ? WHERE user_id = ?",
    [hashedPassword, id],
    (err, result) => {
      if (err) return res.status(500).json({ error: "Lỗi cập nhật mật khẩu" });

      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Không tìm thấy user" });

      res.json({ message: "Cập nhật mật khẩu thành công" });
    }
  );
};

module.exports = {
  register,
  login,
  getUserProfile,
  updateUserProfile,
  deleteUserAccount,
  updatePasswordByUserId,
};
