import express from 'express';
import {
  addOrderItems, getMyOrders, getOrders, updateOrderStatus, updateOrderToDelivered,
  getOrderById, deleteOrder, getRevenueStats, getTopCustomers, getOrdersOverview,
  updatePaymentStatus, cancelOrder, confirmOrderRefund,
} from '../controllers/orderController.js';
import { protect, admin, customerOnly } from '../middleware/authMiddleware.js';
import { recordDeliveryFailure, completeDeliveryReturn } from '../controllers/deliveryController.js';

const router = express.Router();
router.use(protect);
router.get('/stats/revenue', admin, getRevenueStats);
router.get('/stats/top-customers', admin, getTopCustomers);
router.get('/stats/overview', admin, getOrdersOverview);
router.route('/').post(customerOnly, addOrderItems).get(admin, getOrders);
router.get('/myorders', customerOnly, getMyOrders);
router.get('/:id', getOrderById);
router.put('/:id/status', admin, updateOrderStatus);
router.put('/:id/deliver', admin, updateOrderToDelivered);
router.put('/:id/payment', admin, updatePaymentStatus);
router.put('/:id/delivery-failure', admin, recordDeliveryFailure);
router.put('/:id/delivery-return', admin, completeDeliveryReturn);
router.put('/:id/refund', admin, confirmOrderRefund);
router.put('/:id/cancel', cancelOrder);
router.delete('/:id', admin, deleteOrder);
export default router;
