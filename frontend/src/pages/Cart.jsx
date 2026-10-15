import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cartAPI } from '../utils/api';
import { hasProductVariants, productStock, validProductSelection, sharesCartStock, productImageUrl } from '../utils/productVariants';
import { FaShoppingCart, FaTrash, FaMinus, FaPlus } from 'react-icons/fa';

const money = value => Number(value || 0).toLocaleString('vi-VN') + '₫';

const Cart = () => {
  const { user, loading: authLoading } = useAuth();
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setCartItems([]); setLoading(false); return; }
    let active = true;
    setLoading(true);
    cartAPI.getCart().then(({ data }) => { if (active) setCartItems(data); }).catch(failure => {
      if (active) setError(failure.response?.data?.message || 'Không thể tải giỏ hàng. Vui lòng thử lại.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, authLoading]);

  const changeQuantity = async (item, requestedQuantity) => {
    if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || updating) return;
    if (!item.product || item.product.isHidden || item.product.isArchived || !validProductSelection(item.product, item.size, item.color)) {
      setError('Màu hoặc size này không còn được bán. Vui lòng xóa khỏi giỏ hàng.');
      return;
    }
    const otherQuantity = cartItems.filter(other => other._id !== item._id && sharesCartStock(item, other)).reduce((total, other) => total + other.quantity, 0);
    const stock = productStock(item.product, item.size, item.color);
    // Jump to the quantity still available for this row when stock has fallen.
    // If other rows already consume the whole pool, lowering this row to one
    // lets the buyer then adjust those rows without deleting/re-adding shoes.
    const quantity = requestedQuantity < item.quantity
      ? Math.min(requestedQuantity, Math.max(1, stock - otherQuantity))
      : requestedQuantity;
    if (requestedQuantity >= item.quantity && quantity + otherQuantity > stock) {
      setError(hasProductVariants(item.product) ? 'Số lượng đã vượt quá tồn kho của màu và size giày này.' : 'Tổng số lượng của các size đã vượt quá tồn kho của mẫu giày này.');
      return;
    }
    setUpdating(true);
    setError('');
    try {
      const { data } = await cartAPI.updateCartItem(item._id, quantity);
      setCartItems(data);
    } catch (failure) {
      setError(failure.response?.data?.message || 'Không thể cập nhật số lượng.');
    } finally {
      setUpdating(false);
    }
  };

  const removeItem = async (item) => {
    if (updating || !window.confirm('Xóa mẫu giày' + (item.color ? ' màu ' + item.color : '') + (item.size ? ' size ' + item.size : '') + ' khỏi giỏ hàng?')) return;
    setUpdating(true);
    setError('');
    try {
      const { data } = await cartAPI.removeFromCart(item._id);
      setCartItems(data);
    } catch (failure) {
      setError(failure.response?.data?.message || 'Không thể xóa giày khỏi giỏ.');
    } finally {
      setUpdating(false);
    }
  };

  const total = cartItems.reduce((sum, item) => sum + Number(item.product?.price ?? item.price) * item.quantity, 0);
  const hasUnavailableItem = cartItems.some(item => !item.product || item.product.isHidden || item.product.isArchived || !validProductSelection(item.product, item.size, item.color) || cartItems.filter(other => sharesCartStock(item, other)).reduce((sum, other) => sum + other.quantity, 0) > productStock(item.product, item.size, item.color));

  if (authLoading || loading) return <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4"><div className="spinner" /><p>Đang tải giỏ giày...</p></div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <Link to="/products" className="text-red-600 hover:underline">← Tiếp tục chọn giày</Link>
      <h1 className="text-3xl font-bold my-6 flex items-center gap-3"><FaShoppingCart className="text-red-600" />Giỏ hàng của bạn</h1>
      {error && <div role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-4 mb-6">{error}</div>}
      {!user || !cartItems.length ? (
        <div className="text-center py-20 bg-white rounded-xl shadow">
          <FaShoppingCart className="text-6xl text-gray-300 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold mb-3">{user ? 'Chưa có giày trong giỏ' : 'Đăng nhập để xem giỏ hàng'}</h2>
          <p className="text-gray-600 mb-6">Chọn mẫu giày yêu thích và size phù hợp để bắt đầu.</p>
          <Link to={user ? '/products' : '/login'} className="inline-block bg-red-600 text-white px-6 py-3 rounded-lg font-semibold">{user ? 'Khám phá bộ sưu tập' : 'Đăng nhập'}</Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            {cartItems.map(item => {
              const product = item.product;
              const productUrl = product ? '/products/' + product._id : '/products';
              const stock = productStock(product, item.size, item.color);
              const invalidSize = !validProductSelection(product, item.size, item.color);
              const otherQuantity = cartItems.filter(other => other._id !== item._id && sharesCartStock(item, other)).reduce((sum, other) => sum + other.quantity, 0);
              const unavailable = !product || product.isHidden || product.isArchived || invalidSize;
              const overstock = item.quantity + otherQuantity > stock;
              const reducedQuantity = Math.min(item.quantity - 1, Math.max(1, stock - otherQuantity));
              return (
                <article key={item._id} className="bg-white rounded-lg shadow p-4 flex gap-4">
                  <Link to={productUrl} className="shrink-0"><img src={productImageUrl(product?.image || item.image)} alt={product?.name || item.name} className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} /></Link>
                  <div className="flex-1 min-w-0">
                    <Link to={productUrl} className="font-semibold hover:text-red-600">{product?.name || item.name}</Link>
                    <p className="text-sm text-gray-600 mt-1">{item.color ? 'Màu: ' + item.color + ' · ' : ''}{item.size ? 'Size: ' + item.size : product?.sizes?.length ? 'Chưa chọn size' : 'Size theo mẫu'}</p>
                    <p className="text-red-600 font-bold mt-2">{money(product?.price ?? item.price)}</p>
                    {(unavailable || stock === 0) && <p className="text-sm text-red-600 mt-2">{invalidSize ? 'Vui lòng xóa sản phẩm này và chọn lại màu, size đang bán.' : 'Mẫu giày hiện không còn khả dụng. Vui lòng xóa khỏi giỏ.'}</p>}
                    {product && stock > 0 && <p className="text-xs text-gray-500 mt-2">Còn {stock} đôi {hasProductVariants(product) ? 'cho màu và size này' : 'cho mẫu giày này'}</p>}
                    {!unavailable && stock > 0 && overstock && <p className="text-sm text-amber-700 mt-2">{item.quantity > 1 ? `Tồn kho đã giảm. Nhấn “−” để điều chỉnh dòng này về ${reducedQuantity} đôi.` : 'Tổng số lượng đang vượt tồn kho. Vui lòng giảm số lượng ở các dòng dùng chung kho hoặc xóa dòng không cần mua.'}{item.quantity > 1 && otherQuantity >= stock ? ' Sau đó điều chỉnh thêm các dòng dùng chung kho.' : ''}</p>}
                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center rounded-lg border">
                        <button aria-label="Giảm số lượng" onClick={() => changeQuantity(item, item.quantity - 1)} disabled={updating || item.quantity <= 1 || unavailable} className="p-3 disabled:opacity-40 hover:bg-gray-100"><FaMinus size={12} /></button>
                        <span className="px-3 font-semibold">{item.quantity}</span>
                        <button aria-label="Tăng số lượng" onClick={() => changeQuantity(item, item.quantity + 1)} disabled={updating || item.quantity + otherQuantity >= stock || unavailable} className="p-3 disabled:opacity-40 hover:bg-gray-100"><FaPlus size={12} /></button>
                      </div>
                      <button aria-label={'Xóa ' + (product?.name || item.name)} onClick={() => removeItem(item)} disabled={updating} className="text-red-600 p-2 disabled:opacity-40"><FaTrash /></button>
                    </div>
                    <p className="font-bold text-gray-800 mt-3">Thành tiền: {money(Number(product?.price ?? item.price) * item.quantity)}</p>
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="bg-white rounded-lg shadow p-6 h-fit">
            <h2 className="text-xl font-bold mb-5">Tóm tắt đơn giày</h2>
            <dl className="space-y-3">
              <div className="flex justify-between"><dt>Tạm tính</dt><dd>{money(total)}</dd></div>
              <div className="flex justify-between"><dt>Phí vận chuyển</dt><dd>{money(30000)}</dd></div>
              <div className="flex justify-between text-lg font-bold border-t pt-4"><dt>Tổng dự kiến</dt><dd className="text-red-600">{money(total + 30000)}</dd></div>
            </dl>
            <p className="text-sm text-gray-500 my-4">Nhập voucher tại bước thanh toán để nhận ưu đãi.</p>
            {hasUnavailableItem && <p role="alert" className="text-sm text-red-600 mb-4">Vui lòng kiểm tra size và số lượng các mẫu giày trước khi thanh toán.</p>}
            <Link to="/checkout" aria-disabled={updating || hasUnavailableItem} onClick={event => { if (updating || hasUnavailableItem) event.preventDefault(); }} className={'block text-center bg-red-600 text-white py-3 rounded-lg font-semibold ' + (updating || hasUnavailableItem ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-700')}>Tiến hành thanh toán</Link>
          </aside>
        </div>
      )}
    </div>
  );
};

export default Cart;
