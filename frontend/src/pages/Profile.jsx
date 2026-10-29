import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { FaUser, FaEnvelope, FaPhone, FaLock, FaEdit, FaSave, FaTimes, FaMapMarkerAlt } from 'react-icons/fa';
import { SHIPPING_ADDRESS_FIELDS, shippingAddressOf, hasShippingAddress, cleanShippingAddress, sameShippingAddress, shippingAddressLine } from '../utils/shippingAddress';

const Profile = () => {
  const { user, updateProfile, loading: authLoading } = useAuth();
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    shippingAddress: shippingAddressOf(),
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [originalData, setOriginalData] = useState({
    name: '',
    phone: '',
    shippingAddress: shippingAddressOf(),
  });
  const mounted = useRef(true);
  const submission = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; submission.current += 1; };
  }, []);

  useEffect(() => {
    submission.current += 1;
    setLoading(false);
    setError('');
    setSuccess('');
    setEditing(false);
    setChangingPassword(false);
  }, [user?._id]);

  useEffect(() => {
    if (user) {
      const userData = {
        name: user.name || '',
        phone: user.phone || '',
        shippingAddress: shippingAddressOf(user),
      };
      setFormData({
        ...userData,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setOriginalData(userData);
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('shippingAddress.')) setFormData(previous => ({ ...previous, shippingAddress: { ...(previous.shippingAddress || shippingAddressOf(user)), [name.split('.')[1]]: value } }));
    else setFormData(previous => ({ ...previous, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !mounted.current) return;
    const attempt = ++submission.current;
    const isActive = () => mounted.current && attempt === submission.current;
    let result;
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const hasContactChange =
        formData.name !== originalData.name || 
        formData.phone !== originalData.phone;
      const hasAddressChange = !sameShippingAddress(formData.shippingAddress, originalData.shippingAddress);
      const hasInfoChange = hasContactChange || hasAddressChange;
      
      const hasPasswordChange = changingPassword && formData.newPassword;

      if (!hasInfoChange && !hasPasswordChange) {
        setError('Bạn chưa thay đổi thông tin gì');
        setLoading(false);
        return;
      }

      if (changingPassword) {
        if (!formData.currentPassword) {
          throw new Error('Vui lòng nhập mật khẩu cũ');
        }
        if (!formData.newPassword) {
          throw new Error('Vui lòng nhập mật khẩu mới');
        }
        if (formData.newPassword !== formData.confirmPassword) {
          throw new Error('Mật khẩu mới không khớp');
        }
        if (formData.newPassword.length < 6) {
          throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự');
        }
      }

      if (hasInfoChange && formData.phone) {
        const phoneRegex = /^0\d{9}$/;
        if (!phoneRegex.test(formData.phone)) {
          throw new Error('Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0)');
        }
      }

      const updateData = {};
      
      if (hasContactChange) {
        updateData.name = formData.name;
        updateData.phone = formData.phone;
      }
      if (hasAddressChange) updateData.shippingAddress = cleanShippingAddress(formData.shippingAddress);

      if (hasPasswordChange) {
        updateData.currentPassword = formData.currentPassword;
        updateData.newPassword = formData.newPassword;
      }


      result = await updateProfile(updateData);
      if (!isActive() || result.stale || result.isCurrent && !result.isCurrent()) return;
      if (!result.success) throw new Error(result.message || 'Cập nhật thất bại');

      const updatedUser = {
        _id: result.data._id,
        name: result.data.name,
        email: result.data.email,
        phone: result.data.phone,
        isAdmin: result.data.isAdmin,
        shippingAddress: result.data.shippingAddress,
      };

      setSuccess(hasPasswordChange ? 'Đổi mật khẩu thành công. Các phiên đăng nhập cũ đã hết hiệu lực.' : 'Cập nhật thông tin thành công!');
      setOriginalData({ name: updatedUser.name, phone: updatedUser.phone, shippingAddress: shippingAddressOf(updatedUser) });
      setEditing(false);
      
      setChangingPassword(false);
      setFormData(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }));

    } catch (err) {
      if (isActive() && (!result?.isCurrent || result.isCurrent())) setError(err.response?.data?.message || err.message || 'Cập nhật thất bại');
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setChangingPassword(false);
    setError('');
    setSuccess('');
    setFormData({
      name: originalData.name,
      phone: originalData.phone,
      shippingAddress: originalData.shippingAddress || shippingAddressOf(user),
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
  };

  if (authLoading) return <div className="min-h-[60vh] flex items-center justify-center"><div className="spinner" /></div>;

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Vui lòng đăng nhập để xem thông tin</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-3xl font-bold mb-8 text-gray-800">Thông tin tài khoản</h1>
        <Link to="/my-vouchers" className="mb-6 flex items-center justify-between rounded-xl border bg-white p-5 font-semibold text-red-600">Mã ưu đãi của tôi <span>Khám phá quà riêng và mã đã lưu →</span></Link>

        {success && (
          <div className="bg-green-50 border-l-4 border-green-500 text-green-700 p-4 rounded mb-6">
            {success}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="bg-white rounded-lg shadow p-6 space-y-6 shop-panel">
            {/* Họ tên */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <FaUser className="inline mr-2 text-blue-600" />
                Họ tên
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                disabled={!editing}
                required
                className={`w-full px-4 py-2 border rounded-lg ${
                  editing ? "border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500" : 'bg-gray-50 border-gray-300'
                }`}
              />
            </div>

            {/* Email (không cho sửa) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <FaEnvelope className="inline mr-2 text-green-600" />
                Email
              </label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">Email không thể thay đổi</p>
            </div>

            {/* Số điện thoại */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <FaPhone className="inline mr-2 text-purple-600" />
                Số điện thoại
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                disabled={!editing}
                required
                className={`w-full px-4 py-2 border rounded-lg ${
                  editing ? "border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500" : 'bg-gray-50 border-gray-300'
                }`}
                placeholder="0xxxxxxxxx"
              />
            </div>

            <section className="border-t pt-6" aria-labelledby="profile-address-title">
              <h2 id="profile-address-title" className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-800"><FaMapMarkerAlt className="text-red-600" />Địa chỉ giao hàng mặc định</h2>
              <p className="mb-4 text-sm text-gray-500">Dùng để điền sẵn khi thanh toán. Bạn vẫn có thể đổi thông tin giao hàng riêng cho từng đơn.</p>
              {editing ? <div className="grid gap-4 sm:grid-cols-2">
                {SHIPPING_ADDRESS_FIELDS.map(([field, label, required, max]) => <label key={field} htmlFor={`profile-shipping-${field}`} className={`block text-sm font-medium text-gray-700${field === 'address' ? ' sm:col-span-2' : ''}`}>{label}
                  <input id={`profile-shipping-${field}`} name={`shippingAddress.${field}`} type={field === 'phone' ? 'tel' : 'text'} maxLength={max} value={formData.shippingAddress?.[field] || ''} onChange={handleChange} disabled={loading} required={required && (hasShippingAddress(user.shippingAddress) || !sameShippingAddress(formData.shippingAddress, originalData.shippingAddress))} autoComplete={field === 'name' ? 'shipping name' : field === 'phone' ? 'shipping tel' : field === 'address' ? 'shipping street-address' : 'off'} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500" />
                </label>)}
              </div> : hasShippingAddress(user.shippingAddress) ? <div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="font-semibold text-gray-800">{user.shippingAddress.name} · {user.shippingAddress.phone}</p><p className="mt-2 break-words text-gray-600">{shippingAddressLine(user.shippingAddress)}</p></div> : <p className="rounded-lg bg-gray-50 p-4 text-gray-600">Bạn chưa lưu địa chỉ giao hàng. Bấm Chỉnh sửa thông tin để thêm, hoặc nhập địa chỉ khi thanh toán lần đầu.</p>}
            </section>

            {/* Đổi mật khẩu */}
            {editing && (
              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">Đổi mật khẩu</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setChangingPassword(!changingPassword);
                      if (changingPassword) {
                        setFormData(prev => ({
                          ...prev,
                          currentPassword: '',
                          newPassword: '',
                          confirmPassword: ''
                        }));
                      }
                    }}
                    className="text-sm text-red-600 hover:underline"
                  >
                    {changingPassword ? '❌ Hủy đổi mật khẩu' : '🔒 Đổi mật khẩu'}
                  </button>
                </div>

                {changingPassword && (
                  <div className="space-y-4 bg-blue-50 p-4 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <FaLock className="inline mr-2 text-red-600" />
                        Mật khẩu cũ *
                      </label>
                      <input
                        type="password"
                        name="currentPassword"
                        value={formData.currentPassword}
                        onChange={handleChange}
                        required={changingPassword}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Nhập mật khẩu hiện tại"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <FaLock className="inline mr-2 text-green-600" />
                        Mật khẩu mới *
                      </label>
                      <input
                        type="password"
                        name="newPassword"
                        value={formData.newPassword}
                        onChange={handleChange}
                        required={changingPassword}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <FaLock className="inline mr-2 text-orange-600" />
                        Xác nhận mật khẩu mới *
                      </label>
                      <input
                        type="password"
                        name="confirmPassword"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        required={changingPassword}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Nhập lại mật khẩu mới"
                      />
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-sm text-yellow-800">
                      <strong>Lưu ý:</strong> Đổi mật khẩu sẽ kết thúc các phiên đăng nhập cũ. Phiên hiện tại được cập nhật an toàn.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-4 pt-6">
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                >
                  <FaEdit />
                  Chỉnh sửa thông tin
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Đang lưu...
                      </>
                    ) : (
                      <>
                        <FaSave />
                        Lưu thay đổi
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={loading}
                    className="flex-1 bg-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <FaTimes />
                    Hủy
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Profile;
