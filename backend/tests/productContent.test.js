import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../models/productModel.js';
import { parseProductImages, parseProductSections, assignProductContent } from '../utils/productContent.js';

const images = ['/uploads/products/cover.jpg', '/uploads/products/side.png', 'https://images.example.test/back.webp'];
const fields = { name: 'Content test shoe', brand: 'Test', category: 'Sneaker', description: 'Short introduction', image: images[0], images, price: 200000, countInStock: 5, sizes: [40], variants: [] };

test('gallery parsing preserves image order and rejects malformed, duplicate or excessive images', () => {
  assert.deepEqual(parseProductImages(images.map(image => ` ${image} `)), images);
  for (const value of [null, {}, 'image.jpg', [], Array.from({ length: 11 }, (_, i) => `/shoe-${i}.jpg`), [images[0], images[0]], ['javascript:alert(1)'], ['//other.example.test/shoe.jpg'], ['/\\other/shoe.jpg'], [123], [{}]]) assert.throws(() => parseProductImages(value), error => error.status === 400);
});

test('article sections support paragraphs, lists, captions and images in the gallery', () => {
  const result = parseProductSections([{ title: ' Design ', body: ' First paragraph\n\n- First feature\n- Second feature ', image: images[1], caption: ' Side view ' }, { body: '', image: images[2] }], images);
  assert.equal(result[0].title, 'Design'); assert.equal(result[0].caption, 'Side view');
  assert.equal(result[0].body, 'First paragraph\n\n- First feature\n- Second feature');
  assert.equal(result[1].image, images[2]);
});

test('articles reject invalid blocks, lost image references and excessive content', () => {
  for (const value of [null, {}, [null], [[]], [{ title: 'Heading only' }], [{ body: 'Text', image: '/missing.jpg' }], [{ body: 'Text', image: false }], [{ body: 'Text', image: 0 }], [{ body: 'Text', image: 'data:image/png;base64,AA==' }], [{ body: 'x'.repeat(10001) }], [{ body: 'Text', title: 'x'.repeat(161) }], [{ body: 'Text', caption: 'x'.repeat(201) }], [{ body: 'Text', html: '<script>bad()</script>' }], Array.from({ length: 13 }, () => ({ body: 'Text' })), Array.from({ length: 5 }, () => ({ body: 'x'.repeat(10000) }))]) assert.throws(() => parseProductSections(value, images), error => error.status === 400);
  assert.equal(parseProductSections([{ body: '<script>plain text, never HTML</script>' }], images)[0].body, '<script>plain text, never HTML</script>');
});

test('product schema independently protects the gallery, specification fields and article references', async () => {
  const valid = { ...fields, material: 'Mesh and rubber', origin: 'Provided origin', gender: 'Unisex', style: 'Low top', modelCode: 'MODEL-1', contentSections: [{ title: 'Design', body: 'Detailed text', image: images[1], caption: 'Side' }] };
  await new Product(valid).validate();
  for (const patch of [{ image: images[1] }, { images: [] }, { images: [images[0], images[0]] }, { images: Array.from({ length: 11 }, (_, i) => `/shoe-${i}.jpg`) }, { gender: 'Invalid' }, { material: 'x'.repeat(201) }, { contentSections: [{ title: 'Empty' }] }, { contentSections: [{ body: 'Text', image: '/missing.jpg' }] }, { contentSections: Array.from({ length: 5 }, () => ({ body: 'x'.repeat(10000) })) }]) await assert.rejects(new Product({ ...valid, ...patch }).validate(), error => error.name === 'ValidationError');
});

test('legacy one-image products remain valid and metadata edits do not force gallery or inventory migration', async () => {
  const legacy = new Product({ ...fields, images: undefined });
  await legacy.validate();
  assignProductContent(legacy, { material: ' New material ', gender: 'Nam' }, false);
  assert.equal(legacy.image, images[0]); assert.equal(legacy.images, undefined);
  assert.equal(legacy.material, 'New material'); assert.equal(legacy.countInStock, 5); assert.deepEqual(legacy.sizes.toObject(), [40]);
});

test('gallery updates set the cover consistently and fail if a removed image still belongs to the article', async () => {
  const product = new Product({ ...fields, contentSections: [{ body: 'Details', image: images[1] }] });
  assignProductContent(product, { images: [images[1], images[0]] }, false);
  assert.equal(product.image, images[1]); await product.validate();
  assert.throws(() => assignProductContent(product, { images, image: images[2] }, false), error => error.status === 400);
  assignProductContent(product, { images: [images[0]] }, false);
  await assert.rejects(product.validate(), error => error.name === 'ValidationError');
  assignProductContent(product, { contentSections: [{ body: 'Updated without removed image' }] }, false);
  await product.validate();
});
