import { contentSections, scrollToProductSection } from '../utils/productContent';
import { productImageUrl } from '../utils/productVariants';

const paragraphs = text => String(text || '').split(/\n\s*\n/).filter(part => part.trim());
const Body = ({ text }) => paragraphs(text).map((paragraph, index) => {
  const lines = paragraph.split('\n').filter(line => line.trim());
  return lines.length && lines.every(line => /^\s*[-*]\s+/.test(line))
    ? <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^\s*[-*]\s+/, '')}</li>)}</ul>
    : <p key={index}>{paragraph}</p>;
});

export default function ProductStory({ product }) {
  const sections = contentSections(product);
  return (
    <section id="product-story" className="product-story shop-panel" aria-labelledby="product-story-title">
      <div className="product-story__heading"><p className="shop-eyebrow">KHÁM PHÁ CHI TIẾT</p><h2 id="product-story-title">Giới thiệu {product.name}</h2></div>
      {sections.length > 1 && <nav className="product-story__contents" aria-label="Mục lục giới thiệu">{sections.map((section, index) => section.title && <a key={index} href={`#product-section-${index + 1}`} onClick={scrollToProductSection}>{section.title}</a>)}</nav>}
      <div className="product-story__body"><Body text={product.description} />
        {sections.map((section, index) => <section key={index} id={`product-section-${index + 1}`} className="product-story__section">
          {section.title && <h3>{section.title}</h3>}
          {section.body && <Body text={section.body} />}
          {section.image && <figure><img src={productImageUrl(section.image)} alt={section.caption || `${product.name}${section.title ? ' — ' + section.title : ''}`} loading="lazy" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = '/shoe.svg'; }} />{section.caption && <figcaption>{section.caption}</figcaption>}</figure>}
        </section>)}
      </div>
    </section>
  );
}
