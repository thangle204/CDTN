import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FaShoppingBag, FaBoxOpen, FaSearch, FaBars, FaTimes, FaUser, FaArrowRight, FaCog } from 'react-icons/fa';
import './storefront-header.css';

const categories = ['Sneaker', 'Giày chạy bộ', 'Giày da', 'Sandal', 'Giày thể thao'];

const Navbar = () => {
  const { user, logout, loading } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedCategory = new URLSearchParams(location.search).get('category') || '';
  const isCatalog = location.pathname === '/' || location.pathname === '/products';

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  const handleSearch = (event) => {
    event.preventDefault();
    const keyword = searchTerm.trim();
    navigate(keyword ? `/products?keyword=${encodeURIComponent(keyword)}` : '/products');
    setMobileMenuOpen(false);
    setSearchTerm('');
  };

  const handleLogout = () => {
    logout();
    setMobileMenuOpen(false);
    navigate('/login');
  };

  return (
    <header className="store-header">
      <div className="store-header__top">
        <div className="store-header__container store-header__top-inner">
          <p>Chọn đúng size. Tự tin mỗi bước chân.</p>
          <div className="store-header__utility">
            {loading ? <span role="status">Đang tải tài khoản...</span> : user ? (
              <>
                <span className="store-header__greeting">Xin chào, {user.name || user.email}</span>
                <button type="button" onClick={handleLogout}>Đăng xuất</button>
              </>
            ) : (
              <><Link to="/login">Đăng nhập</Link><span aria-hidden="true">/</span><Link to="/register">Đăng ký</Link></>
            )}
          </div>
        </div>
      </div>

      <div className="store-header__container store-header__main">
        <Link to="/" className="store-header__logo" aria-label="SHOE STORE — Trang chủ">
          SHOE<span>STORE</span><i aria-hidden="true">.</i>
        </Link>

        <form className="store-header__search" onSubmit={handleSearch} role="search">
          <input
            type="search"
            aria-label="Tìm kiếm giày"
            placeholder="Tìm đôi giày dành cho bạn..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button type="submit" aria-label="Tìm kiếm"><FaSearch /></button>
        </form>

        <div className="store-header__actions">
          {loading ? (
            <span className="store-header__action store-header__account-loading" aria-label="Đang tải tài khoản"><FaUser aria-hidden="true" /></span>
          ) : (
            <Link to={user ? '/profile' : '/login'} className="store-header__action">
              <FaUser aria-hidden="true" /><span>Tài khoản</span>
            </Link>
          )}
          {user && <Link to="/my-orders" className="store-header__action store-header__orders"><FaBoxOpen aria-hidden="true" /><span>Đơn hàng</span></Link>}
          <Link to="/cart" className="store-header__action"><FaShoppingBag aria-hidden="true" /><span>Giỏ hàng</span></Link>
          {user?.isAdmin && <Link to="/admin" className="store-header__action store-header__admin"><FaCog aria-hidden="true" /><span>Quản trị</span></Link>}
          <button
            type="button"
            className="store-header__menu-button"
            aria-label={mobileMenuOpen ? 'Đóng menu' : 'Mở menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="store-category-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className={`store-header__nav-wrap${mobileMenuOpen ? ' store-header__nav-wrap--open' : ''}`}>
        <nav id="store-category-navigation" className="store-header__container store-header__nav" aria-label="Danh mục giày">
          <Link to="/" className={location.pathname === '/' ? 'is-active' : ''} aria-current={location.pathname === '/' ? 'page' : undefined}>Trang chủ</Link>
          <Link to="/products" className={location.pathname === '/products' && !selectedCategory ? 'is-active' : ''} aria-current={location.pathname === '/products' && !selectedCategory ? 'page' : undefined}>Tất cả giày</Link>
          {categories.map((category) => (
            <Link
              key={category}
              to={`/products?category=${encodeURIComponent(category)}`}
              className={isCatalog && selectedCategory === category ? 'is-active' : ''}
              aria-current={isCatalog && selectedCategory === category ? 'page' : undefined}
            >{category}</Link>
          ))}
          <Link to="/products" className="store-header__browse">Khám phá bộ sưu tập <FaArrowRight aria-hidden="true" /></Link>
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
