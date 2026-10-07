import React, { useState, useEffect, useCallback } from "react"; // Thêm useCallback
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import "./AdminProducts.css";

const AdminProducts = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Lấy dữ liệu an toàn từ localStorage
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const token = localStorage.getItem("token");

  // Dùng useCallback để hàm không bị khởi tạo lại vô ích
  const fetchProducts = useCallback(async () => {
    if (!token) return; // Nếu chưa có token thì không gọi API
    try {
      const response = await axios.get("http://localhost:5000/api/products", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProducts(response.data.data || []);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching products:", error);
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleDelete = async (productId) => {
    if (window.confirm("Bạn có chắc chắn muốn xóa sản phẩm này?")) {
      try {
        const response = await axios.delete(
          `http://localhost:5000/api/products/${productId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (response.data.success) {
          alert("Xóa sản phẩm thành công!");
          fetchProducts(); 
        }
      } catch (error) {
        alert("Có lỗi xảy ra khi xóa sản phẩm");
      }
    }
  };

  if (loading) return <div className="admin-loading">Đang tải danh sách...</div>;

  return (
    <div className="admin-products-page">
      <div className="admin-sidebar">
        <div className="admin-profile">
          <div className="admin-avatar">👤</div>
          <div className="admin-info">
            {/* Sửa: Hiển thị linh hoạt cả fullName và full_name */}
            <h3>{user?.fullName || user?.full_name || "Admin"}</h3>
            <p>Quản trị viên</p>
          </div>
        </div>
        <nav className="admin-nav">
          <Link to="/admin" className="nav-item">Dashboard</Link>
          <Link to="/admin/products" className="nav-item active">Sản phẩm</Link>
          <Link to="/admin/orders" className="nav-item">Đơn hàng</Link>
          <Link to="/admin/users" className="nav-item">Người dùng</Link>
        </nav>
      </div>

      <div className="admin-content">
        <div className="admin-header">
          <h1>Quản lý sản phẩm</h1>
          <button className="add-product-btn" onClick={() => navigate("/admin/products/add")}>
            + Thêm sản phẩm mới
          </button>
        </div>

        <div className="products-table-container">
          <table className="products-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Hình ảnh</th>
                <th>Tên sản phẩm</th>
                <th>Giá</th>
                <th>Giảm giá</th>
                <th>Thương hiệu</th>
                <th>Tồn kho</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.product_id}>
                  <td>{product.product_id}</td>
                  <td>
                    <img
                      // Logic: Nếu là link http thì để nguyên, nếu là tên file thì nối đường dẫn uploads
                      src={
                        product.image && product.image.startsWith('http') 
                          ? product.image 
                          : `http://localhost:5000/uploads/${product.image}`
                      }
                      alt={product.name}
                      className="product-thumbnail"
                      onError={(e) => {
                        // CHẶN VÒNG LẶP: Kiểm tra nếu src hiện tại chưa phải placeholder thì mới đổi
                        const placeholder = "http://localhost:5000/images/placeholder.jpg";
                        if (e.target.src !== placeholder) {
                          e.target.onerror = null; // Ngắt bộ lắng nghe lỗi ngay lập tức
                          e.target.src = placeholder;
                        }
                      }}
                    />
                  </td>
                  <td>{product.name}</td>
                  <td>{product.price?.toLocaleString()}đ</td>
                  <td>{product.discount || 0}%</td>
                  <td>{product.brand}</td>
                  <td>{product.stock}</td>
                  <td className="action-buttons">
                    <button className="edit-btn" onClick={() => navigate(`/admin/products/edit/${product.product_id}`)}>
                      Sửa
                    </button>
                    <button className="delete-btn" onClick={() => handleDelete(product.product_id)}>
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

export default AdminProducts;