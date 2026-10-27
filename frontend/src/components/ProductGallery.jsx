import { useEffect, useRef, useState } from 'react';
import { productImages } from '../utils/productContent';
import { productImageUrl } from '../utils/productVariants';

const imageError = event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; };

export default function ProductGallery({ product }) {
  const stored = productImages(product);
  const images = stored.length ? stored : ['/shoe.svg'];
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(false);
  const dialogRef = useRef(null);
  const index = Math.min(selected, images.length - 1);
  const change = delta => setSelected(previous => (Math.min(previous, images.length - 1) + delta + images.length) % images.length);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!zoom || !dialog) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previous; };
  }, [zoom]);

  return (
    <section className="product-gallery shop-panel" aria-label="Bộ ảnh sản phẩm">
      <button type="button" className="product-gallery__main" aria-label={`Phóng to ảnh ${index + 1} của ${product.name}`} onClick={() => setZoom(true)}>
        <img src={productImageUrl(images[index])} alt={`${product.name} — ảnh ${index + 1}`} onError={imageError} decoding="async" />
        <span className="product-gallery__zoom-note">Bấm để phóng to ↗</span>
      </button>
      {images.length > 1 && <div className="product-gallery__controls"><button type="button" aria-label="Ảnh trước" onClick={() => change(-1)}>←</button><span>{index + 1} / {images.length} ảnh</span><button type="button" aria-label="Ảnh tiếp theo" onClick={() => change(1)}>→</button></div>}
      <div className="product-gallery__thumbnails" aria-label="Chọn ảnh sản phẩm">{images.map((image, imageIndex) => <button key={image} type="button" aria-pressed={index === imageIndex} aria-label={`Xem ảnh ${imageIndex + 1}`} onClick={() => setSelected(imageIndex)}><img src={productImageUrl(image)} alt="" loading="lazy" onError={imageError} /></button>)}</div>
      <dialog ref={dialogRef} className="product-lightbox" aria-label={`Ảnh phóng to của ${product.name}`} onCancel={() => setZoom(false)} onClose={() => setZoom(false)} onClick={event => { if (event.target === event.currentTarget) setZoom(false); }} onKeyDown={event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); change(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); change(1); }
      }}>
        <div className="product-lightbox__content"><div className="product-lightbox__heading"><span>{product.name} · {index + 1}/{images.length}</span><button type="button" autoFocus aria-label="Đóng ảnh phóng to" onClick={() => setZoom(false)}>×</button></div><img src={productImageUrl(images[index])} alt={`${product.name} — ảnh ${index + 1}`} onError={imageError} />{images.length > 1 && <div className="product-lightbox__controls"><button type="button" aria-label="Ảnh phóng to trước" onClick={() => change(-1)}>← Ảnh trước</button><button type="button" aria-label="Ảnh phóng to tiếp theo" onClick={() => change(1)}>Ảnh tiếp theo →</button></div>}</div>
      </dialog>
    </section>
  );
}
