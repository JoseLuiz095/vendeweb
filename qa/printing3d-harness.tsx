// Local-only fixture. Not imported by src, excluded from production build.
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import PrintingWorkspace from '../src/modules/components/PrintingWorkspace';
import PrintCustomRequest from '../src/modules/components/PrintCustomRequest';
import { printingApi, type PrintJob, type PrintRecord } from '../src/modules/printing3d';
import { modulesApi } from '../src/modules/api';
import { appConfig } from '../src/lib/config';
import type { CustomRequest, CustomFile } from '../src/modules/types';
import '../src/styles.css';
import '../src/modules/modules.css';
const STORE='10000000-0000-4000-8000-000000000001',MATERIAL='20000000-0000-4000-8000-000000000001',PRODUCT='30000000-0000-4000-8000-000000000001';
const items=[{id:MATERIAL,storeId:STORE,name:'PLA azul',unit:'g' as const,itemType:'other' as const,currentQuantity:1000,averageUnitCost:.1,lastUnitCost:.1,reorderPoint:100,active:true,createdAt:'2026-11-27',updatedAt:'2026-11-27'}];
let jobs:PrintJob[]=[],records:PrintRecord[]=[],requests:CustomRequest[]=[],files:CustomFile[]=[];
const operations=new Map<string,{id:string}>(),uploads=new Set<string>();
let defaults:any=undefined,failUpload=false;
const snapshot=()=>({items:structuredClone(items),jobs:structuredClone(jobs),orders:[],products:[{id:PRODUCT,name:'Chaveiro espacial'}],purchases:[],purchaseItems:[],costDefaults:defaults,workflowAvailable:true});
Object.assign(printingApi,{load:async()=>snapshot(),records:async(_store:string,job:string)=>records.filter(r=>r.job_id===job),command:async(_store:string,action:string,d:any,key:string)=>{
 if(operations.has(key))return operations.get(key);
 let j=jobs.find(j=>j.id===d.id),result={id:d.id||crypto.randomUUID()};
 if(action==='job_save'){if(d.source_fingerprint&&jobs.some(j=>j.id!==d.id&&j.source_fingerprint===d.source_fingerprint))throw new Error('Este arquivo e mesa já foram importados.');if(j)Object.assign(j,d,{revision:j.revision+1});else jobs.unshift({...d,id:result.id,status:'waiting',revision:0,request_id:null,retry_of:null,quote_snapshot:null,agreed_total_cents:null});}
 if(action==='job_classify'){if(!j)throw new Error('Ausente');Object.assign(j,d,{revision:j.revision+1});}
 if(action==='finish'||action==='correct'){if(!j)throw new Error('Ausente');const prior=records.find(r=>r.job_id===j!.id);const used=d.materials.reduce((n:number,l:any)=>n+l.quantity,0),old=prior?.materials.reduce((n,l)=>n+l.quantity,0)||0;items[0].currentQuantity+=old-used;Object.assign(j,{status:d.outcome,revision:j.revision+1});records.unshift({...d,id:crypto.randomUUID(),job_id:j.id,kind:action==='finish'?'finish':'correction',revision:j.revision,created_at:new Date().toISOString(),material_cost_cents:Math.round(used*10)});}
 if(action==='start'&&j)Object.assign(j,{status:'printing',revision:j.revision+1});
 if(action==='cost_defaults')defaults=d.costs;
 operations.set(key,result);return result;
}});
const realFetch=window.fetch.bind(window);
appConfig.turnstileSiteKey='local-test-fixture';
window.turnstile={render:(_container,options)=>{queueMicrotask(()=>options.callback?.('local-test-captcha'));return'fixture';},remove(){},reset(){}};
window.fetch=async(input,init)=>{
 if(!String(input).includes('/functions/v1/food-printing3d-public'))return realFetch(input,init);
 let data:any;const multipart=init?.body instanceof FormData;
 if(multipart){if(failUpload){failUpload=false;return Response.json({error:'Falha de anexo simulada. Tente novamente.'},{status:503});}const form=init!.body as FormData;const file=form.get('file') as File;const unique=String(form.get('request_id'))+':'+file.name;if(!uploads.has(unique)){uploads.add(unique);files.push({id:crypto.randomUUID(),request_id:String(form.get('request_id')),name:file.name,storage_path:'fixture/'+file.name,size_bytes:file.size});}data={id:form.get('request_id')};}
 else{const body=JSON.parse(String(init?.body));if(body.action==='assist')data={text:'Quero uma caixinha azul com tampa. Medidas, encaixe e material precisam ser confirmados com a loja. Será necessária modelagem e revisão.'};else{if(!requests.some(r=>r.id===body.request_id))requests.push({...body.data,id:body.request_id,store_id:STORE,organization_id:'fixture',status:'quote',notes:body.data.description,final_cents:null,quote:null});data={id:body.request_id};}}
 return Response.json(data);
};
Object.assign(modulesApi,{fileUrl:async()=>URL.createObjectURL(new Blob(['solid test\nendsolid test'],{type:'application/octet-stream'})),upload:async()=>{}});
function App(){const [view,setView]=useState('admin'),[,refresh]=useState(0);return <MemoryRouter><main className="container food-modules" style={{padding:'24px 12px'}}><h1>Validação local de impressão 3D</h1><p>Dados fictícios. Nenhuma alteração é enviada à loja ou à IA real.</p><nav className="module-actions"><button className="button" onClick={()=>{setView('admin');refresh(n=>n+1);}}>Lojista</button><button className="button" onClick={()=>setView('client')}>Cliente</button><button className="button" onClick={()=>{failUpload=true;alert('A próxima tentativa de anexo vai falhar uma vez.');}}>Simular falha de anexo</button></nav>{view==='admin'?<PrintingWorkspace key="admin" store={STORE} requests={requests} files={files} command={async()=>true} busy={false} urgencyBps={0} reload={async()=>{refresh(n=>n+1);}} onError={alert}/>:<PrintCustomRequest store={STORE}/>}</main></MemoryRouter>;}
createRoot(document.getElementById('root')!).render(<App/>);
