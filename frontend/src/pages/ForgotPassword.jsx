import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaEnvelope, FaArrowLeft } from 'react-icons/fa';
import { authAPI } from '../utils/api';
import AuthLayout from '../components/AuthLayout';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data } = await authAPI.forgotPassword(email.trim());
      setMessage(data.message || 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư của bạn.');
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể gửi yêu cầu đặt lại mật khẩu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout>
        <div className="max-w-md w-full">
          <div className="bg-white rounded-lg shadow-md p-8 text-center shop-panel">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <span className="text-green-600 text-3xl">✓</span>
            </div>
            
            <h2 className="text-2xl font-bold text-gray-800 mb-3">
              Kiểm tra email của bạn
            </h2>
            
            <p className="text-gray-600 mb-6">
              {message}
            </p>
            
            <Link
              to="/login"
              className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors inline-block"
            >
              Quay lại đăng nhập
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="max-w-md w-full">
        <div className="mb-8">
          <p className="shop-eyebrow">HỖ TRỢ TÀI KHOẢN</p>
          <h1 className="shop-auth__title">Lấy lại quyền truy cập</h1>
          <p className="text-sm text-gray-600">Chúng tôi sẽ giúp bạn khôi phục mật khẩu.</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 shop-panel">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Quên mật khẩu</h2>
          <p className="text-sm text-gray-600 mb-6">
            Nhập email để nhận hướng dẫn đặt lại mật khẩu
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <div className="relative">
                <FaEnvelope className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="email"
                  id="forgot-email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Nhập email của bạn"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Đang gửi...' : 'Gửi hướng dẫn'}
            </button>

            <div className="text-center">
              <Link
                to="/login"
                className="inline-flex items-center text-sm font-semibold text-red-600 hover:underline"
              >
                <FaArrowLeft className="mr-2" />
                Quay lại đăng nhập
              </Link>
            </div>
          </form>
        </div>
      </div>
    </AuthLayout>
  );
};

export default ForgotPassword;
