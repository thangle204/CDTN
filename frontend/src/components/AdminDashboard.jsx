import { useState, useEffect } from 'react';
import { ordersAPI, productsAPI } from '../utils/api';
import { FaBox, FaDollarSign, FaShoppingCart, FaUsers, FaTrophy, FaChartLine } from 'react-icons/fa';

const AdminDashboard = () => {
  const [overview, setOverview] = useState(null);
  const [topCustomers, setTopCustomers] = useState([]);
  const [bestSelling, setBestSelling] = useState([]);
  const [revenue, setRevenue] = useState([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        ordersAPI.getOverview(),
        ordersAPI.getTopCustomers(),
        productsAPI.getBestSelling(),
        ordersAPI.getRevenueStats('month'),
        productsAPI.getAllProducts()
      ]);
      const [overviewResult, customersResult, productsResult, revenueResult, allProductsResult] = results;
      setOverview(overviewResult.status === 'fulfilled' ? overviewResult.value.data : null);
      setTopCustomers(customersResult.status === 'fulfilled' ? customersResult.value.data : []);
      setBestSelling(productsResult.status === 'fulfilled' ? productsResult.value.data : []);
      setRevenue(revenueResult.status === 'fulfilled' ? revenueResult.value.data : []);
      setTotalProducts(allProductsResult.status === 'fulfilled'
        ? (allProductsResult.value.data.count ?? allProductsResult.value.data.products?.length ?? 0)
        : null);
      if (results.some(result => result.status === 'rejected')) {
        setError('Một số thống kê chưa tải được. Vui lòng thử lại.');
      }
    } catch {
      setError('Không tải được thống kê. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const prepareChartData = () => {
    const currentYear = new Date().getFullYear();
    const monthsData = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      year: currentYear,
      totalRevenue: 0,
      orderCount: 0
    }));

    revenue.forEach(item => {
      const monthIndex = item._id.month - 1;
      if (monthIndex >= 0 && monthIndex < 12 && item._id.year === currentYear) {
        monthsData[monthIndex] = {
          month: item._id.month,
          year: item._id.year,
          totalRevenue: item.totalRevenue,
          orderCount: item.orderCount
        };
      }
    });

    return monthsData;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const chartData = prepareChartData();
  const maxRevenue = Math.max(...chartData.map(d => d.totalRevenue));

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold mb-6">Tổng quan hệ thống</h2>
      {error && <div role="alert" className="rounded bg-red-50 p-3 text-red-700">{error} <button onClick={fetchDashboardData} className="underline">Thử lại</button></div>}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shop-stats">
        <div className="bg-white rounded-lg shadow p-6 shop-panel">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm mb-1">Tổng đơn hàng</p>
              <p className="text-3xl font-bold">{overview?.totalOrders ?? '—'}</p>
            </div>
            <FaShoppingCart className="text-5xl text-red-600 bg-red-50 rounded-xl p-3" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 shop-panel">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm mb-1">Doanh thu (₫)</p>
              <p className="text-3xl font-bold">
                {overview ? (overview.totalRevenue ?? 0).toLocaleString('vi-VN') : '—'}
              </p>
            </div>
            <FaDollarSign className="text-5xl text-green-700 bg-green-50 rounded-xl p-3" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 shop-panel">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm mb-1">Tổng sản phẩm</p>
              <p className="text-3xl font-bold">{totalProducts ?? '—'}</p>
            </div>
            <FaTrophy className="text-5xl text-gray-600 bg-gray-100 rounded-xl p-3" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 shop-panel">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm mb-1">Khách hàng</p>
              <p className="text-3xl font-bold">{overview?.totalCustomers ?? '—'}</p>
            </div>
            <FaUsers className="text-5xl text-amber-700 bg-amber-50 rounded-xl p-3" />
          </div>
        </div>
      </div>

      {/* Orders by Status */}
      <div className="bg-white rounded-lg shadow p-6 shop-panel">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <FaBox className="text-blue-600" />
          Trạng thái đơn hàng
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {overview?.ordersByStatus?.map((status) => (
            <div key={status._id} className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-800">{status.count}</p>
              <p className="text-sm text-gray-600 mt-1">{status._id || 'Đang xử lý'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Customers */}
        <div className="bg-white rounded-lg shadow p-6 shop-panel">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <FaUsers className="text-green-600" />
            Top 10 khách hàng theo tổng chi tiêu
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Khách hàng</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Số đơn</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Tổng chi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {topCustomers.map((customer, index) => (
                  <tr key={customer._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-500">#{index + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{customer.name}</p>
                          <p className="text-xs text-gray-500">{customer.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                        {customer.totalOrders}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-green-600">
                      {customer.totalSpent.toLocaleString('vi-VN')}₫
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Best Selling Products */}
        <div className="bg-white rounded-lg shadow p-6 shop-panel">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <FaTrophy className="text-yellow-600" />
            Sản phẩm bán chạy
          </h3>
          <div className="space-y-3">
            {bestSelling.map((product, index) => (
              <div key={product._id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <span className="font-bold text-gray-500 w-8">#{index + 1}</span>
                <img 
                  src={productImageUrl(product.image)}
                  alt={product.name}
                  className="w-12 h-12 object-cover rounded"
                  onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'https://placehold.co/50x50?text=Giay'; }}
                />
                <div className="flex-grow">
                  <p className="text-sm font-medium text-gray-900 line-clamp-1">{product.name}</p>
                  <p className="text-xs text-gray-500">{product.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-blue-600">{product.totalSold} bán</p>
                  <p className="text-xs text-green-600">{product.totalRevenue.toLocaleString('vi-VN')}₫</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Doanh thu của các đơn đã thanh toán trong năm hiện tại. */}
      <div className="bg-white rounded-lg shadow p-6 shop-panel">
        <div className="mb-6">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <FaChartLine className="text-red-600" />
            Doanh thu theo tháng (Năm {new Date().getFullYear()})
          </h3>
          <p className="text-sm text-gray-500 mt-1">Chỉ tính đơn đã thanh toán và chưa hủy.</p>
        </div>

        <div className="space-y-4">
          {/* Chọn một tháng để xem tổng tiền và số đơn. */}
          <div className="relative overflow-x-auto pt-16 pb-2" role="region" aria-label="Biểu đồ doanh thu theo tháng, cuộn ngang để xem thêm" tabIndex={0}>
            <div className="flex items-end justify-between h-64 gap-1 min-w-[480px] px-4">
              {chartData.map((item, index) => {
                const heightPercent = maxRevenue > 0 ? (item.totalRevenue / maxRevenue) * 100 : 0;
                const isSelected = selectedMonth === item.month;
                
                return (
                  <div key={index} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex flex-col items-center justify-end h-full">
                      <div className="relative w-full group cursor-pointer">
                        <div 
                          onClick={() => setSelectedMonth(current => current === item.month ? null : item.month)}
                          role="button"
                          tabIndex={0}
                          aria-label={`Xem doanh thu tháng ${item.month}`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedMonth(current => current === item.month ? null : item.month);
                            }
                          }}
                          className={`w-full rounded-t transition-all ${
                            isSelected 
                              ? 'bg-gradient-to-t from-red-600 to-red-800'
                              : 'bg-gradient-to-t from-red-200 to-red-500 hover:opacity-80'
                          }`}
                          style={{ height: `${heightPercent * 2.1}px`, minHeight: item.totalRevenue > 0 ? '4px' : '0' }}
                        >
                          {/* Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                            <div className="bg-gray-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                              <p className="font-bold">Tháng {item.month}</p>
                              <p className="text-green-300">{item.totalRevenue.toLocaleString('vi-VN')}₫</p>
                              <p className="text-orange-300">{item.orderCount} đơn</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Month label */}
                    <button type="button" onClick={() => setSelectedMonth(current => current === item.month ? null : item.month)} className={`text-xs font-semibold text-center ${
                      isSelected ? 'text-red-700' : 'text-gray-600'
                    }`}>
                      T{item.month}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Stats - Show selected month or total */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">
                {selectedMonth ? `Doanh thu tháng ${selectedMonth}` : 'Tổng doanh thu'}
              </p>
              <p className="text-lg font-bold text-green-600">
                {selectedMonth 
                  ? chartData[selectedMonth - 1].totalRevenue.toLocaleString('vi-VN')
                  : chartData.reduce((sum, item) => sum + item.totalRevenue, 0).toLocaleString('vi-VN')
                }₫
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">
                {selectedMonth ? `Đơn hàng tháng ${selectedMonth}` : 'Tổng đơn hàng'}
              </p>
              <p className="text-lg font-bold text-blue-600">
                {selectedMonth 
                  ? chartData[selectedMonth - 1].orderCount
                  : chartData.reduce((sum, item) => sum + item.orderCount, 0)
                }
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg shadow p-6 shop-panel">
        <h3 className="text-lg font-bold mb-4">Đơn hàng gần đây</h3>
        <div className="space-y-3">
          {overview?.recentOrders?.map((order) => (
            <div key={order._id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <div>
                <p className="font-semibold text-gray-800">#{order._id.slice(-8)}</p>
                <p className="text-sm text-gray-600">{order.user?.name}</p>
                <p className="text-xs text-gray-500">
                  {new Date(order.createdAt).toLocaleString('vi-VN')}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-red-600">{order.totalPrice.toLocaleString('vi-VN')}₫</p>
                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full">
                  {order.orderStatus || 'Đang xử lý'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
import { productImageUrl } from '../utils/productVariants';
