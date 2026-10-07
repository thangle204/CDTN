import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import "./Main.css";
import ShoesDetail from "../ShoesDetail/ShoesDetail";

const formatPrice = (price) => {
  const num = Number(price) || 0;
  return num.toLocaleString("vi-VN") + "đ";
};
const Main = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await axios.get("http://localhost:5000/api/products/");
        console.log("API Response:", response.data);

        if (response.data.success) {
          // Log thông tin sản phẩm để debug
          const sampleProduct = response.data.data[0];
          console.log("Sample product:", {
            id: sampleProduct?.product_id,
            name: sampleProduct?.name,
            image: sampleProduct?.image,
          });

          setProducts(response.data.data);
        }
      } catch (err) {
        setError("Không thể tải sản phẩm. Vui lòng thử lại sau.");
        console.error("Error fetching products:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  if (loading) return <div className="loading">Đang tải sản phẩm...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="main-container row">
      {/* Sidebar */}
      <div className="sidebar col-md-3">
        <h2 className="sidebar-title">DANH MỤC SẢN PHẨM</h2>
        <ul className="category-list">
          <li>
            <img
              src="http://localhost:5000/uploads/lodo adidas.png"
              alt="Adidas"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Adidas cao cấp</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo nike.png"
              alt="Nike"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Nike cao cấp</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo balenciaga.png"
              alt="Balenciaga"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Balenciaga</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo new balance.png"
              alt="New Balance"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày New Balance</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo Converse.png"
              alt="Converse"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Converse</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/Logo Puma.jpg"
              alt="Puma"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Puma</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo VanS.png"
              alt="Vans"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày VanS</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo Asics.jpg"
              alt="Asics"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Asics</Link>
          </li>
          <li>
            <img
              src="http://localhost:5000/uploads/logo Reebok.png"
              alt="Reebok"
              className="brand-icon"
              onError={(e) => { e.target.src = "http://localhost:5000/images/placeholder.jpg"; }}
            />
            <Link to="#">Giày Reebok</Link>
          </li>
        </ul>
      </div>

      <div className="banner-section col-md-9">
        <img
          src="https://giaysneaker.store/media/wysiwyg/slidershow/home-12/banner_CONVERSE.jpg"
          alt="Converse Sneaker Banner"
          className="banner-image"
        />

        <div className="banner-overlay">
          <h1>Discover Your Perfect Sneakers</h1>
          <p>Explore our collection of premium sneakers</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Best Sellers Section */}
        <div className="best-sellers">
          <div className="section-header">
            <h2>SẢN PHẨM BÁN CHẠY</h2>
            {/* <Link to="/products" className="view-all">
              Xem thêm
            </Link> */}
          </div>
          <div className="products-grid">
            {products.map((product) => (
              <Link
                to={`/product/${product.product_id}`}
                key={product.product_id}
                className="product-link"
              >
                <div className="product-card">
                  <div className="product-image">
                    <img
                      src={
                        product.image
                          ? product.image.startsWith("http")
                            ? product.image
                            : product.image.startsWith("/uploads")
                            ? `http://localhost:5000${product.image}`
                            : `http://localhost:5000/uploads/${product.image}`
                          : "http://localhost:5000/images/placeholder.jpg"
                      }
                      alt={product.name}
                      className="product-image"
                      onError={(e) => {
                        console.log("Image lỗi:", product.image);

                        e.target.onerror = null;
                        e.target.src =
                          "http://localhost:5000/images/placeholder.jpg";
                      }}
                    />
                    {product.discount > 0 && (
                      <span className="discount-badge">
                        -{product.discount}%
                      </span>
                    )}
                  </div>
                  <div className="product-info">
                    <h3 className="product-name">{product.name}</h3>
                    <div className="product-price">
                      {product.discount > 0 ? (
                        <>
                          <span className="discounted-price">
                            {formatPrice(product.price * (1 - product.discount / 100))}
                          </span>
                          <span className="original-price">
                            {formatPrice(product.price)}
                          </span>
                        </>
                      ) : (
                        <span className="price">
                          {formatPrice(product.price)}
                        </span>
                      )}
                    </div>
                    <button
                      className="add-to-cart-btn"
                      onClick={(e) => {
                        e.preventDefault();
                      }}
                    >
                      Thêm vào giỏ
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Main;
