import { useState, useEffect } from 'react';
import { customersAPI } from '../utils/api';
import { FaUser, FaEnvelope, FaPhone, FaShieldAlt, FaEye, FaEyeSlash, FaEdit, FaSave, FaTimes } from 'react-icons/fa';

const AdminAccounts = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  // ✅ EDIT STATE
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', password: '' });
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      setError('');
      const response = await customersAPI.getAllCustomers();
      setCustomers(response.data);
    } catch {
      setError('Không tải được danh sách tài khoản. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAdmin = async (customerId, currentStatus) => {
    const action = currentStatus ? 'gỡ quyền admin' : 'cấp quyền admin';
    if (!window.confirm(`Bạn có chắc chắn muốn ${action} cho người dùng này?`)) return;

    setActionId(customerId);
    try {
      await customersAPI.toggleAdmin(customerId);
      alert(`✅ Đã ${action} thành công!`);
      await fetchCustomers();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      setActionId(null);
    }
  };

  const handleToggleActive = async (customerId, currentStatus) => {
    const action = currentStatus ? 'vô hiệu hóa' : 'kích hoạt';
    if (!window.confirm(`Bạn có chắc chắn muốn ${action} tài khoản này?`)) return;

    setActionId(customerId);
    try {
      await customersAPI.toggleActive(customerId);
      
      alert(`✅ Đã ${action} tài khoản thành công!`);
      await fetchCustomers();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      setActionId(null);
    }
  };

  // ✅ EDIT FUNCTIONS
  const handleEdit = (customer) => {
    setEditingId(customer._id);
    setEditForm({
      name: customer.name || '',
      phone: customer.phone || '',
      password: '' // Không hiển thị mật khẩu cũ
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', phone: '', password: '' });
  };

  const handleSaveEdit = async (customerId) => {
    setEditLoading(true);
    try {
      if (!editForm.name.trim()) {
        alert('❌ Vui lòng nhập tên khách hàng.');
        return;
      }
      // Validate phone
      if (editForm.phone.trim()) {
        const phoneRegex = /^0\d{9}$/;
        if (!phoneRegex.test(editForm.phone.trim())) {
          alert('❌ Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0)');
          setEditLoading(false);
          return;
        }
      }

      const updateData = {
        name: editForm.name.trim(),
        phone: editForm.phone.trim()
      };

      // Chỉ gửi password nếu có nhập
      if (editForm.password) {
        if (editForm.password.trim().length < 6 || new TextEncoder().encode(editForm.password).length > 72) {
          alert('❌ Mật khẩu cần ít nhất 6 ký tự không chỉ là khoảng trắng và tối đa 72 byte.');
          setEditLoading(false);
          return;
        }
        updateData.password = editForm.password;
      }

      await customersAPI.updateCustomerByAdmin(customerId, updateData);
      
      alert('✅ Cập nhật thông tin thành công!');
      setEditingId(null);
      setEditForm({ name: '', phone: '', password: '' });
      await fetchCustomers();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      setEditLoading(false);
    }
  };

  const filteredCustomers = customers.filter(customer => {
    const matchesType = filterType === 'all' || 
                       (filterType === 'admin' && customer.isAdmin) ||
                       (filterType === 'user' && !customer.isAdmin);
    
    const matchesSearch = !searchTerm || 
                         customer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesType && matchesSearch;
  });

  if (loading) {
    return <div className="text-center py-12">Đang tải...</div>;
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">
          {error} <button onClick={fetchCustomers} className="underline">Thử lại</button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Quản lý tài khoản</h2>
          <p className="text-sm text-gray-600 mt-1">
            Hiển thị {filteredCustomers.length}/{customers.length} tài khoản
          </p>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Tìm kiếm tên, email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border-2 border-gray-300 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Tất cả</option>
            <option value="admin">Admin</option>
            <option value="user">Người dùng</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thông tin</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Liên hệ</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thống kê</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quyền hạn</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trạng thái</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thao tác</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredCustomers.map((customer) => (
                <tr key={customer._id} className={customer.isActive === false ? 'bg-gray-50' : ''}>
                  <td className="px-6 py-4">
                    {editingId === customer._id ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full border border-blue-500 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Tên"
                      />
                    ) : (
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <FaUser className="text-blue-600" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{customer.name || 'N/A'}</div>
                          <div className="text-xs text-gray-500">
                            Tham gia: {new Date(customer.createdAt).toLocaleDateString('vi-VN')}
                          </div>
                        </div>
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    {editingId === customer._id ? (
                      <div className="space-y-2">
                        <div className="text-xs text-gray-600">Email: {customer.email}</div>
                        <input
                          type="tel"
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full border border-blue-500 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0xxxxxxxxx"
                        />
                        <input
                          type="password"
                          value={editForm.password}
                          onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                          className="w-full border border-blue-500 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Mật khẩu mới (tùy chọn)"
                        />
                      </div>
                    ) : (
                      <div className="text-sm space-y-1">
                        <div className="flex items-center text-gray-700">
                          <FaEnvelope className="mr-2 text-gray-400" size={12} />
                          {customer.email}
                        </div>
                        {customer.phone && (
                          <div className="flex items-center text-gray-700">
                            <FaPhone className="mr-2 text-gray-400" size={12} />
                            {customer.phone}
                          </div>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <div className="text-sm space-y-1">
                      <div className="text-gray-700">
                        Đơn hàng: <span className="font-semibold">{customer.totalOrders || 0}</span>
                      </div>
                      <div className="text-green-600 font-semibold">
                        {(customer.totalSpent || 0).toLocaleString()}₫
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      customer.isAdmin 
                        ? 'bg-purple-100 text-purple-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {customer.isAdmin ? (
                        <><FaShieldAlt className="mr-1" /> Admin</>
                      ) : (
                        <><FaUser className="mr-1" /> User</>
                      )}
                    </span>
                  </td>

                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      customer.isActive !== false
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {customer.isActive !== false ? '✓ Hoạt động' : '✗ Vô hiệu'}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-sm space-x-2">
                    {editingId === customer._id ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(customer._id)}
                          disabled={editLoading}
                          className="px-3 py-1 rounded text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          title="Lưu"
                        >
                          {editLoading ? '...' : <FaSave className="inline" />}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={editLoading}
                          className="px-3 py-1 rounded text-xs font-semibold bg-gray-300 text-gray-700 hover:bg-gray-400"
                          title="Hủy"
                        >
                          <FaTimes className="inline" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEdit(customer)}
                          disabled={actionId !== null}
                          className="px-3 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200"
                          title="Sửa thông tin"
                        >
                          <FaEdit className="inline" />
                        </button>
                        
                        <button
                          onClick={() => handleToggleAdmin(customer._id, customer.isAdmin)}
                          disabled={actionId !== null}
                          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                            customer.isAdmin
                              ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              : 'bg-purple-600 text-white hover:bg-purple-700'
                          }`}
                          title={customer.isAdmin ? 'Gỡ quyền admin' : 'Cấp quyền admin'}
                        >
                          {customer.isAdmin ? 'Gỡ Admin' : 'Cấp Admin'}
                        </button>
                        
                        {!customer.isAdmin && (
                          <button
                            onClick={() => handleToggleActive(customer._id, customer.isActive !== false)}
                            disabled={actionId !== null}
                            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                              customer.isActive !== false
                                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                : 'bg-green-100 text-green-700 hover:bg-green-200'
                            }`}
                            title={customer.isActive !== false ? 'Vô hiệu hóa' : 'Kích hoạt'}
                          >
                            {customer.isActive !== false ? (
                              <><FaEyeSlash className="inline mr-1" />Vô hiệu</>
                            ) : (
                              <><FaEye className="inline mr-1" />Kích hoạt</>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredCustomers.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow mt-4">
          <p className="text-gray-600">Không tìm thấy tài khoản nào</p>
        </div>
      )}
    </div>
  );
};

export default AdminAccounts;
