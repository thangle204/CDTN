import express from 'express';
import {
  registerCustomer, loginCustomer, getCustomerCart, addItemToCart, removeItemFromCart,
  getCustomerProfile, updateUserProfile, updateCustomerByAdmin, updateCartItemQuantity,
  clearCart, getAllCustomers, toggleCustomerAdmin, toggleCustomerActive, forgotPassword, resetPassword,
} from '../controllers/customerController.js';
import { protect, admin, customerOnly } from '../middleware/authMiddleware.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();
router.post('/', rateLimit({ limit: 10, windowMs: 60 * 60 * 1000 }), registerCustomer);
router.post('/login', rateLimit({ limit: 20, windowMs: 15 * 60 * 1000 }), loginCustomer);
router.post('/forgot-password', rateLimit({ limit: 5, windowMs: 15 * 60 * 1000 }), forgotPassword);
router.post('/reset-password/:token', rateLimit({ limit: 10, windowMs: 15 * 60 * 1000 }), resetPassword);

router.get('/all', protect, admin, getAllCustomers);
router.put('/:id/toggle-admin', protect, admin, toggleCustomerAdmin);
router.put('/:id/toggle-active', protect, admin, toggleCustomerActive);
router.put('/:id/update-info', protect, admin, updateCustomerByAdmin);

router.route('/cart')
  .get(protect, customerOnly, getCustomerCart)
  .post(protect, customerOnly, addItemToCart)
  .put(protect, customerOnly, updateCartItemQuantity)
  .delete(protect, customerOnly, clearCart);
router.delete('/cart/:cartItemId', protect, customerOnly, removeItemFromCart);
router.route('/profile')
  .get(protect, customerOnly, getCustomerProfile)
  .put(protect, customerOnly, updateUserProfile);

export default router;
