const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.join(__dirname, '..', 'src');
const files = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(js|jsx)$/.test(entry.name) && files.push(path.join(dir, entry.name)));
walk(root);
const browserGlobals = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'caches', 'navigator', 'alert', 'confirm', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'URL', 'URLSearchParams', 'AbortController', 'FormData', 'TextEncoder']);
let bindings = 0;
for (const filename of files) {
  const ast = parser.parse(fs.readFileSync(filename, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    JSXIdentifier(p) {
      const name = p.node.name;
      if (!/^[A-Z]/.test(name) || p.parent.type === 'JSXMemberExpression' && p.key === 'property') return;
      assert(p.scope.hasBinding(name), path.relative(__dirname, filename) + ': unbound JSX ' + name);
      bindings++;
    },
    ReferencedIdentifier(p) {
      if (!p.scope.hasBinding(p.node.name) && !browserGlobals.has(p.node.name)) throw new Error(path.relative(__dirname, filename) + ': unbound reference ' + p.node.name);
    }
  });
}
console.log('PASS syntax and bindings: ' + files.length + ' modules, ' + bindings + ' JSX references');

const icons = [...new Set(files.flatMap(filename => fs.readFileSync(filename, 'utf8').match(/\bFa[A-Z]\w*/g) || []))];
const mockPlugin = {
  name: 'frontend-offline-mocks',
  setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onResolve({ filter: /^react-router-dom$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'mock' }));
    build.onResolve({ filter: /context\/AuthContext(?:\.jsx)?$/ }, () => ({ path: 'auth', namespace: 'mock' }));
    build.onResolve({ filter: /utils\/api(?:\.js)?$/ }, () => ({ path: 'api', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
      if (args.path === 'react') return { contents: 'export const useState = initial => globalThis.__frontendTest.state(initial); export const useEffect = effect => globalThis.__frontendTest.effects.push(effect); export const useRef = value => ({current:value}); export const useCallback = callback => callback; export const useMemo = callback => callback();' };
      if (args.path === 'react/jsx-runtime') return { contents: 'export const Fragment = "fragment"; export const jsx = (type, props, key) => ({type,props:props||{},key}); export const jsxs = jsx;' };
      if (args.path === 'react-router-dom') return { contents: 'export const Link = "a"; export const useNavigate = () => (...args) => globalThis.__frontendTest.navigation.push(args); export const useParams = () => ({id:"shoe-1",token:"reset-token"}); export const useLocation = () => ({key:"test"}); export const useSearchParams = () => [new URLSearchParams(),()=>{}];' };
      if (args.path === 'icons') return { contents: icons.map(icon => 'export const ' + icon + ' = () => null;').join('\n') };
      if (args.path === 'auth') return { contents: 'export const useAuth = () => globalThis.__frontendTest.auth;' };
      if (args.path === 'api') return { contents: 'const api = new Proxy({}, {get:(_,name)=>(...args)=>globalThis.__frontendTest.request(name,args)}); export const cartAPI=api,productsAPI=api,ordersAPI=api,vouchersAPI=api,customersAPI=api,authAPI=api; export default api;' };
    });
  }
};
const components = {};
const setup = (values, overrides = {}) => {
  const harness = {
    values: [...values], cursor: 0, effects: [], calls: [], navigation: [], updates: [], loggedOut: false,
    auth: { user: { _id:'customer-1', name:'Customer', phone:'0901234567' }, loading:false },
    state(initial) {
      const index = this.cursor++;
      if (!(index in this.values)) this.values[index] = typeof initial === 'function' ? initial() : initial;
      return [this.values[index], next => { this.values[index] = typeof next === 'function' ? next(this.values[index]) : next; }];
    },
    async request(name,args) { this.calls.push({name,args}); return {data:{}}; },
    ...overrides
  };
  harness.auth.updateUser = data => harness.updates.push(data);
  harness.auth.updateProfile = async changes => {
    const { data } = await harness.request('updateProfile', [changes]);
    harness.updates.push(data);
    return { success: true, data };
  };
  harness.auth.logout = () => { harness.loggedOut = true; };
  globalThis.__frontendTest = harness;
  globalThis.window = { confirm: () => true, location: { reload: () => { throw new Error('Unexpected browser reload'); } } };
  return harness;
};
const allNodes = tree => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(allNodes);
  return [tree, ...allNodes(tree.props?.children)];
};
const textOf = tree => {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textOf).join(' ');
  return textOf(tree.props?.children);
};
const button = (tree, text) => allNodes(tree).find(node => node.type === 'button' && textOf(node).includes(text));
const form = tree => allNodes(tree).find(node => node.type === 'form');
const event = { preventDefault() {}, stopPropagation() {} };
const product = {_id:'shoe-1', name:'Sneaker', price:100000, countInStock:10, sizes:[40,41], image:'/shoe.svg', rating:5, numReviews:1};
const item = {_id:'cart-1',product,size:40,price:100000,quantity:2};
const reviewStates = selected => [product,false,2,selected,'','',false,[{_id:'review-1',name:'Customer',rating:5,comment:'Great',createdAt:'2026-10-12'}],'',''];
const shipping = {name:' Customer ',phone:'0901234567',address:' Street ',city:' City ',district:' District ',ward:' Ward ',notes:' Note '};
const checkoutStates = (quote=null, step=2) => [[item],false,false,step,'',quote,'',false,null,shipping,'COD'];
let assertions = 0;
const test = async (name, action) => { await action(); assertions++; console.log('PASS ' + name); };
(async () => {
  for (const name of ['ProductDetail','Cart','Checkout','ForgotPassword','ResetPassword','Profile','MyOrders']) {
    const result = await esbuild.build({entryPoints:[path.join(root,'pages',name+'.jsx')],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',plugins:[mockPlugin],logLevel:'silent'});
    const module = {exports:{}};
    new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
    components[name] = module.exports.default;
  }
  await test('render product with reviews and require shoe size', async () => {
    const h = setup(reviewStates(''));
    const tree = components.ProductDetail();
    assert(textOf(tree).includes('Customer'));
    await button(tree,'Thêm vào giỏ').props.onClick();
    assert.equal(h.calls.length,0);
    assert.match(h.values[4],/size/);
  });
  await test('selected size and quantity reach shared cart API', async () => {
    const h = setup(reviewStates('40'));
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:product}; };
    await button(components.ProductDetail(),'Thêm vào giỏ').props.onClick();
    assert.deepEqual(h.calls.find(call => call.name==='addToCart').args,['shoe-1',2,'40']);
  });
  await test('product details display reviews without a writing or editing form', async () => {
    const h = setup(reviewStates('40'));
    h.values[8] = 'Không thể tải đánh giá';
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:name==='getProductById' ? product : {reviews:[]}}; };
    const tree = components.ProductDetail();
    assert.equal(form(tree), undefined);
    assert.equal(button(tree, 'Viết đánh giá'), undefined);
    assert.equal(button(tree, 'Sửa đánh giá'), undefined);
    assert(textOf(tree).includes('Great'));
    await button(tree, 'Thử lại').props.onClick();
    assert(h.calls.some(call => call.name==='getReviews'));
    assert(!h.calls.some(call => /create.*Review|update.*Review/i.test(call.name)));
  });
  await test('cart variant update uses cart item ID', async () => {
    const h = setup([[item,{...item,_id:'cart-2',size:41,quantity:3}],false,false,'']);
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:[item]}; };
    const tree = components.Cart();
    const decrement = allNodes(tree).find(node => node.type==='button' && node.props['aria-label']==='Giảm số lượng');
    await decrement.props.onClick();
    assert.deepEqual(h.calls[0],{name:'updateCartItem',args:['cart-1',1]});
  });
  await test('cart removal uses variant ID', async () => {
    const h = setup([[item],false,false,'']);
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:[]}; };
    const remove = allNodes(components.Cart()).find(node => node.type==='button' && node.props['aria-label']==='Xóa Sneaker');
    await remove.props.onClick();
    assert.deepEqual(h.calls[0],{name:'removeFromCart',args:['cart-1']});
  });
  await test('stock limit applies across multiple shoe sizes', async () => {
    setup([[{...item,quantity:7},{...item,_id:'cart-2',size:41,quantity:3}],false,false,'']);
    const increments = allNodes(components.Cart()).filter(node => node.type==='button' && node.props['aria-label']==='Tăng số lượng');
    assert(increments.every(node => node.props.disabled));
  });
  await test('checkout waits for session restoration', async () => {
    const h = setup([], {auth:{user:null,loading:true}});
    components.Checkout();
    h.effects.forEach(effect => effect());
    assert.equal(h.navigation.length,0);
    assert.equal(h.calls.length,0);
  });
  await test('checkout unauthenticated redirect remembers destination', async () => {
    const h = setup([], {auth:{user:null,loading:false}});
    components.Checkout();
    h.effects.forEach(effect => effect());
    assert.deepEqual(h.navigation[0],['/login',{replace:true,state:{from:'/checkout'}}]);
  });
  await test('checkout offers only COD and VNPAY without bank transfer fields', async () => {
    const h = setup(checkoutStates(null, 1));
    let tree = components.Checkout();
    const methods = allNodes(tree).filter(node => node.type === 'input' && node.props.name === 'paymentMethod');
    assert.deepEqual(methods.map(node => node.props.value), ['COD', 'VNPAY']);
    assert.equal(methods[0].props.checked, true);
    assert(!textOf(tree).includes('Chuyển khoản ngân hàng'));
    assert(!textOf(tree).includes('Số tài khoản người chuyển'));
    methods[1].props.onChange();
    h.cursor = 0;
    tree = components.Checkout();
    assert(allNodes(tree).some(node => node.type === 'input' && node.props.value === 'VNPAY' && node.props.checked));
    assert(textOf(tree).includes('chuyển đến VNPAY Sandbox'));
  });
  await test('order sends full shipping and server authoritative pricing', async () => {
    const h = setup(checkoutStates({voucher:{code:'SHIP'},itemsPrice:200000,shippingPrice:0,discountAmount:0,totalPrice:200000}));
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:{_id:'order-1',totalPrice:200000}}; };
    await button(components.Checkout(),'Đặt giày').props.onClick();
    const payload = h.calls.find(call => call.name==='createOrder').args[0];
    assert.equal(payload.voucherCode,'SHIP');
    assert.equal(payload.shippingAddress.name,'Customer');
    assert.equal(payload.shippingAddress.district,'District');
    assert.equal(payload.shippingAddress.ward,'Ward');
    assert.equal(payload.shippingAddress.notes,'Note');
    assert.equal(payload.expectedTotalPrice,200000);
    assert.equal(payload.paymentMethod,'COD');
    assert(!('bankTransferInfo' in payload));
    assert.deepEqual(payload.expectedCart,[{product:'shoe-1',color:'',size:40,quantity:2}]);
    for (const key of ['totalPrice','discountAmount','isPaid','orderItems']) assert(!(key in payload));
    assert.equal(h.values[3],3);
  });
  await test('changed checkout quote refreshes cart and requires confirmation again', async () => {
    const h = setup(checkoutStates({voucher:{code:'SHIP'},itemsPrice:200000,shippingPrice:0,discountAmount:0,totalPrice:200000}));
    const refreshed = [{...item,product:{...product,price:120000},price:120000}];
    h.request = async (name,args) => {
      h.calls.push({name,args});
      if (name === 'createOrder') throw {response:{status:409,data:{message:'Price or voucher changed; please confirm again'}}};
      if (name === 'getCart') return {data:refreshed};
      throw new Error('Unexpected request ' + name);
    };
    await button(components.Checkout(),'Đặt giày').props.onClick();
    assert.deepEqual(h.values[0],refreshed);
    assert.equal(h.values[3],1);
    assert.equal(h.values[5],null);
    assert.equal(h.values[6],'');
    assert.equal(h.values[4],'Price or voucher changed; please confirm again');
    assert.equal(h.values[2],false);
    assert.equal(h.calls.filter(call => call.name === 'createOrder').length,1);
    assert.equal(h.calls.filter(call => call.name === 'getCart').length,1);
  });
  await test('same-price variant change requires a refreshed confirmation before ordering again', async () => {
    const h = setup(checkoutStates(null));
    h.values[0]=[{...item,color:'Trắng'}];
    const refreshed=[{...item,color:'Đen'}];
    h.request=async(name,args)=>{
      h.calls.push({name,args});
      if(name==='createOrder') throw {response:{status:409,data:{message:'Giỏ đã thay đổi. Vui lòng xác nhận lại.'}}};
      if(name==='getCart') return {data:refreshed};
      throw new Error('Unexpected request '+name);
    };
    await button(components.Checkout(),'Đặt giày').props.onClick();
    assert.deepEqual(h.calls.find(call=>call.name==='createOrder').args[0].expectedCart,[{product:'shoe-1',color:'Trắng',size:40,quantity:2}]);
    assert.deepEqual(h.values[0],refreshed);
    assert.equal(h.values[3],1);
    assert.equal(h.values[8],null);
    assert.equal(h.calls.filter(call=>call.name==='createOrder').length,1);
  });
  await test('shipping voucher renders one waiver without extra discount', async () => {
    setup(checkoutStates({voucher:{code:'SHIP'},itemsPrice:200000,shippingPrice:0,discountAmount:0,totalPrice:200000}));
    const tree = components.Checkout();
    assert(textOf(tree).includes('Miễn phí'));
    assert(!textOf(tree).includes('Giảm giá'));
    assert(textOf(tree).includes('200.000₫'));
  });
  await test('voucher uses server quote for totals', async () => {
    const h = setup(checkoutStates(null));
    const quote={voucher:{code:'SHOE10'},itemsPrice:200000,shippingPrice:30000,discountAmount:20000,totalPrice:210000};
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:quote}; };
    await allNodes(components.Checkout()).find(node => node.type?.name === 'VoucherSelector').props.onChoose('SHOE10');
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(h.calls[0],{name:'applyVoucher',args:['SHOE10',200000]});
    assert.deepEqual(h.values[5],quote);
  });
  await test('forgot password reports delivery configuration failure', async () => {
    const h = setup(['customer@example.test',false,'',false,'']);
    h.request = async () => { throw {response:{data:{message:'SMTP unavailable'}}}; };
    await form(components.ForgotPassword()).props.onSubmit(event);
    assert.equal(h.values[1],false);
    assert.equal(h.values[2],'SMTP unavailable');
  });
  await test('forgot password calls real shared API', async () => {
    const h = setup(['customer@example.test',false,'',false,'']);
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:{message:'Check your inbox'}}; };
    await form(components.ForgotPassword()).props.onSubmit(event);
    assert.deepEqual(h.calls[0],{name:'forgotPassword',args:['customer@example.test']});
    assert.equal(h.values[1],true);
  });
  await test('reset password validates confirmation before request', async () => {
    const h = setup(['new-password','different',false,'','']);
    await form(components.ResetPassword()).props.onSubmit(event);
    assert.equal(h.calls.length,0);
    assert(h.values[3]);
  });
  await test('reset password sends token and ends previous session', async () => {
    const h = setup(['new-password','new-password',false,'','']);
    h.request = async (name,args) => { h.calls.push({name,args}); return {data:{message:'Password reset'}}; };
    await form(components.ResetPassword()).props.onSubmit(event);
    assert.deepEqual(h.calls[0],{name:'resetPassword',args:['reset-token','new-password']});
    assert.equal(h.loggedOut,true);
  });
  await test('profile updates auth state without page reload', async () => {
    const h = setup([true,false,false,'','',{name:'New name',phone:'0901234567',currentPassword:'',newPassword:'',confirmPassword:''},{name:'Old name',phone:'0901234567'}]);
    const profile={_id:'customer-1',name:'New name',email:'customer@example.test',phone:'0901234567',isAdmin:false,token:'test-token'};
    h.request=async(name,args)=>{h.calls.push({name,args});return {data:profile};};
    await form(components.Profile()).props.onSubmit(event);
    assert.deepEqual(h.updates,[profile]);
    assert.equal(h.values[0],false);
  });
  await test('cancelled paid order displays pending manual refund', async () => {
    setup([[{_id:'order-1',orderStatus:'Đã hủy',isPaid:true,refundStatus:'pending',totalPrice:200000,orderItems:[{_id:'item-1',name:'Sneaker',size:40,quantity:2,price:100000}],shippingAddress:shipping,paymentMethod:'BANK',createdAt:'2026-10-12'}],false,false,'']);
    assert(textOf(components.MyOrders()).includes('Đang chờ cửa hàng xử lý hoàn tiền'));
  });
  await test('cancelled paid order displays confirmed manual refund', async () => {
    setup([[{_id:'order-1',orderStatus:'Đã hủy',isPaid:true,refundStatus:'refunded',refundedAt:'2026-10-12',totalPrice:200000,orderItems:[{_id:'item-1',name:'Sneaker',size:40,quantity:2,price:100000}],shippingAddress:shipping,paymentMethod:'BANK',createdAt:'2026-10-12'}],false,false,'']);
    assert(textOf(components.MyOrders()).includes('Cửa hàng đã xác nhận hoàn tiền'));
  });
  console.log('PASS offline customer flow checks: '+assertions);
})().catch(error=>{console.error(error);process.exitCode=1;});
