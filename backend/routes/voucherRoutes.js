import express from 'express';
import {
  getActiveVouchers, applyVoucher, useVoucher, createVoucher, updateVoucher,
  deleteVoucher, getAllVouchersAdmin, toggleVoucherVisibility,
  getCustomerVouchers, refreshCustomerVouchers, saveVoucher, unsaveVoucher,
} from '../controllers/voucherController.js';
import { protect, admin, customerOnly } from '../middleware/authMiddleware.js';

const router = express.Router();
router.get('/', getActiveVouchers);
router.get('/mine', protect, customerOnly, getCustomerVouchers);
router.get('/available', protect, customerOnly, getCustomerVouchers);
router.post('/mine/refresh', protect, customerOnly, refreshCustomerVouchers);
router.post('/:id/save', protect, customerOnly, saveVoucher);
router.delete('/:id/save', protect, customerOnly, unsaveVoucher);
router.post('/apply', (req, res, next) => req.headers.authorization ? protect(req, res, next) : next(),
  (req, res, next) => req.user ? customerOnly(req, res, next) : next(), applyVoucher);
router.get('/admin/all', protect, admin, getAllVouchersAdmin);
router.post('/create', protect, admin, createVoucher);
router.put('/:id', protect, admin, updateVoucher);
router.delete('/:id', protect, admin, deleteVoucher);
router.put('/:id/use', protect, useVoucher);
router.put('/:id/toggle-visibility', protect, admin, toggleVoucherVisibility);
export default router;
