import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./AdminProducts.css";

const AdminAddProduct = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    brand: "",
    category_id: "1",
    discount: 0,
  }); // Đã xóa 'stock' tổng ở đây vì backend sẽ tự tính

  // Quản lý danh sách Size/Màu/Số lượng
  const [variants, setVariants] = useState([{ size: "", color: "", stock: 0 }]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleVariantChange = (index, e) => {
    const { name, value } = e.target;
    const newVariants = [...variants];
    newVariants[index][name] = value;
    setVariants(newVariants);
  };

  const addVariant = () => setVariants([...variants, { size: "", color: "", stock: 0 }]);
  const removeVariant = (index) => setVariants(variants.filter((_, i) => i !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name || !formData.price || !file) {
      alert("Vui lòng nhập đầy đủ Tên, Giá và Chọn ảnh từ máy tính!");
      return;
    }

    // Lọc bỏ những dòng biến thể người dùng bấm "Thêm" nhưng quên không gõ chữ
    const validVariants = variants.filter(v => v.size.trim() !== "" && v.color.trim() !== "");
    if (validVariants.length === 0) {
      alert("Vui lòng nhập Size và Màu sắc cho ít nhất 1 biến thể!");
      return;
    }

    const data = new FormData();
    data.append("name", formData.name);
    data.append("description", formData.description);
    data.append("price", formData.price);
    data.append("brand", formData.brand);
    data.append("category_id", formData.category_id);
    data.append("discount", formData.discount);
    data.append("image", file);
    
    // Gửi mảng đã được lọc sạch sẽ
    data.append("variants", JSON.stringify(validVariants)); 

    try {
      const response = await axios.post("http://localhost:5000/api/products", data, {
        headers: { 
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "multipart/form-data" 
        }
      });

      if (response.data.success) {
        alert("Thêm sản phẩm và biến thể thành công!");
        navigate("/admin/products");
      }
    } catch (error) {
      console.error("Lỗi gửi dữ liệu:", error.response?.data);
      alert("Lỗi server: " + (error.response?.data?.message || "Không xác định"));
    }
  };

  return (
    <div className="admin-add-product">
      <div className="admin-header">
        <h2>Thêm Sản Phẩm Mới </h2>
      </div>
      <form onSubmit={handleSubmit} className="product-form">
        <div className="form-group"><label>Tên sản phẩm:</label><input type="text" name="name" value={formData.name} onChange={handleChange} required /></div>
        <div className="form-group"><label>Mô tả:</label><textarea name="description" value={formData.description} onChange={handleChange} required /></div>
        <div className="form-group"><label>Giá:</label><input type="number" name="price" value={formData.price} onChange={handleChange} required /></div>
        <div className="form-group"><label>Thương hiệu:</label><input type="text" name="brand" value={formData.brand} onChange={handleChange} required /></div>
        
        <div className="form-group">
          <label>Chọn hình ảnh từ máy tính:</label>
          <input type="file" accept="image/*" onChange={handleFileChange} required />
          {file && <p style={{fontSize: '12px', color: 'blue'}}>Đã chọn: {file.name}</p>}
        </div>

        <div className="form-group"><label>Giảm giá (%):</label><input type="number" name="discount" value={formData.discount} onChange={handleChange} /></div>

        {/* Đã gỡ bỏ ô nhập Tổng Số Lượng Kho để tránh mâu thuẫn dữ liệu */}

        <div className="variants-section" style={{ marginTop: '20px', border: '1px solid #ddd', padding: '15px' }}>
          <h3>Biến thể (Size, Màu, Số lượng)</h3>
          {variants.map((v, index) => (
            <div key={index} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <input type="text" name="size" placeholder="Size" value={v.size} onChange={(e) => handleVariantChange(index, e)} required style={{width: '25%'}}/>
              <input type="text" name="color" placeholder="Màu" value={v.color} onChange={(e) => handleVariantChange(index, e)} required style={{width: '25%'}}/>
              <input type="number" name="stock" placeholder="Kho" value={v.stock} onChange={(e) => handleVariantChange(index, e)} required style={{width: '25%'}} min="0"/>
              {variants.length > 1 && (
                <button type="button" onClick={() => removeVariant(index)} style={{backgroundColor: '#ff4d4d', color: 'white', border: 'none', padding: '5px 10px'}}>Xóa</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addVariant} style={{padding: '5px 15px', backgroundColor: '#4CAF50', color: 'white', border: 'none'}}>+ Thêm loại khác</button>
        </div>

        <div className="form-actions">
          <button type="submit" className="submit-btn">Thêm sản phẩm</button>
          <button type="button" className="cancel-btn" onClick={() => navigate("/admin/products")}>Hủy</button>
        </div>
      </form>
    </div>
  );
};

export default AdminAddProduct;