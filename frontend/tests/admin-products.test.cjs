const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

let AdminProducts;
const mockPlugin = {
  name: 'admin-products-test-mocks',
  setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'mock' }));
    build.onResolve({ filter: /utils\/api(?:\.js)?$/ }, () => ({ path: 'api', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState = initial => globalThis.__adminProductTest.state(initial); export const useEffect = effect => globalThis.__adminProductTest.effects.push(effect); export const useRef = initial => globalThis.__adminProductTest.ref(initial);' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment = "fragment"; export const jsx = (type, props, key) => ({type,props:props||{},key}); export const jsxs = jsx;' };
      if (args.path === 'icons') return { contents: ['FaPlus', 'FaEdit', 'FaEye', 'FaEyeSlash', 'FaSearch', 'FaTrash'].map(icon => `export const ${icon} = () => null;`).join('\n') };
      if (args.path === 'api') return { contents: 'export const productsAPI = new Proxy({}, {get:(_,name)=>(...args)=>globalThis.__adminProductTest.request(name,args)});' };
    });
  },
};

before(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'components', 'AdminProducts.jsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    define: { 'import.meta.env': '{}' }, plugins: [mockPlugin], logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  AdminProducts = module.exports.default;
});

const nodes = tree => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
};
const text = tree => {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return text(tree.props?.children);
};
const setup = (products = []) => {
  const harness = {
    values: [products, false], cursor: 0, refCursor: 0, refs: [], effects: [], calls: [], alerts: [],
    state(initial) {
      const index = this.cursor++;
      if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;
      return [this.values[index], value => { this.values[index] = typeof value === 'function' ? value(this.values[index]) : value; }];
    },
    async request(name, args) {
      this.calls.push({ name, args });
      return { data: name === 'uploadImage' ? { image: '/uploads/products/new-shoe.png' } : { products } };
    },
    ref(initial) { return this.refs[this.refCursor++] ||= { current: initial }; },
    render() { this.cursor = 0; this.refCursor = 0; this.effects = []; return AdminProducts(); },
    input(selector) {
      const input = nodes(this.render()).find(node => ['input', 'select', 'textarea'].includes(node.type) && selector(node.props));
      assert.ok(input, 'Expected form input');
      return input;
    },
    change(name, value) { this.input(props => props.name === name).props.onChange({ target: { name, value } }); },
    variant(index, field, value) { this.input(props => props.id === `variant-${field}-${index}`).props.onChange({ target: { value } }); },
    button(label) {
      const found = nodes(this.render()).find(node => node.type === 'button' && text(node).trim() === label);
      assert.ok(found, `Expected button ${label}`);
      return found;
    },
    selectImage(file) {
      const event = { target: { files: file ? [file] : [], value: file ? file.name : '' } };
      this.input(props => props.type === 'file').props.onChange(event);
      return event;
    },
    open() { this.button('Thêm sản phẩm').props.onClick(); },
    async submit() {
      const form = nodes(this.render()).find(node => node.type === 'form');
      assert.ok(form);
      await form.props.onSubmit({ preventDefault() {} });
    },
  };
  globalThis.__adminProductTest = harness;
  globalThis.alert = message => harness.alerts.push(message);
  globalThis.window = { confirm: () => true, location: { origin: 'http://localhost:5173' } };
  return harness;
};
const fill = h => {
  for (const [name, value] of Object.entries({ name: ' Sneaker mới ', brand: ' Nike ', price: '200000', category: 'Sneaker', description: ' Giày mới ' })) h.change(name, value);
  h.variant(0, 'color', ' Trắng ');
  h.variant(0, 'size', '40');
  h.variant(0, 'quantity', '20');
};
const image = { name: 'shoe.png', type: 'image/png', size: 1234 };

