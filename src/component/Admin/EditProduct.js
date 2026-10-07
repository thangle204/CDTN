import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import "./EditProduct.css";

const EditProduct = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null); // MỚI: State lưu file ảnh được chọn
  const user = JSON.parse(localStorage.getItem("user"));
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    description: "",
    brand: "",
    stock: "",
    discount: "",
  });

  useEffect(() => {
    if (user && user.role.toLowerCase() === "admin") {
      fetchProduct();
    } else {
      navigate("/login");
    }
  }, [id]);

  const fetchProduct = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await axios.get(`http://localhost:5000/api/products/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const productData = response.data.data;
      setProduct(productData);
      setFormData({
        name: String(productData.name || ""),
        price: String(productData.price ?? ""),
        description: String(productData.description || ""),
        brand: String(productData.brand || ""),
        stock: String(productData.stock ?? ""),
        discount: String(productData.discount ?? "0"),
      });
      setLoading(false);
    } catch (error) {
      setError(error.response?.data?.message || "Không thể tải thông tin sản phẩm");
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // MỚI: Hàm xử lý khi chọn tệp ảnh mới
  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");

      // THAY ĐỔI: Chuyển sang dùng FormData để đóng gói tệp tin gửi lên Server
      const data = new FormData();
      data.append("name", formData.name.trim());
      data.append("price", parseFloat(formData.price));
      data.append("description", formData.description.trim());
      data.append("brand", formData.brand.trim());
      data.append("stock", parseInt(formData.stock));
      data.append("discount", parseInt(formData.discount) || 0);
      
      // Nếu Thắng có chọn file mới thì mới gửi kèm lên, không thì Backend sẽ giữ ảnh cũ
      if (file) {
        data.append("image", file);
      }

      const response = await axios.put(
        `http://localhost:5000/api/products/${id}`,
        data,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data", // Định dạng bắt buộc khi gửi file
          },
        }
      );

      if (response.data.success) {
        alert("Cập nhật sản phẩm thành công!");
        navigate("/admin/products");
      }
    } catch (error) {
      alert(error.response?.data?.message || "Có lỗi xảy ra khi cập nhật sản phẩm");
    }
  };

  if (loading) return <div className="loading">Đang tải...</div>;
  if (error) return <div className="error">{error}</div>;

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
          <Link to="/admin" className="nav-item">Dashboard</Link>
          <Link to="/admin/products" className="nav-item active">Sản phẩm</Link>
          <Link to="/admin/orders" className="nav-item">Đơn hàng</Link>
          <Link to="/admin/users" className="nav-item">Người dùng</Link>
        </nav>
      </div>

      <div className="admin-content">
        <div className="edit-product-container">
          <div className="edit-product-header">
            <h2>Chỉnh sửa sản phẩm #{id}</h2>
            <Link to="/admin/products" className="back-button">Quay lại</Link>
          </div>

          <div className="product-preview">
            <img
              // MỚI: Nếu chọn file mới thì dùng URL tạm để xem trước, nếu không thì dùng nguồn ảnh cũ
              src={
                file
                  ? URL.createObjectURL(file)
                  : product?.image && product.image.startsWith('http')
                    ? product.image
                    : `http://localhost:5000/uploads/${product?.image}`
              }
              alt={product?.name}
              className="product-image"
              onError={(e) => {
                const placeholder = "http://localhost:5000/images/placeholder.jpg";
                if (e.target.src !== placeholder) {
                  e.target.onerror = null;
                  e.target.src = placeholder;
                }
              }}
            />
          </div>

          <form onSubmit={handleSubmit} className="edit-product-form">
            <div className="form-group">
              <label>Tên sản phẩm:</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} />
            </div>

            {/* MỚI: Ô chọn tải ảnh lên từ máy tính */}
            <div className="form-group">
              <label>Thay đổi hình ảnh (Tải lên từ máy tính):</label>
              <input type="file" accept="image/*" onChange={handleFileChange} />
              {file && <p style={{ fontSize: '12px', color: 'green', marginTop: '5px' }}>Đang chọn file mới: {file.name}</p>}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Giá:</label>
                <input type="number" name="price" value={formData.price} onChange={handleChange} />
              </div>

              <div className="form-group">
                <label>Giảm giá (%):</label>
                <input type="number" name="discount" value={formData.discount} onChange={handleChange} min="0" max="100" />
              </div>
            </div>

            <div className="form-group">
              <label>Mô tả:</label>
              <textarea name="description" value={formData.description} onChange={handleChange} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Thương hiệu:</label>
                <input type="text" name="brand" value={formData.brand} onChange={handleChange} />
              </div>

              <div className="form-group">
                <label>Tồn kho:</label>
                <input type="number" name="stock" value={formData.stock} onChange={handleChange} min="0" />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="save-button">Lưu thay đổi</button>
              <button type="button" className="cancel-button" onClick={() => navigate("/admin/products")}>Hủy</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditProduct;