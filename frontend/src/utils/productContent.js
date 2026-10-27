export const MAX_PRODUCT_IMAGES = 10;
export const MAX_PRODUCT_SECTIONS = 12;
export const productImages = product => [...new Set([product?.image, ...(Array.isArray(product?.images) ? product.images : [])]
  .filter(image => typeof image === 'string' && image.trim()))];

export const contentSections = product => Array.isArray(product?.contentSections) ? product.contentSections : [];

// In-page navigation must not create a new router entry and reset the selected
// color/size in ProductDetail. Modifier clicks retain normal link behavior.
export const scrollToProductSection = event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById(event.currentTarget.hash.slice(1));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};

export const productContentPayload = (form, extraImages, cover, editingProduct) => {
  const result = {};
  const images = [cover, ...extraImages.map(image => image.url)];
  if (extraImages.length || editingProduct?.images?.length) result.images = images;
  for (const field of ['material', 'origin', 'style', 'modelCode', 'gender']) {
    if (form[field] || editingProduct?.[field]) result[field] = (form[field] || '').trim();
  }
  if (form.contentSections?.length || editingProduct?.contentSections?.length) {
    result.contentSections = (form.contentSections || []).map(section => ({
      title: (section.title || '').trim(), body: (section.body || '').trim(),
      image: section.imageKey === 'cover' ? cover : extraImages.find(image => image.key === section.imageKey)?.url || '',
      caption: (section.caption || '').trim(),
    }));
  }
  return result;
};

export const validateProductContentDraft = (form, extras) => {
  if (extras.length > MAX_PRODUCT_IMAGES - 1) return 'Mỗi sản phẩm có tối đa 10 ảnh, gồm ảnh bìa.';
  const sections = form.contentSections || [];
  if (sections.length > MAX_PRODUCT_SECTIONS) return 'Bài giới thiệu có tối đa 12 mục.';
  let total = 0;
  for (const [index, section] of sections.entries()) {
    const title = (section.title || '').trim(), body = (section.body || '').trim();
    if ((!body && !section.imageKey) || title.length > 160 || body.length > 10000 || (section.caption || '').trim().length > 200) return `Mục ${index + 1}: cần nội dung hoặc ảnh, tiêu đề tối đa 160 và nội dung tối đa 10.000 ký tự.`;
    if (section.imageKey && section.imageKey !== 'cover' && !extras.some(image => image.key === section.imageKey)) return `Ảnh minh họa của mục ${index + 1} không còn trong bộ ảnh.`;
    total += body.length;
  }
  if (total > 40000) return 'Tổng nội dung giới thiệu không được vượt quá 40.000 ký tự.';
  for (const field of ['material', 'origin', 'style', 'modelCode']) if ((form[field] || '').trim().length > 200) return 'Thông tin chi tiết không được vượt quá 200 ký tự mỗi ô.';
  return '';
};
