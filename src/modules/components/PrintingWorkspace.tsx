import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryItem, InventoryUnit } from '../../types';
import { convertPrintQuantity, emptyPrintPlan, hoursTotal, materialTotal, printingApi, type PrintActual, type PrintJob, type PrintPlan, type PrintRecord } from '../printing3d';
import { moduleMoney } from '../calculator';
import CustomPanel from './CustomPanel';
import PrintPlanFields, { PrintOrderField } from './PrintPlanFields';
import PrintImportPanel from './PrintImportPanel';
import PrintCalculator from './PrintCalculator';
import { defaultPrintCosts } from '../calculator';
import type { PrintCosts } from '../types';
import type { PrintClassification, PrintSource } from '../printing3d';

type Snapshot = Awaited<ReturnType<typeof printingApi.load>>;
type Command = (action: string, data: unknown) => Promise<boolean>;
const labels = { waiting: 'Aguardando', printing: 'Em impressão', completed: 'Concluída', interrupted: 'Interrompida' };
const count = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const materialName = (items: InventoryItem[], id: string) => items.find(i => i.id === id)?.name || 'Material não associado';

export default function PrintingWorkspace({ store, ...custom }: ComponentProps<typeof CustomPanel> & { store: string }) {
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void printingApi.load(store).then(d => { if (alive.current) setData(d); }).catch(e => { if (alive.current) setError(e.message); }); return () => { alive.current = false; }; }, [store]);
  const run: Command = async (action, payload) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    const fingerprint = JSON.stringify({ action, payload });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await printingApi.command(store, action, payload, attempt.current.key);
      attempt.current = undefined;
      // A escrita confirmada não é reenviada porque uma atualização da lista falhou.
      setNotice('Registro confirmado para esta loja.');
      try { const [next] = await Promise.all([printingApi.load(store), custom.reload()]); if (alive.current) setData(next); }
      catch { setError('Registro salvo. Não foi possível atualizar a lista; use Atualizar antes de continuar.'); }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); return false; }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const [edit, setEdit] = useState<PrintJob | 'new'>();
  const [classify,setClassify]=useState<PrintJob>();
  const [finish, setFinish] = useState<PrintJob>();
  const [history, setHistory] = useState<{ job: PrintJob; records: PrintRecord[] }>();
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('deadline');
  const showHistory = async (job: PrintJob, correct = false) => {
    try {
      const records = await printingApi.records(store, job.id);
      if (!records.length) throw new Error('Histórico indisponível. Atualize antes de corrigir.');
      setHistory({ job, records }); if (correct) setFinish(job);
    } catch (e) { setError((e as Error).message); }
  };
  if (!data) return <section className="module-card">{error ? <p role="alert">Produção indisponível: {error}</p> : <p role="status">Carregando produção e materiais...</p>}<button className="button" onClick={()=>void printingApi.load(store).then(setData).catch(e=>setError(e.message))}>Atualizar</button></section>;
  const active = data.jobs.filter(j => j.status === 'waiting' || j.status === 'printing');
  const shortage = (j: PrintJob) => j.plan.materials.filter(l => {
    const i = data.items.find(i => i.id === l.inventory_item_id);
    const q = i ? convertPrintQuantity(materialTotal(l, j.quantity), l.unit, i.unit) : null;
    return !i || q === null || q > i.currentQuantity;
  });
  const requestFor = (j: PrintJob) => custom.requests.find(r => r.id === j.request_id);
  const findJob = (j: PrintJob) => { const r = requestFor(j); const term = search.trim().toLocaleLowerCase('pt-BR'); return !term || [j.description, r?.customer_name, r?.material, r?.color, j.order_id ? String(data.orders.find(o=>o.id===j.order_id)?.order_number || '') : ''].some(v => (v || '').toLocaleLowerCase('pt-BR').includes(term)); };
  const shown = data.jobs.filter(j => (filter==='all'||filter==='active'&&(j.status==='waiting'||j.status==='printing')||j.status===filter||filter==='pending'&&(j.status==='waiting'||j.status==='printing')&&(!j.plan.materials.length||shortage(j).length>0)) && findJob(j)).slice().sort((a,b)=>sort==='deadline' ? (requestFor(a)?.due_at || '9999').localeCompare(requestFor(b)?.due_at || '9999') : 0);
  const low = data.items.filter(i => i.currentQuantity <= i.reorderPoint);
  return <div className="print-workspace">
    <section className="module-card" aria-label="Produção 3D"><div className="module-row"><div><span className="custom-eyebrow">DO ORÇAMENTO À IMPRESSÃO</span><h2>Produção 3D</h2><p>O estoque muda ao confirmar o consumo, inclusive em uma impressão que falhou.</p></div><div className="module-actions"><button className="button button-primary" onClick={()=>setEdit('new')} disabled={busy}>Impressão avulsa</button><button className="button" disabled={busy} onClick={()=>void Promise.all([printingApi.load(store),custom.reload()]).then(([d])=>{setData(d);setError('');}).catch(e=>setError(e.message))}>Atualizar</button><Link className="button" to="/admin/estoque">Abrir insumos</Link><a className="button" href="#print-quotes">Orçamentos</a></div></div>
      <div className="print-summary"><div><strong>{active.filter(j=>j.status==='waiting').length}</strong><span>Aguardando produção</span></div><div><strong>{active.filter(j=>j.status==='printing').length}</strong><span>Em impressão</span></div><div><strong>{active.filter(j=>shortage(j).length>0 || !j.plan.materials.length).length}</strong><span>Com pendências de material</span></div></div>
      <p className="module-caption">Saldos estimados do estoque de insumos. Este fluxo não reserva materiais. A previsão de trabalhos não reduz o saldo disponível.</p>
      {!!low.length && <details className="print-alert"><summary>{low.length} materiais em falta ou no mínimo</summary>{low.map(i=><p key={i.id}>{i.name}: {count(i.currentQuantity)} {i.unit} · mínimo {count(i.reorderPoint)} {i.unit} · {active.filter(j=>j.plan.materials.some(l=>l.inventory_item_id===i.id)).length} trabalhos podem ser afetados.</p>)}<p>Compras em trânsito não garantem data de chegada.</p></details>}
      {error && <p role="alert" className="module-message module-error">{error}</p>}{notice && <p role="status" className="module-message">{notice}</p>}
      {edit && <JobForm key={edit==='new'?'new':edit.id} job={edit==='new'?undefined:edit} data={data} run={run} busy={busy} close={()=>setEdit(undefined)}/>}
      {classify && <ClassificationForm key={`${classify.id}:${classify.revision}`} job={classify} products={data.products} run={run} busy={busy} close={()=>setClassify(undefined)}/>}
      {finish && <ConsumptionForm key={`${finish.id}:${finish.revision}`} job={finish} previous={history?.job.id===finish.id?history.records[0]:undefined} items={data.items} run={run} busy={busy} close={()=>{setFinish(undefined);setHistory(undefined);}}/>}
      <div className="module-grid"><label>Buscar trabalho<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Peça, cliente, material, cor ou número do pedido" /></label><label>Ordenar por<select value={sort} onChange={e=>setSort(e.target.value)}><option value="deadline">Prazo do orçamento</option><option value="recent">Mais recentes</option></select></label><label>Mostrar trabalhos<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Aguardando e em impressão</option><option value="all">Todos</option><option value="pending">Com pendências de material</option><option value="interrupted">Interrompidos</option><option value="completed">Concluídos</option></select></label></div>
      {shown.map(j=><article className="module-card print-job" key={j.id}><div className="module-row"><div><span className="custom-status">{labels[j.status]}</span><h3>{j.description}</h3><p>{j.quantity} peças · {count(hoursTotal(j.plan,j.quantity))} h previstas por lote {j.retry_of && '· Nova tentativa'}</p>{j.order_id && <p>Pedido #{data.orders.find(o=>o.id===j.order_id)?.order_number || 'vinculado'}</p>}{requestFor(j) && <p>Cliente: {requestFor(j)?.customer_name} · Prazo informado: {new Date(requestFor(j)!.due_at).toLocaleString('pt-BR')} · Material: {requestFor(j)?.material} · Cor: {requestFor(j)?.color}</p>}{j.request_id && <p>Arquivos no orçamento: {custom.files.filter(f=>f.request_id===j.request_id).length} · <a href="#print-quotes">Abrir orçamentos e arquivos</a></p>}</div><div className="module-actions">{j.status==='waiting' && <><button className="button" disabled={busy} onClick={()=>setEdit(j)}>Preparar</button><button className="button" disabled={busy} onClick={()=>void run('start',{id:j.id,revision:j.revision})}>Iniciar impressão</button></>}{['waiting','printing'].includes(j.status)?<button className="button button-primary" disabled={busy} onClick={()=>{setHistory(undefined);setFinish(j);}}>Registrar resultado e consumo</button>:<><button className="button" disabled={busy} onClick={()=>void showHistory(j,true)}>Corrigir consumo</button><button className="button" disabled={busy} onClick={()=>void showHistory(j)}>Ver histórico</button>{data.workflowAvailable&&j.status==='completed'&&<button className="button" disabled={busy} onClick={()=>void run('repeat',{id:j.id,revision:j.revision})}>Reimprimir lote</button>}{j.status==='interrupted' && <button className="button" disabled={busy} onClick={()=>void run('retry',{id:j.id})}>Nova tentativa</button>}</>}</div></div>
        {data.workflowAvailable&&<><p>Finalidade: {classificationLabels[j.classification||'unclassified']}{j.product_id&&` · ${data.products.find(p=>p.id===j.product_id)?.name||'Produto vinculado'}`}{j.classification==='private'&&' · sem venda ou lucro obrigatório'}</p><button className="button" disabled={busy} onClick={()=>setClassify(j)}>Corrigir associação / finalidade</button></>}
        {j.imported_metadata&&<p>Estimativa importada: {j.imported_metadata.filename} · mesa {j.imported_metadata.plate} · {j.imported_metadata.printer||'impressora não identificada'}. Confira os valores antes do consumo.</p>}
        {j.plan.materials.map((l,n)=><p key={n}>{materialName(data.items,l.inventory_item_id)}: {count(l.quantity)} {l.unit} {l.basis==='piece'?'por peça':'por lote'} · total previsto {count(materialTotal(l,j.quantity))} {l.unit}</p>)}
        {(!j.plan.materials.length || shortage(j).length>0) && ['waiting','printing'].includes(j.status) && <p className="print-alert">{!j.plan.materials.length?'Associe os materiais antes de confirmar o consumo.':`Pendência: ${shortage(j).map(l=>materialName(data.items,l.inventory_item_id)).join(', ')}. Confira associação, unidade e saldo.`}</p>}
        {(j.quote_snapshot || j.agreed_total_cents!==null) && <p>Custo estimado do lote: {j.quote_snapshot?.base_cents===undefined?'não informado':moduleMoney(j.quote_snapshot.base_cents*j.quantity)} · Preço acordado: {j.agreed_total_cents===null?'não informado':moduleMoney(j.agreed_total_cents)}. O consumo não altera o preço acordado.</p>}
      </article>)}
      {!shown.length && <p role="status">{search || filter!=='active' ? 'Nenhum trabalho encontrado com esses filtros.' : 'Nenhum trabalho aguardando ou em impressão. Aprove um orçamento ou crie uma impressão avulsa.'}</p>}
      {history && !finish && <section className="module-card" aria-label="Histórico de consumo"><h3>Histórico · {history.job.description}</h3>{history.records.map(r=><article key={r.id} className="print-record"><strong>{r.kind==='correction'?'Correção':'Registro inicial'} · {new Date(r.created_at).toLocaleString('pt-BR')}</strong><p>{labels[r.outcome]} · {r.pieces} peças produzidas de {history.job.quantity} · tempo registrado {count(r.hours)} h / previsto {count(hoursTotal(history.job.plan,history.job.quantity))} h</p>{r.materials.map((l,n)=>{const planned=history.job.plan.materials.find(p=>p.inventory_item_id===l.inventory_item_id);const estimate=planned?convertPrintQuantity(materialTotal(planned,history.job.quantity),planned.unit,l.unit):null;return <p key={n}>{l.name||materialName(data.items,l.inventory_item_id)}: {count(l.quantity)} {l.unit} · {l.origin==='estimated_confirmed'?'estimado confirmado':'medido/informado manualmente'}{estimate!==null?` · previsto ${count(estimate)} ${l.unit} · diferença ${count(l.quantity-estimate)} ${l.unit}`:''}</p>;})}{r.material_cost_cents!=null&&<p>Custo acumulado de materiais registrado no estoque: {moduleMoney(r.material_cost_cents)}. Usa o custo médio dos lançamentos; energia e demais despesas ainda dependem de conferência.</p>}{r.reason&&<p>Motivo: {r.reason}</p>}</article>)}<p>Os valores de cada registro são totais da tentativa. Correções movimentam apenas a diferença.</p><button className="button" onClick={()=>setHistory(undefined)}>Fechar histórico</button></section>}
    </section>
    <PurchasePanel data={data} run={run} busy={busy}/>
    <div id="print-quotes"><CustomPanel {...custom} busy={busy||custom.busy} printTools={{items:data.items,orders:data.orders,extendedCosts:data.workflowAvailable,costDefaults:data.costDefaults,saveDefaults:data.workflowAvailable?costs=>run('cost_defaults',{costs}):undefined,save:d=>run('quote_save',d)}}/></div>
  </div>;
}