test('local image chooser accepts supported images and clears invalid, empty and oversized files', () => {
  const h = setup(); h.open();
  const input = h.input(props => props.type === 'file');
  assert.equal(input.props.accept, 'image/jpeg,image/png,image/webp');
  assert.equal(input.props.required, true);
  h.selectImage(image);
  assert.equal(h.input(props => props.type === 'file').props.required, false);
  for (const invalid of [{ ...image, type: 'image/svg+xml' }, { ...image, size: 0 }, { ...image, size: 5 * 1024 * 1024 + 1 }]) {
    const event = h.selectImage(invalid);
    assert.equal(event.target.value, '');
    assert.equal(h.input(props => props.type === 'file').props.required, true);
    assert.match(text(h.render()), /tối đa 5 MB/);
    assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert'));
  }
  assert.equal(h.calls.length, 0);
});

test('variant add/remove controls preserve each color, size and quantity and update total stock', () => {
  const h = setup(); h.open(); fill(h);
  let remove = nodes(h.render()).find(node => node.props?.['aria-label'] === 'Xóa dòng 1');
  assert.equal(remove.props.disabled, true);
  h.button('Thêm').props.onClick();
  h.variant(1, 'color', 'Đen'); h.variant(1, 'size', '41.5'); h.variant(1, 'quantity', '10');
  assert.equal(nodes(h.render()).filter(node => node.type === 'input' && node.props.id?.startsWith('variant-color-')).length, 2);
  assert.match(text(h.render()), /Tổng tồn kho:\s+30\s+đôi/);
  remove = nodes(h.render()).find(node => node.props?.['aria-label'] === 'Xóa dòng 1');
  assert.equal(remove.props.disabled, false);
  remove.props.onClick();
  assert.equal(h.input(props => props.id === 'variant-color-0').props.value, 'Đen');
  assert.equal(h.input(props => props.id === 'variant-size-0').props.value, '41.5');
  assert.match(text(h.render()), /Tổng tồn kho:\s+10\s+đôi/);
});

test('creating uploads the chosen file first then sends normalized image and variant rows', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  h.button('Thêm').props.onClick();
  h.variant(1, 'color', 'Đen'); h.variant(1, 'size', '41.5'); h.variant(1, 'quantity', '10');
  await h.submit();
  assert.deepEqual(h.calls[0], { name: 'uploadImage', args: [image] });
  assert.deepEqual(h.calls[1], { name: 'createProduct', args: [{
    name: 'Sneaker mới', brand: 'Nike', price: 200000, category: 'Sneaker', description: 'Giày mới',
    image: '/uploads/products/new-shoe.png', variants: [{ color: 'Trắng', size: 40, quantity: 20 }, { color: 'Đen', size: 41.5, quantity: 10 }],
  }] });
  assert.equal(h.calls[2].name, 'getAllProducts');
  assert.equal(nodes(h.render()).some(node => node.props?.role === 'dialog'), false);
});

test('upload failure keeps the form open and prevents product creation', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  h.request = async (name, args) => {
    h.calls.push({ name, args });
    throw { response: { data: { message: 'Ảnh tải lên thất bại' } } };
  };
  await h.submit();
  assert.deepEqual(h.calls.map(call => call.name), ['uploadImage']);
  assert.match(text(h.render()), /Ảnh tải lên thất bại/);
  assert.ok(nodes(h.render()).some(node => node.props?.role === 'dialog'));
  assert.equal(h.button('Thêm sản phẩm').props.disabled, undefined); // List action remains available.
  assert.equal(nodes(h.render()).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, false);
});

test('duplicate color and size is rejected before upload, including case and surrounding spaces', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  h.button('Thêm').props.onClick();
  h.variant(1, 'color', ' trắng '); h.variant(1, 'size', '40.0'); h.variant(1, 'quantity', '10');
  await h.submit();
  assert.equal(h.calls.length, 0);
  assert.match(text(h.render()), /bị trùng/);
});

