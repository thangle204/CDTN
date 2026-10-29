// backend/models/productModel.js - PHIÊN BẢN WEB BÁN GIÀY

import mongoose from "mongoose";
import { validProductImage, MAX_PRODUCT_IMAGES, MAX_PRODUCT_SECTIONS, MAX_PRODUCT_CONTENT_LENGTH, PRODUCT_GENDERS } from '../utils/productContent.js';

const contentSectionSchema = new mongoose.Schema({
    title: { type: String, trim: true, maxlength: 160, default: '' },
    body: { type: String, trim: true, maxlength: 10000, default: '' },
    image: { type: String, default: '', validate: value => !value || validProductImage(value) },
    caption: { type: String, trim: true, maxlength: 200, default: '' },
}, { _id: false });

const variantSchema = new mongoose.Schema({
    color: { type: String, required: true, trim: true, maxlength: 100 },
    size: { type: Number, required: true, min: 1, max: 60, validate: (size) => Number.isInteger(size * 2) },
    quantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { _id: false });

const reviewSchema = mongoose.Schema(
    {
        name: { type: String, required: true },
        rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isSafeInteger },
        comment: { type: String, required: true },
        order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
        version: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Customer',
        },
    },
    {
        timestamps: true,
        toJSON: { transform(_document, result) { delete result.order; delete result.version; return result; } },
        toObject: { transform(_document, result) { delete result.order; delete result.version; return result; } },
    }
);

const productSchema = mongoose.Schema(
    {
        name: { type: String, required: true },
        image: { type: String, required: true },
        images: {
            type: [String], default: undefined,
            validate: { validator(images) { return images === undefined || (images.length >= 1 && images.length <= MAX_PRODUCT_IMAGES && images[0] === this.image && new Set(images).size === images.length && images.every(validProductImage)); }, message: 'Bộ ảnh cần từ 1 đến 10 ảnh hợp lệ, không trùng và ảnh đầu tiên là ảnh bìa' },
        },
        material: { type: String, trim: true, maxlength: 200, default: '' },
        origin: { type: String, trim: true, maxlength: 200, default: '' },
        style: { type: String, trim: true, maxlength: 200, default: '' },
        modelCode: { type: String, trim: true, maxlength: 200, default: '' },
        gender: { type: String, enum: PRODUCT_GENDERS, default: '' },
        contentSections: {
            type: [contentSectionSchema], default: [],
            validate: { validator(sections) { return sections.length <= MAX_PRODUCT_SECTIONS && sections.reduce((sum, section) => sum + (section.body || '').length, 0) <= MAX_PRODUCT_CONTENT_LENGTH && sections.every(section => (section.body || section.image) && (!section.image || (this.images || [this.image]).includes(section.image))); }, message: 'Bài giới thiệu tối đa 12 mục, 40.000 ký tự; mỗi mục cần nội dung hoặc ảnh thuộc bộ ảnh sản phẩm' },
        },

        // Thông tin giày
        brand: { type: String, required: true },      // Nike, Adidas, Puma...
        category: { type: String, required: true, enum: ['Sneaker', 'Giày chạy bộ', 'Giày da', 'Sandal', 'Giày thể thao'] },
        description: { type: String, required: true },
        color: { type: String, default: '' },
        variants: {
            type: [variantSchema], default: [],
            validate: {
                validator: (variants) => variants.length <= 100
                    && new Set(variants.map((variant) => `${variant.color?.trim().normalize('NFC').toLocaleLowerCase('vi-VN')}|${variant.size}`)).size === variants.length
                    && Number.isSafeInteger(variants.reduce((total, variant) => total + variant.quantity, 0)),
                message: 'Mỗi màu và size chỉ được nhập một lần, tối đa 100 dòng và tổng số lượng phải hợp lệ',
            },
        },
        sizes: {
            type: [Number], default: [],
            validate: { validator: (sizes) => sizes.every((size) => Number.isFinite(size) && size >= 1 && size <= 60 && Number.isInteger(size * 2)) && new Set(sizes).size === sizes.length, message: 'Size giày phải từ 1 đến 60, theo bước 0.5 và không trùng nhau' },
        },

        price: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },

        countInStock: {
            type: Number, required: true, default: 0, min: 0,
            validate: [
                { validator: Number.isSafeInteger, message: 'Tồn kho phải là số nguyên không âm' },
                { validator(value) { return !this.variants?.length || value === this.variants.reduce((total, variant) => total + variant.quantity, 0); }, message: 'Tổng tồn kho phải bằng tổng số lượng của các màu và size' },
            ],
        },
        // Durable holds bridge the interval between stock reservation and a
        // committed/rolled-back order. They have no automatic expiry.
        checkoutReservations: { type: [String], default: [] },
        // The receipt is written atomically with returned sellable stock.
        // Retain it so delayed retries cannot import the same shoes twice.
        deliveryReturnReceipts: { type: [String], default: [] },
        cancellationReceipts: { type: [String], default: [] },
        reviews: [reviewSchema],
        rating: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
            max: 5,
        },
        numReviews: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
            validate: Number.isSafeInteger,
        },

        // ✅ FIELD ẨN/HIỆN SẢN PHẨM
        isHidden: {
            type: Boolean,
            default: false
        },
        // Archived SKUs stay available to order history and inventory restoration.
        isArchived: {
            type: Boolean,
            default: false
        },

        // SEO
        metaTitle: { type: String },
        metaDescription: { type: String },
        metaKeywords: { type: String },
    },
    {
        timestamps: true,
        optimisticConcurrency: true,
        toJSON: {
            transform(_document, result) {
                delete result.checkoutReservations;
                delete result.deliveryReturnReceipts;
                delete result.cancellationReceipts;
                return result;
            },
        },
        toObject: {
            transform(_document, result) {
                delete result.checkoutReservations;
                delete result.deliveryReturnReceipts;
                delete result.cancellationReceipts;
                return result;
            },
        },
    }
);

const Product = mongoose.model('Product', productSchema);
export default Product;
