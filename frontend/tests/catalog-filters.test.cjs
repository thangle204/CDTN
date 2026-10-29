const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let filterCatalogProducts;
let buildCatalogFacets;
let validateCatalogPriceRange;
let normalizeCatalogText;
before(async () => {
  ({ filterCatalogProducts, buildCatalogFacets, validateCatalogPriceRange, normalizeCatalogText }
    = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'catalogFilters.js')).href));
});

const catalog = [
  {
    _id: 'pairs', name: 'Giày thể thao phối màu', brand: 'Nike', category: 'Sneaker',
    description: 'Đệm êm để đi bộ', price: 1500000, rating: 4.5, numReviews: 4,
    createdAt: '2026-10-10T00:00:00Z', countInStock: 10,
    variants: [
      { color: 'Trắng', size: 40, quantity: 0 },
      { color: 'Trắng', size: 41, quantity: 3 },
      { color: 'Đen', size: 40, quantity: 7 },
    ],
  },
  {
    _id: 'legacy', name: 'Giày da đi làm', brand: 'Vascara', category: 'Giày da',
    price: 990000, color: 'Nâu', sizes: [40, 40.5, 41], countInStock: 2,
    rating: 4.5, numReviews: 8, createdAt: '2026-10-09T00:00:00Z',
  },
  {
    _id: 'sold-out', name: 'Giày chạy nhẹ', brand: 'Adidas', category: 'Giày chạy bộ',
    price: 2000000, color: 'Đỏ', sizes: [42], countInStock: 0,
    rating: 0, numReviews: 0, createdAt: '2026-10-12T00:00:00Z',
  },
  {
    _id: 'second-pair', name: 'Giày trắng cổ thấp', brand: 'Nike', category: 'Sneaker',
    price: 1500000, countInStock: 1, createdAt: '2026-10-11T00:00:00Z', rating: 5, numReviews: 1,
    variants: [{ color: 'Trắng', size: 40, quantity: 1 }],
  },
];
const ids = (filters, products = catalog) => filterCatalogProducts(products, filters).map(product => product._id);

test('price ranges and sorting use the discounted price rather than the original ticket price', () => {
  const products = [
    { _id: 'sale', price: 1000000, discountPercent: 30 },
    { _id: 'regular', price: 800000 },
    { _id: 'free', price: 200000, discountPercent: 100 },
  ];
  assert.deepEqual(ids({ minPrice: '690000', maxPrice: '710000' }, products), ['sale']);
  assert.deepEqual(ids({ sort: 'price_asc' }, products), ['free', 'sale', 'regular']);
  assert.deepEqual(ids({ sort: 'price_desc' }, products), ['regular', 'sale', 'free']);
  assert.deepEqual(ids({ maxPrice: '0' }, products), ['free']);
});
const optionCount = (facets, group, value) => facets[group].find(option => option.value === value)?.count;

test('color and size must match one available variant, never separate rows or a sold-out pair', () => {
  assert.deepEqual(ids({ colors: ['Trắng'], sizes: ['40'] }), ['second-pair']);
  assert.deepEqual(ids({ colors: ['Trắng'], sizes: ['41'] }), ['pairs']);
  assert.deepEqual(ids({ colors: ['Đen'], sizes: [41] }), []);
});

test('multiple choices use OR within each group and AND across groups', () => {
  assert.deepEqual(ids({ brands: ['Nike', 'Vascara'], colors: ['Đen', 'Nâu'], sizes: [40, 40.5] }), ['pairs', 'legacy']);
  assert.deepEqual(ids({ brands: ['Adidas'], colors: ['Đen', 'Nâu'], sizes: [40] }), []);
});

test('legacy stock is shared by its explicit sizes and single color', () => {
  assert.deepEqual(ids({ colors: ['nâu'], sizes: ['40.5'] }), ['legacy']);
  assert.deepEqual(ids({ colors: ['Nâu'], sizes: ['39'] }), []);
  assert.deepEqual(ids({ sizes: [40.5] }, [{ ...catalog[1], countInStock: 0 }]), []);
});

test('normal browsing keeps sold-out models and stock filtering uses variants as the stock source', () => {
  assert.equal(ids({}).length, 4);
  assert.deepEqual(ids({ inStock: true }), ['second-pair', 'pairs', 'legacy']);
  assert.deepEqual(ids({ inStock: true }, [{ ...catalog[0], countInStock: 10, variants: [{ color: 'Đen', size: 40, quantity: 0 }] }]), []);
});

