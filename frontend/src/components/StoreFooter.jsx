import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './storefront-header.css';

const StoreFooter = () => {
  const { user, loading } = useAuth();

  return (
    <footer className="store-footer">
      <div className="store-footer__container store-footer__main">
        <div className="store-footer__intro">
          <Link to="/" className="store-header__logo" aria-label="SHOE STORE — Trang chủ">SHOE<span>STORE</span><i aria-hidden="true">.</i></Link>
          <p>Một đôi giày phù hợp, một ngày trọn vẹn.<br />Tìm phong cách riêng của bạn tại SHOE STORE.</p>
        </div>
        <nav aria-label="Bộ sưu tập" className="store-footer__links">
          <h2>Bộ sưu tập</h2>
          <Link to="/products">Tất cả giày</Link>
          <Link to="/products?category=Sneaker">Sneaker</Link>
          <Link to={`/products?category=${encodeURIComponent('Giày chạy bộ')}`}>Giày chạy bộ</Link>
          <Link to={`/products?category=${encodeURIComponent('Giày da')}`}>Giày da</Link>
          <Link to="/products?category=Sandal">Sandal</Link>
          <Link to={`/products?category=${encodeURIComponent('Giày thể thao')}`}>Giày thể thao</Link>
        </nav>
        <nav aria-label="Tài khoản mua sắm" className="store-footer__links">
          <h2>Cùng SHOE STORE</h2>
          <Link to="/cart">Giỏ hàng</Link>
          {!loading && (user ? (
            <><Link to="/profile">Tài khoản của tôi</Link><Link to="/my-orders">Đơn hàng của tôi</Link>{user.isAdmin && <Link to="/admin">Quản trị cửa hàng</Link>}</>
          ) : (
            <><Link to="/login">Đăng nhập</Link><Link to="/register">Tạo tài khoản</Link></>
          ))}
        </nav>
      </div>
      <div className="store-footer__container store-footer__bottom">
        <span>© {new Date().getFullYear()} SHOE STORE</span>
        <div className="store-footer__payments" aria-label="Phương thức thanh toán"><span>Thanh toán</span><strong>COD</strong><strong>VNPAY Sandbox</strong></div>
      </div>
    </footer>
  );
};

export default StoreFooter;
