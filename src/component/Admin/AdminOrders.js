import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import "./AdminOrders.css";

const AdminOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!user || user.role.toLowerCase() !== "admin") {
      navigate("/login");
      return;
    }
    fetchOrders();
  }, [navigate, user]);

  const fetchOrders = async () => {
    try {
      console.log(
        "Fetching orders with token:",
        token?.substring(0, 20) + "..."
      );
      const response = await axios.get("http://localhost:5000/api/orders/all", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      console.log("Orders response:", response.data);

      if (response.data.success) {
        setOrders(response.data.data);
      } else {
        setError(response.data.message || "Không thể tải danh sách đơn hàng");
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
      setError(
        error.response?.data?.message || "Không thể tải danh sách đơn hàng"
      );
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      const response = await axios.put(
        `http://localhost:5000/api/orders/${orderId}/status`,
        { status: newStatus },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      if (response.data.success) {
        fetchOrders(); // Refresh orders after status update
      }
    } catch (error) {
      console.error("Error updating order status:", error);
      alert(error.response?.data?.message || "Lỗi khi cập nhật trạng thái");
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toUpperCase()) {
      case "PENDING":
        return "#ffc107";
      case "PROCESSING":
        return "#17a2b8";
      case "SHIPPED":
        return "#007bff";
      case "DELIVERED":
        return "#28a745";
      case "CANCELLED":
        return "#dc3545";
      default:
        return "#6c757d";
    }
  };

  const getStatusText = (status) => {
    switch (status?.toUpperCase()) {
      case "PENDING":
        return "Chờ xác nhận";
      case "PROCESSING":
        return "Đang xử lý";
      case "SHIPPED":
        return "Đang giao";
      case "DELIVERED":
        return "Đã giao";
      case "CANCELLED":
        return "Đã hủy";
      default:
        return "Không xác định";
    }
  };

  if (loading) return <div className="admin-orders-loading">Đang tải...</div>;
  if (error) return <div className="admin-orders-error">{error}</div>;

  return (
    <div className="admin-products-page">
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
          <Link to="/admin/orders" className="nav-item active">
            Đơn hàng
          </Link>
          <Link to="/admin/users" className="nav-item">
            Người dùng
          </Link>
        </nav>
      </div>

      <div className="admin-content">
        <div className="admin-header">
          <h1>Quản lý đơn hàng</h1>
        </div>

        <div className="orders-table-container">
          <table className="orders-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Khách hàng</th>
                <th>Email</th>
                <th>Ngày đặt</th>
                <th>Tổng tiền</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.order_id}>
                  <td>#{order.order_id}</td>
                  <td>{order.user_fullname}</td>
                  <td>{order.user_email}</td>
                  <td>
                    {new Date(order.created_at).toLocaleDateString("vi-VN")}
                  </td>
                  <td>{order.total_price.toLocaleString()}đ</td>
                  <td>
                    <select
                      value={order.status.toUpperCase()}
                      onChange={(e) =>
                        updateOrderStatus(order.order_id, e.target.value)
                      }
                      style={{
                        backgroundColor: getStatusColor(order.status.toUpperCase()),
                        color: "white",
                        padding: "5px 10px",
                        borderRadius: "4px",
                        border: "none",
                      }}
                    >
                      <option value="PENDING">Chờ xác nhận</option>
                      <option value="PROCESSING">Đang xử lý</option>
                      <option value="SHIPPED">Đang giao</option>
                      <option value="DELIVERED">Đã giao</option>
                      <option value="CANCELLED">Đã hủy</option>
                    </select>
                  </td>
                  <td>
                    <div className="order-details-section">
                      {order.details.map((item) => (
                        <div key={item.order_detail_id} className="order-item">
                          <img
                            src={
                              item.image_url?.startsWith('http') 
                                ? item.image_url 
                                : `http://localhost:5000/uploads/${item.image_url}`
                            }
                            alt={item.name}
                            className="product-thumbnail"
                            onError={(e) => {
                              if (e.target.src !== "http://localhost:5000/images/placeholder.jpg") {
                                e.target.onerror = null;
                                e.target.src = "http://localhost:5000/images/placeholder.jpg";
                              }
                            }}
                          />
                          <div className="item-info">
                            <p className="item-name">{item.name}</p>
                            <p className="item-variant">
                              Size: {item.size}, Màu: {item.color}
                            </p>
                            <p className="item-quantity">
                              Số lượng: {item.quantity}
                            </p>
                            <p className="item-price">
                              {item.price.toLocaleString()}đ
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
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

export default AdminOrders;
