import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../utils/api';
import { canPayWithVnpay, vnpaySandboxUrl } from '../utils/vnpay';

const VnpayPaymentButton = ({ order, onOrderUpdated, disabled = false }) => {
  const { user, loading: authLoading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const operationRef = useRef(null);
  const current = useRef(null);
  current.current = { account: user?._id, order, onOrderUpdated };
  const eligible = canPayWithVnpay(order);

  useEffect(() => {
    mounted.current = true;
    setBusy(false);
    setError('');
    setMessage('');
    return () => {
      mounted.current = false;
      operationRef.current?.controller.abort();
      operationRef.current = null;
    };
  }, [user?._id, order?._id, eligible]);

  const run = async (refresh = false) => {
    if (disabled || authLoading || !user || !canPayWithVnpay(current.current.order) || operationRef.current) return;
    const operation = { account: user._id, orderId: order._id, controller: new AbortController() };
    operationRef.current = operation;
    const active = () => mounted.current && operationRef.current === operation
      && current.current.account === operation.account && current.current.order?._id === operation.orderId
      && canPayWithVnpay(current.current.order);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (refresh) {
        const { data } = await ordersAPI.reconcileVnpayPayment(operation.orderId, { signal: operation.controller.signal });
        if (active()) {
          if (data?.order?._id !== operation.orderId) throw new Error('Kết quả đối chiếu chưa hợp lệ. Vui lòng thử lại.');
          setMessage(data.message || 'Đã đối chiếu trạng thái thanh toán với VNPAY.');
          current.current.onOrderUpdated?.(data.order);
        }
      } else {
        const { data } = await ordersAPI.createVnpayPayment(operation.orderId, { signal: operation.controller.signal });
        if (active()) window.location.assign(vnpaySandboxUrl(data.paymentUrl));
      }
    } catch (failure) {
      if (active()) setError(failure.response?.data?.message || failure.message || 'Không mở được VNPAY. Vui lòng thử lại.');
    } finally {
      if (active()) setBusy(false);
      if (operationRef.current === operation) operationRef.current = null;
    }
  };

  if (!eligible || !user || authLoading) return null;
  return (
    <div className="mt-4 space-y-3 text-left">
      <p className="text-sm text-gray-600">VNPAY Sandbox dùng để thử nghiệm thanh toán bằng QR hoặc thẻ test. Đơn chỉ được xác nhận đã thanh toán khi hệ thống nhận kết quả từ VNPAY.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-blue-800">{message}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={disabled || busy} onClick={() => run()} className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Đang xử lý VNPAY...' : 'Thanh toán VNPAY'}</button>
        <button type="button" disabled={disabled || busy} onClick={() => run(true)} className="rounded-lg border border-blue-700 px-4 py-3 font-semibold text-blue-700 disabled:opacity-50">Đối chiếu với VNPAY</button>
      </div>
    </div>
  );
};

export default VnpayPaymentButton;
