import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../utils/api';

const presentations = {
  paid: { title: 'Thanh toán thành công', color: 'text-green-700' },
  pending: { title: 'Đang chờ xác nhận thanh toán', color: 'text-amber-700' },
  failed: { title: 'Thanh toán chưa hoàn tất', color: 'text-red-700' },
  invalid: { title: 'Không xác minh được kết quả thanh toán', color: 'text-red-700' },
};

const POLL_INTERVAL_MS = 3000;
const POLL_WINDOW_MS = 60000;
const MAX_AUTOMATIC_CHECKS = 20;

const VnpayReturn = () => {
  const { search } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pollingStopped, setPollingStopped] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState('');
  const sessionRef = useRef(null);
  const reconciliationRef = useRef(null);
  const accountRef = useRef(user?._id);
  accountRef.current = user?._id;
  const searchRef = useRef(search);
  searchRef.current = search;

  const clearTimers = session => {
    clearTimeout(session.pollTimer);
    clearTimeout(session.deadlineTimer);
    session.pollTimer = null;
    session.deadlineTimer = null;
  };

  const stopPolling = session => {
    if (sessionRef.current !== session || searchRef.current !== session.search) return;
    clearTimers(session);
    session.expired = true;
    session.request?.controller.abort();
    session.request = null;
    setLoading(false);
    setPollingStopped(true);
  };

  const refresh = async () => {
    const session = sessionRef.current;
    if (!session || session.search !== search || searchRef.current !== search || session.request || reconciliationRef.current) return;
    clearTimeout(session.pollTimer);
    session.pollTimer = null;
    const request = { controller: new AbortController() };
    session.request = request;
    session.attempts += 1;
    const active = () => sessionRef.current === session && searchRef.current === session.search && session.request === request;
    setLoading(true);
    setError('');
    try {
      if (!search || search === '?') throw new Error('Không có dữ liệu kết quả từ VNPAY. Vui lòng kiểm tra trong Đơn hàng của tôi.');
      const { data } = await ordersAPI.verifyVnpayReturn(search, { signal: request.controller.signal });
      if (!Object.hasOwn(presentations, data?.status)) throw new Error('Kết quả thanh toán chưa hợp lệ. Vui lòng thử kiểm tra lại.');
      if (!active()) return;
      setResult({ data, search: session.search });
      if (data.status === 'pending') {
        if (session.expired || session.attempts >= MAX_AUTOMATIC_CHECKS || Date.now() >= session.deadline) {
          stopPolling(session);
        } else {
          setPollingStopped(false);
          session.deadlineTimer ??= setTimeout(() => stopPolling(session), session.deadline - Date.now());
          session.pollTimer = setTimeout(refresh, POLL_INTERVAL_MS);
        }
      } else {
        clearTimers(session);
        setPollingStopped(false);
      }
    } catch (failure) {
      if (active()) {
        clearTimers(session);
        setResult(null);
        setError(failure.response?.data?.message || failure.message || 'Chưa kiểm tra được kết quả thanh toán.');
      }
    } finally {
      if (active()) {
        session.request = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setReconciling(false);
    setReconcileMessage('');
    return () => {
      reconciliationRef.current?.controller.abort();
      reconciliationRef.current = null;
    };
  }, [user?._id, search]);

  useEffect(() => {
    const session = { search, request: null, attempts: 0, deadline: Date.now() + POLL_WINDOW_MS, expired: false, pollTimer: null, deadlineTimer: null };
    sessionRef.current = session;
    setResult(null);
    setPollingStopped(false);
    refresh();
    return () => {
      clearTimers(session);
      session.request?.controller.abort();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [search]);

  const verified = result?.search === search ? result.data : null;
  const reconcile = async () => {
    const session = sessionRef.current;
    if (authLoading || !user || verified?.status !== 'pending' || typeof verified.orderId !== 'string'
      || !session || session.search !== search || searchRef.current !== search
      || session.request || reconciliationRef.current) return;
    const operation = { account: user._id, controller: new AbortController() };
    reconciliationRef.current = operation;
    const active = () => reconciliationRef.current === operation && accountRef.current === operation.account
      && sessionRef.current === session && searchRef.current === session.search;
    clearTimers(session);
    setPollingStopped(true);
    setReconciling(true);
    setError('');
    setReconcileMessage('');
    let shouldRefresh = false;
    try {
      const txnRef = new URLSearchParams(session.search).get('vnp_TxnRef');
      const { data } = await ordersAPI.reconcileVnpayPayment(verified.orderId, { signal: operation.controller.signal, txnRef });
      if (!active()) return;
      if (data?.order?._id !== verified.orderId) throw new Error('Kết quả đối chiếu chưa hợp lệ. Vui lòng thử lại.');
      setReconcileMessage(data.message || 'Đã đối chiếu trạng thái thanh toán với VNPAY.');
      shouldRefresh = true;
    } catch (failure) {
      if (active()) setError(failure.response?.data?.message || failure.message || 'Chưa đối chiếu được với VNPAY. Vui lòng thử lại sau.');
    } finally {
      if (active()) setReconciling(false);
      if (reconciliationRef.current === operation) reconciliationRef.current = null;
    }
    if (shouldRefresh) await refresh();
  };

  const presentation = verified && presentations[verified.status];
  return (
    <div className="container mx-auto max-w-2xl px-4 py-16">
      <section className="rounded-xl bg-white p-6 text-center shadow sm:p-8 shop-panel">
        <p className="mb-4 font-semibold text-blue-700">VNPAY Sandbox · Thanh toán thử nghiệm</p>
        <h1 className={`mb-4 text-3xl font-bold ${presentation?.color || 'text-gray-800'}`}>{loading && !verified ? 'Đang kiểm tra thanh toán...' : presentation?.title || 'Chưa xác minh được thanh toán'}</h1>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
        {reconcileMessage && <p role="status" className="mb-4 rounded-lg bg-blue-50 p-4 text-blue-800">{reconcileMessage}</p>}
        {verified && <>
          <p className="mb-4 text-gray-700">{verified.message}</p>
          {typeof verified.orderId === 'string' && <p className="mb-4">Mã đơn: <strong>#{verified.orderId.slice(-8)}</strong></p>}
          {verified.status === 'pending' && <p role="status" className="mb-4 text-gray-600">{pollingStopped
            ? 'Chưa nhận được xác nhận thanh toán từ VNPAY. Vui lòng kiểm tra Đơn hàng của tôi hoặc liên hệ cửa hàng. Không cần thanh toán lại.'
            : 'Hệ thống đang tự kiểm tra xác nhận thanh toán từ VNPAY. Bạn không cần thanh toán lại.'}</p>}
          {verified.status === 'failed' && <p className="mb-4 text-gray-600">Bạn có thể mở lại thanh toán từ Đơn hàng của tôi nếu đơn vẫn còn hiệu lực.</p>}
        </>}
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" disabled={loading || reconciling} onClick={refresh} className="rounded-lg border border-red-700 px-5 py-3 font-semibold text-red-700 disabled:opacity-50">{loading ? 'Đang kiểm tra...' : 'Kiểm tra lại kết quả'}</button>
          {verified?.status === 'pending' && typeof verified.orderId === 'string' && user && !authLoading && <button type="button" disabled={loading || reconciling} onClick={reconcile} className="rounded-lg border border-red-700 px-5 py-3 font-semibold text-red-700 disabled:opacity-50">{reconciling ? 'Đang đối chiếu...' : 'Đối chiếu với VNPAY'}</button>}
          <Link to="/my-orders" className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white">Đơn hàng của tôi</Link>
        </div>
      </section>
    </div>
  );
};

export default VnpayReturn;
