import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { mockBackend, STORE } from './fixtures';
const points=[{id:'10000000-0000-4000-8000-000000000010',name:'Centro',short_code:'CENTRO'},{id:'10000000-0000-4000-8000-000000000020',name:'Bairro',short_code:'BAIRRO'}];
test('plaquinha acompanha ponto, contato e QR sem misturar lojas ou pontos',async({page})=>{
 await mockBackend(page,{auth:true});
 await page.route('**/rest/v1/rpc/food_get_public_pickup_locations_v1',route=>route.fulfill({json:points}));
 await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',route=>{const data=route.request().postDataJSON();expect(data.p_store_id).toBe(STORE);const a=data.p_pickup_location_id===points[0].id;return route.fulfill({json:{mode:'point',contacts:[{slot:1,name:a?'Ana Centro':'Bia Bairro',phone:a?'5527999991111':'5527999992222'}]}})});
 await page.setViewportSize({width:390,height:844});await page.goto('/admin/produtos');await page.getByRole('button',{name:'Compartilhar loja com QR Code e link'}).click();const dialog=page.getByRole('dialog');const select=dialog.getByLabel('Página para compartilhar');await expect(select.locator('option')).toHaveCount(3);
 for(const [i,p] of points.entries()){
  await select.selectOption(p.id);if(i===0)await dialog.getByText('Gerar panfleto do ponto').click();const poster=dialog.getByRole('img',{name:`Prévia da plaquinha de ${p.name}`});await expect(poster).toBeVisible();await expect(dialog.getByText(i?'Bia Bairro':'Ana Centro',{exact:false})).toBeVisible();
  const url=await dialog.getByLabel('Link para compartilhar').inputValue();expect(new URL(url).searchParams.get('ponto')).toBe(p.short_code);const matrix=QRCode.create(url,{errorCorrectionLevel:'M'}).modules;
  const pixels=await poster.evaluate((node:HTMLImageElement,size:number)=>{const c=document.createElement('canvas');c.width=node.naturalWidth;c.height=node.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(node,0,0);const scale=680/(size+8),out:number[]=[];for(let y=0;y<size;y++)for(let x=0;x<size;x++)out.push(ctx.getImageData(Math.floor(280+(x+4.5)*scale),Math.floor(500+(y+4.5)*scale),1,1).data[0]<128?1:0);return out;},matrix.size);
  expect(pixels.filter((bit,index)=>bit!==matrix.data[index])).toHaveLength(0);await expect(dialog.getByRole('link',{name:'Baixar imagem'})).toHaveAttribute('download',`placa-${p.short_code.toLowerCase()}.png`);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