test('editing keeps the stored image and sends version without uploading another file', async () => {
  const oldProduct = {
    _id: 'shoe-old', __v: 7, name: 'Old sneaker', brand: 'Nike', price: 100000, category: 'Sneaker',
    description: 'Old description', image: '/uploads/products/old-shoe.jpg', countInStock: 20,
    variants: [{ color: 'Trắng', size: 40, quantity: 20 }],
  };
  const h = setup([oldProduct]);
  nodes(h.render()).find(node => node.type === 'button' && node.props.title === 'Chỉnh sửa').props.onClick();
  assert.equal(h.input(props => props.type === 'file').props.required, false);
  assert.equal(nodes(h.render()).find(node => node.type === 'img' && node.props.alt === 'Xem trước ảnh sản phẩm').props.src, oldProduct.image);
  h.variant(0, 'quantity', '19');
  await h.submit();
  assert.deepEqual(h.calls[0], { name: 'updateProduct', args: ['shoe-old', {
    name: 'Old sneaker', brand: 'Nike', description: 'Old description', category: 'Sneaker', image: oldProduct.image,
    price: 100000, variants: [{ color: 'Trắng', size: 40, quantity: 19 }], version: 7,
  }] });
  assert.equal(h.calls.some(call => call.name === 'uploadImage'), false);
});

const legacyProduct = {
  _id: 'legacy-shoe', __v: 7, name: 'Giày cũ', brand: 'Nike', price: 100000, category: 'Sneaker',
  description: 'Mô tả cũ', image: '/uploads/products/old-shoe.jpg', countInStock: 23,
  sizes: [40, 41], color: 'Trắng', variants: [],
};
const edit = h => nodes(h.render()).find(node => node.type === 'button' && node.props.title === 'Chỉnh sửa').props.onClick();
const convert = (h, checked) => h.input(props => props.id === 'convert-legacy-inventory').props.onChange({ target: { checked } });
const variantInputs = h => nodes(h.render()).filter(node => node.type === 'input' && node.props.id?.startsWith('variant-'));

test('legacy metadata edits keep shared stock and omit all inventory fields without requiring quantity rows', async () => {
  for (const product of [legacyProduct, { ...legacyProduct, variants: undefined }]) {
    const h = setup([product]); edit(h);
    assert.equal(h.input(props => props.id === 'convert-legacy-inventory').props.checked, false);
    assert.equal(variantInputs(h).length, 0);
    assert.match(text(h.render()), /Tồn kho hiện tại:\s+23\s+đôi/);
    h.change('name', 'Tên mới'); h.change('price', '150000'); h.change('description', 'Mô tả mới');
    await h.submit();
    assert.deepEqual(h.calls[0], { name: 'updateProduct', args: ['legacy-shoe', {
      name: 'Tên mới', brand: 'Nike', description: 'Mô tả mới', category: 'Sneaker',
      image: legacyProduct.image, price: 150000, version: 7,
    }] });
    assert.equal(product.countInStock, 23);
    assert.equal(h.calls.some(call => call.name === 'uploadImage' || call.name === 'validateUpdate'), false);
    assert.equal(nodes(h.render()).some(node => node.props?.role === 'dialog'), false);
  }
});

test('legacy conversion is explicit, requires quantities and submits each allocated size with a version', async () => {
  const h = setup([legacyProduct]); edit(h); convert(h, true);
  assert.equal(h.input(props => props.id === 'variant-quantity-0').props.value, '');
  assert.equal(h.input(props => props.id === 'variant-quantity-1').props.value, '');
  await h.submit();
  assert.equal(h.calls.length, 0);
  assert.match(text(h.render()), /Dòng 1:/);
  h.variant(0, 'quantity', '20'); h.variant(1, 'quantity', '3');
  await h.submit();
  const update = h.calls.find(call => call.name === 'updateProduct');
  assert.ok(update);
  assert.deepEqual(update.args[1].variants, [{ color: 'Trắng', size: 40, quantity: 20 }, { color: 'Trắng', size: 41, quantity: 3 }]);
  assert.equal(update.args[1].version, 7);
});

