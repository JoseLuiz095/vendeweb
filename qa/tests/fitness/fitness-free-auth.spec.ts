import { expect, test, type Page } from '@playwright/test';

const store='10000000-0000-4000-8000-000000000001';
const student='20000000-0000-4000-8000-000000000001';
const otherUser='20000000-0000-4000-8000-000000000002';
const client='30000000-0000-4000-8000-000000000001';
const factor='40000000-0000-4000-8000-000000000001';
const jwt=(id:string,aal='aal1')=>[
  Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),
  Buffer.from(JSON.stringify({sub:id,role:'authenticated',aal,exp:Math.floor(Date.now()/1000)+3600,session_id:'50000000-0000-4000-8000-000000000001',amr:[{method:'password',timestamp:1700000000}]})).toString('base64url'),
  'synthetic-signature',
].join('.');
const otherToken=jwt(otherUser);

async function mockFreeAccess(page:Page, options:{mfa?:boolean;rejectPassword?:boolean;settingsFailure?:boolean;phoneOnly?:boolean}={}) {
  const calls:{path:string;body:any;authorization:string}[]=[];
  let registered=false, settingsRequests=0;
  const user={id:student,aud:'authenticated',role:'authenticated',email:'student@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z',phone:options.phoneOnly?'+5527999991234':'',phone_confirmed_at:options.phoneOnly?'2026-11-01T00:00:00Z':null,app_metadata:{},user_metadata:{},factors:options.mfa?[{id:factor,status:'verified',factor_type:'totp',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'}]:[]};
  const session=(aal='aal1')=>({access_token:jwt(student,aal),refresh_token:'qa-refresh-only',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user});
  await page.addInitScript(({otherUser,otherToken})=>{
    localStorage.setItem('foodservice.auth.v1',JSON.stringify({access_token:otherToken,refresh_token:'other-qa-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:otherUser,aud:'authenticated',app_metadata:{},user_metadata:{}}}));
    (window as any).turnstile={render:(_element:any,opts:any)=>{queueMicrotask(()=>opts.callback('synthetic-qa-captcha'));return 'qa-widget';},reset:()=>{},remove:()=>{}};
  },{otherUser,otherToken});
  await page.route('https://*.supabase.co/**',async route=>{
    const request=route.request(), path=new URL(request.url()).pathname;
    const body=request.method()==='POST'?request.postDataJSON():null;
    const authorization=request.headers()['authorization']||'';
    if(body)calls.push({path,body,authorization});
    let result:any=[];
    if(path==='/auth/v1/settings') {
      settingsRequests++;
      if(options.settingsFailure&&settingsRequests===1)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
      result={external:{email:!options.phoneOnly,phone:Boolean(options.phoneOnly)}};
    }else if(path==='/auth/v1/user')result=authorization===`Bearer ${otherToken}`?{id:otherUser,aud:'authenticated',app_metadata:{},user_metadata:{}}:user;
    else if(path==='/auth/v1/token') {
      if(options.rejectPassword)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_code:'invalid_credentials',msg:'Invalid login credentials'})});
      result=session();
    }else if(path==='/auth/v1/otp')result={};
    else if(path==='/auth/v1/verify')result=session();
    else if(path===`/auth/v1/factors/${factor}/challenge`)result={id:'60000000-0000-4000-8000-000000000001',expires_at:Math.floor(Date.now()/1000)+300};
    else if(path===`/auth/v1/factors/${factor}/verify`)result=session('aal2');
    else if(path.endsWith('/food_fitness_student_status_v1'))result={registered,store_id:store,client_id:registered?client:undefined,name:registered?'Aluno QA':undefined};
    else if(path.endsWith('/food_fitness_register_student')){registered=true;result={store_id:store,client_id:client,professional:false};}
    else if(path.endsWith('/food_fitness_student_session_v1'))result={authorized:true};
    else if(path.endsWith('/food_fitness_my_appointments'))result={appointments:[]};
    else if(path.endsWith('/food_fitness_student_authorization_list'))result={professionals:[]};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  return calls;
}

async function enterEmail(page:Page) {
  await page.getByRole('textbox',{name:'E-mail',exact:true}).fill('student@example.invalid');
  await page.getByLabel('Senha',{exact:true}).fill('Qa-only-password-123!');
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
}

for(const width of [320,390,768,1280])test(`Fitness free access: email, recuperação assistida e sessão separada ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const calls=await mockFreeAccess(page);
  await page.goto(`/fitness/${store}/treinos`);
  await expect(page.getByRole('textbox',{name:'E-mail',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Receber código por SMS'})).toHaveCount(0);
  await page.getByRole('link',{name:'Esqueci minha senha',exact:true}).click();
  await expect(page.getByText(/A recuperação de senha é assistida nesta etapa/)).toBeVisible();
  expect(calls.filter(c=>/recover|otp|signup/.test(c.path))).toHaveLength(0);
  await enterEmail(page);
  await expect(page.getByRole('textbox',{name:'Seu nome',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Seu nome',exact:true}).fill('Aluno QA');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Olá, Aluno QA'})).toBeVisible();
  const login=calls.find(c=>c.path==='/auth/v1/token');
  expect(login?.body.email).toBe('student@example.invalid');
  expect(login?.body.gotrue_meta_security?.captcha_token).toBe('synthetic-qa-captcha');
  const register=calls.find(c=>c.path.endsWith('/food_fitness_register_student'));
  expect(register?.body.p_store).toBe(store);
  expect(JSON.parse(Buffer.from((register?.authorization||'').split(' ')[1].split('.')[1],'base64url').toString()).sub).toBe(student);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('foodservice.auth.v1')||'{}').user?.id)).toBe(otherUser);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
});

test('Fitness free access: senha inválida não consulta dados do aluno',async({page})=>{
  const calls=await mockFreeAccess(page,{rejectPassword:true});
  await page.goto(`/fitness/${store}/treinos`);await enterEmail(page);
  await expect(page.getByRole('alert')).toContainText('Não foi possível entrar.');
  await expect(page.getByLabel('Senha',{exact:true})).toHaveValue('');
  expect(calls.filter(c=>c.path.includes('food_fitness_'))).toHaveLength(0);
});

test('Fitness free access: configuração indisponível exige retry sem presumir SMS',async({page})=>{
  await mockFreeAccess(page,{settingsFailure:true});await page.goto(`/fitness/${store}/treinos`);
  await expect(page.getByRole('alert')).toContainText('Não foi possível consultar');
  await expect(page.getByRole('button',{name:'Receber código por SMS'})).toHaveCount(0);
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'E-mail',exact:true})).toBeVisible();
});

test('Fitness free access: conta com MFA precisa do segundo fator antes do cadastro',async({page})=>{
  const calls=await mockFreeAccess(page,{mfa:true});await page.goto(`/fitness/${store}/treinos`);await enterEmail(page);
  await expect(page.getByRole('textbox',{name:'Código do autenticador',exact:true})).toBeVisible();
  expect(calls.filter(c=>c.path.includes('food_fitness_'))).toHaveLength(0);
  await page.getByRole('textbox',{name:'Código do autenticador',exact:true}).fill('123456');
  await page.getByRole('button',{name:'Confirmar segundo fator',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Seu nome',exact:true})).toBeVisible();
  expect(calls.some(c=>c.path.endsWith(`/factors/${factor}/verify`))).toBeTruthy();
});

test('Fitness free access: SMS legado só aparece quando habilitado',async({page})=>{
  const calls=await mockFreeAccess(page,{phoneOnly:true});await page.goto(`/fitness/${store}/treinos`);
  await expect(page.getByRole('textbox',{name:'E-mail',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Telefone',exact:true}).fill('27999991234');
  await page.getByRole('button',{name:'Receber código por SMS',exact:true}).click();
  await page.getByRole('textbox',{name:'Código de acesso',exact:true}).fill('123456');
  await page.getByRole('button',{name:'Confirmar código',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Seu nome',exact:true})).toBeVisible();
  expect(calls.find(c=>c.path==='/auth/v1/otp')?.body.phone).toBe('+5527999991234');
});