function JobForm({ job, data, run, busy, close }: { job?: PrintJob; data: Snapshot; run: Command; busy: boolean; close: () => void }) {
  const [description,setDescription]=useState(job?.description||'');
  const [quantity,setQuantity]=useState(job?.quantity||1);
  const [order,setOrder]=useState(job?.order_id||'');
  const [plan,setPlan]=useState<PrintPlan>(job?.plan||emptyPrintPlan);
  const [classification,setClassification]=useState<PrintClassification>(job?.classification||'unclassified');
  const [product,setProduct]=useState(job?.product_id||'');
  const [source,setSource]=useState<PrintSource|undefined>(job?.imported_metadata||undefined);
  const [quote,setQuote]=useState<PrintCosts>();const [agreed,setAgreed]=useState<number|null>(job?.agreed_total_cents??null);
  const [calculator,setCalculator]=useState<PrintCosts>();const [calcKey,setCalcKey]=useState(0);
  const prepareCost=()=>{
    let grams=0,cents=0,nonMassCents=0;for(const line of plan.materials){const g=convertPrintQuantity(materialTotal(line,quantity),line.unit,'g');const item=data.items.find(i=>i.id===line.inventory_item_id);const units=item?convertPrintQuantity(materialTotal(line,quantity),line.unit,item.unit):null;if(g!==null)grams+=g;if(item&&units!==null){if(g!==null)cents+=units*item.averageUnitCost*100;else nonMassCents+=units*item.averageUnitCost*100;}}
    setCalculator({...defaultPrintCosts,...data.costDefaults,grams:grams/quantity,cents_per_gram:grams?cents/grams:0,hours:hoursTotal(plan,quantity)/quantity,other_cents:(data.costDefaults?.other_cents||0)+nonMassCents/quantity});setCalcKey(k=>k+1);
  };
  return <form className="module-card" aria-label="Preparar impressão" onSubmit={async e=>{e.preventDefault();if(await run('job_save',{id:job?.id,revision:job?.revision,description,quantity,classification,product_id:classification==='catalog'?product:null,order_id:classification==='private'?'':order,plan:{...plan,description,order_id:classification==='private'?'':order},imported_metadata:source,source_fingerprint:job?.retry_of?undefined:source?`${source.sha256}:${source.plate}`:undefined,quote,agreed_total_cents:classification==='private'?null:agreed}))close();}}><h3>{job?'Preparar trabalho':'Impressão avulsa'}</h3>
    {data.workflowAvailable&&<PrintImportPanel onApply={(next,metadata,name)=>{setPlan(next);setSource(metadata);setDescription(name);setQuote(undefined);setCalculator(undefined);}}/>}
    <div className="module-grid"><label>Descrição da impressão<input required maxLength={300} value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Quantidade de peças<input required type="number" min="1" max="100000" value={quantity} onChange={e=>{setQuantity(Number(e.target.value));setQuote(undefined);setCalculator(undefined);setAgreed(job?.agreed_total_cents??null);}}/></label></div>
    {data.workflowAvailable&&<ClassificationFields value={classification} onChange={v=>{setClassification(v);if(v==='private'){setOrder('');setProduct('');}}} product={product} setProduct={setProduct} products={data.products}/>}
    {classification==='private'?<p>Uso próprio. Não cria venda nem exige preço. O filamento será debitado somente se você registrar e confirmar o consumo.</p>:<PrintOrderField value={order} onChange={setOrder} orders={data.orders}/>}
    {source&&<p>Fonte: {source.filename} · mesa {source.plate}. Os totais importados correspondem ao lote inteiro. {source.filaments.map(f=>`${f.type} ${f.color}`).join(' / ')}</p>}
    <PrintPlanFields plan={plan} onChange={v=>{setPlan(v);setCalculator(undefined);setQuote(undefined);}} quantity={quantity} items={data.items}/>
    {data.workflowAvailable&&<button className="button" type="button" onClick={prepareCost}>Calcular com a previsão e custos dos insumos</button>}
    {calculator&&<><p>Custos por peça, rateados a partir deste lote. Materiais sem associação ou custo conhecido entram como zero: confira e complete antes de usar o resultado.</p><PrintCalculator key={calcKey} extended initialCosts={calculator} urgencyBps={0} onApply={(costs,price)=>{setQuote(costs);if(classification!=='private')setAgreed(price*quantity);}}/></>}
    {quote&&<p>Estimativa aplicada ao lote. {classification!=='private'&&agreed!==null&&`Preço acordado do lote: ${moduleMoney(agreed)}.`}</p>}
    <div className="module-actions"><button className="button button-primary" disabled={busy}>Salvar preparação</button><button className="button" type="button" onClick={close} disabled={busy}>Cancelar</button></div></form>;
}

