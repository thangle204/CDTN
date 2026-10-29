const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..', 'src');
const shoe = {
  _id: 'shoe-1', name: 'Sneaker', price: 100000, image: '/uploads/products/shoe.png',
  countInStock: 25, sizes: [40, 41], color: 'Trắng, Đen',
  variants: [{ color: 'Trắng', size: 40, quantity: 20 }, { color: 'Đen', size: 40, quantity: 5 }, { color: 'Trắng', size: 41, quantity: 0 }],
};
const white = { _id: 'cart-white', product: shoe, color: 'Trắng', size: 40, quantity: 20 };
const black = { _id: 'cart-black', product: shoe, color: 'Đen', size: 40, quantity: 1 };
const helpers = import(pathToFileURL(path.join(root, 'utils', 'productVariants.js')).href);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const findButton = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).includes(label));
const setup = values => {
  const harness = {
    values: [...values], cursor: 0, calls: [], effects: [], navigation: [],
    auth: { user: { _id: 'customer-1', name: 'Customer' }, loading: false },
    state(initial) {
      const index = this.cursor++;
      if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;
      return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }];
    },
    async request(name, args) { this.calls.push({ name, args }); return { data: name === 'getProductById' ? shoe : name === 'getReviews' ? { reviews: [] } : [] }; },
  };
  globalThis.__variantTest = harness;
  globalThis.window = { location: { origin: 'http://localhost:5173' }, confirm: () => true };
  return harness;
};
const render = (component, harness) => { harness.cursor = 0; return component(); };
const productState = (color = '', size = '', quantity = 1) => [shoe, false, quantity, size, '', '', false, [], '', color];
const components = (async () => {
  const names = ['ProductDetail', 'Cart', 'Checkout', 'MyOrders'];
  const icons = new Set(names.flatMap(name => fs.readFileSync(path.join(root, 'pages', name + '.jsx'), 'utf8').match(/\bFa[A-Z]\w*/g) || []));
  const plugin = {
    name: 'variant-ui-mocks',
    setup(build) {
      build.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^react-router-dom$|^react-icons\/fa$|context\/AuthContext(?:\.jsx)?$|utils\/api(?:\.js)?$/ }, args => ({ path: args.path, namespace: 'variant-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'variant-mock' }, args => {
        if (args.path === 'react') return { contents: 'export const useState = initial => globalThis.__variantTest.state(initial); export const useEffect = effect => globalThis.__variantTest.effects.push(effect); export const useRef = value => ({current:value});' };
        if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment="fragment"; export const jsx = (type,props,key) => ({type,props:props||{},key}); export const jsxs=jsx;' };
        if (args.path === 'react-router-dom') return { contents: 'export const Link="a"; export const useParams=()=>({id:"shoe-1"}); export const useLocation=()=>({key:"test"}); export const useNavigate=()=>(...args)=>globalThis.__variantTest.navigation.push(args);' };
        if (args.path === 'react-icons/fa') return { contents: [...icons].map(icon => `export const ${icon} = () => null;`).join('\n') };
        if (args.path.includes('AuthContext')) return { contents: 'export const useAuth=()=>globalThis.__variantTest.auth;' };
        return { contents: 'const api=new Proxy({},{get:(_,name)=>(...args)=>globalThis.__variantTest.request(name,args)}); export const productsAPI=api,cartAPI=api,ordersAPI=api,vouchersAPI=api;' };
      });
    },
  };
  const result = {};
  for (const name of names) {
    const build = await esbuild.build({ entryPoints: [path.join(root, 'pages', name + '.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' }, plugins: [plugin], logLevel: 'silent' });
    const module = { exports: {} };
    new Function('module', 'exports', build.outputFiles[0].text)(module, module.exports);
    result[name] = module.exports.default;
  }
  return result;
})();

test('variant lookup uses color and size together, including case and whitespace', async () => {
  const { productStock, productSizes, validProductSelection, productColors } = await helpers;
  assert.equal(productStock(shoe, 40, ' trắng '), 20);
  assert.equal(productStock(shoe, 40, 'TRẮNG'.normalize('NFD')), 20);
  assert.equal(productStock(shoe, 40, 'Đen'), 5);
  assert.equal(productStock(shoe, 41, 'Trắng'), 0);
  assert.equal(validProductSelection(shoe, 41, 'Đen'), false);
  assert.deepEqual(productSizes(shoe, 'Đen'), [40]);
  const mixedCase = { ...shoe, variants: [...shoe.variants, { color: ' trắng '.normalize('NFD'), size: 42, quantity: 1 }] };
  assert.equal(productColors(mixedCase).length, 2);
});

