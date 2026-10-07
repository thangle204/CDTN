import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import "./Cart.css";
import Header from "../Header/Header";
import Footer from "../Footer/footer";
import { useCart } from "./CartContex";

const formatPrice = (price) => {
  const num = Number(price) || 0;
  return num.toLocaleString("vi-VN") + "đ";
};
const Cart = () => {
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const [updatingCartId, setUpdatingCartId] = useState(null);
  const { updateCartItemCount } = useCart();
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchCartItems = useCallback(async () => {
    try {
      if (!token) {
        console.log("Không có token");
        setError("Vui lòng đăng nhập để xem giỏ hàng");
        navigate("/login");
        return;
      }

      // Log để debug
      console.log("Token hiện tại:", token?.substring(0, 20));
      console.log("Authorization header:", `Bearer ${token}`);

      const response = await axios.get("http://localhost:5000/api/cart", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      });

      console.log("Response từ API:", response.data);

      if (response.data && response.data.data) {
        // Xử lý dữ liệu trước khi set state
        const processedItems = response.data.data.map((item) => ({
          ...item,
          image_url: item.image, // Sử dụng image từ server
        }));

        setCartItems(processedItems);
        // Cập nhật tổng số lượng
        const totalItems = processedItems.reduce(
          (sum, item) => sum + item.quantity,
          0
        );
        updateCartItemCount(totalItems);
        setError(null);
      } else {
        setCartItems([]);
        updateCartItemCount(0);
        setError("Giỏ hàng trống");
      }
    } catch (error) {
      // Log chi tiết lỗi
      console.error("Chi tiết lỗi:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        code: error.code,
      });

      // Xử lý các trường hợp lỗi cụ thể
      if (error.code === "ECONNREFUSED") {
        setError(
          "Không thể kết nối đến server. Vui lòng kiểm tra server đã chạy chưa."
        );
      } else if (error.response?.status === 401) {
        setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        localStorage.removeItem("token");
        navigate("/login");
      } else if (error.code === "ETIMEDOUT") {
        setError("Kết nối tới server quá chậm. Vui lòng thử lại.");
      } else if (!navigator.onLine) {
        setError("Vui lòng kiểm tra kết nối internet của bạn.");
      } else {
        setError(
          error.response?.data?.message ||
            "Không thể tải giỏ hàng. Vui lòng thử lại sau."
        );
      }
      setCartItems([]);
      updateCartItemCount(0);
    } finally {
      setLoading(false);
    }
  }, [token, navigate, updateCartItemCount]);

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    fetchCartItems();
  }, [token, navigate, fetchCartItems]);

  const updateQuantity = async (cartId, newQuantity) => {
    try {
      if (newQuantity < 1) return;

      setUpdatingCartId(cartId);

      // Log dữ liệu trước khi gửi request
      console.log("Sending update request:", {
        cartId,
        newQuantity,
        url: `http://localhost:5000/api/cart/${cartId}`,
      });

      const response = await axios.put(
        `http://localhost:5000/api/cart/${cartId}`,
        {
          cart_id: cartId, // Thêm cart_id vào body
          quantity: parseInt(newQuantity), // Đảm bảo quantity là số
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Update response:", response.data);

      if (response.data) {
        setCartItems((prevItems) => {
          const newItems = prevItems.map((item) =>
            item.cart_id === cartId ? { ...item, quantity: newQuantity } : item
          );
          // Cập nhật tổng số lượng
          const totalItems = newItems.reduce(
            (sum, item) => sum + item.quantity,
            0
          );
          updateCartItemCount(totalItems);
          return newItems;
        });
      }
    } catch (error) {
      console.error("Error updating quantity:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      setError("Không thể cập nhật số lượng");
    } finally {
      setUpdatingCartId(null);
    }
  };

  const removeItem = async (cartId) => {
    try {
      await axios.delete(`http://localhost:5000/api/cart/${cartId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Cập nhật UI và tổng số lượng
      setCartItems((prevItems) => {
        const newItems = prevItems.filter((item) => item.cart_id !== cartId);
        const totalItems = newItems.reduce(
          (sum, item) => sum + item.quantity,
          0
        );
        updateCartItemCount(totalItems);
        return newItems;
      });
    } catch (error) {
      console.error("Error removing item:", error);
      setError("Không thể xóa sản phẩm");
    }
  };

  const calculateTotal = () => {
    return cartItems.reduce((total, item) => {
      const price = item.discount
        ? item.price * (1 - item.discount / 100)
        : item.price;
      return total + price * item.quantity;
    }, 0);
  };

  const handleCheckout = async () => {
    try {
      setIsProcessing(true);
      setError(null); // Reset error state

      console.log("Sending order data:", {
        items: cartItems,
        totalAmount: calculateTotal(),
      });

      const response = await axios.post(
        "http://localhost:5000/api/orders", // Sửa lại URL
        {
          items: cartItems,
          totalAmount: calculateTotal(),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Order response:", response.data);

      if (response.data.success) {
        // Xóa giỏ hàng sau khi tạo đơn hàng thành công
        setCartItems([]);
        // Chuyển hướng đến trang đơn hàng
        navigate(`/orders`);
      }
    } catch (error) {
      console.error("Checkout error:", error);
      setError(
        error.response?.data?.message ||
          "Không thể tạo đơn hàng. Vui lòng thử lại."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Thêm styles
  const loadingStyle = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "200px",
    fontSize: "16px",
  };

  const errorStyle = {
    textAlign: "center",
    padding: "20px",
    margin: "20px auto",
    maxWidth: "600px",
    backgroundColor: "#fff",
    borderRadius: "8px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  };

  if (loading) {
    return (
      <>
        <Header />
        <div style={loadingStyle}>
          <div>Đang tải giỏ hàng...</div>
        </div>
        <Footer />
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <div style={errorStyle}>
          <div style={{ color: "#dc3545", marginBottom: "15px" }}>{error}</div>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchCartItems();
            }}
            style={{
              padding: "8px 16px",
              backgroundColor: "#7749F8",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Thử lại
          </button>
          <Link
            to="/"
            style={{
              display: "block",
              marginTop: "10px",
              color: "#7749F8",
              textDecoration: "none",
            }}
          >
            Quay về trang chủ
          </Link>
        </div>
        <Footer />
      </>
    );
  }

  const items = Array.isArray(cartItems) ? cartItems : [];

  return (
    <>
      <Header />
      <div className="cart-container">
        {error && <div className="error-message">{error}</div>}
        <h2>Giỏ hàng của bạn</h2>
        {items.length === 0 ? (
          <div className="empty-cart">
            <p>Giỏ hàng trống</p>
            <Link to="/" className="continue-shopping">
              Tiếp tục mua sắm
            </Link>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {items.map((item) => (
                <div key={item.cart_id} className="cart-item">
                  <div className="item-image">
                    <img
                      src={
                        item.image_url?.startsWith("http")
                          ? item.image_url
                          : `http://localhost:5000${item.image_url}`
                      }
                      alt={item.name}
                      className="item-image"
                      onError={(e) => {
                        // Nếu cả link cũ và file upload đều lỗi, hiện ảnh placeholder
                        const placeholder = "http://localhost:5000/images/placeholder.jpg";
                        if (e.target.src !== placeholder) {
                          e.target.onerror = null; 
                          e.target.src = placeholder;
                        }
                      }}
                    />
                  </div>
                  <div className="item-details">
                    <h3>{item.name}</h3>
                    <p className="item-variant">
                      Size: {item.size}, Màu: {item.color}
                    </p>
                    <div className="price-section" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {item.discount > 0 ? (
                        <>
                          {/* Giá mới đã giảm đưa lên trước: To, đậm và màu đỏ rực */}
                          <span className="discounted-price" style={{ color: '#ff3838', fontWeight: 'bold', fontSize: '20px' }}>
                            {formatPrice(item.price * (1 - item.discount / 100))}
                          </span>

                          {/* Giá gốc và nhãn viên thuốc sale xếp gọn ở hàng dưới */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="original-price" style={{ textDecoration: 'line-through', color: '#a0a0a0', fontSize: '14px' }}>
                              {formatPrice(item.price)}
                            </span>
                            <span style={{ backgroundColor: '#ff3838', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 6px rgba(255,56,56,0.3)' }}>
                              -{item.discount}% OFF
                            </span>
                          </div>
                        </>
                      ) : (
                        /* Khi không giảm giá: Hiện giá thường màu đen xám quý phái */
                        <span className="price" style={{ fontWeight: 'bold', fontSize: '20px', color: '#2d3436' }}>
                          {formatPrice(item.price)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="quantity-controls">
                    <button
                      className="quantity-btn"
                      onClick={() =>
                        updateQuantity(item.cart_id, item.quantity - 1)
                      }
                      disabled={
                        item.quantity <= 1 || updatingCartId === item.cart_id
                      }
                    >
                      -
                    </button>

                    <input
                      type="number"
                      value={item.quantity}
                      min="1"
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value >= 1) {
                          updateQuantity(item.cart_id, value);
                        }
                      }}
                      className="quantity-input"
                      disabled={updatingCartId === item.cart_id}
                    />

                    <button
                      className="quantity-btn"
                      onClick={() =>
                        updateQuantity(item.cart_id, item.quantity + 1)
                      }
                      disabled={updatingCartId === item.cart_id}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="remove-item"
                    onClick={() => removeItem(item.cart_id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="cart-summary">
              <div className="total">
                <span>Tổng tiền:</span>
                <span>{formatPrice(calculateTotal())}</span>
              </div>
              <button
                className="checkout-button"
                onClick={handleCheckout}
                disabled={isProcessing}
              >
                {isProcessing ? "Đang xử lý..." : "Thanh toán"}
              </button>
            </div>
          </>
        )}
      </div>
      <Footer />
    </>
  );
};

export default Cart;
