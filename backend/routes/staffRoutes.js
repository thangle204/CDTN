import express from 'express';
import { registerStaff, loginStaff } from '../controllers/staffController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();
router.post('/', protect, admin, registerStaff);
router.post('/login', rateLimit({ limit: 20, windowMs: 15 * 60 * 1000 }), loginStaff);
export default router;
