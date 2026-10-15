import express from 'express';
import {
  getProducts, getProductById, getAllProductsAdmin, createProduct, updateProduct,
  deleteProduct, updateProductStock, toggleProductVisibility, createProductReview,
  getProductReviews, deleteProductReview, getBestSellingProducts, validateProductUpdate,
} from '../controllers/productController.js';
import { protect, admin, customerOnly } from '../middleware/authMiddleware.js';
import { parseProductImage, createProductUploadHandler } from '../controllers/uploadController.js';

const router = express.Router();
router.post('/upload', protect, admin, parseProductImage, createProductUploadHandler());
router.get('/admin/all', protect, admin, getAllProductsAdmin);
router.get('/stats/best-selling', protect, admin, getBestSellingProducts);
router.get('/', getProducts);
router.get('/:id', getProductById);
router.get('/:id/reviews', getProductReviews);
router.post('/', protect, admin, createProduct);
router.post('/:id/validate-update', protect, admin, validateProductUpdate);
router.put('/:id', protect, admin, updateProduct);
router.put('/:id/stock', protect, admin, updateProductStock);
router.put('/:id/toggle-visibility', protect, admin, toggleProductVisibility);
router.delete('/:id', protect, admin, deleteProduct);
router.post('/:id/reviews', protect, customerOnly, createProductReview);
router.delete('/:id/reviews/:reviewId', protect, deleteProductReview);
export default router;
