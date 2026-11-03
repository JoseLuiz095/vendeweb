import { InfoHint } from '../components/ui/InfoHint';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ProductMedia } from '../components/ProductMedia';
import { useStore } from '../contexts/StoreContext';
import type { Category, Product } from '../types';
import { currency } from '../utils/format';
import { storefrontPath } from '../utils/storefrontRoute';
import { normalizeText } from '../utils/text';
import { fitnessOffersApi, type FitnessOffer } from '../services/fitnessOffersApi';
import { FitnessPilotExamples } from './FitnessPilotExamples';
import './fitness.css';

type CatalogProps = { products: Product[]; categories: Category[]; query?: string; visible?: boolean };

/** Only published rows from the tenant-scoped public snapshot reach this view. */
export function FitnessCatalog({ products, categories, query = '', visible: showProducts = true }: CatalogProps) {
  const [categoryId, setCategoryId] = useState('all');
  const [offerKind, setOfferKind] = useState('all');
  const { storeBasePath, settings } = useStore();
  const [offers, setOffers] = useState<FitnessOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setOffers([]); setOffersError(false); setOffersLoading(true);
    if (!settings.id) { setOffersLoading(false); return; }
    void fitnessOffersApi.list(settings.id).then(items => {
      if (!Array.isArray(items)) throw new Error('Resposta inválida');
      if (active) setOffers(items.filter(item => item.published));
    }).catch(() => { if (active) setOffersError(true); }).finally(() => { if (active) setOffersLoading(false); });
    return () => { active = false; };
  }, [settings.id, retry]);
  const published = useMemo(() => products.filter(product => product.active && categories.some(category => category.id === product.categoryId && category.active)), [products, categories]);
  const visibleCategories = categories.filter(category => category.active && published.some(product => product.categoryId === category.id));
  const visible = published.filter(product => (categoryId === 'all' || product.categoryId === categoryId) && normalizeText(`${product.name} ${product.description}`).includes(normalizeText(query)));
  const visibleOffers = offers.filter(offer => (offerKind === 'all' || offer.kind === offerKind) && normalizeText(`${offer.name} ${offer.description} ${offer.professional_name}`).includes(normalizeText(query)));

  if (!showProducts) return null;
  return <section className="fitness-catalog" aria-labelledby="fitness-catalog-title">
    <div className="food-section-title"><div><span>CATÁLOGO</span><h2 id="fitness-catalog-title">Treinos, serviços e produtos</h2><InfoHint>Veja os exemplos de treino e as ofertas efetivamente publicadas pela loja.</InfoHint></div></div>
    <FitnessPilotExamples query={query}/>
    <section aria-label="Ofertas da loja"><h3>Ofertas publicadas</h3>
      {offersLoading ? <p role="status">Consultando ofertas da loja…</p>
        : offersError ? <div role="alert" className="business-message business-message--error">As ofertas não puderam ser consultadas neste ambiente. <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>
        : offers.length === 0 ? <p className="business-muted">Ainda não há ofertas habilitadas para compra.</p>
        : <><div className="fitness-catalog-filters" role="group" aria-label="Tipos de oferta"><button type="button" aria-pressed={offerKind === 'all'} onClick={() => setOfferKind('all')}>Todas</button>{(['workout','assessment','combo','nutrition_consult','nutrition_plan'] as const).filter(kind => offers.some(offer => offer.kind === kind)).map(kind => <button type="button" key={kind} aria-pressed={offerKind === kind} onClick={() => setOfferKind(kind)}>{({workout:'Fichas',assessment:'Avaliação',combo:'Combos',nutrition_consult:'Consultas',nutrition_plan:'Planos alimentares'})[kind]}</button>)}</div>
          {visibleOffers.length ? <div className="fitness-catalog-grid" aria-label="Ofertas Fitness">{visibleOffers.map(offer => <Link className="fitness-catalog-card" key={offer.id} to={`/fitness/${settings.id}/treinos?oferta=${offer.id}`}><span>{offer.kind.startsWith('nutrition') ? 'Nutrição' : offer.kind === 'workout' ? 'Ficha de treino' : offer.kind === 'combo' ? 'Combo' : 'Avaliação'}</span><h3>{offer.name}</h3><p>{offer.description}</p><small>Responsável: {offer.professional_name} · {offer.professional_council}</small><strong>{currency.format(offer.price_cents / 100)}</strong><small>Ver oferta e condições</small></Link>)}</div> : <p role="status" className="business-muted">Nenhuma oferta corresponde à busca ou ao filtro.</p>}</>}
    </section>
    {published.length > 0 ? <><h3>Produtos físicos</h3>
      <div className="fitness-catalog-filters" role="group" aria-label="Categorias de produtos"><button type="button" aria-pressed={categoryId === 'all'} onClick={() => setCategoryId('all')}>Todos</button>{visibleCategories.map(category => <button type="button" key={category.id} aria-pressed={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div>
      {visible.length ? <div className="fitness-catalog-grid">{visible.map(product => <Link className="fitness-catalog-card" key={product.id} to={storefrontPath(storeBasePath, `/produto/${product.slug}`)}><ProductMedia src={product.imageUrl} imageCount={product.images.length} alt={product.name}/><span>{visibleCategories.find(category => category.id === product.categoryId)?.name}</span><h3>{product.name}</h3><p>{product.description}</p><strong>{product.price > 0 ? currency.format(product.promotionalPrice ?? product.price) : 'Preço não informado'}</strong><small>Ver detalhes</small></Link>)}</div> : <p role="status" className="business-muted">Nenhum produto corresponde à busca. Tente outro termo ou categoria.</p>}
    </> : <p role="status" className="business-muted">Produtos físicos ainda não publicados nesta loja.</p>}
  </section>;
}

export function FitnessProductDetail() {
  const { slug } = useParams();
  const { products, categories, loading, error, storeBasePath } = useStore();
  if (loading) return <div className="container page-center" role="status">Carregando produto…</div>;
  if (error) return <div className="container page-center" role="alert">Não foi possível consultar o produto: {error}</div>;
  const product = products.find(item => item.slug === slug && item.active && categories.some(category => category.id === item.categoryId && category.active));
  if (!product) return <div className="container page-center"><h1>Produto indisponível</h1><p>O item pode ter sido retirado do catálogo.</p><Link to={storefrontPath(storeBasePath)}>Voltar à loja</Link></div>;
  const category = categories.find(item => item.id === product.categoryId);
  const unavailable = product.availabilityStatus !== 'available' || product.stockStatus === 'unavailable' || (product.trackStock && Number(product.stockQuantity || 0) - Number(product.stockReservedQuantity || 0) <= 0);
  return <div className="container fitness-product-detail"><Link to={storefrontPath(storeBasePath)} className="fitness-back"><ArrowLeft size={18}/>Voltar à loja</Link><article className="fitness-product-grid"><ProductMedia src={product.imageUrl} imageCount={product.images.length} alt={product.name}/><div><span className="eyebrow">{category?.name ?? 'Produto'}</span><h1>{product.name}</h1><p>{product.description}</p><strong>{product.price > 0 ? currency.format(product.promotionalPrice ?? product.price) : 'Preço não informado'}</strong><p role="status">{unavailable ? 'Produto indisponível no momento.' : 'Produto publicado para consulta.'}</p><p className="business-muted">Compra online ainda não disponível para este item. Consulte a loja para mais informações.</p></div></article></div>;
}
