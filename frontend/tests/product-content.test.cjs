const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
let Gallery, Story;
const helpers = import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'productContent.js')).href);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
before(async () => {
  const plugin = { name: 'gallery-offline', setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'gallery-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'gallery-mock' }, args => ({ contents: args.path === 'react'
      ? 'export const useState=v=>globalThis.__galleryTest.state(v);export const useRef=v=>globalThis.__galleryTest.ref(v);export const useEffect=(fn,deps)=>globalThis.__galleryTest.effect(fn,deps);'
      : 'export const jsx=(type,props,key)=>({type,props:props||{},key});export const jsxs=jsx;export const Fragment="fragment";' }));
  }};
  const compile = async name => {
    const result = await esbuild.build({ entryPoints: [path.join(__dirname, '..', 'src', 'components', name + '.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', define: { 'import.meta.env': '{}' }, plugins: [plugin], logLevel: 'silent' });
    const module = { exports: {} }; new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports); return module.exports.default;
  };
  Gallery = await compile('ProductGallery'); Story = await compile('ProductStory');
});
const setup = product => {
  const h = { values: [], refs: [], slots: [], effects: [], stateCursor: 0, refCursor: 0, effectCursor: 0,
    state(initial) { const i = this.stateCursor++; if (!(i in this.values)) this.values[i] = typeof initial === 'function' ? initial() : initial; return [this.values[i], next => { this.values[i] = typeof next === 'function' ? next(this.values[i]) : next; }]; },
    ref(initial) { return this.refs[this.refCursor++] ||= { current: initial }; },
    effect(fn, deps) { const i = this.effectCursor++, old = this.slots[i]; if (!old || deps.some((d, index) => d !== old.deps[index])) { const slot = this.slots[i] = { deps }; this.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); }); } },
    render(flush = false) { globalThis.__galleryTest = h; this.stateCursor = this.refCursor = this.effectCursor = 0; const tree = Gallery({ product }); if (flush) this.effects.splice(0).forEach(fn => fn()); return tree; },
    button(label) { const node = nodes(this.render()).find(node => node.type === 'button' && node.props['aria-label'] === label); assert.ok(node, label); return node; },
  }; h.render(); return h;
};
const mainImage = tree => nodes(tree).find(node => node.type === 'img' && node.props.alt?.includes('— ảnh'));
const expand = tree => Array.isArray(tree) ? tree.map(expand) : !tree || typeof tree !== 'object' ? tree : typeof tree.type === 'function' ? expand(tree.type(tree.props)) : { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };

test('legacy products use their one cover image and duplicate gallery entries do not repeat', async () => {
  const { productImages } = await helpers;
  assert.deepEqual(productImages({ image: '/old.jpg' }), ['/old.jpg']);
  assert.deepEqual(productImages({ image: '/a.jpg', images: ['/a.jpg', '/b.jpg', '/b.jpg'] }), ['/a.jpg', '/b.jpg']);
  const h = setup({ name: 'Legacy shoe', image: '/old.jpg' });
  assert.equal(mainImage(h.render()).props.src, '/old.jpg');
  assert.equal(nodes(h.render()).some(node => node.props['aria-label'] === 'Ảnh tiếp theo'), false);
});

test('gallery thumbnails and previous/next controls navigate the same ordered images', () => {
  const h = setup({ name: 'Sneaker', image: '/a.jpg', images: ['/a.jpg', '/b.jpg', '/c.jpg'] });
  h.button('Xem ảnh 3').props.onClick(); assert.equal(mainImage(h.render()).props.src, '/c.jpg');
  assert.equal(h.button('Xem ảnh 3').props['aria-pressed'], true);
  h.button('Ảnh tiếp theo').props.onClick(); assert.equal(mainImage(h.render()).props.src, '/a.jpg');
  h.button('Ảnh trước').props.onClick(); assert.equal(mainImage(h.render()).props.src, '/c.jpg');
});