const classificationLabels: Record<PrintClassification,string>={unclassified:'A classificar',catalog:'Produto do catálogo',private:'Privada / uso próprio',custom:'Personalizada'};
function ClassificationFields({value,onChange,product,setProduct,products}:{value:PrintClassification;onChange:(v:PrintClassification)=>void;product:string;setProduct:(v:string)=>void;products:{id:string;name:string}[]}) {
  return <div className="module-grid"><label>Finalidade da impressão<select value={value} onChange={e=>onChange(e.target.value as PrintClassification)}>{Object.entries(classificationLabels).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>{value==='catalog'&&<label>Produto do catálogo<select required value={product} onChange={e=>setProduct(e.target.value)}><option value="">Selecione o produto</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><small>A associação não repõe peças prontas automaticamente. Produtos com baixa por ficha técnica precisam ter essa automação revisada antes de usar o consumo da produção.</small></label>}</div>;
}
function ClassificationForm({job,products,run,busy,close}:{job:PrintJob;products:{id:string;name:string}[];run:Command;busy:boolean;close:()=>void}) {
  const [value,setValue]=useState<PrintClassification>(job.classification||'unclassified');const [product,setProduct]=useState(job.product_id||'');const [reason,setReason]=useState('');
  return <form className="module-card" aria-label="Corrigir associação" onSubmit={async e=>{e.preventDefault();if(await run('job_classify',{id:job.id,revision:job.revision,classification:value,product_id:value==='catalog'?product:null,reason}))close();}}><h3>Associação · {job.description}</h3><ClassificationFields value={value} onChange={setValue} product={product} setProduct={setProduct} products={products}/><p>Não altera consumo nem gera uma venda. Impressões com pedido ou orçamento vinculado precisam manter sua finalidade comercial.</p><label>Motivo da alteração<textarea required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="button button-primary" disabled={busy}>Salvar associação</button><button className="button" type="button" disabled={busy} onClick={close}>Cancelar</button></form>;
}

function ConsumptionForm({job,previous,items,run,busy,close}:{job:PrintJob;previous?:PrintRecord;items:InventoryItem[];run:Command;busy:boolean;close:()=>void}) {
  const correcting=['completed','interrupted'].includes(job.status);
  const [lines,setLines]=useState<PrintActual[]>(previous?.materials||job.plan.materials.map(l=>({inventory_item_id:l.inventory_item_id,quantity:materialTotal(l,job.quantity),unit:l.unit,origin:'estimated_confirmed'})));
  const [outcome,setOutcome]=useState(previous?.outcome||'completed');
  const [pieces,setPieces]=useState(previous?.pieces??job.quantity);
  const [hours,setHours]=useState(previous?.hours??hoursTotal(job.plan,job.quantity));
  const [reason,setReason]=useState('');
  const update=(index:number,patch:Partial<PrintActual>)=>setLines(current=>current.map((l,n)=>n===index?{...l,...patch}:l));
  const lacks=lines.some(l=>{const i=items.find(i=>i.id===l.inventory_item_id);if(!i)return true;const q=convertPrintQuantity(l.quantity,l.unit,i.unit);const old=previous?.materials.find(p=>p.inventory_item_id===i.id);const oldQ=old?convertPrintQuantity(old.quantity,old.unit,i.unit):0;return q===null||oldQ===null||q-oldQ>i.currentQuantity;});
  return <form className="module-card print-consumption" aria-label="Confirmar consumo" onSubmit={async e=>{e.preventDefault();if(await run(correcting?'correct':'finish',{id:job.id,revision:job.revision,outcome,pieces,hours,reason,materials:lines}))close();}}><h3>{correcting?'Corrigir lançamento':'Resultado da impressão'} · {job.description}</h3><p>Informe o consumo total desta tentativa, incluindo suportes, purga e perdas. Uma falha não devolve material ao estoque. Não há medição automática.</p><div className="module-grid"><label>Resultado<select value={outcome} onChange={e=>setOutcome(e.target.value as 'completed'|'interrupted')}><option value="completed">Concluída</option><option value="interrupted">Falhou / interrompida</option></select></label><label>Peças produzidas<input required type="number" min="0" max={job.quantity} value={pieces} onChange={e=>setPieces(Number(e.target.value))}/></label><label>Tempo registrado do lote (h)<input required type="number" min="0" max="1000000" step="any" value={hours} onChange={e=>setHours(Number(e.target.value))}/></label></div>
    <p>Previsão: {job.quantity} peças · {count(hoursTotal(job.plan,job.quantity))} h por lote. O tempo acima é informado pelo lojista.</p>
    {lines.map((l,n)=>{const i=items.find(i=>i.id===l.inventory_item_id);const old=previous?.materials.find(p=>p.inventory_item_id===l.inventory_item_id);const oldQ=i&&old?convertPrintQuantity(old.quantity,old.unit,i.unit):0;const q=i?convertPrintQuantity(l.quantity,l.unit,i.unit):null;return <fieldset key={n} className="print-material"><legend>Material {n+1} · total da tentativa</legend><div className="module-grid"><label>Material utilizado<select required value={l.inventory_item_id} onChange={e=>update(n,{inventory_item_id:e.target.value,origin:'measured_manual'})}><option value="">Escolha o insumo</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Consumo total<input required type="number" min="0" step="any" value={l.quantity} onChange={e=>update(n,{quantity:Number(e.target.value),origin:'measured_manual'})}/></label><label>Unidade do consumo<select value={l.unit} onChange={e=>update(n,{unit:e.target.value as InventoryUnit,origin:'measured_manual'})}>{['g','kg','ml','l','un','pack'].map(u=><option key={u}>{u}</option>)}</select></label><label>Origem do consumo<select value={l.origin} onChange={e=>update(n,{origin:e.target.value as PrintActual['origin']})}><option value="estimated_confirmed">Estimado confirmado</option><option value="measured_manual">Medido / informado manualmente</option></select></label></div>{i&&<p>Saldo atual estimado: {count(i.currentQuantity)} {i.unit} · após este lançamento: {q===null||oldQ===null?'unidade incompatível':`${count(i.currentQuantity+oldQ-q)} ${i.unit}`}</p>}<button className="button" type="button" onClick={()=>setLines(current=>current.filter((_,index)=>index!==n))}>Remover consumo {n+1}</button></fieldset>;})}
    <button className="button" type="button" disabled={lines.length>=30} onClick={()=>setLines(current=>[...current,{inventory_item_id:'',quantity:0,unit:'g',origin:'measured_manual'}])}>Adicionar material utilizado</button>
    <label>{correcting?'Motivo da correção (obrigatório)':'Motivo da interrupção / observação (opcional)'}<textarea required={correcting} minLength={correcting?3:undefined} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {lacks&&<p className="print-alert" role="status">Confira o material, a unidade e o saldo. O servidor bloqueará consumo maior que o disponível. Registre recebimentos ou confira o estoque antes de confirmar.</p>}
    {correcting&&<p>Preencha o total correto, não a diferença. O sistema registra o ajuste com motivo e preserva o histórico.</p>}
    <div className="module-actions"><button className="button button-primary" disabled={busy||!lines.length||correcting&&!previous}>Confirmar {correcting?'correção':'consumo'}</button><button className="button" type="button" onClick={close} disabled={busy}>Cancelar</button></div>
  </form>;
}

function PurchasePanel({data,run,busy}:{data:Snapshot;run:Command;busy:boolean}) {
  const [supplier,setSupplier]=useState('');const [stage,setStage]=useState('planned');
  const [lines,setLines]=useState([{inventory_item_id:'',quantity:1,unit_cost:0}]);
  return <section className="module-card" aria-label="Compra de materiais"><h2>Compras e recebimento</h2><p>Planejar ou marcar como comprada não aumenta o estoque. Confirme o recebimento quando todo o material desta compra chegar. Para entregas separadas, registre compras separadas.</p><details><summary>Planejar compra de materiais</summary><form onSubmit={async e=>{e.preventDefault();const payload={supplier,stage,items:lines.map(l=>({...l,unit:data.items.find(i=>i.id===l.inventory_item_id)?.unit}))};if(await run('purchase_plan',payload)){setSupplier('');setLines([{inventory_item_id:'',quantity:1,unit_cost:0}]);}}}><div className="module-grid"><label>Fornecedor (opcional)<input maxLength={200} value={supplier} onChange={e=>setSupplier(e.target.value)}/></label><label>Situação da compra<select value={stage} onChange={e=>setStage(e.target.value)}><option value="planned">Planejada</option><option value="ordered">Comprada · aguardando recebimento</option></select></label></div>{lines.map((l,n)=><div className="module-grid print-material" key={n}><label>Insumo da compra<select required value={l.inventory_item_id} onChange={e=>setLines(current=>current.map((x,k)=>k===n?{...x,inventory_item_id:e.target.value}:x))}><option value="">Selecione</option>{data.items.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label><label>Quantidade na unidade do insumo<input required type="number" min="0.001" step="0.001" value={l.quantity} onChange={e=>setLines(current=>current.map((x,k)=>k===n?{...x,quantity:Number(e.target.value)}:x))}/></label><label>Custo por unidade do insumo (R$)<input required type="number" min="0" step="0.0001" value={l.unit_cost} onChange={e=>setLines(current=>current.map((x,k)=>k===n?{...x,unit_cost:Number(e.target.value)}:x))}/></label><button className="button" type="button" onClick={()=>setLines(current=>current.filter((_,k)=>k!==n))}>Remover item</button></div>)}<div className="module-actions"><button className="button" type="button" disabled={lines.length>=30} onClick={()=>setLines(current=>[...current,{inventory_item_id:'',quantity:1,unit_cost:0}])}>Adicionar insumo à compra</button><button className="button button-primary" disabled={busy||!lines.length}>Salvar compra sem entrada no estoque</button></div></form></details>
    {data.purchases.map(p=><article className="module-row" key={p.id}><div><strong>{p.supplier||'Compra de materiais'} · {Number(p.total_amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong><p>{p.status==='received'?'Recebida':p.status==='cancelled'?'Cancelada':p.print_procurement_stage==='ordered'?'Comprada · aguardando material':'Planejada'}</p>{data.purchaseItems.filter(l=>l.purchase_id===p.id).map(l=><p key={l.id}>{materialName(data.items,l.inventory_item_id)}: {count(Number(l.quantity))} {data.items.find(i=>i.id===l.inventory_item_id)?.unit} · {Number(l.unit_cost).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} por unidade do insumo</p>)}</div>{p.status==='draft'&&<div className="module-actions">{p.print_procurement_stage==='planned'&&<button className="button" disabled={busy} onClick={()=>void run('purchase_order',{id:p.id})}>Marcar como comprada</button>}<button className="button button-primary" disabled={busy} onClick={()=>{if(window.confirm('Todo o material desta compra chegou? Confirmar registra a entrada no estoque e aciona o financeiro conforme as permissões existentes.'))void run('purchase_receive',{id:p.id});}}>Confirmar recebimento integral</button><button className="button" disabled={busy} onClick={()=>void run('purchase_cancel',{id:p.id})}>Cancelar compra</button></div>}</article>)}<p className="module-caption">As compras já recebidas continuam disponíveis em Insumos e Financeiro. O recebimento usa a integração financeira existente, quando habilitada; não confirma pagamento.</p>
  </section>;
}
