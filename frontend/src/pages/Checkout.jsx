import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cartAPI, ordersAPI, vouchersAPI } from '../utils/api';
import { productImageUrl } from '../utils/productVariants';
import { cartItemPrice } from '../utils/productPricing';
import { SHIPPING_ADDRESS_FIELDS, shippingAddressOf, hasShippingAddress, cleanShippingAddress, shippingAddressLine } from '../utils/shippingAddress';
import { canPayWithVnpay, vnpaySandboxUrl } from '../utils/vnpay';
import VnpayPaymentButton from '../components/VnpayPaymentButton';
import VoucherSelector from '../components/VoucherSelector';
import { FaMapMarkerAlt, FaCreditCard, FaShoppingBag, FaCheckCircle, FaTag, FaTimes } from 'react-icons/fa';

const SHIPPING_FEE = 30000;
const money = value => Number(value || 0).toLocaleString('vi-VN') + '₫';
const inputClass = 'w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500';

const Checkout = () => {
  const { user, updateProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedVoucher = new URLSearchParams(location.search).get('voucher');
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState(null);
  const [voucherError, setVoucherError] = useState('');
  const [applyingVoucher, setApplyingVoucher] = useState(false);
  const [createdOrder, setCreatedOrder] = useState(null);
  const [shippingInfo, setShippingInfo] = useState(() => ({ ...shippingAddressOf(user), notes: '' }));
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [changeShipping, setChangeShipping] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const mounted = useRef(true);
  const accountRef = useRef(user?._id);
  const submitRef = useRef(null);
  const voucherRequest = useRef(0);
  const voucherBusy = useRef(false);
  const voucherContext = useRef('');
  const requestedApplied = useRef('');
  const shippingOwner = useRef(user?._id);
  const addressSubmission = useRef(null);
  accountRef.current = user?._id;
  const hasSavedAddress = hasShippingAddress(user?.shippingAddress);

  useEffect(() => {
    if (shippingOwner.current !== user?._id) {
      shippingOwner.current = user?._id;
      addressSubmission.current = null;
      setShippingInfo({ ...shippingAddressOf(user), notes: '' });
      setChangeShipping(false);
      setSavingAddress(false);
    } else if (hasSavedAddress && !changeShipping) {
      setShippingInfo(previous => ({ ...shippingAddressOf(user), notes: previous.notes || '' }));
    }
  }, [user?._id, user?.shippingAddress, user?.name, user?.phone, changeShipping]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/login', { replace: true, state: { from: '/checkout' + (location.search || '') } }); return; }
    let active = true;
    const loadCheckout = async () => {
      setLoading(true);
      try {
        const { data } = await cartAPI.getCart();
        if (!active) return;
        if (!data.length) { navigate(requestedVoucher ? `/cart?voucher=${encodeURIComponent(requestedVoucher)}` : '/cart', { replace: true }); return; }
        setCartItems(data);
      } catch (failure) {
        if (active) setError(failure.response?.data?.message || 'Không thể tải giỏ hàng. Vui lòng quay lại giỏ hàng và thử lại.');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadCheckout();
    return () => { active = false; };
  }, [user?._id, authLoading, navigate]);

  useEffect(() => {
    mounted.current = true;
    setSubmitting(false);
    setCreatedOrder(null);
    setStep(1);
    return () => {
      mounted.current = false;
      submitRef.current?.controller.abort();
      submitRef.current = null;
      addressSubmission.current = null;
    };
  }, [user?._id]);

  const subtotal = cartItems.reduce((total, item) => total + cartItemPrice(item) * item.quantity, 0);
  voucherContext.current = `${user?._id || ''}:${subtotal}`;
  useEffect(() => {
    voucherRequest.current += 1; voucherBusy.current = false;
    setQuote(null);setVoucherError('');setApplyingVoucher(false);
    return () => { voucherRequest.current += 1; };
  }, [user?._id, subtotal]);
  const totals = quote || { itemsPrice: subtotal, shippingPrice: SHIPPING_FEE, discountAmount: 0, totalPrice: subtotal + SHIPPING_FEE };
  const address = [shippingInfo.address, shippingInfo.ward, shippingInfo.district, shippingInfo.city].filter(Boolean).join(', ');

  const applyVoucher = async (code) => {
    if (voucherBusy.current || submitting) return;
    if (!code.trim()) { setVoucherError('Vui lòng nhập mã voucher.'); return; }
    setApplyingVoucher(true);
    voucherBusy.current = true;
    const request = ++voucherRequest.current, context = voucherContext.current;
    const current = () => request === voucherRequest.current && context === voucherContext.current;
    setVoucherError('');
    try {
      const { data } = await vouchersAPI.applyVoucher(code.trim(), subtotal);
      if (!current()) return;
      setQuote(data);
    } catch (failure) {
      if (!current()) return;
      setQuote(null);
      setVoucherError(failure.response?.data?.message || 'Không thể áp dụng voucher.');
    } finally {
      if (current()) { voucherBusy.current = false;setApplyingVoucher(false); }
    }
  };
  useEffect(() => {
    const key = `${user?._id}:${requestedVoucher}`;
    if (!loading && cartItems.length && requestedVoucher && requestedApplied.current !== key) {
      requestedApplied.current = key;void applyVoucher(requestedVoucher);
    }
  }, [loading, user?._id, requestedVoucher]);

  const submitOrder = async () => {
    if (submitting || submitRef.current || applyingVoucher || savingAddress || !cartItems.length || shippingOwner.current !== user?._id) return;
    const operation = { account: user?._id, controller: new AbortController() };
    submitRef.current = operation;
    const active = () => mounted.current && submitRef.current === operation && accountRef.current === operation.account;
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
      });
      if (!active()) return;
      setCreatedOrder(data);
      setStep(3);
      if (canPayWithVnpay(data)) {
        try {
          const payment = await ordersAPI.createVnpayPayment(data._id, { signal: operation.controller.signal });
          if (active()) window.location.assign(vnpaySandboxUrl(payment.data.paymentUrl));
        } catch (failure) {
          if (active()) setError('Đơn hàng đã được tạo. ' + (failure.response?.data?.message || failure.message || 'Chưa mở được VNPAY. Bạn có thể thanh toán lại bên dưới hoặc trong Đơn hàng của tôi.'));
        }
      }
    } catch (failure) {
      if (!active()) return;
      const message = failure.response?.data?.message || 'Đặt hàng thất bại. Vui lòng thử lại.';
      setError(message);
      if (failure.response?.status === 409) {
        setQuote(null);
        setVoucherError('');
        setStep(1);
        setCartItems([]);
        setLoading(true);
        try {
          const { data } = await cartAPI.getCart();
          if (active()) setCartItems(data);
        } catch {
          if (active()) setError(message + ' Không thể tải lại giỏ hàng. Vui lòng quay lại giỏ và thử lại.');
        } finally {
          if (active()) setLoading(false);
        }
      }
    } finally {
      if (active()) setSubmitting(false);
      if (submitRef.current === operation) submitRef.current = null;
    }
  };

  const proceed = async (event) => {
    event.preventDefault();
    if (addressSubmission.current || savingAddress || applyingVoucher || shippingOwner.current !== user?._id) return;
    const operation = { account: user?._id };
    addressSubmission.current = operation;
    const active = () => mounted.current && addressSubmission.current === operation && accountRef.current === operation.account;
    let result;
    try {
      setError('');
      const shippingAddress = cleanShippingAddress(shippingInfo);
      if (!hasSavedAddress) {
        setSavingAddress(true);
        result = await updateProfile({ shippingAddress, onlyIfAddressMissing: true });
        if (!active() || result.stale || result.isCurrent && !result.isCurrent()) return;
        if (!result.success) throw Error(result.message || 'Chưa lưu được địa chỉ. Vui lòng thử lại.');
      }
      if (active()) setStep(2);
    } catch (failure) {
      if (active() && (!result?.isCurrent || result.isCurrent())) setError(failure.message || 'Chưa lưu được địa chỉ. Vui lòng thử lại.');
    } finally {
      if (active()) setSavingAddress(false);
      if (addressSubmission.current === operation) addressSubmission.current = null;
    }
  };

  if (authLoading || loading || shippingOwner.current !== user?._id) return <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4"><div className="spinner" /><p>Đang tải thông tin thanh toán...</p></div>;

  if (step === 3) return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <div className="bg-white rounded-xl shadow p-8 text-center shop-panel">
        <FaCheckCircle className="text-6xl text-green-600 mx-auto mb-6" />
        <h1 className="text-3xl font-bold mb-3">Đặt giày thành công!</h1>
        <p className="text-gray-600 mb-6">Cảm ơn bạn đã mua sắm tại SHOE STORE.</p>
        <p className="mb-2">Mã đơn: <strong>#{createdOrder._id.slice(-8)}</strong></p>
        <p className="text-2xl text-red-600 font-bold mb-4">{money(createdOrder.totalPrice)}</p>
        <p className="text-gray-600 mb-6">{createdOrder.paymentMethod === 'VNPAY' ? createdOrder.isPaid ? 'Hệ thống đã xác nhận thanh toán VNPAY.' : 'Đơn hàng đã được tạo và đang chờ thanh toán VNPAY Sandbox.' : 'Bạn sẽ thanh toán khi nhận giày.'}</p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
        {canPayWithVnpay(createdOrder) && <VnpayPaymentButton order={createdOrder} disabled={submitting} onOrderUpdated={setCreatedOrder} />}
        <Link to="/my-orders" className="inline-block bg-red-600 text-white px-6 py-3 rounded-lg font-semibold">Xem đơn hàng</Link>
        <Link to="/products" className="block text-red-600 mt-4 hover:underline">Tiếp tục chọn giày</Link>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 shop-page">
      <Link to="/cart" className="text-red-600 hover:underline">← Quay lại giỏ hàng</Link>
      <h1 className="text-3xl font-bold my-6">Thanh toán</h1>
      <ol className="flex gap-6 mb-8 text-sm font-semibold shop-checkout-steps" aria-label="Tiến trình đặt hàng">
        <li aria-current={step === 1 ? 'step' : undefined} className={step === 1 ? 'text-red-600' : 'text-gray-500'}>1. Giao hàng và thanh toán</li>
        <li aria-current={step === 2 ? 'step' : undefined} className={step === 2 ? 'text-red-600' : 'text-gray-500'}>2. Xác nhận đặt giày</li>
      </ol>
      {error && <div role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-4 mb-6">{error}</div>}
      {!cartItems.length ? <Link to="/cart" className="text-red-600 underline">Quay lại giỏ hàng để tải lại sản phẩm</Link> : (
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {step === 1 ? (
              <form onSubmit={proceed} className="space-y-6">
                <section className="bg-white rounded-lg shadow p-6 shop-panel">
                  <h2 className="text-xl font-bold mb-5 flex items-center gap-2"><FaMapMarkerAlt className="text-red-600" />Thông tin nhận giày</h2>
                  {hasSavedAddress ? <>
                    <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="mb-2 text-sm text-gray-500">Địa chỉ đã lưu trong tài khoản</p><p className="font-semibold">{user.shippingAddress.name} · {user.shippingAddress.phone}</p><p className="mt-2 break-words text-gray-600">{shippingAddressLine(user.shippingAddress)}</p></div>
                    <fieldset className="mb-5" disabled={savingAddress}><legend className="mb-3 font-semibold text-gray-800">Bạn có muốn thay đổi thông tin giao hàng không?</legend><div className="flex flex-wrap gap-4">
                      <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="changeShipping" value="no" checked={!changeShipping} onChange={() => { setChangeShipping(false); setShippingInfo(previous => ({ ...shippingAddressOf(user), notes: previous.notes || '' })); }} />Không, dùng thông tin đã lưu</label>
                      <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="changeShipping" value="yes" checked={changeShipping} onChange={() => setChangeShipping(true)} />Có, đổi cho đơn này</label>
                    </div></fieldset>
                  </> : <p className="mb-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-900">Bạn chưa có địa chỉ giao hàng. Nhập thông tin bên dưới; địa chỉ sẽ được lưu vào tài khoản khi bấm Tiếp tục xác nhận.</p>}
                  {(!hasSavedAddress || changeShipping) && <fieldset disabled={savingAddress} className="grid gap-4 md:grid-cols-2" aria-label={hasSavedAddress ? 'Thông tin giao hàng riêng cho đơn này' : 'Địa chỉ giao hàng đầu tiên'}>
                    {SHIPPING_ADDRESS_FIELDS.map(([name, label, required, max]) => (
                      <label key={name} className="block text-sm font-medium text-gray-700">{label}{required ? ' *' : ''}
                        <input name={name} type={name === 'phone' ? 'tel' : 'text'} autoComplete={name === 'name' ? 'shipping name' : name === 'phone' ? 'shipping tel' : 'off'} required={required} maxLength={max} value={shippingInfo[name]} onChange={event => setShippingInfo(previous => ({ ...previous, [name]: event.target.value }))} className={inputClass + ' mt-2'} />
                      </label>
                    ))}
                    {hasSavedAddress && <p className="text-sm text-gray-500 md:col-span-2">Thông tin này chỉ dùng cho đơn hàng hiện tại, không lưu đè địa chỉ trong tài khoản.</p>}
                  </fieldset>}
                  <label className="block mt-4 text-sm font-medium">Ghi chú giao hàng<textarea name="notes" maxLength={1000} rows={3} value={shippingInfo.notes} onChange={event => setShippingInfo({ ...shippingInfo, notes: event.target.value })} className={inputClass + ' mt-2'} /></label>
                </section>
                <section className="bg-white rounded-lg shadow p-6 shop-panel">
                  <h2 className="text-xl font-bold mb-5 flex items-center gap-2"><FaCreditCard className="text-red-600" />Phương thức thanh toán</h2>
                  {[['COD', 'Thanh toán khi nhận giày (COD)'], ['VNPAY', 'VNPAY Sandbox (QR / thẻ test)']].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-3 border rounded-lg p-4 mb-3 cursor-pointer shop-payment-option"><input type="radio" name="paymentMethod" value={value} checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} />{label}</label>
                  ))}
                  {paymentMethod === 'VNPAY' && <p className="rounded-lg bg-blue-50 p-4 text-blue-900">Sau khi đặt hàng, bạn sẽ được chuyển đến VNPAY Sandbox để chọn QR hoặc thẻ test. Đây là môi trường thử nghiệm; trạng thái thanh toán được cập nhật tự động từ VNPAY.</p>}
                </section>
                <button type="submit" disabled={applyingVoucher || savingAddress} className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">{savingAddress ? 'Đang lưu địa chỉ...' : 'Tiếp tục xác nhận'}</button>
              </form>
            ) : (
              <section className="bg-white rounded-lg shadow p-6 shop-panel">
                <h2 className="text-xl font-bold mb-5 flex items-center gap-2"><FaShoppingBag className="text-red-600" />Xác nhận đơn giày</h2>
                <div className="bg-gray-50 p-4 rounded-lg mb-5 space-y-2"><p className="font-semibold">{shippingInfo.name} · {shippingInfo.phone}</p><p>{address}</p>{shippingInfo.notes && <p className="text-gray-600">Ghi chú: {shippingInfo.notes}</p>}<p className="text-sm">Thanh toán: {paymentMethod === 'COD' ? 'Khi nhận hàng' : 'VNPAY Sandbox (QR / thẻ test)'}</p></div>
                <div className="divide-y">
                  {cartItems.map(item => (
                    <div key={item._id} className="flex gap-4 py-4">
                      <img src={productImageUrl(item.product?.image || item.image)} alt={item.product?.name || item.name} className="w-16 h-16 object-contain rounded" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} />
                      <div className="flex-1"><p className="font-semibold">{item.product?.name || item.name}</p><p className="text-sm text-gray-600">{item.color ? 'Màu ' + item.color + ' · ' : ''}{item.size ? 'Size ' + item.size + ' · ' : ''}Số lượng: {item.quantity}</p></div>
                      <strong className="text-red-600">{money(cartItemPrice(item) * item.quantity)}</strong>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-6"><button disabled={submitting} onClick={() => setStep(1)} className="flex-1 bg-gray-200 py-3 rounded-lg font-semibold disabled:opacity-50">Sửa thông tin</button><button onClick={submitOrder} disabled={submitting || applyingVoucher} className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">{submitting ? 'Đang đặt hàng...' : 'Đặt giày'}</button></div>
              </section>
            )}
          </div>
          <aside className="space-y-6">
            <section className="bg-white rounded-lg shadow p-6 shop-panel">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><FaTag className="text-red-600" />Ưu đãi</h2>
              {voucherError && <p role="alert" className="text-sm text-red-600 mt-3">{voucherError}</p>}
              {quote && <p className="flex items-center justify-between gap-2 bg-green-50 text-green-700 p-3 rounded-lg mt-3 text-sm"><span>Đã áp dụng {quote.voucher.code}</span><button aria-label="Bỏ voucher" disabled={submitting} onClick={() => { setQuote(null); setVoucherError(''); }}><FaTimes /></button></p>}
              <VoucherSelector userId={user?._id} subtotal={subtotal} onChoose={applyVoucher} selectedCode={quote?.voucher?.code} busy={applyingVoucher || submitting} />
            </section>
            <section className="bg-white rounded-lg shadow p-6 shop-panel">
              <h2 className="text-xl font-bold mb-5">Tóm tắt đơn hàng</h2>
              <dl className="space-y-3 text-gray-600">
                <div className="flex justify-between gap-3"><dt>Tạm tính</dt><dd>{money(totals.itemsPrice)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Phí vận chuyển</dt><dd>{totals.shippingPrice === 0 ? 'Miễn phí' : money(totals.shippingPrice)}</dd></div>
                {totals.discountAmount > 0 && <div className="flex justify-between gap-3 text-green-700"><dt>Giảm thêm từ voucher</dt><dd>-{money(totals.discountAmount)}</dd></div>}
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
