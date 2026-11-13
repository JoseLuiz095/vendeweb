import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('conversa pertence ao pedido e não fica acessível pelas credenciais públicas', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.food_store_users(store_id uuid,user_id uuid,role text,active boolean default true,must_change_password boolean default false);
      create table public.food_orders(id uuid primary key, store_id uuid not null, order_number bigint default 1, status text default 'received', scheduled_for timestamptz);`);
    await db.exec(await readFile('supabase/migrations/20261110160940_food_order_conversations.sql', 'utf8'));
    const order = randomUUID(), store = randomUUID(), other = randomUUID(), actor = randomUUID();
    await db.query("insert into auth.users(id) values ($1)",[actor]);
    await db.query("insert into public.food_store_users(store_id,user_id,role) values ($1,$2,'owner')",[store,actor]);
    await db.query('insert into public.food_orders(id, store_id) values ($1,$2)', [order,store]);
    await assert.rejects(db.query('insert into public.food_order_conversations(order_id,store_id) values ($1,$2)', [order,other]));
    const result = await db.query('insert into public.food_order_conversations(order_id,store_id) values ($1,$2) returning id',[order,store]);
    const conversation = result.rows[0].id;
    await assert.rejects(db.query('insert into public.food_order_conversations(order_id,store_id) values ($1,$2)', [order,store]));
    await assert.rejects(db.query("insert into public.food_order_conversation_tokens(token_hash,conversation_id,expires_at) values ('token',$1,now())",[conversation]));
    const token1='a'.repeat(64), token2='b'.repeat(64), requestId=randomUUID();
    await db.query('select * from public.food_order_conversation_issue_v1($1,$2,$3,$4)',[store,order,actor,token1]);
    const sent=await db.query("select public.food_order_conversation_customer_v1($1,'send',$2,$3) result",[token1,'Olá',requestId]);
    assert.equal(sent.rows[0].result.messages.length,1);
    const replay=await db.query("select public.food_order_conversation_customer_v1($1,'send',$2,$3) result",[token1,'Olá',requestId]);
    assert.equal(replay.rows[0].result.messages.length,1);
    await assert.rejects(db.query("select public.food_order_conversation_customer_v1($1,'send',$2,$3)",[token1,'Mensagem alterada',requestId]),/REQUEST_CONFLICT/);
    const staffRequest=randomUUID();
    await db.query("select public.food_order_conversation_staff_v1($1,$2,$3,'send',$4,$5)",[store,order,actor,'Resposta',staffRequest]);
    const thread=await db.query("select public.food_order_conversation_customer_v1($1,'list') result",[token1]);
    assert.equal(thread.rows[0].result.messages.length,2);
    await assert.rejects(db.query("select public.food_order_conversation_staff_v1($1,$2,$3,'list')",[other,order,actor]),/ACCESS_DENIED/);
    await db.query('select * from public.food_order_conversation_issue_v1($1,$2,$3,$4)',[store,order,actor,token2]);
    await assert.rejects(db.query("select public.food_order_conversation_customer_v1($1,'list')",[token1]),/INVALID_ACCESS/);
    await assert.rejects(db.query('select * from public.food_order_conversation_issue_v1($1,$2,$3,$4)',[other,order,actor,'c'.repeat(64)]),/ACCESS_DENIED/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.food_order_conversation_messages'));
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from public.food_order_conversation_tokens'));
  } finally { await db.close(); }
});
