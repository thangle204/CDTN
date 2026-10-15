import { createContext, useState, useEffect, useContext, useRef } from 'react';
import { authAPI, customersAPI } from '../utils/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth phải được sử dụng trong AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const sessionGeneration = useRef(0);
  const loginAttempt = useRef(0);
  const profileAttempt = useRef(0);
  const restoreController = useRef(null);
  const mounted = useRef(false);

  const storeUser = (data) => {
    const { token, ...profile } = data;
    if (token) localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(profile));
    setUser(profile);
  };

  const invalidateSession = () => {
    sessionGeneration.current += 1;
    restoreController.current?.abort();
    restoreController.current = null;
  };

  const updateUser = (data) => {
    invalidateSession();
    storeUser(data);
    setLoading(false);
  };

  const logout = () => {
    invalidateSession();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setLoading(false);
  };

  const restoreSession = async () => {
    const token = localStorage.getItem('token');
    const generation = sessionGeneration.current;
    const controller = new AbortController();
    restoreController.current = controller;
    const isCurrentSession = () => mounted.current && generation === sessionGeneration.current
      && token === localStorage.getItem('token');
    setLoading(true);
    try {
      if (token) {
        const { data } = await authAPI.getProfile({ token, signal: controller.signal });
        if (isCurrentSession()) storeUser(data);
      }
    } catch (error) {
      if (isCurrentSession() && [401, 403].includes(error.response?.status)) logout();
    } finally {
      if (mounted.current && generation === sessionGeneration.current
        && restoreController.current === controller) setLoading(false);
      if (restoreController.current === controller) restoreController.current = null;
    }
  };

  useEffect(() => {
    mounted.current = true;
    restoreSession();
    return () => {
      mounted.current = false;
      invalidateSession();
    };
  }, []);

  const login = async (email, password) => {
    const attempt = ++loginAttempt.current;
    // An explicit login takes precedence over startup restoration, including its errors.
    invalidateSession();
    setLoading(false);
    const generation = sessionGeneration.current;
    const token = localStorage.getItem('token');
    const isCurrentAttempt = () => mounted.current && attempt === loginAttempt.current
      && generation === sessionGeneration.current && token === localStorage.getItem('token');
    try {
      const { data } = await authAPI.login({ email, password });
      if (!isCurrentAttempt()) return { success: false, message: 'Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.' };
      updateUser(data);
      return { success: true };
    } catch (error) {
      // A failed account switch may still have a valid previous session to restore.
      if (isCurrentAttempt() && token) restoreSession();
      return { success: false, message: error.response?.data?.message || 'Đăng nhập thất bại' };
    }
  };

  const updateProfile = async (changes) => {
    const attempt = ++profileAttempt.current;
    const generation = sessionGeneration.current;
    const token = localStorage.getItem('token');
    const isCurrentRequest = () => mounted.current && attempt === profileAttempt.current
      && generation === sessionGeneration.current && token === localStorage.getItem('token');
    const stale = () => ({ success: false, stale: true });
    if (!token || !isCurrentRequest()) return stale();
    try {
      // Pin the request to its initiating session, including before Axios dispatches it.
      const { data } = await customersAPI.updateProfile(changes, { token });
      if (!isCurrentRequest()) return stale();
      updateUser(data);
      const committedGeneration = sessionGeneration.current;
      const committedToken = localStorage.getItem('token');
      return {
        success: true,
        data,
        isCurrent: () => mounted.current && attempt === profileAttempt.current
          && committedGeneration === sessionGeneration.current
          && committedToken === localStorage.getItem('token'),
      };
    } catch (error) {
      if (!isCurrentRequest()) return stale();
      return { success: false, message: error.response?.data?.message || 'Cập nhật thất bại', isCurrent: isCurrentRequest };
    }
  };

  const register = async (data) => {
    try {
      await authAPI.register(data);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Đăng ký thất bại' };
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateUser, updateProfile, loading, isAdmin: user?.isAdmin === true }}>
      {children}
    </AuthContext.Provider>
  );
};
