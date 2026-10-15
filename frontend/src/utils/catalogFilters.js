// Catalog filters count product models, while stock belongs to a color/size pair.
export const normalizeCatalogText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLocaleLowerCase('vi-VN')
  .trim()
  .replace(/\s+/g, ' ');

const optionalPrice = value => {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : NaN;
};

export const validateCatalogPriceRange = (minPrice = '', maxPrice = '') => {
  const min = optionalPrice(minPrice);
  const max = optionalPrice(maxPrice);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return { valid: false, min, max, error: 'Giá phải là số nguyên VND không âm.' };
  }
  if (min !== null && max !== null && min > max) {
    return { valid: false, min, max, error: 'Giá từ phải nhỏ hơn hoặc bằng giá đến.' };
  }
  return { valid: true, min, max, error: '' };
};

const selections = values => new Set((Array.isArray(values) ? values : [])
  .map(normalizeCatalogText).filter(Boolean));
const variantProducts = product => Array.isArray(product.variants) && product.variants.length > 0;
const available = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validSize = value => Number.isFinite(Number(value)) && Number(value) >= 1
  && Number(value) <= 60 && Number.isInteger(Number(value) * 2);
const sizeKey = value => validSize(value) ? String(Number(value)) : '';
const visibleProducts = products => (Array.isArray(products) ? products : [])
  .filter(product => product && !product.isHidden && !product.isArchived);
const timestamp = product => {
  const value = new Date(product.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};
const rating = product => Number.isFinite(Number(product.rating)) && Number(product.rating) >= 0
  && Number(product.rating) <= 5 ? Number(product.rating) : 0;
const reviewCount = product => Number.isSafeInteger(Number(product.numReviews)) && Number(product.numReviews) > 0
  ? Number(product.numReviews) : 0;

const matchesStock = (product, colors, sizes, inStock) => {
  if (!colors.size && !sizes.size && !inStock) return true;
  if (variantProducts(product)) {
    return product.variants.some(variant => available(variant.quantity)
      && (!colors.size || colors.has(normalizeCatalogText(variant.color)))
      && (!sizes.size || sizes.has(sizeKey(variant.size))));
  }
  return available(product.countInStock)
    && (!colors.size || colors.has(normalizeCatalogText(product.color)))
    && (!sizes.size || (product.sizes || []).some(size => sizes.has(sizeKey(size))));
};

export const filterCatalogProducts = (products, filters = {}) => {
  const { keyword = '', category = '', minPrice = '', maxPrice = '', inStock = false, sort = 'newest' } = filters;
  const range = validateCatalogPriceRange(minPrice, maxPrice);
  if (!range.valid) return [];
  const brands = selections(filters.brands);
  const colors = selections(filters.colors);
  const sizes = new Set((Array.isArray(filters.sizes) ? filters.sizes : []).map(sizeKey).filter(Boolean));
  const categoryKey = normalizeCatalogText(category);
  const terms = normalizeCatalogText(keyword).split(' ').filter(Boolean);
  const results = visibleProducts(products).filter(product => {
    if (categoryKey && normalizeCatalogText(product.category) !== categoryKey) return false;
    if (brands.size && !brands.has(normalizeCatalogText(product.brand))) return false;
    if (range.min !== null && (!Number.isSafeInteger(product.price) || product.price < range.min)) return false;
    if (range.max !== null && (!Number.isSafeInteger(product.price) || product.price > range.max)) return false;
    if (terms.length) {
      const searchable = normalizeCatalogText([
        product.name, product.brand, product.category, product.description, product.color,
        ...(product.variants || []).map(variant => variant.color),
      ].join(' '));
      if (!terms.every(term => searchable.includes(term))) return false;
    }
    return matchesStock(product, colors, sizes, inStock);
  });
  const byNewest = (first, second) => timestamp(second) - timestamp(first);
  if (sort === 'price_asc') return results.sort((first, second) => first.price - second.price || byNewest(first, second));
  if (sort === 'price_desc') return results.sort((first, second) => second.price - first.price || byNewest(first, second));
  if (sort === 'rating') return results.sort((first, second) => rating(second) - rating(first)
    || reviewCount(second) - reviewCount(first) || byNewest(first, second));
  return results.sort(byNewest);
};

const facetValues = (products, group) => {
  const unique = new Map();
  products.forEach(product => {
    const values = group === 'brands' ? [product.brand]
      : group === 'colors' ? variantProducts(product) ? product.variants.map(variant => variant.color) : [product.color]
        : variantProducts(product) ? product.variants.map(variant => variant.size) : product.sizes || [];
    values.forEach(value => {
      const label = group === 'sizes' ? sizeKey(value) : String(value ?? '').trim();
      const key = normalizeCatalogText(label);
      if (key && !unique.has(key)) unique.set(key, { value: label, label });
    });
  });
  return [...unique.values()].sort((first, second) => group === 'sizes'
    ? Number(first.value) - Number(second.value)
    : first.label.localeCompare(second.label, 'vi', { sensitivity: 'base' }));
};

// Each count retains the other filters and replaces its own group with one option.
// This keeps alternate choices visible and checks color/size availability together.
export const buildCatalogFacets = (products, filters = {}) => {
  const catalog = visibleProducts(products);
  return Object.fromEntries(['brands', 'colors', 'sizes'].map(group => [group,
    facetValues(catalog, group).map(option => ({
      ...option,
      count: filterCatalogProducts(catalog, { ...filters, [group]: [option.value] }).length,
    })),
  ]));
};
