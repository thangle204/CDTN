import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAuthRequest = url === '/customers' || (url === '/customers/profile' && error.config?.method === 'get') || ['/login', '/forgot-password', '/reset-password/'].some(path => url.includes(path));
      const currentToken = localStorage.getItem('token');
      const authorization = error.config?.headers?.get?.('Authorization') ?? error.config?.headers?.Authorization;
      const belongsToCurrentSession = authorization === (currentToken ? `Bearer ${currentToken}` : undefined);
      if (!isAuthRequest && belongsToCurrentSession) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (credentials) => api.post('/customers/login', credentials),
  register: (userData) => api.post('/customers', userData),
  getProfile: ({ token, signal } = {}) => api.get('/customers/profile', {
    params: { _t: Date.now() }, signal,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  }),
  forgotPassword: (email) => api.post('/customers/forgot-password', { email }),
  resetPassword: (token, password) => api.post(`/customers/reset-password/${encodeURIComponent(token)}`, { password }),
};

export const productsAPI = {
  getProducts: (keyword = '', category = '') => api.get('/products', { 
    params: { keyword, category, _t: Date.now() } 
  }),
  
  getProductById: (id) => api.get(`/products/${id}`, { params: { _t: Date.now() } }),
  getReviews: (id) => api.get(`/products/${id}/reviews`),
  createReview: (id, review) => api.post(`/products/${id}/reviews`, review),
  
  getAllProducts: () => api.get('/products/admin/all', { params: { _t: Date.now() } }),
  createProduct: (productData) => api.post('/products', productData),
  uploadImage: (file) => api.post('/products/upload', file, { headers: { 'Content-Type': file.type } }),
  updateProduct: (id, productData) => api.put(`/products/${id}`, productData),
  validateUpdate: (id, productData) => api.post(`/products/${id}/validate-update`, productData),
  deleteProduct: (id) => api.delete(`/products/${id}`),
  updateStock: (id, countInStock) => api.put(`/products/${id}/stock`, { countInStock }),
  toggleVisibility: (id) => api.put(`/products/${id}/toggle-visibility`),
  getBestSelling: () => api.get('/products/stats/best-selling'),
};

export const ordersAPI = {
  createOrder: (orderData) => api.post('/orders', orderData),
  getMyOrders: () => api.get('/orders/myorders', { params: { _t: Date.now() } }),
  
  getOrderById: (id, { signal } = {}) => api.get(`/orders/${id}`, { params: { _t: Date.now() }, signal }),
  createVnpayPayment: (id, { signal } = {}) => api.post(`/orders/${id}/vnpay/payment`, {}, { signal }),
  reconcileVnpayPayment: (id, { signal, txnRef } = {}) => api.post(`/orders/${id}/vnpay/reconcile`, txnRef ? { txnRef } : {}, { signal, timeout: 30000 }),
  verifyVnpayReturn: (rawQuery = '', { signal } = {}) => api.get(`/payments/vnpay/return${rawQuery ? rawQuery.startsWith('?') ? rawQuery : '?' + rawQuery : ''}`, { signal }),
  getAllOrders: (searchTerm = '') => api.get('/orders', { params: { search: searchTerm, _t: Date.now() } }),
  updateStatus: (id, orderStatus) => api.put(`/orders/${id}/status`, { orderStatus }),
  updateOrderToDelivered: (id) => api.put(`/orders/${id}/deliver`),
  updatePaymentStatus: (id, isPaid) => api.put(`/orders/${id}/payment`, { isPaid }),
  confirmRefund: (id) => api.put(`/orders/${id}/refund`, {}),
  markDeliveryFailed: (id, data) => api.put(`/orders/${id}/delivery-failure`, data),
  settleDeliveryReturn: (id, data) => api.put(`/orders/${id}/delivery-return`, data),
  
  // ✅ FIXED: Đổi từ DELETE thành PUT để gọi đúng route cancel
  cancelOrder: (id) => api.put(`/orders/${id}/cancel`),
  
  // Stats
  getRevenueStats: (period = 'month') => api.get('/orders/stats/revenue', { params: { period } }),
  getTopCustomers: () => api.get('/orders/stats/top-customers'),
  getOverview: () => api.get('/orders/stats/overview'),
};

export const cartAPI = {
  getCart: () => api.get('/customers/cart', { params: { _t: Date.now() } }),
  
  addToCart: (productId, quantity, size = '', color = '') => api.post('/customers/cart', { productId, quantity, size, color }),
  updateCartItem: (cartItemId, quantity) => api.put('/customers/cart', { cartItemId, quantity }),
  removeFromCart: (cartItemId) => api.delete(`/customers/cart/${cartItemId}`),
};

export const vouchersAPI = {
  getActiveVouchers: () => api.get('/vouchers', { params: { _t: Date.now() } }),
  applyVoucher: (code, orderTotal) => api.post('/vouchers/apply', { code, orderTotal }),
  getAllVouchersAdmin: () => api.get('/vouchers/admin/all', { params: { _t: Date.now() } }),
  createVoucher: (voucherData) => api.post('/vouchers/create', voucherData),
  updateVoucher: (id, voucherData) => api.put(`/vouchers/${id}`, voucherData),
  deleteVoucher: (id) => api.delete(`/vouchers/${id}`),
  toggleVoucher: (id) => api.put(`/vouchers/${id}/toggle-visibility`)
};

export const customersAPI = {
  getAllCustomers: () => api.get('/customers/all', { params: { _t: Date.now() } }),
  toggleAdmin: (id) => api.put(`/customers/${id}/toggle-admin`),
  toggleActive: (id) => api.put(`/customers/${id}/toggle-active`),
  updateProfile: (data, { token } = {}) => api.put('/customers/profile', data, {
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  }),
  updateCustomerByAdmin: (id, data) => api.put(`/customers/${id}/update-info`, data)
};

export default api;
