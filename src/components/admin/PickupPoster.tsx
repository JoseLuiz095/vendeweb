import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { Category, StoreSettings } from '../../types';
import { getReceiptDestinations } from '../../services/receiptContactsApi';
import './pickup-poster.css';

type Props = { settings: StoreSettings; point: {id:string; name:string; short_code:string}; url:string; categories:Category[] };
type Contact = { name:string; phone:string };
const loadImage = (src:string, cors=false) => new Promise<HTMLImageElement>((resolve,reject) => { const img=new Image(); if(cors) img.crossOrigin='anonymous'; img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('Imagem indisponível')); img.src=src; });
function fit(ctx:CanvasRenderingContext2D, value:string, maxWidth:number, maxSize:number, minSize=25) {
 let size=maxSize; do { ctx.font=`700 ${size}px Arial, sans-serif`; if(ctx.measureText(value).width<=maxWidth) return; size-=2; } while(size>minSize);
 while(value.length && ctx.measureText(value+'…').width>maxWidth) value=value.slice(0,-1);
 return value+'…';
}
function line(ctx:CanvasRenderingContext2D, value:string, x:number, y:number, maxWidth:number, size:number, color='#302822') {
 const trimmed=fit(ctx,value,maxWidth,size); ctx.fillStyle=color; ctx.fillText(trimmed || value,x,y);
}
async function makePoster(p:{settings:StoreSettings;point:Props['point'];url:string;category:string;contact:Contact|null;showProof:boolean}) {
 const canvas=document.createElement('canvas'); canvas.width=1240; canvas.height=1754;
 const c=canvas.getContext('2d'); if(!c)throw new Error('Não foi possível criar a imagem neste navegador.');
 c.fillStyle='#fff';c.fillRect(0,0,1240,1754); c.strokeStyle='#62544d';c.lineWidth=3;c.strokeRect(40,40,1160,1674);
 const color=/^#[\da-f]{6}$/i.test(p.settings.visualTheme.primaryColor) ? p.settings.visualTheme.primaryColor : '#56382f';
 c.fillStyle=color;c.fillRect(41,41,1158,17); c.textAlign='center';
 let logoMissing=false;
 if(p.settings.logoUrl){try { const img=await loadImage(p.settings.logoUrl,true); c.save();c.beginPath();c.arc(620,151,67,0,Math.PI*2);c.clip(); c.drawImage(img,553,84,134,134);c.restore(); } catch { logoMissing=true; }}
 line(c,p.settings.name || 'Minha loja',620,278,1050,66); line(c,'RETIRADA · '+p.point.name,620,335,1040,31,'#51473f');
 line(c,'ESCOLHA E PEÇA AQUI',620,423,1070,55); line(c,'Aponte a câmera para abrir a loja',620,478,1080,31,'#51473f');
 const qr=await QRCode.toDataURL(p.url,{errorCorrectionLevel:'M',margin:4,width:680,color:{dark:'#000000',light:'#ffffff'}});
 const qrImage=await loadImage(qr); c.drawImage(qrImage,280,500,680,680);
 c.textAlign='left'; const steps=[p.category ? 'Escolha: '+p.category : 'Escolha no catálogo', 'Finalize seu pedido', p.showProof ? 'Pague e envie o comprovante' : 'Siga as orientações da loja'];
 steps.forEach((step,i)=>{const y=1240+i*95;c.fillStyle='#302822';c.beginPath();c.arc(180,y-14,29,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.textAlign='center';c.font='700 30px Arial';c.fillText(String(i+1),180,y-4);c.textAlign='left';line(c,step,235,y,850,39);});
 c.textAlign='center'; if(p.contact){line(c,`Dúvidas? ${p.contact.name}`,620,1575,1050,30);line(c,`WhatsApp: ${p.contact.phone}`,620,1625,1050,35);} else line(c,'Precisa de ajuda? Fale com a loja.',620,1600,1050,30);
 line(c,'Obrigado pela preferência!',620,1680,1040,27,'#51473f');
 return { data:canvas.toDataURL('image/png'), logoMissing };
}
export default function PickupPoster({settings,point,url,categories}:Props){
 const [category,setCategory]=useState(''); const [showProof,setShowProof]=useState(false);
 const [contact,setContact]=useState<Contact|null>(null); const [loadingContact,setLoadingContact]=useState(true); const [contactError,setContactError]=useState(false);
 const [poster,setPoster]=useState(''); const [error,setError]=useState(''); const [logoMissing,setLogoMissing]=useState(false);
 useEffect(()=>{let active=true;setContact(null);setLoadingContact(true);setContactError(false);
  void getReceiptDestinations(settings.id,point.id).then(result=>{if(!active)return; const selected=result.contacts.length===1 ? result.contacts[0] : null; const fallback=(result.mode==='general'||result.mode==='unassigned') && !selected && settings.whatsapp ? {name:'Loja',phone:settings.whatsapp} : null; setContact(selected||fallback);setShowProof(Boolean(settings.pixEnabled&&(selected||fallback)));}).catch(()=>{if(active)setContactError(true)}).finally(()=>{if(active)setLoadingContact(false)});return()=>{active=false};
 },[settings.id,point.id,settings.pixEnabled,settings.whatsapp]);
 useEffect(()=>{let active=true;setPoster('');setError('');if(loadingContact)return;void makePoster({settings,point,url,category:category.trim(),contact,showProof}).then(result=>{if(active){setPoster(result.data);setLogoMissing(result.logoMissing)}}).catch(()=>{if(active)setError('Não foi possível gerar a plaquinha. Tente novamente.')});return()=>{active=false}},[settings,point,url,category,contact,loadingContact,showProof]);
 const print=()=>{const win=window.open('','_blank');if(!win){setError('Permita abrir uma nova janela para imprimir.');return;} const doc=win.document;doc.title='Plaquinha de retirada';const style=doc.createElement('style');style.textContent='@page{size:A4 portrait;margin:0}body{margin:0}img{display:block;width:210mm;height:297mm}';doc.head.appendChild(style);const img=doc.createElement('img');img.alt='Plaquinha do ponto de retirada';img.onload=()=>{win.focus();win.print()};img.src=poster;doc.body.appendChild(img)};
 return <section className="pickup-poster" aria-labelledby="pickup-poster-title"><h3 id="pickup-poster-title">Plaquinha deste ponto</h3><p>Use a identidade da loja para divulgar o ponto de retirada.</p>
 <label>Categoria em destaque <select value={categories.some(c=>c.name===category)?category:''} onChange={e=>setCategory(e.target.value)}><option value="">Produtos em geral</option>{categories.filter(c=>c.active).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select></label>
 <label>Texto da categoria <input value={category} maxLength={55} onChange={e=>setCategory(e.target.value)} placeholder="Ex.: sobremesas" /></label>
 <label className="pickup-poster-check"><input type="checkbox" checked={showProof} onChange={e=>setShowProof(e.target.checked)}/> Incluir orientação de comprovante</label>
 {loadingContact&&<p role="status">Consultando contato do ponto…</p>}{contactError&&<p role="alert">Não foi possível consultar o contato. A plaquinha será criada sem telefone.</p>}
 {contact&&<p>Contato exibido: {contact.name} · {contact.phone}</p>}{!loadingContact&&!contact&&!contactError&&<p>Nenhum contato específico disponível; a plaquinha não exibirá telefone.</p>}
 {poster?<img src={poster} alt={`Prévia da plaquinha de ${point.name}`} />:<p role="status">Preparando prévia…</p>}{logoMissing&&<p role="status">Não foi possível incluir a logo. Confira a imagem cadastrada antes de imprimir.</p>}{error&&<p role="alert">{error}</p>}
 <div className="pickup-poster-actions"><a className="secondary-button" href={poster || undefined} download={`placa-${point.short_code.toLowerCase()}.png`} aria-disabled={!poster} onClick={e=>{if(!poster)e.preventDefault()}}>Baixar imagem</a><button type="button" className="primary-button" disabled={!poster} onClick={print}>Imprimir / salvar PDF</button></div><small>Na impressão, confira o ponto e teste o QR Code antes de distribuir.</small></section>
}
