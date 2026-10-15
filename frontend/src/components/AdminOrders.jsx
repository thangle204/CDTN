import { useState, useEffect, useRef } from 'react';
import { ordersAPI } from '../utils/api';
import DeliveryReturnActions, { canConfirmOrderRefund, isDeliveryReturnOrder } from './DeliveryReturnActions';
import { FaBox, FaPhone, FaMapMarkerAlt, FaEdit, FaSearch, FaMoneyBillWave } from 'react-icons/fa';

const statusTransitions = {
  'Đang xử lý': ['Đã xác nhận', 'Đã hủy'],
  'Đã xác nhận': ['Đang giao', 'Đã hủy'],
  'Đang giao': ['Đã giao'],
  'Đã giao': [],
  'Đã hủy': []
};

const getAllowedStatuses = (order) => (order.cancellationLock || order.deliveryReturn?.state === 'processing' ? [] : statusTransitions[order.orderStatus || 'Đang xử lý'] || [])
  .filter(status => !(order.paymentMethod === 'BANK' && !order.isPaid && ['Đang giao', 'Đã giao'].includes(status)));

const canUpdatePayment = (order, isPaid) => Boolean(order)
  && order.orderStatus !== 'Đã hủy' && !isDeliveryReturnOrder(order) && !order.cancellationLock
  && (isPaid || !['Đang giao', 'Đã giao'].includes(order.orderStatus));

const AdminOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const actionRef = useRef(null);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  useEffect(() => {
    mounted.current = true;
    fetchOrders();
    return () => { mounted.current = false; requestGeneration.current += 1; };
  }, []);

  const fetchOrders = async () => {
    const generation = ++requestGeneration.current;
    try {
      setError('');
      const response = await ordersAPI.getAllOrders('');
      if (mounted.current && generation === requestGeneration.current) setOrders(response.data);
    } catch {
      if (mounted.current && generation === requestGeneration.current) setError('Không tải được danh sách đơn hàng. Vui lòng thử lại.');
    } finally {
      if (mounted.current && generation === requestGeneration.current) setLoading(false);
    }
  };

  const beginAction = orderId => {
    if (!mounted.current || actionRef.current !== null) return false;
    actionRef.current = orderId;
    requestGeneration.current += 1;
    setActionId(orderId);
    return true;
  };
  const endAction = () => { actionRef.current = null; if (mounted.current) setActionId(null); };

  const handleUpdateStatus = async (orderId, status) => {
    const order = ordersRef.current.find(item => item._id === orderId);
    if (!order || !getAllowedStatuses(order).includes(status) || actionRef.current !== null) return;
    if (status === 'Đã hủy' && !window.confirm('Hủy đơn hàng và hoàn lại tồn kho?')) return;
    if (!beginAction(orderId)) return;
    try {
      await ordersAPI.updateStatus(orderId, status);
      alert('✅ Cập nhật trạng thái thành công!');
      setEditingOrderId(null);
      await fetchOrders();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      endAction();
    }
  };

  const handleUpdatePayment = async (orderId, isPaid) => {
    const order = ordersRef.current.find(item => item._id === orderId);
    if (!canUpdatePayment(order, isPaid) || actionRef.current !== null) return;
    const action = isPaid ? 'xác nhận đã thanh toán' : 'hủy xác nhận thanh toán';
    if (!window.confirm(`Bạn có chắc chắn muốn ${action} cho đơn hàng này?`)) return;

    if (!beginAction(orderId)) return;
    try {
      await ordersAPI.updatePaymentStatus(orderId, isPaid);
      alert(`✅ Đã ${action} thành công!`);
      await fetchOrders();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
      if ([400, 409].includes(error.response?.status)) await fetchOrders();
    } finally {
      endAction();
    }
  };

  const handleConfirmRefund = async (orderId) => {
    const order = ordersRef.current.find(item => item._id === orderId);
    if (!canConfirmOrderRefund(order) || actionRef.current !== null || !window.confirm('Bạn đã hoàn lại tiền cho khách hàng qua ngân hàng hoặc bằng tiền mặt? Thao tác này chỉ ghi nhận khoản hoàn tiền đã thực hiện, không tự chuyển tiền.')) return;
    if (!beginAction(orderId)) return;
    try {
      await ordersAPI.confirmRefund(orderId);
      alert('✅ Đã ghi nhận hoàn tiền cho khách hàng.');
      await fetchOrders();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      endAction();
    }
  };

  const handleDeliveryAction = async (orderId, data, type) => {
    const order = ordersRef.current.find(item => item._id === orderId);
    const allowed = order && !order.cancellationLock && (type === 'failure' ? order.orderStatus === 'Đang giao' : order.orderStatus === 'Giao thất bại');
    if (!allowed || !beginAction(orderId)) return false;
    try {
      const response = await (type === 'failure' ? ordersAPI.markDeliveryFailed(orderId, data) : ordersAPI.settleDeliveryReturn(orderId, data));
      if (mounted.current) {
        requestGeneration.current += 1;
        setOrders(previous => previous.map(item => item._id === orderId ? response.data : item));
        setEditingOrderId(null);
        setNewStatus('');
      }
      return true;
    } catch (failure) {
      // Reload persisted inspection after a partial write; the form resumes this exact snapshot.
      if (mounted.current) await fetchOrders();
      throw failure;
    } finally { endAction(); }
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

  // ✅ LỌC ĐƠN HÀNG THEO TRẠNG THÁI VÀ TÌM KIẾM - CLIENT SIDE
  const filteredOrders = orders.filter(order => {
    // Lọc theo trạng thái
    if (filterStatus !== 'all') {
      const orderStatus = order.orderStatus || 'Đang xử lý';
      if (orderStatus !== filterStatus) return false;
    }

    // ✅ TÌM KIẾM THEO MÃ ĐƠN HÀNG
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      const orderId = order._id.toLowerCase();
      
      // Tìm kiếm theo:
      // 1. Toàn bộ ID
      // 2. 6-8 ký tự cuối của ID
      // 3. Bất kỳ phần nào của ID
      return orderId.includes(search) || 
             orderId.slice(-8).includes(search) ||
             orderId.slice(-6).includes(search);
    }
    
    return true;
  });

  if (loading) {
    return <div className="text-center py-12">Đang tải...</div>;
  }

  return (
    <div>
      {error && <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">{error} <button onClick={fetchOrders} className="underline">Thử lại</button></div>}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Danh sách đơn hàng</h2>
          <p className="text-sm text-gray-600 mt-1">
            Hiển thị {filteredOrders.length}/{orders.length} đơn hàng
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <div className="relative min-w-0 w-full sm:w-auto">
            <FaSearch className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm mã đơn hàng..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border-2 border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500 w-full sm:w-64"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                title="Xóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full min-w-0 sm:w-auto border-2 border-gray-300 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="Đang xử lý">Đang xử lý</option>
            <option value="Đã xác nhận">Đã xác nhận</option>
            <option value="Đang giao">Đang giao</option>
            <option value="Đã giao">Đã giao</option>
            <option value="Đã hủy">Đã hủy</option>
            <option value="Giao thất bại">Giao thất bại</option>
            <option value="Đã xử lý hoàn hàng">Đã xử lý hoàn hàng</option>
          </select>
        </div>
      </div>

      {/* ✅ THÔNG BÁO KHI TÌM KIẾM */}
      {searchTerm && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-blue-700">
            <FaSearch className="inline mr-2" />
            Tìm kiếm: "<strong>{searchTerm}</strong>" - {filteredOrders.length} kết quả
          </p>
          <button
            onClick={() => setSearchTerm('')}
            className="text-blue-600 hover:text-blue-800 text-sm font-semibold"
          >
            Xóa tìm kiếm
          </button>
        </div>
      )}

      {/* DANH SÁCH ĐƠN HÀNG */}
      <div className="space-y-4">
        {filteredOrders.map((order) => (
          <div key={order._id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
            <div className="border-b border-gray-200 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <FaBox className="text-blue-600 text-xl" />
                    <h3 className="font-bold text-lg">Đơn hàng #{order._id.slice(-8)}</h3>
                  </div>
                  <p className="text-sm text-gray-500">
                    {new Date(order.createdAt).toLocaleString('vi-VN')}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    Khách hàng: <span className="font-medium">{order.user?.name || order.user?.email || 'N/A'}</span>
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  {editingOrderId === order._id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value)}
                        className="border-2 border-blue-500 rounded-md px-3 py-2 text-sm focus:outline-none"
                      >
                        <option value="">Chọn trạng thái</option>
                        {getAllowedStatuses(order).map(status => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <button
                        onClick={() => handleUpdateStatus(order._id, newStatus)}
                        disabled={!newStatus || actionId !== null}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-semibold"
                      >
                        Lưu
                      </button>
                      <button
                        disabled={actionId !== null}
                        onClick={() => {
                          setEditingOrderId(null);
                          setNewStatus('');
                        }}
                        className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 text-sm font-semibold"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={`px-4 py-2 rounded-full text-sm font-medium border ${getStatusColor(order.orderStatus || 'Đang xử lý')}`}>
                        {order.orderStatus || 'Đang xử lý'}
                      </span>
                      {getAllowedStatuses(order).length > 0 && <button
                        onClick={() => {
                          setEditingOrderId(order._id);
                          setNewStatus('');
                        }}
                        disabled={actionId !== null}
                        className="text-blue-600 hover:text-blue-800 p-2"
                        title="Cập nhật trạng thái"
                      >
                        <FaEdit className="text-xl" />
                      </button>}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6">
              <div className="mb-4 p-3 bg-gray-50 rounded">
                <h4 className="font-semibold text-sm text-gray-700 mb-2">Sản phẩm:</h4>
                {(order.orderItems || []).map((item, index) => (
                  <div key={item._id || `${item.product}-${item.color}-${item.size}-${index}`} className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700">
                      {item.name}{item.color ? ` · Màu ${item.color}` : ''}{item.size != null ? ` · Size ${item.size}` : ''} x {item.quantity}
                    </span>
                    <span className="font-medium text-gray-900">
                      {(item.price * item.quantity).toLocaleString()} ₫
                    </span>
                  </div>
                ))}
                {order.itemsPrice != null && <div className="flex justify-between text-sm"><span>Tiền giày:</span><span>{order.itemsPrice.toLocaleString()} ₫</span></div>}
                {order.shippingPrice != null && <div className="flex justify-between text-sm"><span>Phí vận chuyển:</span><span>{order.shippingPrice.toLocaleString()} ₫</span></div>}
                {order.discountAmount > 0 && <div className="flex justify-between text-sm text-green-700"><span>Giảm giá{order.voucherCode ? ` (${order.voucherCode})` : ''}:</span><span>-{order.discountAmount.toLocaleString()} ₫</span></div>}
                {order.voucherCode && !order.discountAmount && <p className="text-xs text-green-700">Voucher: {order.voucherCode}</p>}
                <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                  <span>Tổng:</span>
                  <span className="text-red-600">{order.totalPrice.toLocaleString()} ₫</span>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-blue-50 rounded">
                  <p className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <FaMapMarkerAlt className="text-blue-600" />
                    Thông tin giao hàng:
                  </p>
                  {order.shippingAddress?.name && <p className="font-medium text-gray-700">{order.shippingAddress.name}</p>}
                  <p className="text-gray-700">
                    {[order.shippingAddress?.address, order.shippingAddress?.ward, order.shippingAddress?.district, order.shippingAddress?.city].filter(Boolean).join(', ') || 'Chưa có địa chỉ giao hàng'}
                  </p>
                  {order.shippingAddress?.notes && <p className="mt-1 text-gray-600">Ghi chú: {order.shippingAddress.notes}</p>}
                </div>
                
                <div className="p-3 bg-green-50 rounded">
                  <p className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <FaPhone className="text-green-600" />
                    Số điện thoại:
                  </p>
                  <p className="text-gray-700">{order.shippingAddress?.phone || 'Chưa có số điện thoại'}</p>
                </div>
              </div>

              <div className="mt-4 p-4 bg-yellow-50 rounded-lg border-2 border-yellow-200">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-gray-700">
                      <strong>Thanh toán:</strong> {order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng (COD)' : order.paymentMethod === 'BANK' ? 'Chuyển khoản ngân hàng' : order.paymentMethod}
                    </p>
                    <p className={`text-sm font-semibold mt-1 ${order.isPaid ? 'text-green-700' : 'text-red-700'}`}>
                      {order.isPaid ? '✅ Đã thanh toán' : order.paymentMethod === 'BANK' ? '⏳ Chờ xác nhận chuyển khoản' : '⏳ Chưa thanh toán'}
                    </p>
                    {order.paymentMethod === 'BANK' && !order.isPaid && order.orderStatus !== 'Đã hủy' && !isDeliveryReturnOrder(order) && <p className="mt-1 text-xs text-gray-600">Xác nhận đã nhận tiền trước khi chuyển sang giao hàng.</p>}
                  </div>
                  
                  {canUpdatePayment(order, !order.isPaid) && <button
                    onClick={() => handleUpdatePayment(order._id, !order.isPaid)}
                    disabled={actionId !== null}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors ${
                      order.isPaid 
                        ? 'bg-red-100 text-red-700 hover:bg-red-200 border-2 border-red-300' 
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                    title={order.isPaid ? 'Hủy xác nhận thanh toán' : 'Xác nhận đã thanh toán'}
                  >
                    <FaMoneyBillWave />
                    {order.isPaid ? 'Hủy xác nhận' : 'Xác nhận đã TT'}
                  </button>}
                </div>
                
                {order.bankTransferInfo && (
                  <div className="mt-3 pt-3 border-t border-yellow-200">
                    <p className="text-xs text-gray-600 font-semibold mb-1">Thông tin chuyển khoản:</p>
                    <p className="text-xs text-gray-700">Ngân hàng: {order.bankTransferInfo.bankName}</p>
                    <p className="text-xs text-gray-700">STK: {order.bankTransferInfo.accountNumber}</p>
                    <p className="text-xs text-gray-700">Chủ TK: {order.bankTransferInfo.accountHolder}</p>
                    {order.bankTransferInfo.transferNote && <p className="text-xs text-gray-700">Nội dung: {order.bankTransferInfo.transferNote}</p>}
                  </div>
                )}
                {(order.orderStatus === 'Đã hủy' || order.orderStatus === 'Đã xử lý hoàn hàng' && order.deliveryReturn?.state === 'completed' && order.deliveryReturn.refundAmount > 0) && order.isPaid && (
                  <div className="mt-3 border-t border-yellow-200 pt-3">
                    <p className={`text-sm font-semibold ${order.refundStatus === 'refunded' ? 'text-green-700' : 'text-red-700'}`}>
                      {order.refundStatus === 'refunded' ? 'Đã hoàn tiền cho khách hàng' : 'Chờ hoàn tiền cho khách hàng'}
                    </p>
                    {order.refundedAt && <p className="text-xs text-gray-600">Ghi nhận lúc: {new Date(order.refundedAt).toLocaleString('vi-VN')}</p>}
                    {canConfirmOrderRefund(order) && <>
                      <p className="mt-1 text-xs text-gray-600">Hoàn tiền cho khách hàng trước, sau đó xác nhận tại đây. Hệ thống chỉ ghi nhận, không tự chuyển tiền.</p>
                      <button type="button" onClick={() => handleConfirmRefund(order._id)} disabled={actionId !== null} className="mt-2 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Xác nhận đã hoàn tiền</button>
                    </>}
                  </div>
                )}
              </div>
              <DeliveryReturnActions order={order} busy={actionId !== null}
                onMarkFailed={(id, data) => handleDeliveryAction(id, data, 'failure')}
                onSettleReturn={(id, data) => handleDeliveryAction(id, data, 'return')} />
            </div>
          </div>
        ))}
      </div>

      {/* THÔNG BÁO KHI KHÔNG TÌM THẤY */}
      {filteredOrders.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-600">
            {searchTerm 
              ? `Không tìm thấy đơn hàng với mã "${searchTerm}"` 
              : 'Không có đơn hàng nào'}
          </p>
        </div>
      )}
    </div>
  );
};

export default AdminOrders;