test('cart inventory separates variants and retains shared stock for legacy shoes', async () => {
  const { sharesCartStock, productStock } = await helpers;
  assert.equal(sharesCartStock(white, black), false);
  assert.equal(sharesCartStock(white, { ...white, color: 'trắng' }), true);
  assert.equal(sharesCartStock(white, { ...white, size: 41 }), false);
  const legacy = { ...shoe, variants: [], countInStock: 9 };
  assert.equal(sharesCartStock({ ...white, product: legacy }, { ...black, product: legacy, size: 41 }), true);
  assert.equal(productStock(legacy, 40, 'Trắng'), 9);
});

test('product requires color before adding and changing color clears size and quantity', async () => {
  const { ProductDetail } = await components;
  const h = setup(productState('', '40', 4));
  const unselectedTree = render(ProductDetail, h);
  assert.equal(Boolean(findButton(unselectedTree, 'Thêm vào giỏ').props.disabled), false);
  assert.equal(Boolean(findButton(unselectedTree, 'Mua ngay').props.disabled), false);
  await findButton(unselectedTree, 'Thêm vào giỏ').props.onClick();
  assert.equal(h.calls.length, 0);
  assert.match(h.values[4], /chọn màu/);
  findButton(render(ProductDetail, h), 'Đen').props.onClick();
  assert.equal(h.values[9], 'Đen');
  assert.equal(h.values[3], '');
  assert.equal(h.values[2], 1);
  const tree = render(ProductDetail, h);
  assert.equal(findButton(tree, '41'), undefined);
  await findButton(tree, 'Mua ngay').props.onClick();
  assert.equal(h.calls.length, 0);
  assert.match(h.values[4], /chọn size/);
});

test('product refresh preserves the current selection when color changes during its request', async () => {
  const { ProductDetail } = await components;
  const refreshedShoe = { ...shoe, countInStock: 29, variants: shoe.variants.map(variant => variant.size === 41 ? { ...variant, quantity: 4 } : variant) };
  const h = setup(productState('Đen', '40', 2));
  h.values[0] = refreshedShoe;
  let resolveRefresh;
  h.request = async (name, args) => {
    h.calls.push({ name, args });
    if (name === 'getProductById') return new Promise(resolve => { resolveRefresh = resolve; });
    return { data: [] };
  };
  const pending = findButton(render(ProductDetail, h), 'Thêm vào giỏ').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  findButton(render(ProductDetail, h), 'Trắng').props.onClick();
  findButton(render(ProductDetail, h), '41').props.onClick();
  resolveRefresh({ data: refreshedShoe });
  await pending;
  h.effects = [];
  render(ProductDetail, h);
  h.effects[1]();
  assert.equal(h.values[9], 'Trắng');
  assert.equal(h.values[3], '41');
  assert.equal(h.values[2], 1);
});

test('product sends chosen variant to cart and clamps quantity to its inventory', async () => {
  const { ProductDetail } = await components;
  const h = setup(productState('Đen', '40', 2));
  let tree = render(ProductDetail, h);
  const quantity = nodes(tree).find(node => node.type === 'input' && node.props.type === 'number');
  assert.equal(quantity.props.max, 5);
  quantity.props.onChange({ target: { value: '9' } });
  assert.equal(h.values[2], 5);
  tree = render(ProductDetail, h);
  await findButton(tree, 'Thêm vào giỏ').props.onClick();
  assert.deepEqual(h.calls.find(call => call.name === 'addToCart').args, ['shoe-1', 5, '40', 'Đen']);
});

test('sold out sizes are disabled and stale variant quantities never reach cart API', async () => {
  const { ProductDetail } = await components;
  const h = setup(productState('Trắng', '40', 21));
  const tree = render(ProductDetail, h);
  assert.equal(findButton(tree, '41').props.disabled, true);
  await findButton(tree, 'Thêm vào giỏ').props.onClick();
  assert.equal(h.calls.length, 0);
  assert.match(h.values[4], /không còn đủ hàng/);
});

