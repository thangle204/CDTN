import { useState, useEffect, useRef } from 'react';
import { productsAPI } from '../utils/api';
import { productImageUrl } from '../utils/productVariants';
import { FaPlus, FaEdit, FaEye, FaEyeSlash, FaSearch, FaTrash } from 'react-icons/fa';
import ProductPhotoPreview from './ProductPhotoPreview';
import { productImages, productContentPayload, validateProductContentDraft, MAX_PRODUCT_IMAGES, MAX_PRODUCT_SECTIONS } from '../utils/productContent';

const emptyForm = () => ({ name: '', price: '', category: '', description: '', image: '', brand: '', material: '', origin: '', gender: '', style: '', modelCode: '', contentSections: [], variants: [{ color: '', size: '', quantity: '' }] });
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

const AdminProducts = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState(''); // ✅ SEARCH STATE
  const [formData, setFormData] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [formError, setFormError] = useState('');
  const [convertLegacyInventory, setConvertLegacyInventory] = useState(false);
  const [extraImages, setExtraImages] = useState([]);
  const saveOperation = useRef(false);

  const isLegacyProduct = Boolean(editingProduct && !editingProduct.variants?.length);
  const showVariantEditor = !isLegacyProduct || convertLegacyInventory;

  useEffect(() => {
    if (!imageFile) { setImagePreview(''); return; }
    const preview = URL.createObjectURL(imageFile);
    setImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [imageFile]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setError('');
      const response = await productsAPI.getAllProducts();
      setProducts(response.data.products);
    } catch {
      setError('Không tải được danh sách giày. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData(previous => ({ ...previous, [e.target.name]: e.target.value }));
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    setFormError('');
    if (!file) { setImageFile(null); return; }
    if (!imageTypes.includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) {
      setFormError('Chọn ảnh JPG, PNG hoặc WebP, dung lượng tối đa 5 MB.');
      event.target.value = '';
      setImageFile(null);
      return;
    }
    setImageFile(file);
  };

  const updateVariant = (index, field, value) => {
    setFormData(previous => ({ ...previous, variants: previous.variants.map((variant, row) => row === index ? { ...variant, [field]: value } : variant) }));
  };

  const addGalleryFiles = event => {
    const files = Array.from(event.target.files || []);
    setFormError('');
    event.target.value = '';
    if (!files.length) return;
    if (extraImages.length + files.length > MAX_PRODUCT_IMAGES - 1) { setFormError('Chỉ thêm tối đa 9 ảnh bổ sung, cùng 1 ảnh bìa là 10 ảnh.'); return; }
    if (files.some(file => !imageTypes.includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024)) { setFormError('Mọi ảnh phải là JPG, PNG hoặc WebP, dung lượng tối đa 5 MB mỗi ảnh.'); return; }
    setExtraImages(previous => [...previous, ...files.map(file => ({ key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, file, url: '' }))]);
  };
  const updateSection = (index, field, value) => setFormData(previous => ({ ...previous, contentSections: previous.contentSections.map((section, row) => row === index ? { ...section, [field]: value } : section) }));
  const removeGalleryImage = key => {
    setExtraImages(previous => previous.filter(image => image.key !== key));
    setFormData(previous => ({ ...previous, contentSections: previous.contentSections.map(section => section.imageKey === key ? { ...section, imageKey: '' } : section) }));
  };
  const moveGalleryImage = (index, delta) => setExtraImages(previous => {
    const next = [...previous], target = index + delta;
    if (target < 0 || target >= next.length) return previous;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const useAsCover = media => {
    const oldCover = { key: media.key, file: imageFile, url: imageFile ? '' : formData.image };
    const hadCover = Boolean(oldCover.file || oldCover.url);
    setImageFile(media.file || null);
    setFormData(previous => ({ ...previous, image: media.file ? '' : media.url, contentSections: previous.contentSections.map(section => ({ ...section, imageKey: section.imageKey === media.key ? 'cover' : section.imageKey === 'cover' && hadCover ? media.key : section.imageKey })) }));
    setExtraImages(previous => hadCover ? previous.map(image => image.key === media.key ? oldCover : image) : previous.filter(image => image.key !== media.key));
  };

  const totalStock = formData.variants.reduce((total, variant) => {
    const quantity = Number(variant.quantity);
    return total + (Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : 0);
  }, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || saveOperation.current) return;
    setFormError('');
    const price = Number(formData.price);
    if (!formData.name.trim() || !formData.brand.trim() || !formData.description.trim() || !formData.category) {
      setFormError('Vui lòng nhập đầy đủ tên giày, danh mục, thương hiệu và mô tả.');
      return;
    }
    if (!imageFile && !formData.image) { setFormError('Vui lòng chọn hình ảnh sản phẩm từ máy tính.'); return; }
    if (formData.name.trim().length > 200 || formData.brand.trim().length > 100 || formData.description.trim().length > 5000) { setFormError('Tên tối đa 200, thương hiệu 100 và mô tả ngắn 5.000 ký tự. Dùng bài giới thiệu cho nội dung dài hơn.'); return; }
    const contentError = validateProductContentDraft(formData, extraImages);
    if (contentError) { setFormError(contentError); return; }
    if (formData.price === '' || !Number.isSafeInteger(price) || price < 0) {
      setFormError('Giá phải là số nguyên không âm.');
      return;
    }
    const variants = [];
    const keys = new Set();
    for (const [index, row] of (showVariantEditor ? formData.variants : []).entries()) {
      const color = row.color.trim();
      const size = Number(row.size);
      const quantity = Number(row.quantity);
      if (!color || color.length > 100 || String(row.size).trim() === '' || !Number.isFinite(size) || size < 1 || size > 60 || !Number.isInteger(size * 2) || String(row.quantity).trim() === '' || !Number.isSafeInteger(quantity) || quantity < 0) {
        setFormError(`Dòng ${index + 1}: nhập màu sắc, size từ 1 đến 60 (bước 0.5) và số lượng nguyên không âm.`);
        return;
      }
      const key = `${color.normalize('NFC').toLocaleLowerCase('vi-VN')}|${size}`;
      if (keys.has(key)) { setFormError(`Màu ${color}, size ${size} bị trùng. Hãy gộp số lượng vào một dòng.`); return; }
      keys.add(key);
      variants.push({ color, size, quantity });
    }
    if (showVariantEditor && (!variants.length || variants.length > 100 || !Number.isSafeInteger(totalStock))) { setFormError('Nhập từ 1 đến 100 dòng với tổng số lượng hợp lệ.'); return; }
    const inventoryChanged = !editingProduct || (isLegacyProduct
      ? convertLegacyInventory
      : variants.length !== editingProduct.variants.length || variants.some((variant, index) => {
        const previous = editingProduct.variants[index];
        return variant.color !== previous.color || variant.size !== previous.size || variant.quantity !== previous.quantity;
      }));
    const placeholderCover = imageFile ? extraImages.some(image => image.url === '/shoe.svg') ? '/shoe-cover-preview.svg' : '/shoe.svg' : formData.image;
    const pendingExtras = extraImages.map((image, index) => ({ ...image, url: image.file ? `/shoe-gallery-preview-${index + 1}.svg` : image.url }));
    const payload = {
      name: formData.name.trim(),
      brand: formData.brand.trim(),
      description: formData.description.trim(),
      category: formData.category,
      image: placeholderCover,
      ...productContentPayload(formData, pendingExtras, placeholderCover, editingProduct),
      price,
      ...(inventoryChanged ? { variants } : {}),
      ...(editingProduct ? { version: editingProduct.__v ?? 0 } : {}),
    };
    saveOperation.current = true;
    setSaving(true);
    try {
      if (editingProduct && (imageFile || extraImages.some(image => image.file))) await productsAPI.validateUpdate(editingProduct._id, { ...payload });
      let cover = formData.image;
      if (imageFile) {
        const { data } = await productsAPI.uploadImage(imageFile);
        cover = data.image;
        setFormData(previous => ({ ...previous, image: data.image }));
        setImageFile(null);
      }
      const resolvedExtras = [];
      for (const media of extraImages) {
        if (!media.file) { resolvedExtras.push(media); continue; }
        const { data } = await productsAPI.uploadImage(media.file);
        const resolved = { ...media, file: null, url: data.image };
        resolvedExtras.push(resolved);
        // Keep successful uploads when a later file or the final save fails.
        setExtraImages(previous => previous.map(image => image.key === media.key ? resolved : image));
      }
      payload.image = cover;
      Object.assign(payload, productContentPayload(formData, resolvedExtras, cover, editingProduct));
      if (editingProduct) {
        await productsAPI.updateProduct(editingProduct._id, payload);
        alert('✅ Cập nhật sản phẩm thành công!');
      } else {
        await productsAPI.createProduct(payload);
        alert('✅ Thêm sản phẩm thành công!');
      }
      setShowModal(false);
      setEditingProduct(null);
      resetForm();
      await fetchProducts();
    } catch (error) {
      setFormError(error.response?.data?.message || 'Không lưu được sản phẩm. Vui lòng thử lại.');
    } finally {
      saveOperation.current = false;
      setSaving(false);
    }
  };

  const handleEdit = (product) => {
    const images = productImages(product);
    const extras = images.slice(1).map((url, index) => ({ key: `existing-${index}`, url, file: null }));
    setExtraImages(extras);
    setImageFile(null);
    setFormError('');
    setConvertLegacyInventory(false);
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: product.price,
      category: product.category || '',
      description: product.description || '',
      image: product.image || '',
      brand: product.brand || '',
      material: product.material || '', origin: product.origin || '', gender: product.gender || '', style: product.style || '', modelCode: product.modelCode || '',
      contentSections: (product.contentSections || []).map(section => ({ title: section.title || '', body: section.body || '', caption: section.caption || '', imageKey: section.image === product.image ? 'cover' : extras.find(image => image.url === section.image)?.key || '' })),
      variants: product.variants?.length
        ? product.variants.map(({ color, size, quantity }) => ({ color, size: String(size), quantity: String(quantity) }))
        : (product.sizes?.length ? product.sizes : ['']).map(size => ({ color: product.color || '', size: String(size), quantity: '' })),
    });
    setShowModal(true);
  };

  const handleToggleVisibility = async (id, currentStatus) => {
    const action = currentStatus ? 'hiển thị' : 'ẩn';
    if (!window.confirm(`Bạn có chắc chắn muốn ${action} sản phẩm này?`)) return;
    setActionId(id);
    try {
      await productsAPI.toggleVisibility(id);
      alert(`✅ Đã ${action} sản phẩm thành công!`);
      await fetchProducts();
    } catch (error) {
      alert('❌ Lỗi: ' + (error.response?.data?.message || error.message));
    } finally {
      setActionId(null);
    }
  };

  const resetForm = () => {
    setFormData(emptyForm());
    setImageFile(null);
    setExtraImages([]);
    setFormError('');
    setConvertLegacyInventory(false);
  };

  // ✅ LỌC SẢN PHẨM THEO TRẠNG THÁI VÀ TÌM KIẾM
  const filteredProducts = products.filter(product => {
    // Filter by status
    if (filterStatus === 'visible' && product.isHidden) return false;
    if (filterStatus === 'hidden' && !product.isHidden) return false;
    
    // ✅ Filter by search term
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      return (
        product.name?.toLowerCase().includes(search) ||
        product.color?.toLowerCase().includes(search) ||
        product.category?.toLowerCase().includes(search) ||
        product.brand?.toLowerCase().includes(search)
      );
    }
    
    return true;
  });

  if (loading) {
    return <div className="text-center py-12">Đang tải...</div>;
  }

  return (
    <div>
      {error && <div role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">{error} <button onClick={fetchProducts} className="underline">Thử lại</button></div>}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Danh sách sản phẩm</h2>
          <p className="text-sm text-gray-600 mt-1">
            Hiển thị {filteredProducts.length}/{products.length} sản phẩm
          </p>
        </div>
        
        <div className="flex gap-3 flex-wrap">
          {/* ✅ SEARCH INPUT */}
          <div className="relative">
            <FaSearch className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm tên giày, thương hiệu..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border-2 border-gray-300 rounded-md text-sm focus:outline-none focus:border-red-500 w-64"
            />
          </div>
          
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-red-500"
          >
            <option value="all">Tất cả</option>
            <option value="visible">Đang hiển thị</option>
            <option value="hidden">Đã ẩn</option>
          </select>
          
          <button
            onClick={() => {
              setEditingProduct(null);
              resetForm();
              setShowModal(true);
            }}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 flex items-center space-x-2 whitespace-nowrap"
          >
            <FaPlus />
            <span>Thêm sản phẩm</span>
          </button>
        </div>
      </div>

      {/* ✅ HIỂN THỊ THÔNG BÁO KHI TÌM KIẾM */}
      {searchTerm && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-blue-700">
            <FaSearch className="inline mr-2" />
            Tìm kiếm: "<strong>{searchTerm}</strong>" - {filteredProducts.length} kết quả
          </p>
          <button
            onClick={() => setSearchTerm('')}
            className="text-red-600 hover:text-red-800 text-sm font-semibold"
          >
            Xóa tìm kiếm
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden shop-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sản phẩm</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thể loại</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Giá</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tồn kho</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trạng thái</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Thao tác</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredProducts.map((product) => (
                <tr key={product._id} className={product.isHidden ? 'bg-gray-50 opacity-60' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <img 
                        src={productImageUrl(product.image)}
                        alt={product.name} 
                        className="h-12 w-12 rounded object-cover"
                        onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/shoe.svg'; }}
                      />
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{product.name}</div>
                        {product.brand && (
                          <div className="text-xs text-gray-500">{product.brand}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {product.category || product.brand}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-red-600 font-semibold">
                    {product.price.toLocaleString('vi-VN')}₫
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      (product.countInStock ?? product.stock ?? 0) > 0
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {product.countInStock ?? product.stock ?? 0}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      product.isHidden 
                        ? 'bg-gray-200 text-gray-700' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {product.isHidden ? '👁️‍🗨️ Đã ẩn' : '👁️ Hiển thị'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    <button
                      onClick={() => handleEdit(product)}
                      className="text-red-600 hover:text-red-800 p-2"
                      title="Chỉnh sửa"
                    >
                      <FaEdit size={16} />
                    </button>
                    <button
                      onClick={() => handleToggleVisibility(product._id, product.isHidden)}
                      disabled={actionId !== null}
                      className={`p-2 ${
                        product.isHidden 
                          ? 'text-green-600 hover:text-green-900' 
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      title={product.isHidden ? 'Hiển thị' : 'Ẩn'}
                    >
                      {product.isHidden ? <FaEye size={16} /> : <FaEyeSlash size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅ THÔNG BÁO KHI KHÔNG TÌM THẤY */}
      {filteredProducts.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow mt-4 shop-panel">
          <p className="text-gray-600">
            {searchTerm 
              ? `Không tìm thấy sản phẩm với từ khóa "${searchTerm}"` 
              : 'Không có sản phẩm nào'}
          </p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" aria-labelledby="product-form-title" className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <h3 id="product-form-title" className="text-xl font-bold mb-4">
              {editingProduct ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm mới'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
              <fieldset disabled={saving} className="space-y-4 disabled:opacity-70">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tên giày *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleChange} required maxLength={200} className="w-full border border-gray-300 rounded px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Danh mục *</label>
                  <select name="category" value={formData.category} onChange={handleChange} required className="w-full border border-gray-300 rounded px-3 py-2">
                    <option value="">Chọn danh mục</option>
                    <option value="Sneaker">Sneaker</option>
                    <option value="Giày chạy bộ">Giày chạy bộ</option>
                    <option value="Giày da">Giày da</option>
                    <option value="Sandal">Sandal</option>
                    <option value="Giày thể thao">Giày thể thao</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Giá (₫) *</label>
                  <input type="number" name="price" value={formData.price} onChange={handleChange} required min="0" step="1" className="w-full border border-gray-300 rounded px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Thương hiệu *</label>
                  <input type="text" name="brand" value={formData.brand} onChange={handleChange} required maxLength="100" placeholder="Nike, Adidas, Puma..." className="w-full border border-gray-300 rounded px-3 py-2" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả ngắn *</label>
                <textarea name="description" value={formData.description} onChange={handleChange} required maxLength={5000} rows="3" className="w-full border border-gray-300 rounded px-3 py-2"></textarea>
                <p className="mt-1 text-xs text-gray-500">Nêu đặc điểm chính của mẫu giày. Nội dung dài và ảnh minh họa được nhập ở phần Bài giới thiệu chi tiết bên dưới.</p>
              </div>

              <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h4 className="mb-3 font-semibold">Thông tin chi tiết (không bắt buộc)</h4>
                <div className="grid gap-4 sm:grid-cols-2">{[['modelCode', 'Mã mẫu', 'Ví dụ: mã do hãng cung cấp'], ['material', 'Chất liệu', 'Ví dụ: da, vải dệt, cao su'], ['origin', 'Xuất xứ', 'Nhập theo thông tin sản phẩm'], ['style', 'Kiểu dáng', 'Ví dụ: cổ thấp, hở gót']].map(([name, label, placeholder]) => <label key={name} className="block text-sm font-medium">{label}<input name={name} value={formData[name] || ''} onChange={handleChange} maxLength={200} placeholder={placeholder} className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2" /></label>)}
                  <label className="block text-sm font-medium">Giới tính sử dụng<select name="gender" value={formData.gender || ''} onChange={handleChange} className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2">{['', 'Nam', 'Nữ', 'Unisex', 'Trẻ em'].map(value => <option key={value} value={value}>{value || 'Chưa cung cấp'}</option>)}</select></label>
                </div>
              </section>

              <div>
                <label htmlFor="product-image-file" className="block text-sm font-medium text-gray-700 mb-1">Ảnh bìa sản phẩm *</label>
                <input id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} required={!formData.image && !imageFile} className="w-full rounded border border-gray-300 p-2 text-sm file:mr-4 file:rounded file:border-0 file:bg-red-50 file:px-4 file:py-2 file:font-semibold file:text-red-700" />
                <p className="mt-1 text-xs text-gray-500">Chọn ảnh JPG, PNG hoặc WebP từ máy tính, tối đa 5 MB.</p>
                {(imagePreview || formData.image) && <div className="mt-3 flex items-center gap-4"><img src={imagePreview || productImageUrl(formData.image)} alt="Xem trước ảnh sản phẩm" className="h-28 w-28 rounded-lg border object-contain" /><p className="break-all text-sm text-gray-600">{imageFile?.name || 'Ảnh hiện tại. Chọn ảnh khác để thay thế.'}</p></div>}
              </div>

              <section className="rounded-lg border border-gray-200 p-4" aria-label="Bộ ảnh bổ sung">
                <label htmlFor="product-gallery-files" className="block text-sm font-semibold">Ảnh bổ sung ({extraImages.length}/9)</label>
                <input id="product-gallery-files" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={addGalleryFiles} disabled={extraImages.length >= MAX_PRODUCT_IMAGES - 1} className="mt-2 w-full rounded border border-gray-300 p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-red-50 file:px-3 file:py-2 file:font-semibold file:text-red-700" />
                <p className="mt-2 text-xs text-gray-500">Có thể chọn nhiều ảnh từ máy tính. Tối đa 10 ảnh gồm ảnh bìa; mỗi ảnh JPG, PNG hoặc WebP không quá 5 MB. Ảnh này cũng có thể chèn vào bài giới thiệu.</p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{extraImages.map((media, index) => <figure key={media.key} className="min-w-0 rounded-lg border border-gray-200 p-2">
                  <ProductPhotoPreview media={media} alt={`Ảnh bổ sung ${index + 1}`} />
                  <figcaption className="mt-2 text-sm font-medium">Ảnh {index + 2}</figcaption>
                  <button type="button" onClick={() => useAsCover(media)} aria-label={`Dùng ảnh ${index + 2} làm ảnh bìa`} className="mt-1 text-sm font-semibold text-red-600 hover:underline">Dùng làm ảnh bìa</button>
                  <div className="mt-2 flex flex-wrap gap-2"><button type="button" aria-label={`Đưa ảnh ${index + 2} ra trước`} disabled={index === 0} onClick={() => moveGalleryImage(index, -1)} className="rounded border px-2 py-1 disabled:opacity-30">←</button><button type="button" aria-label={`Đưa ảnh ${index + 2} ra sau`} disabled={index === extraImages.length - 1} onClick={() => moveGalleryImage(index, 1)} className="rounded border px-2 py-1 disabled:opacity-30">→</button><button type="button" aria-label={`Xóa ảnh ${index + 2}`} onClick={() => removeGalleryImage(media.key)} className="rounded border px-2 py-1 text-red-600">Xóa</button></div>
                </figure>)}</div>
              </section>

              {isLegacyProduct && (
                <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm text-gray-700">Tồn kho hiện tại: <strong>{editingProduct.countInStock ?? 0}</strong> đôi, dùng chung cho các size. Sửa thông tin sản phẩm sẽ giữ nguyên kho.</p>
                  <label htmlFor="convert-legacy-inventory" className="mt-3 flex items-start gap-2 text-sm font-medium text-gray-800">
                    <input id="convert-legacy-inventory" type="checkbox" checked={convertLegacyInventory} onChange={event => { setConvertLegacyInventory(event.target.checked); setFormError(''); }} className="mt-0.5" />
                    Chuyển sang quản lý kho theo màu và size
                  </label>
                  {convertLegacyInventory && <p className="mt-2 text-sm text-amber-800">Nhập số lượng thực tế cho từng màu và size. Chỉ chuyển đổi khi sản phẩm không có trong giỏ hàng hoặc đơn chưa hoàn tất.</p>}
                </section>
              )}
              {showVariantEditor && <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-gray-800">Màu sắc, size và số lượng *</h4><span className="text-sm text-gray-600">Tổng tồn kho: <strong>{totalStock}</strong> đôi</span></div>
                <div className="space-y-3">
                  {formData.variants.map((variant, index) => <div key={index} className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                    <div><label htmlFor={`variant-color-${index}`} className="mb-1 block text-sm font-medium text-gray-700">Màu sắc</label><input id={`variant-color-${index}`} type="text" value={variant.color} onChange={event => updateVariant(index, 'color', event.target.value)} required maxLength="100" placeholder="Trắng" className="w-full rounded border border-gray-300 px-3 py-2" /></div>
                    <div><label htmlFor={`variant-size-${index}`} className="mb-1 block text-sm font-medium text-gray-700">Size</label><input id={`variant-size-${index}`} type="number" value={variant.size} onChange={event => updateVariant(index, 'size', event.target.value)} required min="1" max="60" step="0.5" placeholder="40" className="w-full rounded border border-gray-300 px-3 py-2" /></div>
                    <div><label htmlFor={`variant-quantity-${index}`} className="mb-1 block text-sm font-medium text-gray-700">Số lượng</label><input id={`variant-quantity-${index}`} type="number" value={variant.quantity} onChange={event => updateVariant(index, 'quantity', event.target.value)} required min="0" step="1" placeholder="20" className="w-full rounded border border-gray-300 px-3 py-2" /></div>
                    <button type="button" aria-label={`Xóa dòng ${index + 1}`} disabled={formData.variants.length === 1} onClick={() => setFormData(previous => ({ ...previous, variants: previous.variants.filter((_, row) => row !== index) }))} className="rounded p-3 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"><FaTrash /></button>
                  </div>)}
                </div>
                <button type="button" disabled={formData.variants.length >= 100} onClick={() => setFormData(previous => ({ ...previous, variants: [...previous.variants, { color: '', size: '', quantity: '' }] }))} className="mt-3 flex items-center gap-2 rounded border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><FaPlus /> Thêm</button>
              </section>}
              <section className="space-y-4 rounded-lg border border-gray-200 p-4">
                <div><h4 className="font-semibold">Bài giới thiệu chi tiết</h4><p className="mt-1 text-sm text-gray-600">Thêm các mục như Giới thiệu thương hiệu, Thiết kế, Chất liệu, Bảo quản hoặc Hướng dẫn chọn size. Xuống dòng để chia đoạn; bắt đầu dòng bằng “- ” để tạo danh sách.</p></div>
                {(formData.contentSections || []).map((section, index) => <div key={index} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3"><strong className="text-sm">Mục {index + 1}</strong><button type="button" aria-label={`Xóa mục giới thiệu ${index + 1}`} onClick={() => setFormData(previous => ({ ...previous, contentSections: previous.contentSections.filter((_, row) => row !== index) }))} className="text-sm font-semibold text-red-600">Xóa mục</button></div>
                  <label className="block text-sm font-medium">Tiêu đề mục<input id={`content-title-${index}`} value={section.title} maxLength={160} onChange={event => updateSection(index, 'title', event.target.value)} placeholder="Ví dụ: Thiết kế và chất liệu" className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2" /></label>
                  <label className="block text-sm font-medium">Nội dung<textarea id={`content-body-${index}`} value={section.body} maxLength={10000} rows={7} required={!section.imageKey} onChange={event => updateSection(index, 'body', event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2" /></label>
                  <label className="block text-sm font-medium">Ảnh minh họa<select id={`content-image-${index}`} value={section.imageKey || ''} onChange={event => updateSection(index, 'imageKey', event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2"><option value="">Không chèn ảnh</option>{(formData.image || imageFile) && <option value="cover">Ảnh bìa</option>}{extraImages.map((media, photoIndex) => <option key={media.key} value={media.key}>Ảnh {photoIndex + 2}{media.file?.name ? ' — ' + media.file.name : ''}</option>)}</select></label>
                  {section.imageKey && <label className="block text-sm font-medium">Chú thích ảnh<input id={`content-caption-${index}`} value={section.caption || ''} maxLength={200} onChange={event => updateSection(index, 'caption', event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2" /></label>}
                </div>)}
                <button type="button" disabled={(formData.contentSections || []).length >= MAX_PRODUCT_SECTIONS} onClick={() => setFormData(previous => ({ ...previous, contentSections: [...(previous.contentSections || []), { title: '', body: '', imageKey: '', caption: '' }] }))} className="rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50">+ Thêm mục giới thiệu</button>
                <p className="text-xs text-gray-500">Tối đa 12 mục, tổng nội dung 40.000 ký tự. Không cần nhập mã HTML.</p>
              </section>
              </fieldset>

              <div className="flex gap-2 pt-4">
                <button type="submit" disabled={saving} className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700 disabled:opacity-50">
                  {saving ? 'Đang lưu...' : editingProduct ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm'}
                </button>
                <button type="button" disabled={saving} onClick={() => { setShowModal(false); setEditingProduct(null); resetForm(); }} className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400">
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminProducts;
