import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import "./AdminUsers.css";

const AdminUsers = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }

    // Kiểm tra token có hợp lệ không
    try {
      const tokenData = JSON.parse(atob(token.split(".")[1]));
      const expirationTime = tokenData.exp * 1000;

      console.log("Token data:", {
        user_id: tokenData.user_id,
        email: tokenData.email,
        role: tokenData.role,
        exp: new Date(expirationTime).toLocaleString(),
      });

      if (Date.now() >= expirationTime) {
        setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại");
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/login");
        return;
      }

      if (tokenData.role.toLowerCase() !== "admin") {
        navigate("/");
        return;
      }
    } catch (error) {
      console.error("Lỗi khi kiểm tra token:", error);
      setError("Token không hợp lệ. Vui lòng đăng nhập lại");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      navigate("/login");
      return;
    }

    fetchUsers();
  }, [navigate, token]);

  const fetchUsers = async () => {
    try {
      console.log(
        "Fetching users with token:",
        token?.substring(0, 20) + "..."
      );

      const response = await axios.get("http://localhost:5000/api/users", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      console.log("Users API Response:", {
        status: response.status,
        headers: response.headers,
        data: response.data,
      });

      if (response.data.success) {
        setUsers(response.data.data);
      } else {
        setError(response.data.message || "Không thể tải danh sách người dùng");
      }
      setLoading(false);
    } catch (error) {
      console.error("Error fetching users:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      if (error.response?.status === 401) {
        setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại");
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/login");
      } else {
        setError(
          error.response?.data?.message || "Không thể tải danh sách người dùng"
        );
      }
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (window.confirm("Bạn có chắc chắn muốn xóa người dùng này?")) {
      try {
        const response = await axios.delete(
          `http://localhost:5000/api/users/${userId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (response.data.success) {
          alert("Xóa người dùng thành công!");
          fetchUsers(); // Refresh danh sách
        }
      } catch (error) {
        console.error("Error deleting user:", error);
        alert(
          error.response?.data?.message || "Có lỗi xảy ra khi xóa người dùng"
        );
      }
    }
  };

  if (loading) return <div className="loading">Đang tải...</div>;
  if (error)
    return (
      <div className="error">
        <p>{error}</p>
        <button onClick={fetchUsers} className="retry-button">
          Thử lại
        </button>
      </div>
    );

  return (
    <div className="admin-users-page">
      <div className="admin-sidebar">
        <div className="admin-profile">
          <div className="admin-avatar">👤</div>
          <div className="admin-info">
            <h3>{user?.full_name}</h3>
            <p>Admin</p>
          </div>
        </div>
        <nav className="admin-nav">
          <Link to="/admin" className="nav-item">
            Dashboard
          </Link>
          <Link to="/admin/products" className="nav-item">
            Sản phẩm
          </Link>
          <Link to="/admin/orders" className="nav-item">
            Đơn hàng
          </Link>
          <Link to="/admin/users" className="nav-item active">
            Người dùng
          </Link>
        </nav>
      </div>

      <div className="admin-content">
        <div className="admin-header">
          <h1>Quản lý người dùng</h1>
        </div>

        <div className="users-table-container">
          <table className="users-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tên đăng nhập</th>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Số điện thoại</th>
                <th>Địa chỉ</th>
                <th>Vai trò</th>
                <th>Ngày tạo</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td>{user.user_id}</td>
                  <td>{user.username}</td>
                  <td>{user.full_name || "Chưa cập nhật"}</td>
                  <td>{user.email}</td>
                  <td>{user.phone || "Chưa cập nhật"}</td>
                  <td>{user.address || "Chưa cập nhật"}</td>
                  <td>
                    {user.role === "admin" ? "Quản trị viên" : "Khách hàng"}
                  </td>
                  <td>
                    {new Date(user.created_at).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="action-buttons">
                    <button
                      className="delete-btn"
                      onClick={() => handleDeleteUser(user.user_id)}
                      disabled={user.role === "admin"}
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminUsers;
