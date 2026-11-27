import { useRef, useState } from 'react';
import { TurnstileWidget } from '../../components/ui/TurnstileWidget';
import { appConfig } from '../../lib/config';
import { printing3dPublicCall } from '../../services/printing3dPublicApi';
import { optimizeImageForUpload } from '../../utils/imageUpload';
import '../../modules/modules.css';

const makeToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const toBase64=(file:File):Promise<string>=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('Não foi possível ler a foto.'));r.readAsDataURL(file);});
export default function PrintCustomRequest({store}:{store:string}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [form,setForm]=useState({customer_name:'',customer_phone:'',quantity:1,size:'',material:'',color:'',due_at:'',description:''});
  const [files,setFiles]=useState<File[]>([]),[photo,setPhoto]=useState<File>(),[consent,setConsent]=useState(false),[suggestion,setSuggestion]=useState('');
  const [captcha,setCaptcha]=useState(''),[reset,setReset]=useState(0),[saved,setSaved]=useState(false),[complete,setComplete]=useState(false);
  const pending=useRef<{id:string;token:string;data:typeof form}|undefined>(undefined),inFlight=useRef(false),uploaded=useRef(new Set<File>());
  const tokenUsed=()=>{setCaptcha('');setReset(n=>n+1);};
  const assist=async()=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
    try{let attachment:undefined|{mime:string;data:string};if(photo){const optimized=await optimizeImageForUpload(photo);if(optimized.size>750000)throw new Error('Use uma foto menor para a IA. O anexo original pode ser enviado à loja.');attachment={mime:optimized.type,data:await toBase64(optimized)};}
      const result=await printing3dPublicCall({action:'assist',store_id:store,description:form.description,photo:attachment,consent,turnstileToken:captcha});setSuggestion(result.text||'');
    }catch(e){setError((e as Error).message);}finally{tokenUsed();inFlight.current=false;setBusy(false);}
  };
  const send=async()=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(!pending.current)pending.current={id:crypto.randomUUID(),token:makeToken(),data:{...form,due_at:new Date(form.due_at).toISOString()}};
      const p=pending.current;
      if(!saved){await printing3dPublicCall({action:'create',store_id:store,request_id:p.id,token:p.token,data:p.data,turnstileToken:captcha});setSaved(true);setNotice('Solicitação recebida. Enviando os anexos…');tokenUsed();}
      const attachments=[...files,...(photo?[photo]:[])];
      for(const file of attachments){if(uploaded.current.has(file))continue;const prepared=await optimizeImageForUpload(file);const body=new FormData();for(const [key,value] of Object.entries({action:'upload',store_id:store,request_id:p.id,token:p.token}))body.set(key,value);body.set('file',prepared);await printing3dPublicCall(body);uploaded.current.add(file);}
      setComplete(true);setNotice('Solicitação e anexos recebidos. A loja vai conferir o projeto e combinar preço e prazo pelo contato informado.');
    }catch(e){setError(`${(e as Error).message}${saved?' A solicitação já foi recebida; tente novamente para completar os anexos.':''}`);if(!saved)tokenUsed();}
    finally{inFlight.current=false;setBusy(false);}
  };
  const selectFiles=(incoming:FileList|null,isPhoto=false)=>{
    const next=Array.from(incoming||[]);setError('');if(next.some(f=>!f.size||f.size>25*1024*1024||!/\.(png|jpg|jpeg|webp|pdf|stl|obj|3mf)$/i.test(f.name))){setError('Use foto, PDF, STL, OBJ ou 3MF de até 25 MiB por arquivo.');return;}
    if((isPhoto?files.length+next.length:next.length+(photo?1:0))>5){setError('Escolha até cinco anexos, incluindo a foto.');return;}
    if(isPhoto)setPhoto(next[0]);else setFiles(next);
  };
  return <section className="food-modules module-card print-public-request" aria-label="Projeto personalizado"><h2>Tem uma ideia para imprimir?</h2><p>Envie um modelo 3D ou explique sua ideia com uma foto. Você pode comprar os produtos prontos no catálogo ou pedir este orçamento personalizado.</p><button type="button" className="button button-primary" aria-expanded={open} onClick={()=>setOpen(!open)}>Pedir impressão personalizada</button>
    {open&&<>{complete?<div role="status"><h3>Projeto enviado para revisão</h3><p>{notice}</p><p>Referência: {pending.current?.id.slice(0,8)}</p><p>A solicitação é um orçamento e ainda não confirma uma compra.</p></div>:<form aria-label="Solicitar impressão personalizada" onSubmit={e=>{e.preventDefault();void send();}}>
      <fieldset disabled={busy||saved} className="print-public-fields"><legend>Sua ideia</legend><label>O que você quer imprimir?<textarea required minLength={5} maxLength={2000} value={form.description} onChange={e=>{setForm({...form,description:e.target.value});if(!saved)pending.current=undefined;}} placeholder="Conte o que é a peça, para que será usada e os detalhes importantes."/></label>
        <div className="module-grid"><label>Foto de referência (opcional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>selectFiles(e.target.files,true)}/></label><label>Arquivos do projeto (opcional)<input type="file" multiple accept=".stl,.obj,.3mf,.pdf,.png,.jpg,.jpeg,.webp" onChange={e=>selectFiles(e.target.files)}/></label></div>
        <p>Até cinco anexos de 25 MiB cada. A foto ajuda a explicar; o modelo precisa ser conferido antes da impressão. Envie apenas arquivos que você pode usar.</p><ul>{[...files,...(photo?[photo]:[])].map((f,n)=><li key={n}>{f.name}</li>)}</ul>
        <details><summary>Organizar minha ideia com ajuda da IA</summary><p>A IA ajuda a escrever o pedido. Ela não gera um arquivo 3D nem garante dimensões, resistência ou preço. A loja revisará o projeto.</p><label className="module-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Autorizo enviar esta descrição e a foto de referência para a OpenAI para preparar um rascunho. Não inclua dados pessoais na descrição ou foto.</label><button className="button" type="button" disabled={busy||!consent||!captcha||form.description.trim().length<5} onClick={()=>void assist()}>Ajudar a descrever minha peça</button>{suggestion&&<><label>Rascunho da IA<textarea maxLength={2000} value={suggestion} onChange={e=>setSuggestion(e.target.value)}/></label><button className="button" type="button" onClick={()=>{setForm({...form,description:suggestion});pending.current=undefined;setNotice('Rascunho aplicado. Confira e complete as medidas antes de enviar.');}}>Usar este rascunho na descrição</button></>}</details>
        <div className="module-grid"><label>Quantidade de peças<input required type="number" min="1" max="100000" value={form.quantity} onChange={e=>{setForm({...form,quantity:Number(e.target.value)});pending.current=undefined;}}/></label><label>Medidas desejadas (opcional)<input maxLength={200} placeholder="Ex.: 10 × 5 × 3 cm" value={form.size} onChange={e=>{setForm({...form,size:e.target.value});pending.current=undefined;}}/></label><label>Material desejado (opcional)<input maxLength={100} placeholder="Pode deixar a definir" value={form.material} onChange={e=>{setForm({...form,material:e.target.value});pending.current=undefined;}}/></label><label>Cor desejada (opcional)<input maxLength={100} value={form.color} onChange={e=>{setForm({...form,color:e.target.value});pending.current=undefined;}}/></label><label>Prazo desejado<input required type="datetime-local" value={form.due_at} onChange={e=>{setForm({...form,due_at:e.target.value});pending.current=undefined;}}/></label><label>Seu nome<input required minLength={2} maxLength={120} autoComplete="name" value={form.customer_name} onChange={e=>{setForm({...form,customer_name:e.target.value});pending.current=undefined;}}/></label><label>WhatsApp para retorno<input required type="tel" minLength={10} maxLength={25} autoComplete="tel" value={form.customer_phone} onChange={e=>{setForm({...form,customer_phone:e.target.value});pending.current=undefined;}}/></label></div>
      </fieldset>
      {!saved&&<TurnstileWidget siteKey={appConfig.turnstileSiteKey} action="print3d" resetSignal={reset} onToken={setCaptcha}/>}
      {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}<p>Preço, prazo e viabilidade dependem da conferência da loja. O envio não gera pagamento automático.</p><button className="button button-primary" disabled={busy||!saved&&!captcha}>{busy?'Enviando…':saved?'Concluir envio dos anexos':'Enviar projeto para orçamento'}</button>
    </form>}</>}
  </section>;
}
