import { useEffect, useState } from 'react';
import { productImageUrl } from '../utils/productVariants';

export default function ProductPhotoPreview({ media, alt }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!media.file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(media.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [media.file]);
  return <img src={preview || productImageUrl(media.url)} alt={alt} className="h-28 w-full rounded-lg bg-gray-50 object-contain" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} />;
}