test('cart can increase black size 40 while white size 40 is at its own limit', async () => {
  const { Cart } = await components;
  const h = setup([[white, black], false, false, '']);
  const tree = render(Cart, h);
  const increments = nodes(tree).filter(node => node.props['aria-label'] === 'Tăng số lượng');
  assert.equal(increments[0].props.disabled, true);
  assert.equal(Boolean(increments[1].props.disabled), false);
  await increments[1].props.onClick();
  assert.deepEqual(h.calls[0], { name: 'updateCartItem', args: ['cart-black', 2] });
  assert(text(tree).includes('Màu: Trắng'));
  assert(text(tree).includes('Màu: Đen'));
});

test('cart prevents checkout when a color/size combination no longer exists', async () => {
  const { Cart } = await components;
  const h = setup([[{ ...black, size: 41 }], false, false, '']);
  const tree = render(Cart, h);
  const checkout = nodes(tree).find(node => node.type === 'a' && node.props.to === '/checkout');
  assert.equal(checkout.props['aria-disabled'], true);
});

const cartQuantityButtons = (tree, increase = false) => nodes(tree).filter(node =>
  node.type === 'button' && node.props['aria-label'] === (increase ? 'T\u0103ng s\u1ed1 l\u01b0\u1ee3ng' : 'Gi\u1ea3m s\u1ed1 l\u01b0\u1ee3ng')
);
const cartCheckout = tree => nodes(tree).find(node => node.type === 'a' && node.props.to === '/checkout');
const cartWithStock = (quantity, stock, overrides = {}) => ({
  ...white,
  quantity,
  product: { ...shoe, countInStock: stock, variants: [{ ...shoe.variants[0], quantity: stock }] },
  ...overrides,
});
const respondWithCart = (harness, cart) => {
  harness.request = async (name, args) => {
    harness.calls.push({ name, args });
    return { data: cart };
  };
};

test('cart minus repairs a quantity above current variant stock in one request and uses the server cart', async () => {
  const { Cart } = await components;
  const item = cartWithStock(20, 10);
  const serverCart = [{ ...item, quantity: 10, serverSnapshot: 'latest' }];
  const h = setup([[item], false, false, '']);
  respondWithCart(h, serverCart);
  const tree = render(Cart, h);
  assert.equal(cartQuantityButtons(tree)[0].props.disabled, false);
  assert.equal(cartCheckout(tree).props['aria-disabled'], true);
  await cartQuantityButtons(tree)[0].props.onClick();
  assert.deepEqual(h.calls, [{ name: 'updateCartItem', args: ['cart-white', 10] }]);
  assert.equal(h.values[0], serverCart);
  assert.equal(cartCheckout(render(Cart, h)).props['aria-disabled'], false);
});

test('cart minus reserves shared legacy stock for other sizes when repairing an oversized line', async () => {
  const { Cart } = await components;
  const product = { ...shoe, variants: [], countInStock: 10 };
  const first = { ...white, product, quantity: 20 };
  const second = { ...black, product, size: 41, quantity: 7 };
  const h = setup([[first, second], false, false, '']);
  respondWithCart(h, [{ ...first, quantity: 3 }, second]);
  await cartQuantityButtons(render(Cart, h))[0].props.onClick();
  assert.deepEqual(h.calls, [{ name: 'updateCartItem', args: ['cart-white', 3] }]);
  assert.equal(cartCheckout(render(Cart, h)).props['aria-disabled'], false);
});

test('cart can progressively repair two legacy lines even when other sizes already exceed shared stock', async () => {
  const { Cart } = await components;
  const product = { ...shoe, variants: [], countInStock: 10 };
  const first = { ...white, product, quantity: 20 };
  const second = { ...black, product, size: 41, quantity: 20 };
  const h = setup([[first, second], false, false, '']);
  respondWithCart(h, [{ ...first, quantity: 1 }, second]);
  await cartQuantityButtons(render(Cart, h))[0].props.onClick();
  assert.deepEqual(h.calls[0], { name: 'updateCartItem', args: ['cart-white', 1] });
  let tree = render(Cart, h);
  assert.equal(cartCheckout(tree).props['aria-disabled'], true);
  assert.equal(cartQuantityButtons(tree)[0].props.disabled, true);
  respondWithCart(h, [{ ...first, quantity: 1 }, { ...second, quantity: 9 }]);
  await cartQuantityButtons(tree)[1].props.onClick();
  assert.deepEqual(h.calls[1], { name: 'updateCartItem', args: ['cart-black', 9] });
  tree = render(Cart, h);
  assert.equal(cartCheckout(tree).props['aria-disabled'], false);
  assert.equal(h.calls.some(call => call.name === 'removeFromCart'), false);
});