test('opting out of a partially entered conversion saves metadata and reopening resets the choice', async () => {
  const h = setup([legacyProduct]); edit(h); convert(h, true);
  h.variant(0, 'quantity', 'invalid'); convert(h, false);
  assert.equal(variantInputs(h).length, 0);
  h.change('brand', 'Adidas');
  await h.submit();
  assert.equal(h.calls[0].name, 'updateProduct');
  assert.equal(Object.hasOwn(h.calls[0].args[1], 'variants'), false);
  assert.equal(h.calls[0].args[1].brand, 'Adidas');
  edit(h); convert(h, true); h.button('Hủy').props.onClick(); edit(h);
  assert.equal(h.input(props => props.id === 'convert-legacy-inventory').props.checked, false);
  assert.equal(variantInputs(h).length, 0);
});

test('legacy image edits validate metadata before uploading and save the new image without migrating stock', async () => {
  const h = setup([legacyProduct]); edit(h); h.selectImage(image);
  await h.submit();
  assert.deepEqual(h.calls.map(call => call.name), ['validateUpdate', 'uploadImage', 'updateProduct', 'getAllProducts']);
  assert.equal(h.calls[0].args[0], legacyProduct._id);
  assert.equal(h.calls[0].args[1].image, '/shoe.svg');
  assert.equal(h.calls[2].args[1].image, '/uploads/products/new-shoe.png');
  for (const call of [h.calls[0], h.calls[2]]) {
    for (const key of ['variants', 'countInStock', 'sizes', 'color']) assert.equal(Object.hasOwn(call.args[1], key), false);
    assert.equal(call.args[1].version, 7);
  }
});

test('a rejected conversion preflight prevents image upload and preserves the entered allocation', async () => {
  const h = setup([legacyProduct]); edit(h); convert(h, true);
  h.variant(0, 'quantity', '20'); h.variant(1, 'quantity', '3'); h.selectImage(image);
  h.request = async (name, args) => {
    h.calls.push({ name, args });
    throw { response: { status: 409, data: { message: 'Sản phẩm đang có trong giỏ hàng, chưa thể chuyển đổi kho.' } } };
  };
  await h.submit();
  assert.deepEqual(h.calls.map(call => call.name), ['validateUpdate']);
  assert.match(text(h.render()), /Sản phẩm đang có trong giỏ hàng/);
  assert.equal(h.input(props => props.id === 'variant-quantity-0').props.value, '20');
  assert.ok(nodes(h.render()).some(node => node.props?.role === 'dialog'));
  assert.equal(nodes(h.render()).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, false);
});

test('a valid replacement file can repair a missing or invalid legacy image without preflight validating the old path', async () => {
  for (const oldImage of ['', 'invalid-old-path']) {
    const h = setup([{ ...legacyProduct, image: oldImage }]); edit(h); h.selectImage(image);
    const request = h.request.bind(h);
    h.request = async (name, args) => {
      if (name === 'validateUpdate') {
        assert.match(args[1].image, /^\/[^/]/);
        assert.notEqual(args[1].image, oldImage);
      }
      return request(name, args);
    };
    await h.submit();
    assert.deepEqual(h.calls.map(call => call.name), ['validateUpdate', 'uploadImage', 'updateProduct', 'getAllProducts']);
    assert.equal(h.calls[2].args[1].image, '/uploads/products/new-shoe.png');
    assert.equal(Object.hasOwn(h.calls[2].args[1], 'variants'), false);
  }
});

