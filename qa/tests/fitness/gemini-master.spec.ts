import { test, expect } from '@playwright/test';

test('master can explicitly run a Gemini connection check',async({page})=>{
 const user='20000000-0000-4000-8000-000000000001';
 await page.addInitScript(({user})=>{const exp=Math.floor(Date.now()/1000)+3600;const enc=(value:string)=>btoa(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');const token=enc(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+enc(JSON.stringify({sub:user,role:'authenticated',aal:'aal2',exp,amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]}))+'.c2lnbmF0dXJl';localStorage.setItem('foodservice.auth.v1',JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:user,email:'master@example.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},factors:[]}}));},{user});
 let calls=0;
 await page.route('https://*.supabase.co/**',route=>{const path=new URL(route.request().url()).pathname;let result:unknown=[];if(path==='/auth/v1/user') result={id:user,email:'master@example.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},factors:[]};else if(path.endsWith('/food_platform_admins'))result=[{id:'admin',user_id:user,name:'Master',active:true}];else if(path.endsWith('/food-gemini-diagnostic')){calls++;result={ok:true,model:'gemini-test',text:'Teste concluído.'};} return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});});
 await page.goto('/admin-master/diagnostico');
 await expect(page.getByRole('button',{name:'Testar conexão com Gemini'})).toBeVisible();expect(calls).toBe(0);
 await page.getByRole('button',{name:'Testar conexão com Gemini'}).click();
 await expect(page.getByText('Conexão confirmada.',{exact:false})).toBeVisible();expect(calls).toBe(1);
});
