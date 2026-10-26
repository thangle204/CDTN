export const canReviewOrder = order => Boolean(order?._id && order.orderStatus === 'Đã giao'
  && order.isPaid === true && order.isDelivered === true && order.checkoutFinalized !== false
  && !order.cancellationLock && !order.deliveryReturn);

export const reviewProducts = order => [...new Map((order?.orderItems || [])
  .filter(item => item.product)
  .map(item => [String(item.product?._id || item.product), item])).entries()]
  .map(([productId, item]) => ({ productId, name: item.name, image: item.image }));
