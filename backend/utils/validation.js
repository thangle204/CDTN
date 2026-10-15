export const httpError = (status, message) => Object.assign(new Error(message), { status });

export const cleanText = (value, label, { required = true, max = 200 } = {}) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw httpError(400, `${label} không hợp lệ`);
  const text = value.trim();
  if ((required && !text) || text.length > max) throw httpError(400, `${label} không hợp lệ`);
  return text;
};

export const normalizeEmail = (value) => {
  const email = cleanText(value, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Email không hợp lệ');
  return email;
};

export const normalizePhone = (value) => {
  const phone = cleanText(value, 'Số điện thoại', { max: 10 });
  if (!/^0\d{9}$/.test(phone)) throw httpError(400, 'Số điện thoại phải có 10 số và bắt đầu bằng 0');
  return phone;
};

export const validatePassword = (value) => {
  if (typeof value !== 'string' || value.trim().length < 6 || Buffer.byteLength(value, 'utf8') > 72) {
    throw httpError(400, 'Mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte');
  }
  return value;
};

export const positiveQuantity = (value) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw httpError(400, 'Số lượng phải là số nguyên dương');
  }
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw httpError(400, 'Số lượng phải là số nguyên dương');
  return quantity;
};

export const nonNegativeInteger = (value, label) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw httpError(400, `${label} phải là số nguyên không âm`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw httpError(400, `${label} phải là số nguyên không âm`);
  return number;
};

export const normalizeSize = (value, availableSizes = []) => {
  if (value == null || value === '') {
    if (availableSizes.length) throw httpError(400, 'Vui lòng chọn size giày');
    return undefined;
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw httpError(400, 'Size giày không hợp lệ');
  if (typeof value === 'string' && !value.trim()) throw httpError(400, 'Size giày không hợp lệ');
  const size = Number(value);
  if (!Number.isFinite(size) || size < 1 || size > 60 || !Number.isInteger(size * 2)) {
    throw httpError(400, 'Size giày không hợp lệ');
  }
  if (availableSizes.length && !availableSizes.includes(size)) throw httpError(400, 'Size giày này không còn được bán');
  return size;
};
