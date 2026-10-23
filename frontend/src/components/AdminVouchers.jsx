import { useState, useEffect } from 'react';
import { vouchersAPI } from '../utils/api';
import { FaPlus, FaEdit, FaEye, FaEyeSlash, FaCheckCircle, FaTimesCircle, FaSearch } from 'react-icons/fa';

const getVoucherStatus = (voucher, now = new Date()) => {
  if (!voucher.isActive) return 'inactive';
  if (new Date(voucher.endDate) < now) return 'expired';
  if (new Date(voucher.startDate) > now) return 'upcoming';
  if (voucher.usedCount >= voucher.maxUses) return 'exhausted';
  return 'active';
};

const voucherStatusLabels = {
  active: 'Hoạt động',
  inactive: 'Đã ẩn',
  expired: 'Hết hạn',
  upcoming: 'Chưa bắt đầu',
  exhausted: 'Hết lượt dùng'
};

const toDateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const AdminVouchers = () => {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState(''); // ✅ TÌM KIẾM
  const [formData, setFormData] = useState({
    code: '',
    description: '',
    discount: '',
    type: 'fixed',
    minOrder: '',
    maxUses: '',
    startDate: '',
    endDate: '',
    isActive: true
  });

  useEffect(() => {
    fetchVouchers();
  }, []);

  const fetchVouchers = async () => {
    try {
      setError('');
      const response = await vouchersAPI.getAllVouchersAdmin();
      setVouchers(response.data);
    } catch {
      setError('Không tải được danh sách voucher. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
      ...(name === 'type' && value === 'shipping' ? { discount: 30000 } : {})
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const code = formData.code.trim().toUpperCase();
    const discount = formData.type === 'shipping' ? 30000 : Number(formData.discount);
    const minOrder = Number(formData.minOrder || 0);
    const maxUses = Number(formData.maxUses || 100);
    const startDate = formData.startDate
      ? new Date(`${formData.startDate}T00:00:00`)
      : new Date(editingVoucher?.startDate || Date.now());
    const endDate = new Date(`${formData.endDate}T23:59:59.999`);
    if (!/^[A-Z0-9_-]{1,50}$/.test(code) || !formData.description.trim()) {
      alert('❌ Nhập mã voucher (chữ, số, dấu gạch) và mô tả.');
      return;
    }
    if (formData.discount === '' && formData.type !== 'shipping' || !Number.isSafeInteger(discount) || discount < 0 || (formData.type === 'percent' && discount > 100)) {
      alert('❌ Mức giảm phải là số nguyên không âm; phần trăm không quá 100.');
      return;
    }
    if (!Number.isSafeInteger(minOrder) || minOrder < 0 || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses < (editingVoucher?.usedCount || 0)) {
      alert('❌ Đơn tối thiểu phải không âm, số lượt dùng phải là số nguyên dương và không nhỏ hơn số lượt đã dùng.');
      return;
    }
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
      alert('❌ Ngày kết thúc phải từ ngày bắt đầu trở đi.');
      return;
    }
    const payload = { ...formData, code, description: formData.description.trim(), discount, minOrder, maxUses, startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    setSaving(true);
    try {
      if (editingVoucher) {
        await vouchersAPI.updateVoucher(editingVoucher._id, payload);
        alert('✅ Cập nhật voucher thành công!');
      } else {
        await vouchersAPI.createVoucher(payload);
        alert('✅ Thêm voucher thành công!');
      }
      setShowModal(false);
      setEditingVoucher(null);
      resetForm();
      await fetchVouchers();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (voucher) => {
    setEditingVoucher(voucher);
    setFormData({
      code: voucher.code,
      description: voucher.description,
      discount: voucher.discount,
      type: voucher.type,
      minOrder: voucher.minOrder ?? 0,
      maxUses: voucher.maxUses ?? 100,
      startDate: toDateInput(voucher.startDate),
      endDate: toDateInput(voucher.endDate),
      isActive: voucher.isActive
    });
    setShowModal(true);
  };

  // Kích hoạt hoặc ẩn voucher mà không xóa lịch sử sử dụng.
  const handleToggleVisibility = async (id, currentStatus) => {
    const action = currentStatus ? 'ẩn' : 'hiển thị';
    if (!window.confirm(`Bạn có chắc chắn muốn ${action} voucher này?`)) return;
    setActionId(id);
    try {
      await vouchersAPI.toggleVoucher(id);
      alert(`✅ Đã ${action} voucher thành công!`);
      await fetchVouchers();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      setActionId(null);
    }
  };

  const resetForm = () => {
    setFormData({
      code: '',
      description: '',
      discount: '',
      type: 'fixed',
      minOrder: '',
      maxUses: '',
      startDate: '',
      endDate: '',
      isActive: true
    });
  };

  const getTypeLabel = (type) => {
    switch(type) {
      case 'fixed': return 'Giảm cố định';
      case 'percent': return 'Giảm %';
      case 'shipping': return 'Miễn phí ship';
      default: return type;
    }
  };

  // ✅ LỌC THEO TRẠNG THÁI VÀ TÌM KIẾM
  const filteredVouchers = vouchers.filter(voucher => {
    // Lọc theo trạng thái
    if (filterStatus !== 'all' && getVoucherStatus(voucher) !== filterStatus) return false;
    
    // ✅ Tìm kiếm theo mã
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      return (
        voucher.code?.toLowerCase().includes(search) ||
        voucher.description?.toLowerCase().includes(search)
      );
    }
    
    return true;
  });

  if (loading) {
    return <div className="text-center py-12">Đang tải...</div>;
  }

  return (
    <div>
      {error && <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">{error} <button onClick={fetchVouchers} className="underline">Thử lại</button></div>}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Quản lý Vouchers</h2>
          <p className="text-sm text-gray-600 mt-1">
            Hiển thị {filteredVouchers.length}/{vouchers.length} voucher
          </p>
        </div>
        
        <div className="flex gap-3 flex-wrap">
          {/* ✅ TÌM KIẾM */}
          <div className="relative">
            <FaSearch className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm mã voucher..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border-2 border-gray-300 rounded-md text-sm focus:outline-none focus:border-orange-500 w-64"
            />
          </div>
          
          {/* LỌC TRẠNG THÁI */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="all">Tất cả</option>
            <option value="active">Đang hoạt động</option>
            <option value="inactive">Đã ẩn</option>
            <option value="expired">Đã hết hạn</option>
            <option value="upcoming">Chưa bắt đầu</option>
            <option value="exhausted">Hết lượt dùng</option>
          </select>
          
          <button
            onClick={() => {
              setEditingVoucher(null);
              resetForm();
              setShowModal(true);
            }}
            className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 flex items-center space-x-2 whitespace-nowrap"
          >
            <FaPlus />
            <span>Thêm voucher</span>
          </button>
        </div>
      </div>

      {/* ✅ THÔNG BÁO KHI TÌM KIẾM */}
      {searchTerm && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-orange-700">
            <FaSearch className="inline mr-2" />
            Tìm kiếm: "<strong>{searchTerm}</strong>" - {filteredVouchers.length} kết quả
          </p>
          <button
            onClick={() => setSearchTerm('')}
            className="text-orange-600 hover:text-orange-800 text-sm font-semibold"
          >
            Xóa tìm kiếm
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden shop-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mã</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mô tả</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Loại</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Giảm giá</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Đơn tối thiểu</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Đã dùng/Tổng</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trạng thái</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thao tác</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredVouchers.map((voucher) => (
                <tr key={voucher._id} className={!voucher.isActive ? 'bg-gray-50 opacity-60' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-bold text-orange-600">{voucher.code}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">{voucher.description}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm">{getTypeLabel(voucher.type)}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-semibold text-red-600">
                      {voucher.type === 'shipping' ? 'Miễn phí vận chuyển' : voucher.type === 'percent' ? `${voucher.discount}%` : `${voucher.discount.toLocaleString('vi-VN')}₫`}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {voucher.minOrder.toLocaleString('vi-VN')}₫
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={voucher.usedCount >= voucher.maxUses ? 'text-red-600 font-semibold' : ''}>
                      {voucher.usedCount}/{voucher.maxUses}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getVoucherStatus(voucher) === 'active' ? (
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        <FaCheckCircle className="mr-1" /> Hoạt động
                      </span>
                    ) : (
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                        <FaTimesCircle className="mr-1" /> {voucherStatusLabels[getVoucherStatus(voucher)]}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    <button
                      onClick={() => handleEdit(voucher)}
                      className="text-orange-600 hover:text-orange-900 p-2"
                      title="Chỉnh sửa"
                    >
                      <FaEdit />
                    </button>
                    
                    {/* Kích hoạt hoặc ẩn voucher. */}
                    <button
                      onClick={() => handleToggleVisibility(voucher._id, voucher.isActive)}
                      disabled={actionId !== null}
                      className={`p-2 ${
                        voucher.isActive 
                          ? 'text-gray-600 hover:text-gray-900' 
                          : 'text-green-600 hover:text-green-900'
                      }`}
                      title={voucher.isActive ? 'Ẩn voucher' : 'Hiện voucher'}
                    >
                      {voucher.isActive ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredVouchers.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow mt-4 shop-panel">
          <p className="text-gray-600">
            {searchTerm 
              ? `Không tìm thấy voucher với từ khóa "${searchTerm}"` 
              : 'Không tìm thấy voucher nào'}
          </p>
        </div>
      )}

      {/* Form tạo và chỉnh sửa voucher. */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingVoucher ? 'Chỉnh sửa voucher' : 'Thêm voucher mới'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mã voucher *</label>
                  <input
                    type="text"
                    name="code"
                    value={formData.code}
                    onChange={handleChange}
                    required
                    maxLength={50}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 uppercase"
                    placeholder="VD: FREESHIP"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loại *</label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    required
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="fixed">Giảm cố định (VNĐ)</option>
                    <option value="percent">Giảm phần trăm (%)</option>
                    <option value="shipping">Miễn phí ship</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả *</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  required
                  rows="2"
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="VD: Giảm 50,000đ cho đơn từ 200,000đ"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {formData.type === 'shipping' ? 'Ưu đãi vận chuyển' : `Giảm giá * ${formData.type === 'percent' ? '(%)' : '(VNĐ)'}`}
                  </label>
                  {formData.type === 'shipping' ? <p className="py-2 text-sm text-green-700">Miễn toàn bộ phí vận chuyển</p> : <input
                    type="number"
                    name="discount"
                    value={formData.discount}
                    onChange={handleChange}
                    required
                    min="0"
                    max={formData.type === 'percent' ? '100' : undefined}
                    step="1"
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Đơn tối thiểu (VNĐ)</label>
                  <input
                    type="number"
                    name="minOrder"
                    value={formData.minOrder}
                    onChange={handleChange}
                    min="0"
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số lượt dùng</label>
                  <input
                    type="number"
                    name="maxUses"
                    value={formData.maxUses}
                    onChange={handleChange}
                    min="1"
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ngày bắt đầu</label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ngày kết thúc *</label>
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                    required
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleChange}
                  className="mr-2"
                />
                <label className="text-sm font-medium text-gray-700">Kích hoạt voucher</label>
              </div>

              <div className="flex gap-2 pt-4">
                <button type="submit" disabled={saving} className="flex-1 bg-orange-600 text-white py-2 rounded hover:bg-orange-700 disabled:opacity-50">
                  {saving ? 'Đang lưu...' : editingVoucher ? 'Cập nhật' : 'Thêm'}
                </button>
                <button type="button" disabled={saving} onClick={() => { setShowModal(false); setEditingVoucher(null); resetForm(); }} className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400">
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminVouchers;
