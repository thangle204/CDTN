// Header.js
import React, { useState, useEffect } from "react";
import "./Header.css";
import { Link, useNavigate } from "react-router-dom";
import UserProfile from "../Users/UserProfile";
import { SearchResultsList } from "./SearchResultList";
import { SearchResult } from "./SearchResult";
import axios from "axios";
import Cart from "../Cart/Cart";

const Header = () => {
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("token"));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("user") || "{}"));
  const token = localStorage.getItem("token");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  // Fetch số lượng sản phẩm trong giỏ hàng
  const fetchCartCount = async () => {
    if (!token) return;

    try {
      const response = await axios.get("http://localhost:5000/api/cart", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.data && response.data.data) {
        // Tính tổng số lượng từ tất cả các sản phẩm trong giỏ hàng
        const totalItems = response.data.data.reduce(
          (sum, item) => sum + item.quantity,
          0
        );
        setCartCount(totalItems);
      }
    } catch (error) {
      console.error("Error fetching cart count:", error);
      setCartCount(0);
    }
  };

  // Gọi fetchCartCount khi component mount và khi token thay đổi
  useEffect(() => {
    // 1. Kiểm tra lại token mới nhất từ localStorage
    const currentToken = localStorage.getItem("token");
    
    // 2. Cập nhật ngay lập tức các State để giao diện biến đổi theo
    setIsLoggedIn(!!currentToken);
    setUser(JSON.parse(localStorage.getItem("user") || "{}"));
    
    // 3. Nếu có token (đang đăng nhập) thì mới đi lấy số lượng giỏ hàng
    if (currentToken) {
      fetchCartCount();
    } else {
      setCartCount(0); // Nếu logout thì reset giỏ hàng về 0 luôn
    }
  }, [token]);

  // Đóng user menu khi click bên ngoài
  useEffect(() => {
    const handleClickOutside = (event) => {
      const userIcon = document.getElementById("userIcon");
      const userMenu = document.getElementById("userMenu");

      if (userIcon && userMenu) {
        if (
          !userIcon.contains(event.target) &&
          !userMenu.contains(event.target)
        ) {
          setShowUserMenu(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Toggle user menu
  const toggleUserMenu = () => {
    setShowUserMenu(!showUserMenu);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    setIsLoggedIn(false);
    setUser({});
    setCartCount(0);

    navigate("/login");
    
  };

  const handleSearchChange = async (e) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (value.trim()) {
      try {
        const response = await axios.get(
          `http://localhost:5000/api/products/search?query=${value}`
        );
        if (response.data.success) {
          setSearchResults(response.data.data);
          setShowResults(true);
        }
      } catch (err) {
        console.error("Search error:", err);
      }
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  };

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest(".search-container")) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <header className="p-2">
      <nav className="navbar">
        {/* Logo and Title */}
        <div className="logo-container">
          <Link to="/" className="logo-link">
            <img src="/Logo_home.png" alt="logo" className="logo-image" />
            <h2>Sneakers</h2>
          </Link>
        </div>

        {/* Update Search Bar */}
        <div className="search-container">
          <div className="search-input-wrapper">
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search for products, categories or brands..."
              onFocus={() => setShowResults(true)}
            />
            <button>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
          </div>
          {showResults && searchResults.length > 0 && (
            <SearchResultsList results={searchResults} />
          )}
        </div>

        {/* Navigation Links and Cart */}
        <div className="nav-links">
          <Link to="/" className="nav-link">
            Home
          </Link>

          {isLoggedIn ? (
            <>
              <div className="cart-wrapper">
                <Link to="/cart" className="cart-link">
                  <div className="cart-icon-container">
                    <img
                      src="https://static.vecteezy.com/system/resources/previews/001/504/962/non_2x/shopping-cart-icon-free-vector.jpg"
                      alt="cart"
                      className="cart-icon"
                    />
                    {cartCount > 0 && (
                      <span className="cart-badge">{cartCount}</span>
                    )}
                  </div>
                </Link>
              </div>

              <div className="user-menu-container">
                <div
                  className="user-icon"
                  onClick={toggleUserMenu}
                  id="userIcon"
                >
                  {user.fullName ? user.fullName[0].toUpperCase() : "👤"}
                </div>
                {showUserMenu && (
                  <div className="user-menu" id="userMenu">
                    <div className="user-info">
                      <p className="user-name">{user.fullName}</p>
                      <p className="user-email">{user.email}</p>
                    </div>
                    <div className="menu-divider"></div>
                    <Link to="/user/profile" className="menu-item">
                      <i className="fas fa-user"></i> Tài khoản
                    </Link>
                    {user && user.role && user.role.toLowerCase() === "admin" && (
                      <Link to="/admin" className="menu-item admin-link" style={{color: '#ff4757', fontWeight: 'bold'}}>
                        <i className="fas fa-user-shield"></i> Trang quản trị
                      </Link>
                    )}
                    <Link to="/orders" className="menu-item">
                      <i className="fas fa-shopping-bag"></i> Đơn hàng
                    </Link>
                    <Link to="/change-password" className="menu-item">
                      <i className="fas fa-key"></i> Đổi mật khẩu
                    </Link>
                    <div className="menu-divider"></div>
                    <button onClick={handleLogout} className="menu-item logout">
                      <i className="fas fa-sign-out-alt"></i> Đăng xuất
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="auth-buttons">
              <Link to="/signup">Sign Up</Link>
              <span className="divider">|</span>
              <Link to="/login">Log in</Link>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Header;
