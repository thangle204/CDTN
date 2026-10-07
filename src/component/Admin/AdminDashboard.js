import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import "./AdminDashboard.css";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState({ newOrders: 0, totalRevenue: 0 }); // State lưu thống kê
  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Gọi song song cả API sản phẩm và API thống kê
        const [prodRes, statsRes] = await Promise.all([
          axios.get("http://localhost:5000/api/products"),
          axios.get("http://localhost:5000/api/orders/admin/stats", {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);

        setProducts(prodRes.data.data);
        if (statsRes.data.success) {
          setStats(statsRes.data.data);
        }
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  if (loading) {
    return (
      <div className="admin-dashboard-loading">
        <div className="spinner"></div> 
        <p>Đang đồng bộ dữ liệu...</p>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-sidebar">
        <div className="admin-profile">
          <div className="admin-avatar">👤</div>
          <div className="admin-info">
            <h3>{user?.full_name}</h3>
            <p>Admin</p>
          </div>
        </div>
        <nav className="admin-nav">
          <Link to="/admin" className="nav-item active text-decoration-none">Dashboard</Link>
          <Link to="/admin/products" className="nav-item text-decoration-none">Sản phẩm</Link>
          <Link to="/admin/orders" className="nav-item text-decoration-none">Đơn hàng</Link>
          <Link to="/admin/users" className="nav-item text-decoration-none">Người dùng</Link>
        </nav>
      </div>

      <div className="admin-main">
        <div className="admin-header">
          <h1>Dashboard</h1>
          <button
            className="logout-btn"
            onClick={() => {
              localStorage.removeItem("token");
              localStorage.removeItem("user");
              navigate("/login");
            }}
          >
            Đăng xuất
          </button>
        </div>

        <div className="admin-stats">
          <div className="stat-card">
            <h3>Tổng sản phẩm</h3>
            <p>{products.length}</p>
          </div>
          <div className="stat-card">
            <h3>Đơn hàng mới</h3>
            <p>{stats.newOrders}</p> {/* Thay số 0 bằng dữ liệu thật */}
          </div>
          <div className="stat-card">
            <h3>Doanh thu</h3>
            <p>{stats.totalRevenue.toLocaleString()}đ</p> {/* Thay 0đ bằng dữ liệu thật */}
          </div>
        </div>

        <div className="admin-products">
          <div className="section-header">
            <h2>Quản lý sản phẩm</h2>
          </div>

          <table className="products-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Hình ảnh</th>
                <th>Tên sản phẩm</th>
                <th>Giá</th>
                <th>Thương hiệu</th>
                <th>Tồn kho</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.product_id}>
                  <td>{product.product_id}</td>
                  <td>
                    <img
                      src={
                        product.image?.startsWith('http') 
                          ? product.image 
                          : `http://localhost:5000/uploads/${product.image}`
                      }
                      alt={product.name}
                      className="product-thumbnail"
                      onError={(e) => {
                        // CHẶN NHÁY ẢNH: Nếu đã đổi sang placeholder rồi thì không báo lỗi nữa
                        if (e.target.src !== "http://localhost:5000/images/placeholder.jpg") {
                          e.target.onerror = null; 
                          e.target.src = "http://localhost:5000/images/placeholder.jpg";
                        }
                      }}
                    />
                  </td>
                  <td>{product.name}</td>
                  <td>{product.price.toLocaleString()}đ</td>
                  <td>{product.brand}</td>
                  <td>{product.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;