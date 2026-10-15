import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authAPI } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const ResetPassword = () => {
  const { token } = useParams();
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async event => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) { setError('Mật khẩu xác nhận không khớp.'); return; }
    setLoading(true);
    try {
      const { data } = await authAPI.resetPassword(token, password);
      logout();
      setSuccess(data.message || 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.');
      setPassword('');
      setConfirmation('');
    } catch (failure) {
      setError(failure.response?.data?.message || 'Không thể đặt lại mật khẩu. Vui lòng yêu cầu liên kết mới.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <Link to="/" className="block text-center text-3xl font-bold mb-8">SHOE <span className="text-red-600">STORE</span></Link>
        <div className="bg-white p-8 rounded-xl shadow">
          <h1 className="text-2xl font-bold mb-6">Đặt lại mật khẩu</h1>
          {success ? <div><p role="status" className="text-green-700 mb-6">{success}</p><Link to="/login" className="block bg-red-600 text-white text-center rounded-lg py-3 font-semibold">Đăng nhập</Link></div> : (
            <form onSubmit={submit} className="space-y-5">
              {error && <p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</p>}
              <label className="block text-sm font-medium">Mật khẩu mới<input type="password" autoComplete="new-password" minLength={6} maxLength={72} required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border px-4 py-2" /></label>
              <label className="block text-sm font-medium">Xác nhận mật khẩu<input type="password" autoComplete="new-password" minLength={6} maxLength={72} required value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 w-full rounded-lg border px-4 py-2" /></label>
              <button disabled={loading} className="w-full bg-red-600 text-white rounded-lg py-3 font-semibold disabled:opacity-50">{loading ? 'Đang cập nhật...' : 'Lưu mật khẩu mới'}</button>
              <Link to="/forgot-password" className="block text-sm text-center text-red-600 hover:underline">Yêu cầu liên kết đặt lại mật khẩu mới</Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
export default ResetPassword;
