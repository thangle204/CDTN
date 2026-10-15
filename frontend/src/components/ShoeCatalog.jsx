import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FaArrowRight, FaChevronLeft, FaChevronRight, FaSearch, FaSlidersH, FaStar, FaTimes, FaThLarge, FaShoePrints } from 'react-icons/fa';
import { productsAPI } from '../utils/api';
import { productImageUrl } from '../utils/productVariants';
import { filterCatalogProducts, buildCatalogFacets, validateCatalogPriceRange, normalizeCatalogText } from '../utils/catalogFilters';
import StoreFooter from './StoreFooter';
import './shoe-catalog.css';

const CATEGORIES = ['Sneaker', 'Giày chạy bộ', 'Giày da', 'Sandal', 'Giày thể thao'];
const PAGE_SIZE = 20;
const SORT_OPTIONS = [['newest', 'Mới nhất'], ['price_asc', 'Giá thấp đến cao'], ['price_desc', 'Giá cao đến thấp'], ['rating', 'Đánh giá cao nhất']];
const money = value => Number(value || 0).toLocaleString('vi-VN') + ' ₫';
const onImageError = event => {
  event.currentTarget.onerror = null;
  event.currentTarget.src = '/shoe.svg';
};

function ProductCard({ product }) {
  const available = Number(product.countInStock) > 0;
  const sizes = [...new Set(product.variants?.length
    ? product.variants.filter(variant => variant.quantity > 0).map(variant => variant.size)
    : available ? product.sizes || [] : [])].sort((a, b) => a - b);
  const reviews = Number(product.numReviews) || 0;
  const rating = Math.max(0, Math.min(5, Number(product.rating) || 0));
  return (
    <article className="catalog-card">
      <Link to={`/products/${product._id}`} className="catalog-card-image" aria-label={`Xem ${product.name}`}>
        <img src={productImageUrl(product.image)} alt={product.name} loading="lazy" decoding="async" onError={onImageError} />
        {!available && <span className="catalog-stock-badge">Hết hàng</span>}
      </Link>
      <div className="catalog-card-info">
        <p className="catalog-card-brand">{product.brand}</p>
        <h2><Link to={`/products/${product._id}`}>{product.name}</Link></h2>
        <div className="catalog-card-rating">
          {reviews > 0 ? <>
            <span className="catalog-stars" role="img" aria-label={`${rating.toLocaleString('vi-VN')} trên 5 sao`}>
              <span className="catalog-stars-base" aria-hidden="true">{[0, 1, 2, 3, 4].map(star => <FaStar key={star} />)}</span>
              <span className="catalog-stars-fill" aria-hidden="true" style={{ width: `${rating / 5 * 100}%` }}>{[0, 1, 2, 3, 4].map(star => <FaStar key={star} />)}</span>
            </span><span>({reviews.toLocaleString('vi-VN')})</span>
          </> : <span className="catalog-no-reviews">Chưa có đánh giá</span>}
        </div>
        <p className="catalog-card-price">{money(product.price)}</p>
        <div className="catalog-card-bottom">
          <span className={available ? 'catalog-size-note' : 'catalog-size-note is-sold-out'}>
            {!available ? 'Tạm hết hàng' : sizes.length ? `Size ${sizes.slice(0, 3).join(' · ')}${sizes.length > 3 ? '…' : ''}` : 'Còn hàng'}
          </span>
          <Link to={`/products/${product._id}`} className="catalog-card-action" aria-label={`${available ? 'Chọn' : 'Xem'} ${product.name}`}>
            {available && sizes.length ? 'Chọn size' : 'Chi tiết'} <FaArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function FacetSection({ title, options, selected, onToggle, searchable = false }) {
  const [query, setQuery] = useState('');
  const visible = options.filter(option => normalizeCatalogText(option.label).includes(normalizeCatalogText(query)));
  return (
    <section className="catalog-facet">
      <h3>{title}</h3>
      {searchable && <div className="catalog-facet-search">
        <input type="search" aria-label={`Tìm ${title.toLocaleLowerCase('vi-VN')}`} placeholder="Tìm kiếm" value={query} onChange={event => setQuery(event.target.value)} />
        <FaSearch aria-hidden="true" />
      </div>}
      <div className="catalog-facet-options">
        {visible.map(option => <label key={option.value} className={`catalog-check ${option.count === 0 && !selected.includes(option.value) ? 'is-unavailable' : ''}`}>
          <input type="checkbox" checked={selected.includes(option.value)} disabled={option.count === 0 && !selected.includes(option.value)} onChange={() => onToggle(option.value)} />
          <span>{option.label}</span><span className="catalog-facet-count">({option.count})</span>
        </label>)}
        {visible.length === 0 && <p className="catalog-facet-empty">Không tìm thấy {title.toLocaleLowerCase('vi-VN')}.</p>}
      </div>
    </section>
  );
}

export default function ShoeCatalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ min: '', max: '' });
  const [priceError, setPriceError] = useState('');
  const requestVersion = useRef(0);
  const hasLoaded = useRef(false);
  const filterPanel = useRef(null);
  const filterTrigger = useRef(null);
  const catalogHeading = useRef(null);
  const paramsKey = searchParams.toString();
  const filters = useMemo(() => ({
    keyword: searchParams.get('keyword') || '', category: searchParams.get('category') || '',
    brands: searchParams.getAll('brand'), colors: searchParams.getAll('color'), sizes: searchParams.getAll('size'),
    minPrice: searchParams.get('minPrice') || '', maxPrice: searchParams.get('maxPrice') || '',
    inStock: searchParams.get('inStock') === '1',
    sort: SORT_OPTIONS.some(([value]) => value === searchParams.get('sort')) ? searchParams.get('sort') : 'newest',
  }), [paramsKey]);

  const fetchProducts = useCallback(async () => {
    const version = ++requestVersion.current;
    if (hasLoaded.current) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const { data, headers } = await productsAPI.getProducts();
      if (version !== requestVersion.current) return;
      if (!Array.isArray(data)) throw new Error('Dữ liệu sản phẩm không hợp lệ');
      setProducts(data);
      setDemoMode(String(headers?.['x-demo-mode']) === 'true');
      hasLoaded.current = true;
    } catch (failure) {
      if (version === requestVersion.current) setError(failure.response?.data?.message || 'Không thể tải bộ sưu tập giày. Vui lòng thử lại.');
    } finally {
      if (version === requestVersion.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    const refreshVisible = () => { if (document.visibilityState === 'visible') fetchProducts(); };
    window.addEventListener('focus', fetchProducts);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      requestVersion.current += 1;
      window.removeEventListener('focus', fetchProducts);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [fetchProducts]);

  useEffect(() => {
    setPriceDraft({ min: filters.minPrice, max: filters.maxPrice }); setPriceError('');
  }, [filters.minPrice, filters.maxPrice]);

  // Contain keyboard focus and page scrolling while the mobile panel is open.
  useEffect(() => {
    if (!filtersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...filterPanel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], select:not(:disabled)')].filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { setFiltersOpen(false); return; }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const handleResize = () => { if (window.innerWidth >= 1024) setFiltersOpen(false); };
    document.addEventListener('keydown', handleKey); window.addEventListener('resize', handleResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey); window.removeEventListener('resize', handleResize);
      filterTrigger.current?.focus();
    };
  }, [filtersOpen]);

  const changeParam = (key, value) => {
    const next = new URLSearchParams(searchParams); next.delete(key);
    (Array.isArray(value) ? value : value ? [value] : []).forEach(item => next.append(key, String(item)));
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };
  const toggleParam = (key, value) => {
    const current = searchParams.getAll(key);
    changeParam(key, current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  };
  const clearFilters = () => {
    const next = new URLSearchParams();
    if (searchParams.get('sort')) next.set('sort', filters.sort);
    setSearchParams(next); setPriceDraft({ min: '', max: '' }); setPriceError('');
  };
  const applyPrice = event => {
    event.preventDefault();
    const range = validateCatalogPriceRange(priceDraft.min, priceDraft.max);
    if (!range.valid) { setPriceError(range.error); return; }
    const next = new URLSearchParams(searchParams);
    next.delete('minPrice'); next.delete('maxPrice'); next.delete('page');
    if (range.min !== null) next.set('minPrice', String(range.min));
    if (range.max !== null) next.set('maxPrice', String(range.max));
    setPriceError(''); setSearchParams(next);
  };

  const visibleProducts = useMemo(() => filterCatalogProducts(products, filters), [products, filters]);
  const facets = useMemo(() => buildCatalogFacets(products, filters), [products, filters]);
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const requestedPage = Number(searchParams.get('page'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, totalPages) : 1;
  const start = (page - 1) * PAGE_SIZE;
  const pageProducts = visibleProducts.slice(start, start + PAGE_SIZE);
  const activeChips = [
    ...(filters.keyword ? [{ key: 'keyword', value: filters.keyword, label: `Tìm: ${filters.keyword}` }] : []),
    ...(filters.category ? [{ key: 'category', value: filters.category, label: filters.category }] : []),
    ...filters.brands.map(value => ({ key: 'brand', value, label: value })),
    ...filters.colors.map(value => ({ key: 'color', value, label: value })),
    ...filters.sizes.map(value => ({ key: 'size', value, label: `Size ${value}` })),
    ...(filters.inStock ? [{ key: 'inStock', value: '1', label: 'Còn hàng' }] : []),
    ...(filters.minPrice !== '' || filters.maxPrice !== '' ? [{ key: 'price', label: `${filters.minPrice !== '' ? money(filters.minPrice) : '0 ₫'} – ${filters.maxPrice !== '' ? money(filters.maxPrice) : 'trở lên'}` }] : []),
  ];
  const removeChip = chip => {
    if (chip.key !== 'price') { changeParam(chip.key, searchParams.getAll(chip.key).filter(value => value !== chip.value)); return; }
    const next = new URLSearchParams(searchParams); next.delete('minPrice'); next.delete('maxPrice'); next.delete('page'); setSearchParams(next);
  };
  const goToPage = nextPage => {
    changeParam('page', String(nextPage));
    catalogHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const priceRange = validateCatalogPriceRange(filters.minPrice, filters.maxPrice);
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, totalPages].filter(value => value >= 1 && value <= totalPages))].sort((a, b) => a - b);

  return (
    <div className="shoe-storefront">
      <main className="catalog-shell">
        <nav className="catalog-breadcrumb" aria-label="Đường dẫn"><Link to="/">Trang chủ</Link><FaChevronRight aria-hidden="true" /><span aria-current="page">Giày</span></nav>
        {demoMode && <p className="catalog-demo-notice" role="status">Bạn đang xem sản phẩm mẫu. Việc mua hàng cần kết nối cơ sở dữ liệu của cửa hàng.</p>}
        <div className="catalog-layout">
          {filtersOpen && <button className="catalog-filter-backdrop" onClick={() => setFiltersOpen(false)} aria-label="Đóng nền bộ lọc" tabIndex={-1} />}
          <aside ref={filterPanel} id="shoe-filters" className={`catalog-sidebar${filtersOpen ? ' is-open' : ''}`} aria-label="Bộ lọc sản phẩm" role={filtersOpen ? 'dialog' : undefined} aria-modal={filtersOpen ? true : undefined}>
            <div className="catalog-sidebar-heading">
              <h2><FaSlidersH aria-hidden="true" /> Bộ lọc</h2>
              <button className="catalog-mobile-close" onClick={() => setFiltersOpen(false)} aria-label="Đóng bộ lọc"><FaTimes /></button>
              {activeChips.length > 0 && <button className="catalog-reset" onClick={clearFilters}>Xóa tất cả</button>}
            </div>
            <FacetSection title="Thương hiệu" options={facets.brands} selected={filters.brands} onToggle={value => toggleParam('brand', value)} searchable />
            <FacetSection title="Màu sắc" options={facets.colors} selected={filters.colors} onToggle={value => toggleParam('color', value)} searchable />
            <section className="catalog-facet">
              <h3>Size giày</h3>
              <div className="catalog-size-options">{facets.sizes.map(option => <button key={option.value} type="button" aria-label={`Size ${option.label}`} aria-pressed={filters.sizes.includes(option.value)} disabled={option.count === 0 && !filters.sizes.includes(option.value)} onClick={() => toggleParam('size', option.value)}>{option.label}</button>)}</div>
              {facets.sizes.length === 0 && <p className="catalog-facet-empty">Chưa có thông tin size.</p>}
            </section>
            <section className="catalog-facet">
              <h3>Khoảng giá</h3>
              <form onSubmit={applyPrice}>
                <div className="catalog-price-fields">
                  <label><span>Từ (₫)</span><input type="number" aria-label="Từ giá" min="0" step="1" placeholder="0" value={priceDraft.min} onChange={event => setPriceDraft(previous => ({ ...previous, min: event.target.value }))} /></label>
                  <span className="catalog-price-dash">–</span>
                  <label><span>Đến (₫)</span><input type="number" aria-label="Đến giá" min="0" step="1" placeholder="Không giới hạn" value={priceDraft.max} onChange={event => setPriceDraft(previous => ({ ...previous, max: event.target.value }))} /></label>
                </div>
                {priceError && <p className="catalog-price-error" role="alert">{priceError}</p>}
                <button type="submit" className="catalog-price-apply">Áp dụng</button>
              </form>
            </section>
            <section className="catalog-facet catalog-stock-filter"><label className="catalog-check"><input type="checkbox" checked={filters.inStock} onChange={event => changeParam('inStock', event.target.checked ? '1' : '')} /><span>Chỉ xem giày còn hàng</span></label></section>
            <button type="button" className="catalog-mobile-results" onClick={() => setFiltersOpen(false)}>Xem {visibleProducts.length} sản phẩm <FaArrowRight aria-hidden="true" /></button>
          </aside>
          <div className="catalog-content">
            <div className="catalog-heading" ref={catalogHeading}>
              <div><h1>{filters.category || 'Bộ sưu tập giày'}</h1><p>{loading ? 'Đang tải bộ sưu tập…' : `${visibleProducts.length.toLocaleString('vi-VN')} mẫu giày${filters.keyword ? ` cho “${filters.keyword}”` : ' cho phong cách của bạn'}`}</p></div>
              <div className="catalog-sort"><span aria-hidden="true">↕</span><label className="sr-only" htmlFor="catalog-sort">Sắp xếp sản phẩm</label><select id="catalog-sort" aria-label="Sắp xếp sản phẩm" value={filters.sort} onChange={event => changeParam('sort', event.target.value)}>{SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            </div>
            <div className="catalog-categories" aria-label="Danh mục giày">
              <button type="button" className={!filters.category ? 'is-active' : ''} aria-pressed={!filters.category} onClick={() => changeParam('category', '')}><FaThLarge aria-hidden="true" /><span>Tất cả giày</span></button>
              {CATEGORIES.map(category => {
                const image = products.find(product => product.category === category)?.image;
                return <button key={category} type="button" className={filters.category === category ? 'is-active' : ''} aria-pressed={filters.category === category} onClick={() => changeParam('category', category)}>{image ? <img src={productImageUrl(image)} alt="" onError={onImageError} /> : <FaShoePrints aria-hidden="true" />}<span>{category}</span></button>;
              })}
            </div>
            <div className="catalog-mobile-toolbar"><button ref={filterTrigger} onClick={() => setFiltersOpen(true)} aria-label="Mở bộ lọc" aria-controls="shoe-filters" aria-expanded={filtersOpen}><FaSlidersH aria-hidden="true" /> Bộ lọc{activeChips.length > 0 && <span>{activeChips.length}</span>}</button><span>{refreshing ? 'Đang cập nhật…' : 'Chọn màu, chọn size, chọn phong cách'}</span></div>
            {activeChips.length > 0 && <div className="catalog-active-filters" aria-label="Bộ lọc đã chọn">{activeChips.map(chip => <button type="button" key={`${chip.key}-${chip.value || ''}`} onClick={() => removeChip(chip)} aria-label={`Bỏ lọc ${chip.label}`}>{chip.label}<FaTimes aria-hidden="true" /></button>)}<button className="catalog-clear-all" onClick={clearFilters}>Xóa tất cả</button></div>}
            {!priceRange.valid && <p role="alert" className="catalog-error">{priceRange.error} <button onClick={() => removeChip({ key: 'price' })}>Xóa khoảng giá</button></p>}
            {error && <div role="alert" className="catalog-error">{error}<button type="button" onClick={fetchProducts}>Thử lại</button></div>}
            <div className="catalog-grid" aria-busy={loading || refreshing}>{loading ? Array.from({ length: 8 }, (_, index) => <div className="catalog-skeleton" key={index} aria-hidden="true"><div /><span /><span /><span /></div>) : pageProducts.map(product => <ProductCard key={product._id} product={product} />)}</div>
            {!loading && !error && visibleProducts.length === 0 && <div className="catalog-empty"><FaSearch aria-hidden="true" /><h2>Chưa tìm thấy đôi giày phù hợp</h2><p>Thử thay đổi màu sắc, size hoặc khoảng giá để xem thêm mẫu giày.</p><button onClick={clearFilters}>Xem tất cả giày <FaArrowRight aria-hidden="true" /></button></div>}
            {!loading && visibleProducts.length > 0 && <div className="catalog-pagination-row">
              <p role="status">Hiển thị {start + 1}–{Math.min(start + PAGE_SIZE, visibleProducts.length)} / {visibleProducts.length} sản phẩm</p>
              {totalPages > 1 && <nav className="catalog-pagination" aria-label="Phân trang sản phẩm"><button aria-label="Trang trước" disabled={page === 1} onClick={() => goToPage(page - 1)}><FaChevronLeft /></button>{pageNumbers.map((number, index) => <span key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <span className="catalog-page-gap">…</span>}<button aria-label={`Trang ${number}`} aria-current={number === page ? 'page' : undefined} onClick={() => goToPage(number)}>{number}</button></span>)}<button aria-label="Trang sau" disabled={page === totalPages} onClick={() => goToPage(page + 1)}><FaChevronRight /></button></nav>}
            </div>}
          </div>
        </div>
      </main>
      <StoreFooter />
    </div>
  );
}