test('cart repair counts duplicate variants together while keeping other colors and sizes separate', async () => {
  const { Cart } = await components;
  const product = {
    ...shoe,
    variants: [
      { ...shoe.variants[0], quantity: 10 },
      { ...shoe.variants[1], quantity: 30 },
      { ...shoe.variants[2], quantity: 30 },
    ],
  };
  const first = { ...white, product, quantity: 20 };
  const duplicate = { ...white, product, _id: 'cart-duplicate', quantity: 7 };
  const differentColor = { ...black, product, quantity: 20 };
  const differentSize = { ...white, product, _id: 'cart-size-41', size: 41, quantity: 20 };
  const h = setup([[first, duplicate, differentColor, differentSize], false, false, '']);
  respondWithCart(h, [{ ...first, quantity: 3 }, duplicate, differentColor, differentSize]);
  await cartQuantityButtons(render(Cart, h))[0].props.onClick();
  assert.deepEqual(h.calls, [{ name: 'updateCartItem', args: ['cart-white', 3] }]);
  assert.equal(cartCheckout(render(Cart, h)).props['aria-disabled'], false);
});

test('cart preserves one-step changes in stock and rejects oversized increases without clamping them', async () => {
  const { Cart } = await components;
  const item = cartWithStock(5, 10);
  const h = setup([[item], false, false, '']);
  respondWithCart(h, [{ ...item, quantity: 4 }]);
  await cartQuantityButtons(render(Cart, h))[0].props.onClick();
  assert.deepEqual(h.calls[0], { name: 'updateCartItem', args: ['cart-white', 4] });
  respondWithCart(h, [{ ...item, quantity: 5 }]);
  await cartQuantityButtons(render(Cart, h), true)[0].props.onClick();
  assert.deepEqual(h.calls[1], { name: 'updateCartItem', args: ['cart-white', 5] });

  const oversized = setup([[cartWithStock(20, 10)], false, false, '']);
  const tree = render(Cart, oversized);
  assert.equal(cartQuantityButtons(tree, true)[0].props.disabled, true);
  await cartQuantityButtons(tree, true)[0].props.onClick();
  assert.equal(oversized.calls.length, 0);
  assert.ok(oversized.values[3]);
  assert.equal(oversized.values[0][0].quantity, 20);
});

test('sold-out variants may decrease to one but remain blocked from checkout with a removal hint', async () => {
  const { Cart } = await components;
  const item = cartWithStock(20, 0);
  const h = setup([[item], false, false, '']);
  respondWithCart(h, [{ ...item, quantity: 1 }]);
  await cartQuantityButtons(render(Cart, h))[0].props.onClick();
  assert.deepEqual(h.calls, [{ name: 'updateCartItem', args: ['cart-white', 1] }]);
  const tree = render(Cart, h);
  assert.equal(cartCheckout(tree).props['aria-disabled'], true);
  assert.equal(cartQuantityButtons(tree)[0].props.disabled, true);
  assert.match(text(tree), /x\u00f3a kh\u1ecfi gi\u1ecf/);
  await cartQuantityButtons(tree)[0].props.onClick();
  assert.equal(h.calls.length, 1);
});

test('missing, hidden, archived and removed-variant lines cannot decrement through disabled callbacks', async () => {
  const { Cart } = await components;
  const item = cartWithStock(20, 10);
  const unavailable = [
    { ...item, product: null },
    { ...item, product: { ...item.product, isHidden: true } },
    { ...item, product: { ...item.product, isArchived: true } },
    { ...item, size: 42 },
  ];
  for (const line of unavailable) {
    const h = setup([[line], false, false, '']);
    const tree = render(Cart, h);
    assert.equal(cartQuantityButtons(tree)[0].props.disabled, true);
    assert.equal(cartCheckout(tree).props['aria-disabled'], true);
    await cartQuantityButtons(tree)[0].props.onClick();
    assert.equal(h.calls.length, 0);
    assert.equal(h.values[0][0].quantity, 20);
  }
});

