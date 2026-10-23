import { FaShoePrints, FaShoppingBag, FaCreditCard } from 'react-icons/fa';

export default function AuthLayout({ children }) {
  return (
    <div className="shop-auth">
      <div className="shop-auth__shell">
        <aside className="shop-auth__story" aria-label="Cùng SHOE STORE">
          <p className="shop-eyebrow">CÙNG SHOE STORE</p>
          <h2>Bước đi của bạn.<br />Phong cách của bạn.</h2>
          <p>Khám phá đôi giày phù hợp và lưu lại hành trình mua sắm trong tài khoản của bạn.</p>
          <FaShoePrints className="shop-auth__art" aria-hidden="true" />
          <ul>
            <li><FaShoePrints aria-hidden="true" /><span>Chọn màu và size theo sở thích</span></li>
            <li><FaShoppingBag aria-hidden="true" /><span>Theo dõi đơn hàng dễ dàng</span></li>
            <li><FaCreditCard aria-hidden="true" /><span>Thanh toán COD hoặc VNPAY</span></li>
          </ul>
          <span className="shop-auth__signature">CHỌN ĐÚNG SIZE. TỰ TIN MỖI BƯỚC CHÂN.</span>
        </aside>
        <div className="shop-auth__content">{children}</div>
      </div>
    </div>
  );
}
