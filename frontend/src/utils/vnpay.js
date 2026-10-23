export const canPayWithVnpay = order => Boolean(order?._id
  && order.paymentMethod === 'VNPAY' && !order.isPaid
  && ['Đang xử lý', 'Đã xác nhận'].includes(order.orderStatus)
  && order.checkoutFinalized !== false && !order.cancellationLock
  && order.deliveryReturn?.state !== 'processing');

export const vnpaySandboxUrl = value => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'sandbox.vnpayment.vn'
    || url.pathname !== '/paymentv2/vpcpay.html' || url.username || url.password
    || url.port && url.port !== '443' || url.hash) {
    throw new Error('Đường dẫn thanh toán VNPAY Sandbox không hợp lệ.');
  }
  return url.href;
};