test('keyword search ignores Vietnamese diacritics, case and repeated spaces', () => {
  assert.equal(normalizeCatalogText('  ĐỆM   ÊM '), 'dem em');
  assert.deepEqual(ids({ keyword: 'GIAY    the THAO dem' }), ['pairs']);
  assert.deepEqual(ids({ keyword: 'nike trang', category: 'SNEAKER' }), ['second-pair', 'pairs']);
  assert.deepEqual(ids({ keyword: 'Nike', category: 'Giày da' }), []);
});

test('price boundaries are inclusive and optional without accidentally treating blanks as zero', () => {
  assert.deepEqual(validateCatalogPriceRange('', ''), { valid: true, min: null, max: null, error: '' });
  assert.deepEqual(ids({ minPrice: '1500000', maxPrice: 1500000 }), ['second-pair', 'pairs']);
  assert.deepEqual(ids({ maxPrice: '990000' }), ['legacy']);
  assert.equal(validateCatalogPriceRange(0, 0).valid, true);
});

test('invalid VND ranges do not silently display an unfiltered catalog', () => {
  for (const [minPrice, maxPrice] of [[-1, ''], [1.5, ''], ['abc', ''], [Infinity, ''], ['', Number.MAX_SAFE_INTEGER + 1], [2, 1], [true, '']]) {
    assert.equal(validateCatalogPriceRange(minPrice, maxPrice).valid, false);
    assert.deepEqual(ids({ minPrice, maxPrice }), []);
  }
});

test('sort options use actual price, timestamps and ratings and leave input order intact', () => {
  const before = catalog.map(product => product._id);
  assert.deepEqual(ids({ sort: 'newest' }), ['sold-out', 'second-pair', 'pairs', 'legacy']);
  assert.deepEqual(ids({ sort: 'price_asc' }), ['legacy', 'second-pair', 'pairs', 'sold-out']);
  assert.deepEqual(ids({ sort: 'price_desc' }), ['sold-out', 'second-pair', 'pairs', 'legacy']);
  assert.deepEqual(ids({ sort: 'rating' }), ['second-pair', 'legacy', 'pairs', 'sold-out']);
  assert.deepEqual(catalog.map(product => product._id), before);
});

test('facet counts represent product models and respect color/size pairs under the other filters', () => {
  const facets = buildCatalogFacets(catalog, { colors: ['Trắng'], sizes: [40] });
  assert.equal(optionCount(facets, 'brands', 'Nike'), 1);
  assert.equal(optionCount(facets, 'colors', 'Trắng'), 1);
  assert.equal(optionCount(facets, 'colors', 'Đen'), 1);
  assert.equal(optionCount(facets, 'sizes', '40'), 1);
  assert.equal(optionCount(facets, 'sizes', '41'), 1);
  assert.equal(optionCount(facets, 'sizes', '42'), 0);
});

test('facet alternatives ignore their own selected group and retain the price and category filters', () => {
  const facets = buildCatalogFacets(catalog, { brands: ['Vascara'], category: 'Sneaker', maxPrice: 1500000 });
  assert.equal(optionCount(facets, 'brands', 'Nike'), 2);
  assert.equal(optionCount(facets, 'brands', 'Vascara'), 0);
  assert.equal(optionCount(facets, 'colors', 'Trắng'), 0);
  assert.deepEqual(facets.sizes.map(option => option.value), ['40', '40.5', '41', '42']);
});

test('hidden and archived products never appear in results or inflate facet counts', () => {
  const products = [...catalog, { ...catalog[1], _id: 'hidden', isHidden: true }, { ...catalog[1], _id: 'archived', isArchived: true }];
  assert.equal(ids({}, products).length, 4);
  assert.equal(optionCount(buildCatalogFacets(products), 'brands', 'Vascara'), 1);
  assert.deepEqual(filterCatalogProducts(null), []);
});

test('facet options deduplicate repeated variant rows and brand case while preserving a display label', () => {
  const products = [catalog[0], { ...catalog[3], brand: 'nike' }];
  const facets = buildCatalogFacets(products);
  assert.deepEqual(facets.brands, [{ value: 'Nike', label: 'Nike', count: 2 }]);
  assert.equal(optionCount(facets, 'colors', 'Trắng'), 2);
  assert.equal(optionCount(facets, 'sizes', '40'), 2);
});
