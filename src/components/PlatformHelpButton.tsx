import { MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadAdminSupportContact } from '../services/supportApi';

export function PlatformHelpButton({assistant=false}:{assistant?:boolean}){
  const [phone,setPhone]=useState('');
  useEffect(()=>{
    let active=true;
    if(!assistant)void loadAdminSupportContact().then((value)=>{if(active)setPhone(value)}).catch(()=>undefined);
    return()=>{active=false};
  },[assistant]);
  if(assistant)return <Link className="foodweb-help-fab admin-only-help" to="/admin/ia" aria-label="Abrir assistente de ajuda"><MessageCircle size={21}/><span>Ajuda</span></Link>;
  if(!phone)return null;
  const normalized=(phone.length===10||phone.length===11)&&!phone.startsWith('55')?`55${phone}`:phone;
  const message=encodeURIComponent('Olá! Sou lojista e preciso de suporte com a VendeWeb.');
  return <a className="foodweb-help-fab admin-only-help" href={`https://wa.me/${normalized}?text=${message}`} target="_blank" rel="noreferrer" aria-label="Abrir suporte da VendeWeb no WhatsApp"><MessageCircle size={21}/><span>Suporte</span></a>;
}
