import { cleanText, httpError } from './validation.js';

export const MAX_PRODUCT_IMAGES = 10;
export const MAX_PRODUCT_SECTIONS = 12;
export const MAX_PRODUCT_CONTENT_LENGTH = 40000;
export const PRODUCT_GENDERS = ['', 'Nam', 'Nữ', 'Unisex', 'Trẻ em'];
export const validProductImage = value => typeof value === 'string' && value.length <= 2000
  && !/[\u0000-\u001f\u007f\\]/.test(value) && (/^https?:\/\//i.test(value) || /^\/[^/]/.test(value));
const imagePath = value => {
  const image = cleanText(value, 'Đường dẫn ảnh', { max: 2000 });
  if (!validProductImage(image)) throw httpError(400, 'Ảnh phải là URL http/https hoặc đường dẫn trong website');
  return image;
};
export const parseProductImages = input => {
  if (!Array.isArray(input) || !input.length || input.length > MAX_PRODUCT_IMAGES) throw httpError(400, 'Mỗi sản phẩm cần từ 1 đến 10 ảnh');
  const images = input.map(imagePath);
  if (new Set(images).size !== images.length) throw httpError(400, 'Bộ ảnh sản phẩm không được chứa ảnh trùng nhau');
  return images;
};
export const parseProductSections = (input, images) => {
  if (!Array.isArray(input) || input.length > MAX_PRODUCT_SECTIONS) throw httpError(400, 'Bài giới thiệu có tối đa 12 mục');
  const sections = input.map((section, index) => {
    if (!section || typeof section !== 'object' || Array.isArray(section) || Object.keys(section).some(key => !['title', 'body', 'image', 'caption'].includes(key))) throw httpError(400, `Mục giới thiệu ${index + 1} không hợp lệ`);
    const result = {
      title: cleanText(section.title ?? '', 'Tiêu đề', { required: false, max: 160 }),
      body: cleanText(section.body ?? '', 'Nội dung giới thiệu', { required: false, max: 10000 }),
      image: section.image == null || section.image === '' ? '' : imagePath(section.image),
      caption: cleanText(section.caption ?? '', 'Chú thích ảnh', { required: false, max: 200 }),
    };
    if (!result.body && !result.image) throw httpError(400, `Mục giới thiệu ${index + 1} cần nội dung hoặc ảnh minh họa`);
    if (result.image && !images.includes(result.image)) throw httpError(400, 'Ảnh minh họa phải nằm trong bộ ảnh sản phẩm');
    return result;
  });
  if (sections.reduce((total, section) => total + section.body.length, 0) > MAX_PRODUCT_CONTENT_LENGTH) throw httpError(400, 'Tổng nội dung giới thiệu không được vượt quá 40.000 ký tự');
  return sections;
};

export const assignProductContent = (product, body, creating) => {
  if (body.images !== undefined) {
    const images = parseProductImages(body.images);
    if (body.image !== undefined && imagePath(body.image) !== images[0]) throw httpError(400, 'Ảnh bìa phải là ảnh đầu tiên trong bộ ảnh');
    product.images = images;
    product.image = images[0];
  } else if (creating || body.image !== undefined) {
    const image = imagePath(body.image);
    const previous = product.image;
    product.image = image;
    product.images = [image, ...(product.images || []).filter(value => value !== previous && value !== image)];
  }
  for (const [field, label] of [['material', 'Chất liệu'], ['origin', 'Xuất xứ'], ['style', 'Kiểu dáng'], ['modelCode', 'Mã mẫu']]) {
    if (body[field] !== undefined) product[field] = cleanText(body[field] ?? '', label, { required: false, max: 200 });
  }
  if (body.gender !== undefined) {
    if (!PRODUCT_GENDERS.includes(body.gender)) throw httpError(400, 'Giới tính sử dụng không hợp lệ');
    product.gender = body.gender;
  }
  if (body.contentSections !== undefined) product.contentSections = parseProductSections(body.contentSections, product.images || [product.image]);
};