test('retry after a final save failure reuses the uploaded image and keeps metadata independent of stock', async () => {
  const h = setup([legacyProduct]); edit(h); h.selectImage(image);
  let updates = 0;
  h.request = async (name, args) => {
    h.calls.push({ name, args });
    if (name === 'updateProduct' && ++updates === 1) throw { response: { data: { message: 'Lưu tạm thời thất bại' } } };
    return { data: name === 'uploadImage' ? { image: '/uploads/products/reused-shoe.png' } : { products: [legacyProduct] } };
  };
  await h.submit();
  assert.match(text(h.render()), /Lưu tạm thời thất bại/);
  await h.submit();
  assert.deepEqual(h.calls.map(call => call.name), ['validateUpdate', 'uploadImage', 'updateProduct', 'updateProduct', 'getAllProducts']);
  for (const call of h.calls.filter(call => call.name === 'updateProduct')) {
    assert.equal(call.args[1].image, '/uploads/products/reused-shoe.png');
    assert.equal(Object.hasOwn(call.args[1], 'variants'), false);
  }
  assert.equal(nodes(h.render()).some(node => node.props?.role === 'dialog'), false);
});

const galleryFiles = (h, files) => h.input(props => props.id === 'product-gallery-files').props.onChange({ target: { files, value: 'selected' } });
const sectionChange = (h, index, field, value) => h.input(props => props.id === `content-${field}-${index}`).props.onChange({ target: { value } });

test('gallery supports multiple local images, enforces the limit and rejects invalid batches atomically', () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  galleryFiles(h, [{ ...image, name: 'side.png' }, { ...image, name: 'back.png' }]);
  assert.match(text(h.render()), /Ảnh bổ sung \(\s*2\s*\/9\)/);
  galleryFiles(h, [{ ...image, name: 'bad.svg', type: 'image/svg+xml' }]);
  assert.match(text(h.render()), /Ảnh bổ sung \(\s*2\s*\/9\)/); assert.match(text(h.render()), /tối đa 5 MB/);
  galleryFiles(h, Array.from({ length: 8 }, (_, i) => ({ ...image, name: `${i}.png` })));
  assert.match(text(h.render()), /Ảnh bổ sung \(\s*2\s*\/9\)/); assert.match(text(h.render()), /tối đa 9 ảnh bổ sung/);
});

test('gallery files upload before saving and article images use the final uploaded URLs', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  galleryFiles(h, [{ ...image, name: 'side.png' }, { ...image, name: 'back.png' }]);
  h.button('+ Thêm mục giới thiệu').props.onClick();
  sectionChange(h, 0, 'title', ' Design '); sectionChange(h, 0, 'body', ' Detailed introduction ');
  const options = nodes(h.input(props => props.id === 'content-image-0')).filter(node => node.type === 'option');
  sectionChange(h, 0, 'image', options[2].props.value);
  let counter = 0;
  h.request = async (name, args) => { h.calls.push({ name, args }); return { data: name === 'uploadImage' ? { image: `/uploads/products/${++counter}.png` } : { products: [] } }; };
  await h.submit();
  assert.deepEqual(h.calls.map(call => call.name), ['uploadImage', 'uploadImage', 'uploadImage', 'createProduct', 'getAllProducts']);
  const payload = h.calls[3].args[0];
  assert.deepEqual(payload.images, ['/uploads/products/1.png', '/uploads/products/2.png', '/uploads/products/3.png']);
  assert.equal(payload.image, payload.images[0]); assert.equal(payload.contentSections[0].image, payload.images[1]);
  assert.equal(payload.contentSections[0].title, 'Design'); assert.equal(payload.contentSections[0].body, 'Detailed introduction');
});

test('gallery cover changes and reordering preserve article references without changing stock', async () => {
  const product = { ...legacyProduct, images: [legacyProduct.image, '/side.jpg', '/back.jpg'], material: 'Canvas', contentSections: [{ title: 'Side', body: 'Description', image: '/side.jpg', caption: 'Side view' }] };
  const h = setup([product]); edit(h);
  nodes(h.render()).find(node => node.props['aria-label'] === 'Dùng ảnh 2 làm ảnh bìa').props.onClick();
  nodes(h.render()).find(node => node.props['aria-label'] === 'Đưa ảnh 3 ra trước').props.onClick();
  await h.submit();
  const payload = h.calls.find(call => call.name === 'updateProduct').args[1];
  assert.equal(payload.image, '/side.jpg'); assert.deepEqual(payload.images, ['/side.jpg', '/back.jpg', legacyProduct.image]);
  assert.equal(payload.contentSections[0].image, '/side.jpg'); assert.equal(payload.material, 'Canvas');
  assert.equal(Object.hasOwn(payload, 'variants'), false); assert.equal(h.calls.some(call => call.name === 'uploadImage'), false);
});

