
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { productsAPI, cartAPI } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { colorKey, hasProductVariants, productColors, productSizes, productStock, validProductSelection, productImageUrl } from '../utils/productVariants';
import { 
  FaShoePrints, FaShoppingCart, FaArrowLeft, FaCheckCircle, FaExclamationCircle, 
  FaTag, FaPalette, FaRuler, FaStar, FaUser
} from 'react-icons/fa';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addingToCart, setAddingToCart] = useState(false);
  
  const [reviews, setReviews] = useState([]);
  const [reviewError, setReviewError] = useState('');
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewData, setReviewData] = useState({ rating: 5, comment: '' });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [selectedColor, setSelectedColor] = useState('');
  const productVersion = useRef(0);
  const reviewVersion = useRef(0);
  const hasVariants = hasProductVariants(product);
  const colors = productColors(product);
  const sizes = productSizes(product, selectedColor);
  const selectedStock = productStock(product, selectedSize, selectedColor);

  useEffect(() => {
    setLoading(true);
    setProduct(null);
    setReviews([]);
    setReviewError('');
    setError('');
    setSuccess('');
    setQuantity(1);
    setSelectedSize('');
    setSelectedColor('');
    fetchProduct();
    fetchReviews();
    return () => { productVersion.current += 1; reviewVersion.current += 1; };
  }, [id, location.key]);

  useEffect(() => {
    if (!product) return;
    setSelectedColor(current => productColors(product).find(color => colorKey(color) === colorKey(current)) || '');
    setSelectedSize(current => validProductSelection(product, current, selectedColor) ? current : '');
    const stock = productStock(product, selectedSize, selectedColor);
    setQuantity(current => stock > 0 ? Math.max(1, Math.min(current, stock)) : 1);
  }, [product, selectedColor, selectedSize]);

  const fetchProduct = async () => {
    const version = ++productVersion.current;
    try {
      const response = await productsAPI.getProductById(id);
      if (version !== productVersion.current) return;
      setProduct(response.data);
    } catch (error) {
      if (version === productVersion.current) setError(error.response?.data?.message || 'Không thể tải thông tin giày. Vui lòng thử lại.');
    } finally {
      if (version === productVersion.current) setLoading(false);
    }
  };

  const fetchReviews = async () => {
    const version = ++reviewVersion.current;
    try {
      setReviewError('');
      const response = await productsAPI.getReviews(id);
      if (version !== reviewVersion.current) return;
      setReviews(response.data.reviews || []);
    } catch (error) {
      if (version === reviewVersion.current) setReviewError(error.response?.data?.message || 'Không thể tải đánh giá. Vui lòng thử lại.');
    }
  };

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!user) {
      navigate('/login', { state: { from: `/products/${id}` } });
      return;
    }

    setSubmittingReview(true);
    try {
      setError('');
      await productsAPI.createReview(id, reviewData);
      
      setSuccess('✅ Đánh giá của bạn đã được gửi!');
      setShowReviewForm(false);
      setReviewData({ rating: 5, comment: '' });
      fetchProduct();
      fetchReviews();
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError(error.response?.data?.message || 'Gửi đánh giá thất bại');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleAddToCart = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/products/${id}` } });
      return;
    }
    if (hasVariants && !selectedColor) {
      setError('Vui lòng chọn màu giày trước khi thêm vào giỏ.');
      return;
    }
    if ((hasVariants || product.sizes?.length) && !selectedSize) {
      setError('Vui lòng chọn size giày trước khi thêm vào giỏ.');
      return;
    }
    if (!validProductSelection(product, selectedSize, selectedColor) || quantity > selectedStock || selectedStock <= 0) {
      setError('Màu, size hoặc số lượng đã chọn hiện không còn đủ hàng.');
      return;
    }

    setError('');
    setSuccess('');
    setAddingToCart(true);

    try {
      if (hasVariants) await cartAPI.addToCart(id, quantity, selectedSize, selectedColor);
      else await cartAPI.addToCart(id, quantity, selectedSize);
      
      
      await fetchProduct();
      
      setSuccess('Đã thêm vào giỏ hàng!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError(error.response?.data?.message || 'Thêm vào giỏ hàng thất bại');
    } finally {
      setAddingToCart(false);
    }
  };

  const handleBuyNow = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/products/${id}` } });
      return;
    }
    if (hasVariants && !selectedColor) {
      setError('Vui lòng chọn màu giày trước khi đặt mua.');
      return;
    }
    if ((hasVariants || product.sizes?.length) && !selectedSize) {
      setError('Vui lòng chọn size giày trước khi đặt mua.');
      return;
    }
    if (!validProductSelection(product, selectedSize, selectedColor) || quantity > selectedStock || selectedStock <= 0) {
      setError('Màu, size hoặc số lượng đã chọn hiện không còn đủ hàng.');
      return;
    }

    setAddingToCart(true);
    setError('');
    try {
      if (hasVariants) await cartAPI.addToCart(id, quantity, selectedSize, selectedColor);
      else await cartAPI.addToCart(id, quantity, selectedSize);
      navigate('/cart');
    } catch (error) {
      setError(error.response?.data?.message || 'Có lỗi xảy ra');
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-20 shop-page">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="spinner mb-4"></div>
          <p className="text-gray-600 text-lg">Đang tải thông tin sản phẩm...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-20 shop-page">
        <div className="text-center">
          <FaExclamationCircle className="text-6xl text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-xl">{error || 'Không tìm thấy giày'}</p>
          <Link to="/products" className="mt-4 inline-block text-red-600 hover:text-red-800 font-medium">
            Quay lại danh sách sản phẩm
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 shop-page">
        <Link to="/products" className="inline-flex items-center space-x-2 text-red-600 hover:text-red-800 mb-6 font-medium transition-colors">
          <FaArrowLeft />
          <span>Quay lại danh sách sản phẩm</span>
        </Link>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Product Image */}
          <div className="bg-white rounded-lg shadow p-8 shop-panel shop-product-image">
            {product.image ? (
              <img src={productImageUrl(product.image)} alt={product.name} className="w-full h-[500px] object-contain" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} />
            ) : (
              <div className="w-full h-[500px] bg-gray-100 flex items-center justify-center rounded-lg">
                <FaShoePrints className="text-gray-300 text-8xl" />
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6 shop-panel">
              <div className="mb-4">
                <span className="inline-block bg-red-100 text-red-600 px-3 py-1 rounded-full text-sm font-semibold mb-3">
                  {product.category || product.brand}
                </span>
                <h1 className="text-3xl font-bold mb-2 text-gray-800">{product.name}</h1>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex text-yellow-400">
                    {[...Array(5)].map((_, i) => (
                      <FaStar key={i} className={i < Math.round(product.rating || 0) ? 'fill-current' : 'text-gray-300'} />
                    ))}
                  </div>
                  <span className="text-sm text-gray-600">
                    {product.rating ? product.rating.toFixed(1) : '0.0'} ({product.numReviews || 0} đánh giá)
                  </span>
                </div>
                <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${
                  product.countInStock > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {product.countInStock > 0 ? `✓ Còn ${product.countInStock} sản phẩm` : '✗ Hết hàng'}
                </div>
              </div>

              {/* Price */}
              <div className="bg-red-50 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-600 mb-1">Giá bán</p>
                <p className="text-4xl font-bold text-red-600">{product.price.toLocaleString('vi-VN')} ₫</p>
              </div>

              {/* Description */}
              <div className="mb-6">
                <h3 className="font-bold text-gray-800 mb-2">Giới thiệu sản phẩm</h3>
                <p className="text-gray-700 leading-relaxed">
                  {product.description || 'Chưa có mô tả chi tiết cho mẫu giày này.'}
                </p>
              </div>

              {/* Messages */}
              {success && (
                <div className="bg-green-50 border-l-4 border-green-500 text-green-700 p-4 rounded mb-4">
                  <div className="flex items-center space-x-2">
                    <FaCheckCircle />
                    <p className="font-medium">{success}</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded mb-4">
                  <div className="flex items-center space-x-2">
                    <FaExclamationCircle />
                    <p className="font-medium">{error}</p>
                  </div>
                </div>
              )}

              {/* Quantity & Actions */}
              <div className="space-y-4">
                {hasVariants && (
                  <fieldset>
                    <legend className="block text-sm font-semibold text-gray-700 mb-2">Chọn màu giày *</legend>
                    <div className="flex flex-wrap gap-2">
                      {colors.map(color => (
                        <button key={color} type="button" aria-pressed={selectedColor === color} onClick={() => { setSelectedColor(color); setSelectedSize(''); setQuantity(1); setError(''); }} className={`px-4 py-2 rounded-lg border-2 font-semibold ${selectedColor === color ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 hover:border-red-400'}`}>{color}</button>
                      ))}
                    </div>
                  </fieldset>
                )}
                {(hasVariants || sizes.length > 0) && (
                  <fieldset>
                    <legend className="block text-sm font-semibold text-gray-700 mb-2">Chọn size giày *</legend>
                    <div className="flex flex-wrap gap-2">
                      {sizes.map(size => (
                        <button key={size} type="button" disabled={hasVariants && productStock(product, size, selectedColor) <= 0} aria-pressed={selectedSize === String(size)} onClick={() => { setSelectedSize(String(size)); setQuantity(1); setError(''); }} className={`min-w-[48px] px-3 py-2 rounded-lg border-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${selectedSize === String(size) ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 hover:border-red-400'}`}>{size}{hasVariants && productStock(product, size, selectedColor) <= 0 ? ' (hết)' : ''}</button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{hasVariants ? !selectedColor ? 'Chọn màu để xem các size tương ứng.' : selectedSize ? `Còn ${selectedStock} đôi màu ${selectedColor}, size ${selectedSize}.` : 'Chọn size để xem số lượng còn hàng của màu này.' : 'Chọn size bạn thường mang. Số lượng tồn kho tính chung cho mẫu giày.'}</p>
                  </fieldset>
                )}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Số lượng</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(selectedStock, parseInt(e.target.value) || 1)))}
                    min="1"
                    max={selectedStock}
                    disabled={hasVariants && (!selectedColor || !selectedSize || selectedStock <= 0)}
                    className="w-32 border-2 border-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                  />
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={handleAddToCart}
                    disabled={product.countInStock <= 0 || addingToCart || (hasVariants && selectedColor && selectedSize && selectedStock <= 0)}
                    className="flex-1 bg-white border-2 border-red-600 text-red-600 py-3 rounded-lg font-semibold hover:bg-red-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {addingToCart ? (
                      <span className="flex items-center justify-center">
                        <div className="spinner mr-2" style={{ width: '20px', height: '20px', borderWidth: '2px' }}></div>
                        Đang thêm...
                      </span>
                    ) : (
                      <>
                        <FaShoppingCart className="inline mr-2" />
                        Thêm vào giỏ
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleBuyNow}
                    disabled={product.countInStock <= 0 || addingToCart || (hasVariants && selectedColor && selectedSize && selectedStock <= 0)}
                    className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {user ? 'Mua ngay' : 'Đăng nhập để mua'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Information */}
        <div className="mt-8 bg-white rounded-lg shadow shop-panel">
          <div className="border-b">
            <div className="flex">
              <button className="px-6 py-4 font-semibold border-b-2 border-red-600 text-red-600">
                Thông tin chi tiết
              </button>
            </div>
          </div>
          <div className="p-6">
            <table className="w-full">
              <tbody className="divide-y">
                {product.brand && (
                  <tr>
                    <td className="py-3 text-gray-600 font-medium flex items-center gap-2">
                      <FaTag className="text-blue-600" /> Thương hiệu
                    </td>
                    <td className="py-3 text-gray-800">{product.brand}</td>
                  </tr>
                )}
                {product.category && (
                  <tr>
                    <td className="py-3 text-gray-600 font-medium">Danh mục</td>
                    <td className="py-3 text-gray-800">{product.category}</td>
                  </tr>
                )}
                {product.color && (
                  <tr>
                    <td className="py-3 text-gray-600 font-medium flex items-center gap-2">
                      <FaPalette className="text-purple-600" /> Màu sắc
                    </td>
                    <td className="py-3 text-gray-800">{product.color}</td>
                  </tr>
                )}
                {product.sizes && product.sizes.length > 0 && (
                  <tr>
                    <td className="py-3 text-gray-600 font-medium flex items-center gap-2">
                      <FaRuler className="text-orange-600" /> Size còn bán
                    </td>
                    <td className="py-3 text-gray-800">
                      <div className="flex flex-wrap gap-2">
                        {product.sizes.map((size) => (
                          <span key={size} className="px-3 py-1 border border-gray-300 rounded text-sm">{size}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-8 bg-white rounded-lg shadow p-6 shop-panel">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">Đánh giá sản phẩm</h2>
            {user && (
              <button
                onClick={() => setShowReviewForm(!showReviewForm)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                {showReviewForm ? 'Hủy' : 'Viết đánh giá'}
              </button>
            )}
          </div>

          {/* Review Form */}
          {showReviewForm && (
            <form onSubmit={handleSubmitReview} className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Đánh giá của bạn</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewData({ ...reviewData, rating: star })}
                      className="text-3xl"
                    >
                      <FaStar className={star <= reviewData.rating ? 'text-yellow-400' : 'text-gray-300'} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Nhận xét</label>
                <textarea
                  value={reviewData.comment}
                  onChange={(e) => setReviewData({ ...reviewData, comment: e.target.value })}
                  required
                  rows="4"
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Chia sẻ trải nghiệm của bạn về sản phẩm..."
                />
              </div>

              <button
                type="submit"
                disabled={submittingReview}
                className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {submittingReview ? 'Đang gửi...' : 'Gửi đánh giá'}
              </button>
            </form>
          )}

          {/* Reviews List */}
          {reviewError && <p role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4">{reviewError} <button onClick={fetchReviews} className="underline">Thử lại</button></p>}
          <div className="space-y-4">
            {reviews.length === 0 ? (
              <p className="text-gray-500 text-center py-8">Chưa có đánh giá nào</p>
            ) : (
              reviews.map((review) => (
                <div key={review._id} className="border-b pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FaUser className="text-gray-400" />
                      <span className="font-semibold">{review.name}</span>
                    </div>
                    <div className="flex text-yellow-400">
                      {[...Array(5)].map((_, i) => (
                        <FaStar key={i} className={i < review.rating ? 'fill-current' : 'text-gray-300'} size={14} />
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm">{review.comment}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(review.createdAt).toLocaleDateString('vi-VN')}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