test('lightbox locks scrolling, handles image arrow keys and restores the previous scroll style', () => {
  const h = setup({ name: 'Sneaker', image: '/a.jpg', images: ['/a.jpg', '/b.jpg'] });
  globalThis.document = { body: { style: { overflow: 'auto' } } };
  let shown = 0, closed = 0;
  h.refs[0].current = { open: false, showModal() { this.open = true; shown++; }, close() { this.open = false; closed++; } };
  h.render(true); h.button('Phóng to ảnh 1 của Sneaker').props.onClick(); h.render(true);
  assert.equal(shown, 1); assert.equal(document.body.style.overflow, 'hidden');
  nodes(h.render()).find(node => node.type === 'dialog').props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(mainImage(h.render()).props.src, '/b.jpg');
  h.button('Đóng ảnh phóng to').props.onClick(); h.render(true);
  assert.equal(closed, 1); assert.equal(document.body.style.overflow, 'auto');
});

test('product stories render headings, paragraphs, lists, photos and captions without interpreting HTML', () => {
  const tree = expand(Story({ product: { name: 'Story shoe', description: 'Opening paragraph', contentSections: [
    { title: 'Design', body: 'First paragraph\n\nSecond paragraph', image: '/side.jpg', caption: 'Side view' },
    { title: 'Care', body: '- Dry naturally\n- Avoid bleach\n\n<script>plain text</script>' },
  ] } }));
  assert(text(tree).includes('Opening paragraph')); assert(text(tree).includes('Second paragraph'));
  assert.equal(nodes(tree).filter(node => node.type === 'h3').length, 2);
  assert.equal(nodes(tree).filter(node => node.type === 'li').length, 2);
  assert.equal(nodes(tree).find(node => node.type === 'img').props.src, '/side.jpg');
  assert(text(tree).includes('Side view')); assert(text(tree).includes('<script>plain text</script>'));
  assert.equal(nodes(tree).some(node => node.type === 'script' || node.props.dangerouslySetInnerHTML), false);
});

test('draft serialization resolves section image keys to gallery URLs without sending editor-only fields', async () => {
  const { productContentPayload, validateProductContentDraft } = await helpers;
  const form = { material: ' Mesh ', contentSections: [{ title: ' Design ', body: ' Text ', imageKey: 'extra-a', caption: ' Side ' }] };
  const extras = [{ key: 'extra-a', url: '/side.jpg' }];
  assert.equal(validateProductContentDraft(form, extras), '');
  const result = productContentPayload(form, extras, '/cover.jpg', null);
  assert.deepEqual(result.images, ['/cover.jpg', '/side.jpg']);
  assert.deepEqual(result.contentSections, [{ title: 'Design', body: 'Text', image: '/side.jpg', caption: 'Side' }]);
  assert.equal(result.material, 'Mesh');
  assert.equal(Object.hasOwn(result, 'variants'), false); assert.equal(Object.hasOwn(result.contentSections[0], 'imageKey'), false);
});

test('content drafts enforce gallery/section limits and reject deleted photo references before uploading', async () => {
  const { validateProductContentDraft } = await helpers;
  for (const [form, extras] of [[{ contentSections: [{ title: 'Empty' }] }, []], [{ contentSections: [{ body: 'Text', imageKey: 'deleted' }] }, []], [{ contentSections: Array.from({ length: 13 }, () => ({ body: 'Text' })) }, []], [{ contentSections: Array.from({ length: 5 }, () => ({ body: 'x'.repeat(10000) })) }, []], [{}, Array.from({ length: 10 }, (_, i) => ({ key: String(i), url: `/i${i}.jpg` }))]]) assert.notEqual(validateProductContentDraft(form, extras), '');
});

test('article links scroll without changing routes and respect modifier clicks and reduced motion', async () => {
  const { scrollToProductSection } = await helpers;
  let prevented = 0; const scrolls = [];
  globalThis.document = { getElementById: id => id === 'product-story' ? { scrollIntoView: options => scrolls.push(options) } : null };
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  const event = { currentTarget: { hash: '#product-story' }, preventDefault() { prevented++; } };
  scrollToProductSection(event); assert.equal(prevented, 1); assert.deepEqual(scrolls, [{ block: 'start', behavior: 'auto' }]);
  scrollToProductSection({ ...event, ctrlKey: true }); assert.equal(prevented, 1); assert.equal(scrolls.length, 1);
});
