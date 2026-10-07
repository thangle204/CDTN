import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { FiShoppingCart } from "react-icons/fi";
import "./ShoesDetail.css";
import Header from "../Header/Header";
import Footer from "../Footer/footer";

const formatPrice = (price) => {
  const num = Number(price) || 0;
  return num.toLocaleString("vi-VN") + "đ";
};
const ShoesDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [addToCartMessage, setAddToCartMessage] = useState(null);
  const token = localStorage.getItem("token");
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewError, setReviewError] = useState(null);
  const [reviewSuccess, setReviewSuccess] = useState(null);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await axios.get(
          `http://localhost:5000/api/products/${id}`
        );

        console.log("API Response:", response.data.data);

        if (response.data.success) {
          const productData = response.data.data;

          // Log để debug variants
          console.log("Product variants:", productData.variants);

          // Kiểm tra và xử lý variants
          if (!productData.variants || productData.variants.length === 0) {
            setError("Sản phẩm này không có biến thể");
            return;
          }

          setProduct(productData);

          // Set màu đầu tiên làm mặc định
          const firstColor = productData.variants[0].color;
          setSelectedColor(firstColor);

          // Log thông tin variant đầu tiên
          console.log("First variant:", productData.variants[0]);

          // Fetch reviews
          try {
            const reviewsResponse = await axios.get(
              `http://localhost:5000/api/reviews/product/${id}`
            );
            if (reviewsResponse.data.success) {
              setReviews(reviewsResponse.data.data);
            }
          } catch (reviewError) {
            console.error("Error fetching reviews:", reviewError);
            setReviewError("Không thể tải đánh giá sản phẩm");
          }
        } else {
          setError(response.data.message || "Không thể tải thông tin sản phẩm");
        }
      } catch (err) {
        console.error("Error fetching product:", err);
        setError("Không thể tải thông tin sản phẩm");
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  const handleColorSelect = (color) => {
    console.log("Selected color:", color);
    setSelectedColor(color);
    setSelectedSize(null); // Reset size khi đổi màu
    setSelectedVariant(null); // Reset variant khi đổi màu
  };

  const handleSizeSelect = (variant) => {
    console.log("Selecting variant:", variant);
    if (!variant || !variant.variant_id) {
      console.error("Invalid variant selected:", variant);
      return;
    }
    setSelectedVariant(variant);
    setSelectedSize(variant.size);
    console.log("Updated state:", {
      selectedVariant: variant,
      selectedSize: variant.size,
    });
  };

  const handleAddToCart = async () => {
    try {
      if (!token) {
        navigate("/login");
        return;
      }

      // Thêm log chi tiết
      console.log("Current state:", {
        selectedColor,
        selectedSize,
        selectedVariant,
        product,
      });

      if (!selectedVariant || !selectedVariant.variant_id) {
        setAddToCartMessage({
          type: "error",
          content: "Vui lòng chọn size và màu sắc",
        });
        return;
      }

      const cartData = {
      productId: parseInt(product.product_id),
      variantId: parseInt(selectedVariant.variant_id),
      quantity: parseInt(quantity),
    };

      // Log chi tiết dữ liệu gửi đi
      console.log("Cart data to be sent:", cartData);
      console.log("Selected variant details:", selectedVariant);

      const response = await axios.post(
        "http://localhost:5000/api/cart",
        cartData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Cart response:", response.data);

      if (response.data.success) {
        setAddToCartMessage({
          type: "success",
          content: "Đã thêm vào giỏ hàng thành công!",
        });
        setTimeout(() => setAddToCartMessage(null), 3000);
      }
    } catch (error) {
      console.error("Add to cart error:", error);
      if (error.response?.status === 401) {
        // Token hết hạn hoặc không hợp lệ
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setAddToCartMessage({
        type: "error",
        content: error.response?.data?.message || "Không thể thêm vào giỏ hàng",
      });
    }
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!token) {
      setReviewError("Vui lòng đăng nhập để đánh giá sản phẩm");
      return;
    }

    try {
      console.log("Đang gửi đánh giá với dữ liệu:", {
        product_id: id,
        rating,
        comment,
      });

      const response = await axios.post(
        `http://localhost:5000/api/reviews`,
        {
          product_id: id,
          rating,
          comment,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Phản hồi từ API thêm đánh giá:", response.data);

      if (response.data.success) {
        setReviewSuccess("Đánh giá của bạn đã được gửi thành công!");
        setComment("");
        setRating(5);

        // Tải lại danh sách đánh giá
        try {
          console.log("Đang tải lại danh sách đánh giá...");
          const reviewsResponse = await axios.get(
            `http://localhost:5000/api/reviews/product/${id}`
          );
          console.log("Phản hồi từ API lấy đánh giá:", reviewsResponse.data);

          if (reviewsResponse.data.success) {
            setReviews(reviewsResponse.data.data);
            console.log(
              "Đã cập nhật danh sách đánh giá:",
              reviewsResponse.data.data
            );
          } else {
            console.error(
              "Lỗi khi tải lại đánh giá:",
              reviewsResponse.data.message
            );
          }
        } catch (reviewError) {
          console.error("Lỗi khi tải lại danh sách đánh giá:", reviewError);
        }

        setTimeout(() => setReviewSuccess(null), 3000);
      }
    } catch (error) {
      console.error("Error submitting review:", error);
      setReviewError(
        error.response?.data?.message ||
          "Không thể gửi đánh giá. Vui lòng thử lại sau."
      );
      setTimeout(() => setReviewError(null), 3000);
    }
  };

  // Thêm hàm fetchReviews riêng
  const fetchReviews = async () => {
    try {
      console.log("Đang tải danh sách đánh giá cho sản phẩm:", id);
      const reviewsResponse = await axios.get(
        `http://localhost:5000/api/reviews/product/${id}`
      );
      console.log("Kết quả lấy đánh giá:", reviewsResponse.data);

      if (reviewsResponse.data.success) {
        setReviews(reviewsResponse.data.data);
        console.log("Số lượng đánh giá:", reviewsResponse.data.data.length);
      }
    } catch (error) {
      console.error("Lỗi khi tải đánh giá:", error);
      setReviewError("Không thể tải đánh giá sản phẩm");
    }
  };

  // Thêm useEffect riêng cho việc tải đánh giá
  useEffect(() => {
    if (id) {
      fetchReviews();
    }
  }, [id]);

  // Lọc danh sách màu sắc duy nhất từ variants
  const uniqueColors = product?.variants
    ? [...new Set(product.variants.map((v) => v.color))]
    : [];

  // Lọc danh sách size dựa trên màu đã chọn
  const availableSizes = product?.variants
    ? product.variants.filter((v) => v.color === selectedColor)
    : [];

  // Thêm component thông báo
  const MessagePopup = ({ message }) => {
    if (!message) return null;

    return (
      <div className={`message-popup ${message.type}`}>{message.content}</div>
    );
  };

  if (loading) return <div className="loading">Đang tải sản phẩm...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!product) return <div className="error">Không tìm thấy sản phẩm</div>;

  return (
    <>
      <Header />
      <div className="shoes-detail-container">
        {addToCartMessage && <MessagePopup message={addToCartMessage} />}
        <div className="product-detail">
          <div className="product-images">
            <div className="main-image">
              <img
                // KIỂM TRA: Nếu bắt đầu bằng "http" thì dùng luôn, nếu không thì mới nối link uploads
                src={
                  product.image && product.image.startsWith('http')
                    ? product.image
                    : `http://localhost:5000/uploads/${product.image}`
                }
                alt={product.name}
                className="main-product-img" // Class cũ của bạn
                onError={(e) => {
                  // Chặn vòng lặp và hiện ảnh placeholder nếu link cũ bị chết hoặc file mới bị lỗi
                  const placeholder = "http://localhost:5000/images/placeholder.jpg";
                  if (e.target.src !== placeholder) {
                    e.target.onerror = null;
                    e.target.src = placeholder;
                  }
                }}
              />
              {product.discount > 0 && (
                <span className="discount-badge-detail">-{product.discount}% SALE</span>
              )}
            </div>
          </div>

          <div className="product-info">
            <h1 className="product-title">{product.name}</h1>

            <div className="product-price-detail">
              {product.discount > 0 ? (
                <>
                  {/* Giá mới lên trên */}
                  <span className="discounted-price">
                    {formatPrice(product.price * (1 - product.discount / 100))}
                  </span>
                  {/* Giá gốc xuống dưới */}
                  <span className="original-price">
                    {formatPrice(product.price)}
                  </span>
                </>
              ) : (
                <span className="price">{formatPrice(product.price)}</span>
              )}
            </div>

            <div className="product-description">
              <h3>Mô tả sản phẩm</h3>
              <p>{product.description}</p>
            </div>

            <div className="color-selector">
              <h3>Màu sắc</h3>
              <div className="color-options">
                {uniqueColors.map((color, index) => (
                  <button
                    key={index}
                    className={`color-btn ${
                      selectedColor === color ? "selected" : ""
                    }`}
                    onClick={() => handleColorSelect(color)}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>

            {selectedColor && (
              <div className="size-selector">
                <h3>Chọn size</h3>
                <div className="size-options">
                  {availableSizes.map((variant) => (
                    <button
                      key={variant.variant_id}
                      className={`size-btn ${
                        selectedVariant?.variant_id === variant.variant_id
                          ? "selected"
                          : ""
                      } ${variant.stock === 0 ? "out-of-stock" : ""}`}
                      onClick={() => handleSizeSelect(variant)}
                      disabled={variant.stock === 0}
                    >
                      {variant.size}
                      {variant.stock === 0 && (
                        <span className="out-of-stock-label">Hết hàng</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="product-actions">
              <div className="quantity-selector">
                <label>Số lượng:</label>
                <div className="quantity-controls">
                  <button
                    onClick={() => quantity > 1 && setQuantity(quantity - 1)}
                    className="quantity-btn"
                    disabled={!selectedVariant}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (
                        value > 0 &&
                        selectedVariant &&
                        value <= selectedVariant.stock
                      ) {
                        setQuantity(value);
                      }
                    }}
                    min="1"
                    max={selectedVariant?.stock || 1}
                    disabled={!selectedVariant}
                  />
                  <button
                    onClick={() =>
                      selectedVariant &&
                      quantity < selectedVariant.stock &&
                      setQuantity(quantity + 1)
                    }
                    className="quantity-btn"
                    disabled={!selectedVariant}
                  >
                    +
                  </button>
                </div>
                {selectedVariant && (
                  <span className="stock-info">
                    Còn {selectedVariant.stock} sản phẩm
                  </span>
                )}
              </div>

              <button
                className="add-to-cart"
                onClick={handleAddToCart}
                disabled={!selectedVariant || selectedVariant.stock === 0}
              >
                <FiShoppingCart className="cart-icon" />
                {selectedVariant?.stock === 0
                  ? "Hết hàng"
                  : "Thêm vào giỏ hàng"}
              </button>
            </div>
          </div>
        </div>

        <div className="reviews-section">
          <h2>Đánh giá sản phẩm</h2>

          {/* Form đánh giá */}
          <div className="review-form">
            <h3>Viết đánh giá của bạn</h3>
            {reviewError && <div className="error-message">{reviewError}</div>}
            {reviewSuccess && (
              <div className="success-message">{reviewSuccess}</div>
            )}
            <form onSubmit={handleSubmitReview}>
              <div className="rating-input">
                <label>Đánh giá của bạn:</label>
                <div className="star-rating">
                  {[5, 4, 3, 2, 1].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`star-btn ${rating >= star ? "filled" : ""}`}
                      onClick={() => setRating(star)}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
              <div className="comment-input">
                <label>Nhận xét của bạn:</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Chia sẻ trải nghiệm của bạn về sản phẩm..."
                  required
                />
              </div>
              <button type="submit" className="submit-review-btn">
                Gửi đánh giá
              </button>
            </form>
          </div>

          {/* Danh sách đánh giá */}
          <div className="reviews-list">
            <h3>Tất cả đánh giá</h3>
            {reviews.length === 0 ? (
              <div className="no-reviews">
                <p>Chưa có đánh giá nào cho sản phẩm này</p>
              </div>
            ) : (
              reviews.map((review) => (
                <div key={review.review_id} className="review-item">
                  <div className="review-header">
                    <div className="reviewer-info">
                      <span className="reviewer-name">{review.username}</span>
                      <span className="review-date">
                        {new Date(review.created_at).toLocaleDateString(
                          "vi-VN"
                        )}
                      </span>
                    </div>
                    <div className="rating">
                      {[...Array(5)].map((_, index) => (
                        <span
                          key={index}
                          className={`star ${
                            index < review.rating ? "filled" : ""
                          }`}
                        >
                          ★
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="review-comment">{review.comment}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
};

export default ShoesDetail;
