export const colorKey = color => String(color || '').trim().normalize('NFC').toLocaleLowerCase('vi-VN');

export const hasProductVariants = product => Array.isArray(product?.variants) && product.variants.length > 0;

export const productColors = product => hasProductVariants(product)
  ? [...new Map(product.variants.map(variant => [colorKey(variant.color), variant.color])).values()]
  : product?.color ? [product.color] : [];

export const productSizes = (product, color = '') => hasProductVariants(product)
  ? [...new Set(product.variants.filter(variant => colorKey(variant.color) === colorKey(color)).map(variant => variant.size))].sort((a, b) => a - b)
  : product?.sizes || [];

export const findProductVariant = (product, size, color) => product?.variants?.find(variant =>
  String(variant.size) === String(size) && colorKey(variant.color) === colorKey(color)
);

export const productStock = (product, size, color) => Number(hasProductVariants(product)
  ? findProductVariant(product, size, color)?.quantity || 0
  : product?.countInStock || 0);

export const validProductSelection = (product, size, color) => hasProductVariants(product)
  ? Boolean(findProductVariant(product, size, color))
  : !product?.sizes?.length || product.sizes.map(String).includes(String(size));

// Old products share stock across sizes. New products reserve each color/size separately.
export const sharesCartStock = (first, second) => {
  const firstId = first.product?._id || first.product;
  const secondId = second.product?._id || second.product;
  if (!firstId || String(firstId) !== String(secondId)) return false;
  return !hasProductVariants(first.product) || (
    String(first.size) === String(second.size) && colorKey(first.color) === colorKey(second.color)
  );
};

export const productImageUrl = image => {
  if (typeof image !== 'string' || !image) return '/shoe.svg';
  if (!image.startsWith('/uploads/')) return image;
  const apiUrl = import.meta.env?.VITE_API_URL;
  if (!apiUrl) return image;
  try {
    return new URL(image, new URL(apiUrl, window.location.origin)).href;
  } catch {
    return image;
  }
};