test('empty article sections fail before uploads and removing a referenced image clears its selection', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image); galleryFiles(h, [{ ...image, name: 'detail.png' }]);
  h.button('+ Thêm mục giới thiệu').props.onClick();
  await h.submit(); assert.equal(h.calls.length, 0); assert.match(text(h.render()), /Mục 1:/);
  const options = nodes(h.input(props => props.id === 'content-image-0')).filter(node => node.type === 'option');
  sectionChange(h, 0, 'image', options[2].props.value);
  nodes(h.render()).find(node => node.props['aria-label'] === 'Xóa ảnh 2').props.onClick();
  assert.equal(h.input(props => props.id === 'content-image-0').props.value, '');
  await h.submit(); assert.equal(h.calls.length, 0);
});

test('a partial gallery upload failure reuses successful files on retry', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  galleryFiles(h, [{ ...image, name: 'side.png' }, { ...image, name: 'back.png' }]);
  let fail = true;
  h.request = async (name, args) => {
    h.calls.push({ name, args });
    if (name === 'uploadImage' && args[0].name === 'back.png' && fail) { fail = false; throw new Error('Back image upload failed'); }
    return { data: name === 'uploadImage' ? { image: `/uploads/products/${args[0].name}` } : { products: [] } };
  };
  await h.submit(); assert.match(text(h.render()), /Back image upload failed|Không lưu được/);
  assert.equal(h.calls.some(call => call.name === 'createProduct'), false);
  await h.submit();
  assert.equal(h.calls.filter(call => call.name === 'uploadImage' && call.args[0].name === 'shoe.png').length, 1);
  assert.equal(h.calls.filter(call => call.name === 'uploadImage' && call.args[0].name === 'side.png').length, 1);
  assert.equal(h.calls.filter(call => call.name === 'uploadImage' && call.args[0].name === 'back.png').length, 2);
  assert.equal(h.calls.filter(call => call.name === 'createProduct').length, 1);
});

test('rapid submit cannot start a second product upload operation', async () => {
  const h = setup(); h.open(); fill(h); h.selectImage(image);
  let resolveUpload;
  h.request = (name, args) => { h.calls.push({ name, args }); return name === 'uploadImage' ? new Promise(resolve => { resolveUpload = resolve; }) : Promise.resolve({ data: { products: [] } }); };
  const first = h.submit(); const duplicate = h.submit();
  assert.equal(h.calls.length, 1);
  resolveUpload({ data: { image: '/uploads/products/only-once.png' } });
  await Promise.all([first, duplicate]); assert.equal(h.calls.filter(call => call.name === 'createProduct').length, 1);
});

test('metadata edits on a product already using variants do not resubmit unchanged inventory', async () => {
  const product = { ...legacyProduct, variants: [{ color: 'Trắng', size: 40, quantity: 23 }] };
  const h = setup([product]); edit(h);
  assert.equal(nodes(h.render()).some(node => node.props.id === 'convert-legacy-inventory'), false);
  h.change('name', 'Tên mới'); h.variant(0, 'size', '40.0'); h.variant(0, 'quantity', '023');
  await h.submit();
  assert.equal(h.calls[0].name, 'updateProduct');
  assert.equal(h.calls[0].args[1].name, 'Tên mới');
  assert.equal(Object.hasOwn(h.calls[0].args[1], 'variants'), false);
  assert.equal(h.calls[0].args[1].version, 7);
});
