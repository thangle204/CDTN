import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FaCog, FaLock, FaShoePrints, FaBoxOpen, FaTag, FaChartBar, FaUsers } from 'react-icons/fa';
import AdminDashboard from '../components/AdminDashboard';
import AdminProducts from '../components/AdminProducts';
import AdminOrders from '../components/AdminOrders';
import AdminVouchers from '../components/AdminVouchers';
import AdminAccounts from '../components/AdminAccounts';

const Admin = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Đang tải...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-20 shop-page">
          <div className="max-w-md mx-auto text-center py-20 bg-white rounded-lg shadow shop-panel">
            <FaLock className="text-6xl text-gray-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Yêu cầu đăng nhập</h2>
            <p className="text-gray-600 mb-6">Bạn cần đăng nhập để truy cập trang này</p>
            <Link to="/login" className="inline-block bg-red-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors">
              Đăng nhập ngay
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 shop-page">
        {/* Header */}
        <div className="mb-6 shop-admin-heading">
          <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3 mb-2">
            <FaCog className="text-red-600" />
            Quản trị hệ thống
          </h1>
          <p className="text-gray-600">
            Xin chào, <span className="font-semibold">{user.name || user.email}</span>
            {user.isAdmin && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-1 rounded">ADMIN</span>}
          </p>
          </div>
          <Link to="/products" className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Xem cửa hàng →</Link>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6 shop-panel">
          <div className="overflow-x-auto shop-admin-tabs">
            <nav className="flex" aria-label="Chức năng quản trị">
              <button
                onClick={() => setActiveTab('dashboard')}
                aria-current={activeTab === 'dashboard' ? 'page' : undefined}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === 'dashboard' ? "border-red-500 text-red-600" : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <FaChartBar className="inline mr-2" />
                Tổng quan
              </button>
              <button
                onClick={() => setActiveTab('products')}
                aria-current={activeTab === 'products' ? 'page' : undefined}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === 'products' ? "border-red-500 text-red-600" : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <FaShoePrints className="inline mr-2" />
                Sản phẩm
              </button>
              <button
                onClick={() => setActiveTab('orders')}
                aria-current={activeTab === 'orders' ? 'page' : undefined}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === 'orders' ? "border-red-500 text-red-600" : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <FaBoxOpen className="inline mr-2" />
                Đơn hàng
              </button>
              <button
                onClick={() => setActiveTab('vouchers')}
                aria-current={activeTab === 'vouchers' ? 'page' : undefined}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === 'vouchers' ? "border-red-500 text-red-600" : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <FaTag className="inline mr-2" />
                Mã ưu đãi
              </button>
              <button
                onClick={() => setActiveTab('accounts')}
                aria-current={activeTab === 'accounts' ? 'page' : undefined}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === 'accounts' ? "border-red-500 text-red-600" : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <FaUsers className="inline mr-2" />
                Tài khoản
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="p-6">
            {activeTab === 'dashboard' && <AdminDashboard />}
            {activeTab === 'products' && <AdminProducts />}
            {activeTab === 'orders' && <AdminOrders />}
            {activeTab === 'vouchers' && <AdminVouchers />}
            {activeTab === 'accounts' && <AdminAccounts />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;
