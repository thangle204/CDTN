export const publicOrder = (order) => {
  const result = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  delete result.cancellationLock;
  delete result.checkoutToken;
  delete result.checkoutState;
  if (result.deliveryReturn) {
    result.deliveryReturn = { ...result.deliveryReturn };
    delete result.deliveryReturn.token;
    delete result.deliveryReturn.requestHash;
  }
  return result;
};

export const publicCustomerOrder = (order) => {
  const result = publicOrder(order);
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
