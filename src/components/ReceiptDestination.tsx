import { useEffect, useState } from 'react';
import { getReceiptDestinations, type ReceiptDestinations } from '../services/receiptContactsApi';
import { getWhatsAppUrl } from '../utils/whatsapp';
import './receipt-contacts.css';

type Props = {
  storeId?: string;
  pointId?: string;
  destinations?: ReceiptDestinations;
  legacyPhone?: string;
  message: string;
  onOpen?: () => void;
  receiptToken?: string;
  requireReceiptToken?: boolean;
  onReported?: (autoPickedUp: boolean) => void;
};

export default function ReceiptDestination({
  storeId, pointId, destinations, legacyPhone = '', message, onOpen, receiptToken,
}: Props) {
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState({ key: '', id: '' });
  const key = (storeId || '') + ':' + (pointId || '') + ':' + (receiptToken || '');
  const [state, setState] = useState<{ key: string; data?: ReceiptDestinations; loading: boolean; error: string }>({
    key: '', loading: true, error: '',
  });

  useEffect(() => {
    let active = true;
    setChoice({ key, id: '' });
    if (destinations) {
      setState({ key, data: destinations, loading: false, error: '' });
      return;
    }
    if (!storeId) {
      setState({ key, data: { mode: 'general', contacts: [] }, loading: false, error: '' });
      return;
    }
    setState({ key, loading: true, error: '' });
    void getReceiptDestinations(storeId, pointId)
      .then(data => { if (active) setState({ key, data, loading: false, error: '' }); })
      .catch(() => {
        if (active) setState({ key, loading: false, error: 'Não foi possível consultar o destino do comprovante. Tente novamente.' });
      });
    return () => { active = false; };
  }, [key, storeId, pointId, destinations, attempt]);

  const data = state.key === key ? state.data : undefined;
  const contacts = data?.contacts || [];
  const contactId = (contact: (typeof contacts)[number]) => (contact.pointId || '') + ':' + contact.slot;
  const selected = contacts.length === 1 ? contacts[0] : contacts.find(contact => choice.key === key && choice.id === contactId(contact));
  const fallback = (data?.mode === 'general' || data?.mode === 'unassigned')
    && contacts.length === 0
    && /^[1-9][0-9]{9,14}$/.test(legacyPhone.replace(/\D/g, ''))
    ? legacyPhone : '';
  const phone = selected?.phone || fallback;

  return <section className="receipt-destination" aria-label="Enviar comprovante">
    <h2>Envie o comprovante à loja</h2>
    {state.key !== key || state.loading
      ? <p role="status">Consultando contato…</p>
      : state.error
        ? <><p role="alert">{state.error}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Tentar consultar contatos</button></>
        : <>
          {data?.mode === 'unavailable'
            ? <p>O destino do comprovante não está disponível. Fale com a loja para conferir o número.</p>
            : <>
              {data?.mode === 'unassigned' && <p>{fallback
                ? 'Este ponto não tem WhatsApp exclusivo. O comprovante será enviado ao WhatsApp da loja.'
                : 'Este ponto ainda não tem contato definido. Solicite o número correto ao local.'}</p>}
              {data?.mode === 'selection' && contacts.length > 0 && <p>A loja não cadastrou WhatsApp próprio. Escolha o ponto que receberá o comprovante.</p>}
              {contacts.length > 1 && <label>Destino do comprovante
                <select value={selected ? contactId(selected) : ''} onChange={event => setChoice({ key, id: event.target.value })}>
                  <option value="">Selecione um destino</option>
                  {contacts.map(contact => <option key={contactId(contact)} value={contactId(contact)}>{contact.name}</option>)}
                </select>
              </label>}
              {selected && <p>Destino: <strong>{selected.name}</strong> · +{selected.phone}</p>}
              {phone
                ? <a className="primary-button" href={getWhatsAppUrl(phone, message)} target="_blank" rel="noopener noreferrer" onClick={onOpen}>
                  Abrir WhatsApp e enviar comprovante
                </a>
                : contacts.length > 1 && !selected
                  ? <button type="button" disabled>Selecione um destino para enviar o comprovante</button>
                  : !phone && data?.mode !== 'unassigned' && <p>A loja ainda não cadastrou um destino para comprovantes.</p>}
            </>}
        </>}
    <p>Aguardando confirmação da loja. Enviar o comprovante não verifica o recebimento bancário.</p>
    <p>Depois de pagar, anexe o comprovante na conversa do WhatsApp.</p>
  </section>;
}