test('cart keeps its previous quantity on API failure and blocks another update while one is pending', async () => {
  const { Cart } = await components;
  const item = cartWithStock(20, 10);
  const originalCart = [item];
  const h = setup([originalCart, false, false, '']);
  let rejectRequest;
  h.request = (name, args) => {
    h.calls.push({ name, args });
    return new Promise((resolve, reject) => { rejectRequest = reject; });
  };
  const pending = cartQuantityButtons(render(Cart, h))[0].props.onClick();
  assert.equal(h.values[2], true);
  assert.equal(h.values[0], originalCart);
  const busyTree = render(Cart, h);
  assert.equal(cartQuantityButtons(busyTree)[0].props.disabled, true);
  await cartQuantityButtons(busyTree)[0].props.onClick();
  assert.equal(h.calls.length, 1);
  rejectRequest({ response: { data: { message: 'Stock changed again; please retry.' } } });
  await pending;
  assert.equal(h.values[0], originalCart);
  assert.equal(h.values[3], 'Stock changed again; please retry.');
  assert.equal(h.values[2], false);
  assert.match(text(render(Cart, h)), /Stock changed again; please retry\./);
});

test('checkout and stored orders display the selected color and size', async () => {
  const { Checkout, MyOrders } = await components;
  const shipping = { name: 'Customer', phone: '0901234567', address: 'Street', city: 'City', district: '', ward: '', notes: '' };
  const checkout = setup([[black], false, false, 2, '', null, '', false, null, shipping, 'COD', {}]);
  assert.match(text(render(Checkout, checkout)), /Màu Đen.*Size 40/);
  const orders = setup([[{ _id: 'order-1', orderStatus: 'Đang xử lý', totalPrice: 130000, orderItems: [{ ...black, name: shoe.name, image: shoe.image, price: shoe.price }], shippingAddress: shipping, paymentMethod: 'COD', createdAt: '2026-10-14' }], false, false, '']);
  assert.match(text(render(MyOrders, orders)), /Màu: Đen.*Size: 40/);
});

test('uploaded image paths resolve to the API origin when a separate API URL is configured', async () => {
  globalThis.window = { location: { origin: 'http://localhost:5173' } };
  const build = await esbuild.build({ entryPoints: [path.join(root, 'utils', 'productVariants.js')], bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': '{"VITE_API_URL":"https://api.example.test/api"}' }, logLevel: 'silent' });
  const module = { exports: {} };
  new Function('module', 'exports', build.outputFiles[0].text)(module, module.exports);
  assert.equal(module.exports.productImageUrl('/uploads/products/shoe.png'), 'https://api.example.test/uploads/products/shoe.png');
  assert.equal(module.exports.productImageUrl('https://images.example.test/shoe.png'), 'https://images.example.test/shoe.png');
  assert.equal(module.exports.productImageUrl(''), '/shoe.svg');
  assert.equal(module.exports.productImageUrl({ path: '/uploads/products/shoe.png' }), '/shoe.svg');
});

test('product details and cart show the same percentage sale without discounting the cart snapshot twice', async () => {
  const { ProductDetail, Cart } = await components;
  const saleShoe = { ...shoe, discountPercent: 25 };
  const detail = setup(productState('Đen', '40'));
  detail.values[0] = saleShoe;
  const detailText = text(render(ProductDetail, detail));
  assert.match(detailText, /75\.000/);
  assert.match(detailText, /Giảm\s+25\s*%/);
  assert.match(detailText, /Tiết kiệm\s+25\.000/);
  const cart = setup([[{ ...black, product: saleShoe, price: 75000, quantity: 2 }], false, false, '']);
  const cartText = text(render(Cart, cart));
  assert.match(cartText, /Thành tiền:\s+150\.000₫/);
  assert.match(cartText, /Tổng dự kiến\s+180\.000₫/);
});

test('checkout uses sale totals for voucher previews and the confirmed server total', async () => {
  const { Checkout } = await components;
  const shipping = { name: 'Customer', phone: '0901234567', address: 'Street', city: 'City', district: '', ward: '', notes: '' };
  const row = { ...black, product: { ...shoe, discountPercent: 25 }, price: 1, quantity: 2 };
  const h = setup([[row], false, false, 2, '', null, '', false, null, shipping, 'COD']);
  assert.match(text(render(Checkout, h)), /Tạm tính\s+150\.000₫/);
  await findButton(render(Checkout, h), 'Đặt giày').props.onClick();
  const payload = h.calls.find(call => call.name === 'createOrder').args[0];
  assert.equal(payload.expectedTotalPrice, 180000);
  assert.equal(payload.discountPercent, undefined);
  const voucher = setup([[row], false, false, 2, '', null, '', false, null, shipping, 'COD']);
  const selector = nodes(render(Checkout, voucher)).find(node => node.type?.name === 'VoucherSelector');
  await selector.props.onChoose('SALE');
  assert.deepEqual(voucher.calls.find(call => call.name === 'applyVoucher').args, ['SALE', 150000]);
});
