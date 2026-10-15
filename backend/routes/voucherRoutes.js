import express from 'express';
import {
  getActiveVouchers, applyVoucher, useVoucher, createVoucher, updateVoucher,
  deleteVoucher, getAllVouchersAdmin, toggleVoucherVisibility,
} from '../controllers/voucherController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();
router.get('/', getActiveVouchers);
router.post('/apply', applyVoucher);
router.get('/admin/all', protect, admin, getAllVouchersAdmin);
router.post('/create', protect, admin, createVoucher);
router.put('/:id', protect, admin, updateVoucher);
router.delete('/:id', protect, admin, deleteVoucher);
router.put('/:id/use', protect, useVoucher);
router.put('/:id/toggle-visibility', protect, admin, toggleVoucherVisibility);
export default router;
