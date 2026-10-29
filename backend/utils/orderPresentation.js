export const publicOrder = (order) => {
  const result = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  result.cancellationPending = Boolean(result.cancellationLock && result.orderStatus === 'Đã hủy' && !result.stockRestored);
  delete result.cancellationLock;
  delete result.cancellationReceipt;
  delete result.checkoutToken;
  delete result.checkoutState;
  delete result.vnpayQueryNextAt;
  delete result.paymentExpiryNextAt;
  if (result.voucher) {
    result.voucher = { ...result.voucher };
    delete result.voucher.reservationToken;
    delete result.voucher.wallet;
  }
  if (result.deliveryReturn) {
    result.deliveryReturn = { ...result.deliveryReturn };
    delete result.deliveryReturn.token;
    delete result.deliveryReturn.requestHash;
  }
  return result;
};

export const publicCustomerOrder = (order) => {
  const result = publicOrder(order);
  delete result.vnpayPayments;
  delete result.cancellationRecoveryRequired;
  if (result.deliveryFailure) {
    result.deliveryFailure = { ...result.deliveryFailure };
    delete result.deliveryFailure.notes;
    delete result.deliveryFailure.failedBy;
  }
  if (result.deliveryReturn) {
    delete result.deliveryReturn.notes;
    delete result.deliveryReturn.returnShippingCost;
    delete result.deliveryReturn.receivedBy;
    delete result.deliveryReturn.recoveryRequired;
  }
  return result;
};
