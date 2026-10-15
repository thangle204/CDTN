import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cartAPI, ordersAPI, vouchersAPI } from '../utils/api';
import { productImageUrl } from '../utils/productVariants';
import { FaMapMarkerAlt, FaCreditCard, FaShoppingBag, FaCheckCircle, FaTag, FaTimes } from 'react-icons/fa';

const SHIPPING_FEE = 30000;
const money = value => Number(value || 0).toLocaleString('vi-VN') + '₫';
const inputClass = 'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500';

const Checkout = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [vouchers, setVouchers] = useState([]);
  const [voucherCode, setVoucherCode] = useState('');
  const [quote, setQuote] = useState(null);
  const [voucherError, setVoucherError] = useState('');
  const [applyingVoucher, setApplyingVoucher] = useState(false);
  const [createdOrder, setCreatedOrder] = useState(null);
  const [shippingInfo, setShippingInfo] = useState({ name: '', phone: '', address: '', city: '', district: '', ward: '', notes: '' });
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [bankInfo, setBankInfo] = useState({ bankName: '', accountNumber: '', accountHolder: '', transferNote: '' });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/login', { replace: true, state: { from: '/checkout' } }); return; }
    let active = true;
    setShippingInfo(previous => ({ ...previous, name: previous.name || user.name || '', phone: previous.phone || user.phone || '' }));
    const loadCheckout = async () => {
      setLoading(true);
      try {
        const [cart, availableVouchers] = await Promise.allSettled([cartAPI.getCart(), vouchersAPI.getActiveVouchers()]);
        if (!active) return;
        if (cart.status === 'rejected') throw cart.reason;
        if (!cart.value.data.length) { navigate('/cart', { replace: true }); return; }
        setCartItems(cart.value.data);
        if (availableVouchers.status === 'fulfilled') setVouchers(availableVouchers.value.data);
        else setVoucherError('Chưa tải được ưu đãi. Bạn vẫn có thể nhập mã voucher.');
      } catch (failure) {
        if (active) setError(failure.response?.data?.message || 'Không thể tải giỏ hàng. Vui lòng quay lại giỏ hàng và thử lại.');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadCheckout();
    return () => { active = false; };
  }, [user, authLoading, navigate]);

  const subtotal = cartItems.reduce((total, item) => total + Number(item.product?.price ?? item.price) * item.quantity, 0);
  const totals = quote || { itemsPrice: subtotal, shippingPrice: SHIPPING_FEE, discountAmount: 0, totalPrice: subtotal + SHIPPING_FEE };
  const address = [shippingInfo.address, shippingInfo.ward, shippingInfo.district, shippingInfo.city].filter(Boolean).join(', ');

  const applyVoucher = async (code) => {
    if (!code.trim()) { setVoucherError('Vui lòng nhập mã voucher.'); return; }
    setApplyingVoucher(true);
    setVoucherError('');
    try {
      const { data } = await vouchersAPI.applyVoucher(code.trim(), subtotal);
      setQuote(data);
      setVoucherCode(data.voucher.code);
    } catch (failure) {
      setQuote(null);
      setVoucherError(failure.response?.data?.message || 'Không thể áp dụng voucher.');
    } finally {
      setApplyingVoucher(false);
    }
  };

  const submitOrder = async () => {
    if (submitting || applyingVoucher || !cartItems.length) return;
    setSubmitting(true);
    setError('');
    try {
      const { data } = await ordersAPI.createOrder({
        shippingAddress: Object.fromEntries(Object.entries(shippingInfo).map(([key, value]) => [key, value.trim()])),
        paymentMethod,
        voucherCode: quote?.voucher?.code || null,
        expectedTotalPrice: totals.totalPrice,
        expectedCart: cartItems.map(item => ({
          product: item.product?._id ?? item.product,
          color: item.color || '',
          size: item.size ?? null,
          quantity: item.quantity,
        })),
        bankTransferInfo: paymentMethod === 'BANK' ? bankInfo : undefined,
      });
      setCreatedOrder(data);
      setStep(3);
    } catch (failure) {
      const message = failure.response?.data?.message || 'Đặt hàng thất bại. Vui lòng thử lại.';
      setError(message);
      if (failure.response?.status === 409) {
        setQuote(null);
        setVoucherCode('');
        setVoucherError('');
        setStep(1);
        setCartItems([]);
        setLoading(true);
        try {
          const { data } = await cartAPI.getCart();
          setCartItems(data);
        } catch {
          setError(message + ' Không thể tải lại giỏ hàng. Vui lòng quay lại giỏ và thử lại.');
        } finally {
          setLoading(false);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const proceed = (event) => {
    event.preventDefault();
    if (!/^0\d{9}$/.test(shippingInfo.phone.trim())) { setError('Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0.'); return; }
    if (!shippingInfo.name.trim() || !shippingInfo.address.trim() || !shippingInfo.city.trim()) { setError('Vui lòng điền đầy đủ thông tin giao hàng.'); return; }
    setError('');
    setStep(2);
  };

  if (authLoading || loading) return <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4"><div className="spinner" /><p>Đang tải thông tin thanh toán...</p></div>;

  if (step === 3) return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <FaCheckCircle className="text-6xl text-green-600 mx-auto mb-6" />
        <h1 className="text-3xl font-bold mb-3">Đặt giày thành công!</h1>
        <p className="text-gray-600 mb-6">Cảm ơn bạn đã mua sắm tại SHOE STORE.</p>
        <p className="mb-2">Mã đơn: <strong>#{createdOrder._id.slice(-8)}</strong></p>
        <p className="text-2xl text-red-600 font-bold mb-4">{money(createdOrder.totalPrice)}</p>
        <p className="text-gray-600 mb-6">{paymentMethod === 'BANK' ? 'Đơn hàng đang chờ đối chiếu chuyển khoản. Cửa hàng sẽ xác nhận thanh toán sau.' : 'Bạn sẽ thanh toán khi nhận giày.'}</p>
        <Link to="/my-orders" className="inline-block bg-red-600 text-white px-6 py-3 rounded-lg font-semibold">Xem đơn hàng</Link>
        <Link to="/products" className="block text-red-600 mt-4 hover:underline">Tiếp tục chọn giày</Link>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <Link to="/cart" className="text-red-600 hover:underline">← Quay lại giỏ hàng</Link>
      <h1 className="text-3xl font-bold my-6">Thanh toán</h1>
      <ol className="flex gap-6 mb-8 text-sm font-semibold" aria-label="Tiến trình đặt hàng">
        <li className={step === 1 ? 'text-red-600' : 'text-gray-500'}>1. Giao hàng và thanh toán</li>
        <li className={step === 2 ? 'text-red-600' : 'text-gray-500'}>2. Xác nhận đặt giày</li>
      </ol>
      {error && <div role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-4 mb-6">{error}</div>}
      {!cartItems.length ? <Link to="/cart" className="text-red-600 underline">Quay lại giỏ hàng để tải lại sản phẩm</Link> : (
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {step === 1 ? (
              <form onSubmit={proceed} className="space-y-6">
                <section className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-xl font-bold mb-5 flex items-center gap-2"><FaMapMarkerAlt className="text-red-600" />Thông tin nhận giày</h2>
                  <div className="grid md:grid-cols-2 gap-4">
                    {[['name', 'Họ tên người nhận', true], ['phone', 'Số điện thoại', true], ['address', 'Số nhà, tên đường', true], ['city', 'Tỉnh / Thành phố', true], ['district', 'Quận / Huyện'], ['ward', 'Phường / Xã']].map(([name, label, required]) => (
                      <label key={name} className="block text-sm font-medium text-gray-700">{label}{required ? ' *' : ''}
                        <input name={name} type={name === 'phone' ? 'tel' : 'text'} autoComplete={name === 'name' ? 'name' : name === 'phone' ? 'tel' : 'off'} required={required} maxLength={name === 'phone' ? 10 : name === 'address' ? 500 : 120} value={shippingInfo[name]} onChange={event => setShippingInfo({ ...shippingInfo, [name]: event.target.value })} className={inputClass + ' mt-2'} />
                      </label>
                    ))}
                  </div>
                  <label className="block mt-4 text-sm font-medium">Ghi chú giao hàng<textarea name="notes" maxLength={1000} rows={3} value={shippingInfo.notes} onChange={event => setShippingInfo({ ...shippingInfo, notes: event.target.value })} className={inputClass + ' mt-2'} /></label>
                </section>
                <section className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-xl font-bold mb-5 flex items-center gap-2"><FaCreditCard className="text-red-600" />Phương thức thanh toán</h2>
                  {[['COD', 'Thanh toán khi nhận giày (COD)'], ['BANK', 'Chuyển khoản ngân hàng']].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-3 border rounded-lg p-4 mb-3 cursor-pointer"><input type="radio" name="paymentMethod" value={value} checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} />{label}</label>
                  ))}
                  {paymentMethod === 'BANK' && (
                    <div className="p-4 rounded-lg bg-blue-50 mt-4">
                      <p className="text-sm text-blue-900 mb-4">Thông tin người chuyển khoản giúp cửa hàng đối chiếu giao dịch. Cửa hàng sẽ liên hệ xác nhận thông tin nhận tiền. Đơn chỉ được ghi nhận đã thanh toán sau khi đối chiếu.</p>
                      <div className="grid md:grid-cols-2 gap-4">
                        {[['bankName', 'Ngân hàng'], ['accountHolder', 'Tên người chuyển khoản'], ['accountNumber', 'Số tài khoản người chuyển'], ['transferNote', 'Nội dung chuyển khoản']].map(([name, label]) => (
                          <label key={name} className="text-sm font-medium">{label}<input maxLength={name === 'accountNumber' ? 50 : name === 'transferNote' ? 500 : 120} value={bankInfo[name]} onChange={event => setBankInfo({ ...bankInfo, [name]: event.target.value })} className={inputClass + ' mt-2'} /></label>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
                <button type="submit" disabled={applyingVoucher} className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">Tiếp tục xác nhận</button>
              </form>
            ) : (
              <section className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-bold mb-5 flex items-center gap-2"><FaShoppingBag className="text-red-600" />Xác nhận đơn giày</h2>
                <div className="bg-gray-50 p-4 rounded-lg mb-5 space-y-2"><p className="font-semibold">{shippingInfo.name} · {shippingInfo.phone}</p><p>{address}</p>{shippingInfo.notes && <p className="text-gray-600">Ghi chú: {shippingInfo.notes}</p>}<p className="text-sm">Thanh toán: {paymentMethod === 'COD' ? 'Khi nhận hàng' : 'Chuyển khoản, chờ đối chiếu'}</p></div>
                <div className="divide-y">
                  {cartItems.map(item => (
                    <div key={item._id} className="flex gap-4 py-4">
                      <img src={productImageUrl(item.product?.image || item.image)} alt={item.product?.name || item.name} className="w-16 h-16 object-contain rounded" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} />
                      <div className="flex-1"><p className="font-semibold">{item.product?.name || item.name}</p><p className="text-sm text-gray-600">{item.color ? 'Màu ' + item.color + ' · ' : ''}{item.size ? 'Size ' + item.size + ' · ' : ''}Số lượng: {item.quantity}</p></div>
                      <strong className="text-red-600">{money(Number(item.product?.price ?? item.price) * item.quantity)}</strong>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-6"><button disabled={submitting} onClick={() => setStep(1)} className="flex-1 bg-gray-200 py-3 rounded-lg font-semibold disabled:opacity-50">Sửa thông tin</button><button onClick={submitOrder} disabled={submitting || applyingVoucher} className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">{submitting ? 'Đang đặt hàng...' : 'Đặt giày'}</button></div>
              </section>
            )}
          </div>
          <aside className="space-y-6">
            <section className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><FaTag className="text-red-600" />Ưu đãi</h2>
              <form onSubmit={event => { event.preventDefault(); applyVoucher(voucherCode); }} className="flex gap-2">
                <input aria-label="Mã voucher" maxLength={50} placeholder="Nhập mã voucher" value={voucherCode} onChange={event => setVoucherCode(event.target.value)} className={inputClass} />
                <button type="submit" disabled={applyingVoucher || submitting} className="bg-red-600 text-white px-3 rounded-lg whitespace-nowrap disabled:opacity-50">{applyingVoucher ? 'Đang kiểm tra' : 'Áp dụng'}</button>
              </form>
              {voucherError && <p role="alert" className="text-sm text-red-600 mt-3">{voucherError}</p>}
              {quote && <p className="flex items-center justify-between gap-2 bg-green-50 text-green-700 p-3 rounded-lg mt-3 text-sm"><span>Đã áp dụng {quote.voucher.code}</span><button aria-label="Bỏ voucher" disabled={submitting} onClick={() => { setQuote(null); setVoucherCode(''); setVoucherError(''); }}><FaTimes /></button></p>}
              {vouchers.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-red-600">Chọn mã ưu đãi ({vouchers.length})</summary><div className="mt-3 space-y-2">{vouchers.map(voucher => <button key={voucher._id} disabled={applyingVoucher || submitting} onClick={() => applyVoucher(voucher.code)} className="text-left w-full rounded-lg border border-dashed border-red-300 p-3 hover:bg-red-50 disabled:opacity-50"><strong className="text-red-600">{voucher.code}</strong><p className="text-sm mt-1">{voucher.description}</p><p className="text-xs text-gray-500 mt-1">Đơn tối thiểu {money(voucher.minOrder)}</p></button>)}</div></details>}
            </section>
            <section className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-5">Tóm tắt đơn hàng</h2>
              <dl className="space-y-3 text-gray-600">
                <div className="flex justify-between gap-3"><dt>Tạm tính</dt><dd>{money(totals.itemsPrice)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Phí vận chuyển</dt><dd>{totals.shippingPrice === 0 ? 'Miễn phí' : money(totals.shippingPrice)}</dd></div>
                {totals.discountAmount > 0 && <div className="flex justify-between gap-3 text-green-700"><dt>Giảm giá</dt><dd>-{money(totals.discountAmount)}</dd></div>}
                <div className="flex justify-between gap-3 border-t pt-4 text-xl font-bold text-gray-900"><dt>Tổng</dt><dd className="text-red-600">{money(totals.totalPrice)}</dd></div>
              </dl>
              <p className="text-xs text-gray-500 mt-4">Giá và ưu đãi được kiểm tra lại khi đặt hàng. Cửa hàng sẽ thông báo nếu sản phẩm hoặc mã ưu đãi không còn khả dụng.</p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
};

export default Checkout;
