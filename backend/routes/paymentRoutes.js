import express from 'express';
import { vnpayIpn, vnpayReturn } from '../controllers/vnpayController.js';

const router = express.Router();
// No customer JWT: VNPAY calls IPN directly. HMAC verification is mandatory.
router.get('/vnpay/ipn', vnpayIpn);
router.get('/vnpay/return', vnpayReturn);
export default router;
