import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../utils/api';
import { productImageUrl } from '../utils/productVariants';
import { DeliveryReturnSummary } from '../components/DeliveryReturnActions';
import VnpayPaymentButton from '../components/VnpayPaymentButton';
import OrderReviews from '../components/OrderReviews';
import { canReviewOrder } from '../utils/orderReviews';
import { canPayWithVnpay } from '../utils/vnpay';
import { FaBox, FaPhone, FaMapMarkerAlt, FaCheckCircle, FaClock, FaTruck, FaTimesCircle } from 'react-icons/fa';

const MyOrders = () => {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const accountRef = useRef(user?._id);
  const cancelRef = useRef(null);
  const ordersRef = useRef(orders);
  accountRef.current = user?._id;
  ordersRef.current = orders;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current += 1; };
  }, []);

  useEffect(() => {
    requestGeneration.current += 1;
    setOrders([]);
    setError('');
    setCanceling(false);
    if (authLoading) return;
    if (user) {
      fetchOrders();
    } else {
      setLoading(false);
    }
    return () => { requestGeneration.current += 1; };
  }, [user?._id, authLoading]);

  const fetchOrders = async () => {
    const account = accountRef.current;
    if (!account || cancelRef.current?.account === account) return;
    const generation = ++requestGeneration.current;
    const active = () => mounted.current && accountRef.current === account && requestGeneration.current === generation;
    try {
      setError('');
      setLoading(true);
      const response = await ordersAPI.getMyOrders();
      if (active()) setOrders(response.data);
    } catch (error) {
      if (active()) setError(error.response?.data?.message || 'Không thể tải đơn hàng. Vui lòng thử lại.');
    } finally {
      if (active()) setLoading(false);
    }
  };

  const handleCancelOrder = async (orderId) => {
    const account = accountRef.current;
    if (!account || cancelRef.current || ordersRef.current.find(order => order._id === orderId)?.orderStatus !== 'Đang xử lý') return;
    const isConfirm = window.confirm(
      "⚠️ Bạn có chắc chắn muốn hủy đơn hàng này?\n\n" +
      "Số lượng sản phẩm sẽ được hoàn trả về kho."
    );
    
    if (!isConfirm) return;

    const operation = { account, orderId };
    cancelRef.current = operation;
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    const active = () => mounted.current && accountRef.current === account && requestGeneration.current === generation;
    setLoading(false);
    setCanceling(true);
    try {
      const response = await ordersAPI.cancelOrder(orderId);
      
      if (active()) setOrders(previous => previous.map(order => order._id === orderId ? response.data.order || { ...order, orderStatus: 'Đã hủy' } : order));
      
    } catch (error) {
      if (active()) setError(error.response?.data?.message || 'Không thể hủy đơn hàng.');
    } finally {
      if (cancelRef.current === operation) cancelRef.current = null;
      if (active()) setCanceling(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Đang xử lý':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Đã xác nhận':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Đang giao':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'Đã giao':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'Đã hủy':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'Giao thất bại':
        return 'bg-orange-100 text-orange-900 border-orange-300';
      case 'Đã xử lý hoàn hàng':
        return 'bg-slate-100 text-slate-800 border-slate-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Đang xử lý':
        return <FaClock className="inline mr-1" />;
      case 'Đã xác nhận':
        return <FaCheckCircle className="inline mr-1" />;
      case 'Đang giao':
        return <FaTruck className="inline mr-1" />;
      case 'Đã giao':
        return <FaCheckCircle className="inline mr-1" />;
      case 'Đã hủy':
      case 'Giao thất bại':
      case 'Đã xử lý hoàn hàng':
        return <FaTimesCircle className="inline mr-1" />;
      default:
        return null;
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Đang tải đơn hàng...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-2xl mx-auto text-center py-20 bg-white rounded-lg shadow shop-panel">
            <FaBox className="text-6xl text-gray-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Chưa có đơn hàng</h2>
            <p className="text-gray-600 mb-6">
              Đăng nhập để xem đơn hàng hoặc bắt đầu mua sắm ngay!
            </p>
            <div className="flex gap-4 justify-center">
              <Link
                to="/login"
                className="bg-red-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors"
              >
                Đăng nhập
              </Link>
              <Link
                to="/products"
                className="bg-white border-2 border-red-600 text-red-600 px-8 py-3 rounded-lg font-semibold hover:bg-red-50 transition-colors"
              >
                Mua sắm ngay
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold mb-8 text-gray-800">Đơn hàng của tôi</h1>
          
          <div className="max-w-2xl mx-auto text-center py-20 bg-white rounded-lg shadow shop-panel">
            <FaBox className="text-6xl text-gray-300 mx-auto mb-4" />
            {error ? <div role="alert"><p className="text-red-600 mb-4">{error}</p><button onClick={fetchOrders} className="text-red-600 underline">Thử lại</button></div> : <p className="text-gray-600 text-xl font-medium mb-2">Bạn chưa có đơn hàng nào</p>}
            <p className="text-gray-500 mb-6">Hãy đặt hàng ngay để nhận ưu đãi!</p>
            <Link
              to="/products"
              className="inline-block bg-red-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors"
            >
              Mua sắm ngay
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 shop-page">
        <h1 className="text-3xl font-bold mb-8 text-gray-800 flex items-center gap-3">
          <FaBox className="text-red-600" />
          Đơn hàng của tôi
        </h1>
        {error && <div role="alert" className="p-4 mb-6 bg-red-50 text-red-700 rounded-lg">{error}</div>}

        {canceling && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl text-center shop-panel">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
              <p className="text-gray-700 font-semibold">Đang hủy đơn hàng...</p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {orders.map((order) => (
            <div key={order._id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow shop-panel">
              {/* Order Header */}
              <div className="border-b border-gray-200 p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-lg">Đơn hàng #{order._id.slice(-8)}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(order.orderStatus || 'Đang xử lý')}`}>
                        {getStatusIcon(order.orderStatus || 'Đang xử lý')}
                        {order.orderStatus || 'Đang xử lý'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {new Date(order.createdAt).toLocaleString('vi-VN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  
                  <div className="text-left sm:text-right">
                    <p className="text-sm text-gray-600 mb-1">Tổng tiền</p>
                    <p className="text-2xl font-bold text-red-600">{order.totalPrice.toLocaleString('vi-VN')}₫</p>
                  </div>
                </div>
              </div>

              {/* Order Body */}
              <div className="p-4 sm:p-6">
                {/* Order Items */}
                <div className="mb-4">
                  <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <FaBox className="text-blue-600" />
                    Sản phẩm đã đặt
                  </h4>
                  <div className="space-y-3">
                    {order.orderItems.map((item) => (
                      <div key={item._id} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                        <img
                          src={productImageUrl(item.image)}
                          alt={item.name}
                          className="w-16 h-16 object-cover rounded"
                          onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }}
                        />
                        <div className="flex-grow">
                          <p className="font-medium text-sm line-clamp-2">{item.name}</p>
                          {(item.color || item.size) && <p className="text-sm text-gray-600">{item.color ? `Màu: ${item.color}${item.size ? ' · ' : ''}` : ''}{item.size ? `Size: ${item.size}` : ''}</p>}
                          <p className="text-sm text-gray-600">Số lượng: {item.quantity}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-red-600">
                            {(item.price * item.quantity).toLocaleString('vi-VN')}₫
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Shipping Info */}
                <div className="grid md:grid-cols-2 gap-4 p-4 bg-blue-50 rounded-lg">
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <FaMapMarkerAlt className="text-blue-600" />
                      Địa chỉ giao hàng
                    </h4>
                    <p className="text-sm text-gray-700">
                      {order.shippingAddress.name && <span className="block font-medium">{order.shippingAddress.name}</span>}
                      {[order.shippingAddress.address, order.shippingAddress.ward, order.shippingAddress.district, order.shippingAddress.city].filter(Boolean).join(', ')}
                      {order.shippingAddress.notes && <span className="block mt-1">Ghi chú: {order.shippingAddress.notes}</span>}
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <FaPhone className="text-blue-600" />
                      Số điện thoại
                    </h4>
                    <p className="text-sm text-gray-700">{order.shippingAddress.phone}</p>
                  </div>
                </div>

                {/* Payment Method */}
                {typeof order.itemsPrice === 'number' && <div className="mt-4 text-sm text-gray-600 space-y-1"><p>Tiền giày: {order.itemsPrice.toLocaleString('vi-VN')}₫</p><p>Phí vận chuyển: {(order.shippingPrice || 0).toLocaleString('vi-VN')}₫</p>{order.discountAmount > 0 && <p className="text-green-700">Giảm giá: -{order.discountAmount.toLocaleString('vi-VN')}₫</p>}{order.voucher?.code && <p>Voucher: {order.voucher.code}</p>}</div>}
                <div className="mt-4 p-3 bg-yellow-50 rounded-lg border-l-4 border-yellow-400">
                  <p className="text-sm text-gray-700">
                    <strong>Phương thức thanh toán:</strong> {order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng' : order.paymentMethod === 'VNPAY' ? 'VNPAY Sandbox (QR / thẻ test)' : 'Chuyển khoản'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    <strong>Trạng thái thanh toán:</strong> {order.isPaid ? '✓ Đã thanh toán' : '⏳ Chưa thanh toán'}
                  </p>
                  {order.orderStatus === 'Đã hủy' && order.isPaid && <p className="text-sm mt-2 text-blue-800"><strong>Hoàn tiền:</strong> {order.refundStatus === 'refunded' ? 'Cửa hàng đã xác nhận hoàn tiền' : 'Đang chờ cửa hàng xử lý hoàn tiền'}{order.refundedAt && ` (${new Date(order.refundedAt).toLocaleString('vi-VN')})`}</p>}
                  {order.paymentMethod === 'VNPAY' && order.paymentReviewRequired && <p className="mt-2 text-sm text-amber-900">Cần đối soát khoản thanh toán dư; chưa xác nhận hoàn tiền toàn bộ. Vui lòng liên hệ cửa hàng để được hỗ trợ.</p>}
                  {order.paymentMethod === 'VNPAY' && !order.isPaid && order.orderStatus !== 'Đã hủy' && order.paymentDeadline && <p className="mt-2 text-sm text-gray-700">Hạn chờ thanh toán: {new Date(order.paymentDeadline).toLocaleString('vi-VN')}. Sau hạn, hệ thống đối soát trước khi tự hủy và trả lượt mã.</p>}
                  {order.paymentExpiryReviewRequired && !order.isPaid && order.orderStatus !== 'Đã hủy' && <p className="mt-2 text-sm text-amber-900">Chưa xác định được kết quả VNPAY. Hệ thống đang kiểm tra lại; đơn và ưu đãi được giữ để đối soát.</p>}
                  {order.autoCancelledAt && <p className="mt-2 text-sm text-gray-600">Đơn tự hủy sau thời hạn chờ thanh toán và kiểm tra kết quả.</p>}
                </div>

                {canPayWithVnpay(order) && <VnpayPaymentButton order={order} disabled={canceling} onOrderUpdated={updated => {
                  if (mounted.current && accountRef.current === user?._id && updated?._id === order._id) {
                    requestGeneration.current += 1;
                    setOrders(previous => previous.map(item => item._id === updated._id ? updated : item));
                  }
                }} />}

                {/* Actions */}
                <DeliveryReturnSummary order={order} />
                {canReviewOrder(order) && <OrderReviews order={order} />}
                <div className="mt-4 flex gap-3">
                  {(order.orderStatus === 'Đang xử lý' || order.cancellationPending) && (
                    <button
                      onClick={() => handleCancelOrder(order._id)}
                      disabled={canceling}
                      className="flex-1 bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {canceling ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Đang hủy...
                        </>
                      ) : (
                        <>
                          <FaTimesCircle />
                          {order.cancellationPending ? 'Tiếp tục hoàn tất hủy đơn' : 'Hủy đơn hàng'}
                        </>
                      )}
                    </button>
                  )}
                  
                  <Link to="/products" className="flex-1 text-center bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-300">Tiếp tục chọn giày</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MyOrders;
