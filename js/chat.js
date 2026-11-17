import { supabase, isConfigured } from './supabaseClient.js';

const CHAT_BUILD = '20261117-10';

function syncChatViewport() {
  const height = Math.round(window.visualViewport?.height || window.innerHeight);
  document.documentElement.style.setProperty('--chat-viewport-height', `${height}px`);
}
syncChatViewport();
window.addEventListener('resize', syncChatViewport);
window.visualViewport?.addEventListener('resize', syncChatViewport);
window.visualViewport?.addEventListener('scroll', syncChatViewport);

async function activateCurrentServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register(`/sw.js?v=${CHAT_BUILD}`, { scope:'/', updateViaCache:'none' });
  registration.update().catch(error => console.warn('No se pudo buscar una actualización de la aplicación:', error));
}

activateCurrentServiceWorker().catch(error => console.warn('No se pudo actualizar la aplicación instalada:', error));

async function returnToChats(event) {
  event.preventDefault();
  activateCurrentServiceWorker().catch(error => console.warn('No se pudo actualizar la aplicación instalada:', error));
  location.replace(`index.html?v=${CHAT_BUILD}&from=chat&cache=${Date.now()}#chats`);
}

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const id = new URLSearchParams(location.search).get('id');

let userId = null;
let otherUser = null;
let channel = null;
let request = null;
let transaction = null;
let loanRequest = null;
let loan = null;
let ratings = [];
let currentMessages = [];
let chatEvents = [];
let refreshTimer = null;
let fallbackRefreshTimer = null;
let pendingMessage = null;
let loanPeople = new Map();
let ratingModalDismissed = false;
let selectedRatingScore = 0;

const safe = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const one = value => Array.isArray(value) ? value[0] : value;

const formatTime = value => {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
};

const formatDateShort = value => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = value => {
  if (!value) return 'Sin registrar';
  return `${formatDateShort(value)}, ${formatTime(value)}`;
};

const paymentLabel = method => ({ CASH: 'Efectivo', TRANSFER: 'Transferencia', OTHER: 'Otro' }[method] || method || '');

const toast = (message, type = '') => {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toast-root').append(node);
  setTimeout(() => node.remove(), 4000);
};

function avatar(profile) {
  return profile?.avatar_url
    ? `<img class="avatar" src="${safe(profile.avatar_url)}" alt="${safe(profile.name)}" />`
    : `<span class="avatar avatar-fallback" aria-label="${safe(profile?.name || 'Usuario')}">${safe((profile?.name || '?').slice(0, 1).toUpperCase())}</span>`;
}

// Iconos de estado de mensaje: Enviando, Enviado, Recibido (sobre naranja), Visto (ojo)
function messageStateIcon(message) {
  if (!message.own) return '';
  if (message.pending) {
    return `<span class="msg-status-icon" title="Enviando" aria-label="Enviando">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>
    </span>`;
  }
  const receipt = one(message.message_receipts);
  if (receipt?.read_at) {
    return `<span class="msg-status-icon" title="Visto" aria-label="Visto">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
    </span>`;
  }
  if (receipt?.delivered_at) {
    return `<span class="msg-status-icon" title="Recibido" aria-label="Recibido">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="#e66c2c" stroke="#123f4b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>
    </span>`;
  }
  return `<span class="msg-status-icon" title="Enviado" aria-label="Enviado">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>
  </span>`;
}

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(value) {
  const now = new Date();
  const target = new Date(value);
  if (dayKey(now) === dayKey(target)) return 'Hoy';
  return formatDateShort(target);
}

function buildTimelineItems(messages) {
  const items = [];

  messages.forEach(msg => {
    items.push({
      kind: 'message',
      created_at: msg.created_at,
      data: { ...msg, own: msg.sender_id === userId }
    });
  });

  if (pendingMessage) {
    items.push({
      kind: 'message',
      created_at: new Date().toISOString(),
      data: { sender_id: userId, content: pendingMessage, created_at: new Date().toISOString(), own: true, pending: true }
    });
  }

  const fallbackEvents = [];
  if (!chatEvents.length) {
    if (transaction?.meeting_at) {
      fallbackEvents.push({
        event_type: 'TRANSACTION_MEETING',
        created_at: transaction.meeting_at,
        details: { point: transaction.meeting_points?.name, at: transaction.meeting_at, payment_method: transaction.payment_method }
      });
    }
    if (loan?.meeting_at) {
      fallbackEvents.push({
        event_type: 'LOAN_DELIVERY_MEETING',
        created_at: loan.meeting_at,
        details: { point: loan.delivery_point?.name, at: loan.meeting_at }
      });
    }
    if (loan?.return_meeting_at) {
      fallbackEvents.push({
        event_type: 'LOAN_RETURN_MEETING',
        created_at: loan.return_meeting_at,
        details: { point: loan.return_point?.name, at: loan.return_meeting_at }
      });
    }
  }

  (chatEvents.length ? chatEvents : fallbackEvents).forEach(ev => {
    items.push({
      kind: 'schedule',
      created_at: ev.created_at || ev.details?.at || new Date().toISOString(),
      data: ev
    });
  });

  // Confirmaciones de procesos
  if (transaction) {
    if (transaction.delivered_at) {
      items.push({
        kind: 'confirmed',
        created_at: transaction.delivered_at,
        label: 'Entrega confirmada'
      });
    }
    if (transaction.received_at) {
      items.push({
        kind: 'confirmed',
        created_at: transaction.received_at,
        label: 'Recepción confirmada'
      });
    }
  }

  if (loan) {
    if (loan.lender_delivered_at) {
      items.push({
        kind: 'confirmed',
        created_at: loan.lender_delivered_at,
        label: 'Entrega confirmada'
      });
    }
    if (loan.requester_received_at) {
      items.push({
        kind: 'confirmed',
        created_at: loan.requester_received_at,
        label: 'Recepción confirmada'
      });
    }
    if (loan.requester_returned_at) {
      items.push({
        kind: 'confirmed',
        created_at: loan.requester_returned_at,
        label: 'Devolución confirmada'
      });
    }
    if (loan.lender_received_at) {
      items.push({
        kind: 'confirmed',
        created_at: loan.lender_received_at,
        label: 'Última recepción confirmada'
      });
    }
  }

  // Mensajes de calificaciones enviadas y recibidas
  ratings.forEach(r => {
    const isMine = r.rater_id === userId;
    const otherName = otherUser?.name || 'Nombre de usuario';
    const stars = '★'.repeat(r.score) + '☆'.repeat(5 - r.score);
    items.push({
      kind: 'rating',
      created_at: r.created_at || new Date().toISOString(),
      text: isMine ? `Calificaste a ${otherName}:` : `${otherName} te calificó:`,
      stars
    });
  });

  items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return items;
}

function canReprogramEvent(eventType) {
  if (transaction) {
    return eventType === 'TRANSACTION_MEETING' && ['PENDING', 'SCHEDULED'].includes(transaction.status) && !transaction.delivered_at && !transaction.received_at;
  }
  if (loan) {
    if (eventType === 'LOAN_DELIVERY_MEETING') {
      return ['SELECTED', 'SCHEDULED'].includes(loan.status) && !loan.lender_delivered_at && !loan.requester_received_at;
    }
    if (eventType === 'LOAN_RETURN_MEETING') {
      return ['ACTIVE', 'RETURN_PENDING'].includes(loan.status) && !loan.requester_returned_at && !loan.lender_received_at;
    }
  }
  return false;
}

function renderScheduleCard(event) {
  const details = event.details || {};
  const isReturn = event.event_type === 'LOAN_RETURN_MEETING';
  const title = isReturn ? 'Devolución programada' : 'Encuentro programado';
  const isSale = request?.kind === 'SALE';
  const paymentText = isSale && details.payment_method ? `<br>Método de pago: ${safe(paymentLabel(details.payment_method))}` : '';
  const isSuperseded = Boolean(event.superseded_at);
  const allowReprogram = !isSuperseded && canReprogramEvent(event.event_type);

  const footerLeft = isSuperseded
    ? '<span class="process-card-superseded-label">Programación sustituida</span>'
    : allowReprogram
      ? `<button type="button" class="process-card-link" data-open-schedule="${event.event_type}">Reprogramar encuentro</button>`
      : '<span></span>';

  return `<article class="process-card ${isSuperseded ? 'superseded' : ''}">
    <h3 class="process-card-title">${title}</h3>
    <p class="process-card-details">${safe(details.point || 'Punto por definir')}, ${formatDateTime(details.at)}${paymentText}</p>
    <div class="process-card-footer">
      ${footerLeft}
      <time class="process-card-time">${formatTime(event.created_at || details.at)}</time>
    </div>
  </article>`;
}

function renderMessages(messages) {
  const root = $('#messages');
  const previousScrollTop = root.scrollTop;
  const wasNearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 72;
  const timeline = buildTimelineItems(messages);

  if (!timeline.length) {
    root.innerHTML = '<div class="empty-state">Aún no hay mensajes. Comienza la coordinación.</div>';
    return;
  }

  let lastDay = '';
  const html = timeline.map(item => {
    const currentDay = dayKey(item.created_at);
    const chip = currentDay !== lastDay
      ? `<div class="chat-day-chip">${safe(dayLabel(item.created_at))}</div>`
      : '';
    lastDay = currentDay;

    if (item.kind === 'message') {
      const msg = item.data;
      return `${chip}<article class="message-bubble ${msg.own ? 'own' : 'received'}">
        <div class="message-bubble-text">${safe(msg.content)}</div>
        <div class="message-bubble-meta">
          ${messageStateIcon(msg)}
          <span>${formatTime(msg.created_at)}</span>
        </div>
      </article>`;
    }

    if (item.kind === 'schedule') {
      return `${chip}${renderScheduleCard(item.data)}`;
    }

    if (item.kind === 'confirmed') {
      return `${chip}<article class="process-confirmed-card">
        <strong>${safe(item.label)}</strong>
        <time>${formatTime(item.created_at)}</time>
      </article>`;
    }

    if (item.kind === 'rating') {
      return `${chip}<article class="process-confirmed-card">
        <span class="rating-line">${safe(item.text)} <span class="rating-stars">${item.stars}</span></span>
        <time>${formatTime(item.created_at)}</time>
      </article>`;
    }

    return '';
  }).join('');

  root.innerHTML = html;
  root.scrollTop = wasNearBottom ? root.scrollHeight : previousScrollTop;
}

function personName(personId) {
  return loanPeople.get(personId)?.name || 'Estudiante ITESA';
}

function updateHeaderAndControls() {
  const cancelBtn = $('#chat-cancel-btn');
  const banner = $('#operation-panel');
  const bar = $('#chat-process-bar');

  cancelBtn.hidden = true;
  banner.hidden = true;
  banner.innerHTML = '';
  bar.hidden = true;
  bar.innerHTML = '';

  // Flujo de Compra / Intercambio
  if (request) {
    const isSeller = request.seller_id === userId;

    if (request.status === 'PENDING') {
      banner.hidden = false;
      if (isSeller) {
        banner.innerHTML = `<strong>Solicitud pendiente</strong>
          <p>Revisa la propuesta y responde.</p>
          <div class="operation-banner-actions">
            <button type="button" class="button success compact" data-tx-action="accept">Aceptar</button>
            <button type="button" class="button secondary compact" data-tx-action="reject">Rechazar</button>
          </div>`;
      } else {
        banner.innerHTML = `<strong>Solicitud pendiente</strong>
          <p>Esperando respuesta del vendedor para iniciar el proceso.</p>`;
      }
      return;
    }

    if (request.status === 'REJECTED') {
      banner.hidden = false;
      banner.innerHTML = `<strong>Solicitud rechazada</strong><p>Esta operación no continuará. El historial se conserva.</p>`;
      return;
    }

    if (!transaction) return;

    if (transaction.status === 'CANCELLED') {
      banner.hidden = false;
      banner.innerHTML = `<strong>Operación cancelada</strong><p>El historial de coordinación se conserva.</p>`;
      return;
    }

    if (transaction.status === 'COMPLETED') {
      maybeOpenRatingModal();
      return;
    }

    // Cancelar visible solo después de aceptar y antes de confirmar entrega
    if (['PENDING', 'SCHEDULED'].includes(transaction.status) && !transaction.delivered_at && !transaction.received_at) {
      cancelBtn.hidden = false;
      cancelBtn.dataset.cancelKind = 'transaction';
    }

    const buttons = [];
    // (Re)Programar proceso visible para ambos hasta que el vendedor confirme entrega
    if (['PENDING', 'SCHEDULED'].includes(transaction.status) && !transaction.delivered_at) {
      const label = transaction.meeting_at ? 'Reprogramar proceso' : 'Programar proceso';
      buttons.push(`<button type="button" class="button" data-open-schedule="TRANSACTION_MEETING">${label}</button>`);
    }

    // Confirmar proceso según estado y rol
    if (transaction.status === 'SCHEDULED' && isSeller && !transaction.delivered_at) {
      buttons.push(`<button type="button" class="button btn-confirm-orange" data-tx-action="delivery">Confirmar entrega</button>`);
    } else if (transaction.status === 'DELIVERED' && !isSeller && !transaction.received_at) {
      buttons.push(`<button type="button" class="button btn-confirm-orange" data-tx-action="reception">Confirmar recepción</button>`);
    }

    if (buttons.length) {
      bar.hidden = false;
      bar.innerHTML = buttons.join('');
    }
    return;
  }

  // Flujo de Préstamos
  if (loanRequest) {
    const isRequester = loanRequest.requester_id === userId;

    if (!loan) {
      banner.hidden = false;
      if (loanRequest.status === 'OPEN') {
        const pending = (loanRequest.loan_offers || []).filter(o => o.status === 'PENDING');
        if (isRequester) {
          banner.innerHTML = `<strong>Solicitud pendiente</strong>
            <p>${pending.length ? 'Selecciona una propuesta para iniciar el préstamo.' : 'Aún no hay propuestas recibidas.'}</p>
            ${pending.map(offer => `<article class="list-card"><div><h3>${safe(personName(offer.lender_id))}</h3><p>${safe(offer.note || 'Sin mensaje adicional')}</p></div><div class="operation-banner-actions"><button type="button" class="button compact" data-loan-action="select-lender" data-offer-id="${offer.id}">Aceptar</button><button type="button" class="button button-outline compact" data-loan-action="reject-lender" data-offer-id="${offer.id}">Rechazar</button></div></article>`).join('')}`;
        } else {
          banner.innerHTML = `<strong>Propuesta pendiente</strong><p>Espera a que el solicitante acepte tu propuesta.</p>`;
        }
      } else {
        banner.innerHTML = `<strong>${loanRequest.status === 'EXPIRED' ? 'Solicitud vencida' : 'Solicitud cancelada'}</strong><p>El historial de coordinación se conserva.</p>`;
      }
      return;
    }

    const isLender = loan.lender_id === userId;
    const status = loan.status;

    if (status === 'CANCELLED') {
      banner.hidden = false;
      banner.innerHTML = `<strong>Préstamo cancelado</strong><p>El historial de coordinación se conserva.</p>`;
      return;
    }

    if (status === 'CLOSED') {
      maybeOpenRatingModal();
      return;
    }

    // Cancelar visible solo después de aceptar/seleccionar y antes de confirmar entrega
    if (['SELECTED', 'SCHEDULED'].includes(status) && !loan.lender_delivered_at && !loan.requester_received_at) {
      cancelBtn.hidden = false;
      cancelBtn.dataset.cancelKind = 'loan';
    }

    const buttons = [];

    // Fase 1: Entrega del préstamo
    if (['SELECTED', 'SCHEDULED'].includes(status) && !loan.lender_delivered_at) {
      const label = loan.meeting_at ? 'Reprogramar proceso' : 'Programar proceso';
      buttons.push(`<button type="button" class="button" data-open-schedule="LOAN_DELIVERY_MEETING">${label}</button>`);
    }

    // Fase 2: Devolución del préstamo (vuelve a aparecer tras confirmar la recepción inicial)
    if (['ACTIVE', 'RETURN_PENDING'].includes(status) && loan.requester_received_at && !loan.requester_returned_at) {
      const label = loan.return_meeting_at ? 'Reprogramar proceso' : 'Programar proceso';
      buttons.push(`<button type="button" class="button" data-open-schedule="LOAN_RETURN_MEETING">${label}</button>`);
    }

    // Botón de Confirmar proceso según etapa y rol
    if (status === 'SCHEDULED' && isLender && !loan.lender_delivered_at) {
      buttons.push(`<button type="button" class="button btn-confirm-orange" data-loan-action="delivery">Confirmar entrega</button>`);
    } else if (status === 'SCHEDULED' && isRequester && loan.lender_delivered_at && !loan.requester_received_at) {
      buttons.push(`<button type="button" class="button btn-confirm-orange" data-loan-action="reception">Confirmar recepción</button>`);
    } else if (status === 'RETURN_PENDING' && isRequester && !loan.requester_returned_at) {
      buttons.push(`<button type="button" class="button btn-confirm-orange" data-loan-action="return">Confirmar devolución</button>`);
    } else if (status === 'RETURN_PENDING' && isLender && loan.requester_returned_at && !loan.lender_received_at) {
      buttons.push(`<button type="button" class="button btn-confirm-orange" data-loan-action="return-reception">Confirmar recepción</button>`);
    }

    if (buttons.length) {
      bar.hidden = false;
      bar.innerHTML = buttons.join('');
    }
  }
}

async function openScheduleModal(eventType) {
  const { data: points } = await supabase.from('meeting_points').select('id,name').eq('active', true).order('name');
  const options = '<option value="">Seleccionar un punto</option>' + (points || []).map(p => `<option value="${p.id}">${safe(p.name)}</option>`).join('');
  const isSale = request?.kind === 'SALE';

  $('#chat-modal-root').innerHTML = `<div class="chat-modal-backdrop" id="schedule-backdrop">
    <section class="chat-modal-card" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
      <h2 id="schedule-modal-title">Programar o reprogramar proceso</h2>
      <form id="schedule-modal-form" data-event-type="${eventType}" class="auth-form">
        <div class="chat-modal-field">
          <label for="modal-meeting-point">Punto de encuentro</label>
          <select id="modal-meeting-point" required>${options}</select>
        </div>
        <div class="chat-modal-field">
          <label for="modal-meeting-at">Fecha y hora</label>
          <input id="modal-meeting-at" type="datetime-local" required />
        </div>
        ${isSale ? `<div class="chat-modal-field">
          <label for="modal-payment-method">Método de pago</label>
          <select id="modal-payment-method">
            <option value="CASH">Efectivo</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>` : ''}
        <div class="chat-modal-actions">
          <button type="submit" class="button btn-orange">Confirmar encuentro</button>
          <button type="button" class="button" data-close-chat-modal>Cancelar</button>
        </div>
      </form>
    </section>
  </div>`;
}

function maybeOpenRatingModal() {
  if (ratingModalDismissed) return;
  const alreadyRated = ratings.some(r => r.rater_id === userId);
  if (alreadyRated) return;
  if ($('#rating-backdrop')) return;

  const targetName = otherUser?.name || 'Nombre de usuario';
  selectedRatingScore = 0;

  const renderStars = score => [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="star-btn" data-star-value="${n}" aria-label="${n} estrella${n > 1 ? 's' : ''}">${n <= score ? '★' : '☆'}</button>`
  ).join('');

  $('#chat-modal-root').innerHTML = `<div class="chat-modal-backdrop" id="rating-backdrop">
    <section class="chat-modal-card" role="dialog" aria-modal="true" aria-labelledby="rating-modal-title">
      <h2 id="rating-modal-title">Califica a ${safe(targetName)}</h2>
      <div class="star-picker" id="star-picker">${renderStars(selectedRatingScore)}</div>
      <div class="chat-modal-actions">
        <button type="button" class="button btn-orange" id="submit-rating-btn">Enviar</button>
      </div>
    </section>
  </div>`;
}

function closeChatModal(markDismissed = false) {
  if (markDismissed) ratingModalDismissed = true;
  $('#chat-modal-root').innerHTML = '';
}

async function loadLoanPeople(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) {
    loanPeople = new Map();
    return;
  }
  const { data } = await supabase.from('public_profile_summaries').select('id,name').in('id', unique);
  loanPeople = new Map((data || []).map(person => [person.id, person]));
}

async function ensureLoanOfferInitialMessage() {
  if (!loanRequest || !loan) return;
  const acceptedOffer = (loanRequest.loan_offers || []).find(o => o.lender_id === loan.lender_id && o.note && o.note.trim());
  if (!acceptedOffer) return;

  const { data: existing } = await supabase.from('messages').select('id').eq('chat_id', id).limit(1);
  if (existing && existing.length > 0) return;

  await supabase.from('messages').insert({
    chat_id: id,
    sender_id: acceptedOffer.lender_id,
    content: acceptedOffer.note.trim()
  });
}

async function loadRatings() {
  if (transaction?.id) {
    const { data } = await supabase.from('ratings').select('rater_id,rated_id,score,created_at').eq('transaction_id', transaction.id);
    ratings = data || [];
    return;
  }
  if (loan?.id) {
    const { data, error } = await supabase.from('ratings').select('rater_id,rated_id,score,created_at').eq('loan_id', loan.id);
    if (!error) {
      ratings = data || [];
      return;
    }
  }
  ratings = [];
}

async function loadMessages() {
  const [{ data, error }, { data: events, error: eventsError }] = await Promise.all([
    supabase.from('messages').select('id,sender_id,content,created_at,message_receipts(recipient_id,delivered_at,read_at)').eq('chat_id', id).order('created_at'),
    supabase.from('chat_system_events').select('id,event_type,details,created_at,superseded_at').eq('chat_id', id).order('created_at')
  ]);
  if (error) return toast('No se pudieron cargar los mensajes.', 'error');
  if (eventsError) {
    // El resto del chat sigue disponible si la migración de eventos aún no se ha aplicado.
    console.warn('No se pudieron cargar los eventos de proceso:', eventsError.message);
    chatEvents = [];
  } else {
    chatEvents = events || [];
  }
  pendingMessage = null;
  currentMessages = data || [];
  renderMessages(currentMessages);
  markCurrentMessagesSeen();
}

async function clearChatNotification() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications();
    notifications.filter(notification => notification.tag === `chat-${id}` || notification.data?.url?.includes(`id=${id}`)).forEach(notification => notification.close());
  } catch (_) { /* El chat sigue funcionando cuando el navegador no expone notificaciones activas. */ }
}

async function markCurrentMessagesSeen() {
  const incomingIds = currentMessages.filter(message => message.sender_id !== userId).map(message => message.id);
  if (!incomingIds.length) return clearChatNotification();
  const { error } = await supabase.rpc('mark_chat_messages_seen', { p_chat_id: id });
  if (error) {
    const now = new Date().toISOString();
    await supabase.from('message_receipts').update({ delivered_at:now, read_at:now }).eq('recipient_id', userId).in('message_id', incomingIds).is('read_at', null);
  }
  clearChatNotification();
}

function queueReload() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(true), 40);
}

function startFallbackRefresh() {
  clearInterval(fallbackRefreshTimer);
  fallbackRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') load(true);
  }, 10000);
}

async function openOtherUserProfile() {
  if (!otherUser?.id) return;
  const [{ data: profiles, error }, { data: publications }, { data: summary }] = await Promise.all([
    supabase.rpc('get_public_profile', { p_profile_id: otherUser.id }),
    supabase.from('publications').select('id,title,description,condition,price,stock,operation_type,status,created_at,publication_images(public_url,position)').eq('owner_id', otherUser.id).eq('status', 'AVAILABLE').order('created_at', { ascending: false }),
    supabase.from('public_profile_summaries').select('career_id').eq('id', otherUser.id).maybeSingle()
  ]);
  const profile = profiles?.[0];
  if (error || !profile) return toast('Este perfil no está disponible.', 'error');
  const score = Math.round(Number(profile.rating_average || 0));
  const stars = '★'.repeat(score) + '☆'.repeat(5 - score);
  const career = summary?.career_id ? 'ITESA' : 'ITESA';
  const cards = (publications || []).map(item => {
    const image = [...(item.publication_images || [])].sort((a, b) => (a.position || 0) - (b.position || 0))[0];
    const price = item.operation_type === 'SALE' ? `$${Number(item.price || 0).toFixed(2)}` : 'Intercambio';
    return `<article class="product-card social-card"><header class="card-owner">${avatar(profile)}<span class="owner-info"><span class="owner-name">${safe(profile.name || 'Nombre de usuario')}</span><span class="owner-career">Carrera: ${career}</span></span></header><div class="product-gallery"><div class="product-image">${image?.public_url ? `<img src="${safe(image.public_url)}" alt="${safe(item.title)}" />` : 'Sin imagen'}</div></div><div class="product-body"><div class="product-name-price"><p class="product-title">${safe(item.title)}</p><p class="product-price">${price}</p></div><details class="card-details"><div class="card-details-body"><p>${safe(item.description || 'Sin descripción')}</p><p>${item.stock} disponible(s).</p></div><summary>Ver más detalles</summary></details></div></article>`;
  }).join('') || '<p class="muted">No tiene publicaciones disponibles.</p>';
  $('#chat-modal-root').innerHTML = `<div class="chat-modal-backdrop" id="profile-backdrop">
    <section class="chat-modal-card chat-public-profile public-profile" role="dialog" aria-modal="true" aria-labelledby="chat-profile-title">
      ${avatar(profile)}
      <h2 id="chat-profile-title">${safe(profile.name || 'Usuario')}</h2>
      <p class="muted">${safe(profile.email || '')}</p>
      <p>${stars} ${Number(profile.rating_average || 0).toFixed(1)} / 5</p>
      <div class="chat-profile-actions"><button type="button" class="button" data-chat-profile-action="chat">Chatear</button><button type="button" class="button secondary" data-chat-profile-action="block">Bloquear</button><button type="button" class="button secondary" data-chat-profile-action="report">Reportar</button></div>
      <h3>Publicaciones</h3>
      <div class="chat-publications">${cards}</div>
      <div class="chat-modal-actions"><button type="button" class="button" data-close-chat-modal>Cerrar</button></div>
    </section>
  </div>`;
}

async function syncPresence() {
  if (userId && id) {
    await supabase.from('active_chat_sessions').upsert(
      { user_id: userId, chat_id: id, expires_at: new Date(Date.now() + 25000).toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id,chat_id' }
    );
  }
}

async function load(keepChannel = false) {
  if (!isConfigured) return toast('Configura Supabase para usar el chat.', 'error');
  if (!id) return toast('No se encontró el chat solicitado.', 'error');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.href = 'index.html#chats';
    return;
  }
  userId = session.user.id;

  const query = 'id,participant_a,participant_b,transaction_requests(id,buyer_id,seller_id,kind,note,status,publications(title),transactions(id,status,meeting_at,payment_method,delivered_at,received_at,meeting_points(name))),loan_requests(id,title,requester_id,status,loan_offers(id,lender_id,note,status),loans(id,requester_id,lender_id,status,meeting_at,expected_return_at,lender_delivered_at,requester_received_at,requester_returned_at,lender_received_at,closed_at,return_meeting_at,delivery_point:meeting_points!loans_meeting_point_id_fkey(name),return_point:meeting_points!loans_return_meeting_point_id_fkey(name)))';
  const { data: chat, error } = await supabase.from('chats').select(query).eq('id', id).single();

  if (error || ![chat?.participant_a, chat?.participant_b].includes(userId)) {
    toast('No tienes acceso a este chat.', 'error');
    return;
  }

  request = one(chat.transaction_requests);
  loanRequest = one(chat.loan_requests);
  transaction = one(request?.transactions);
  loan = one(loanRequest?.loans);

  const otherId = chat.participant_a === userId ? chat.participant_b : chat.participant_a;
  const messagesPromise = loadMessages();
  const ratingsPromise = loadRatings();
  const profilePromise = supabase.from('public_profile_summaries').select('id,name,avatar_url').eq('id', otherId).maybeSingle();
  const loanPeoplePromise = loanRequest ? loadLoanPeople([
      loanRequest.requester_id,
      loan?.requester_id,
      loan?.lender_id,
      ...(loanRequest.loan_offers || []).map(offer => offer.lender_id)
    ]) : Promise.resolve();
  const { data: profileSummary } = await profilePromise;
  otherUser = profileSummary || { id: otherId, name: 'Usuario' };

  $('#chat-user-name').textContent = otherUser.name || 'Nombre del usuario';
  $('#chat-product-name').textContent = request?.publications?.title || loanRequest?.title || 'Nombre del producto';
  $('#chat-avatar').outerHTML = `<span id="chat-avatar">${avatar(otherUser)}</span>`;

  if (loanRequest) await ensureLoanOfferInitialMessage();
  await Promise.all([messagesPromise, ratingsPromise, loanPeoplePromise]);

  updateHeaderAndControls();
  renderMessages(currentMessages);

  if (channel && !keepChannel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
  if (!channel) {
    channel = supabase.channel(`chat:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${id}` }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_requests' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_requests' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_offers' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_receipts' }, queueReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_system_events', filter: `chat_id=eq.${id}` }, queueReload)
      .subscribe();
  }
}

$('#message-input').addEventListener('input', event => {
  event.target.style.height = 'auto';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
});

$('#message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#message-input');
  const content = input.value.trim();
  if (!content) return;

  pendingMessage = content;
  const { data: currentMessages } = await supabase.from('messages').select('id,sender_id,content,created_at,message_receipts(recipient_id,delivered_at,read_at)').eq('chat_id', id).order('created_at');
  renderMessages(currentMessages || []);

  input.value = '';
  input.style.height = 'auto';

  const { data: sent, error } = await supabase.from('messages').insert({ chat_id: id, sender_id: userId, content }).select('id').single();
  if (error) {
    pendingMessage = null;
    toast(error.message, 'error');
    return loadMessages();
  }
  if (sent?.id) {
    supabase.functions.invoke('send-push', { body: { messageId: sent.id } }).then(({ error }) => { if (error) console.warn('No se pudo enviar la notificación push:', error.message); });
  }
  loadMessages();
});

document.addEventListener('submit', async event => {
  if (event.target.id === 'schedule-modal-form') {
    event.preventDefault();
    const eventType = event.target.dataset.eventType;
    const point = $('#modal-meeting-point')?.value;
    const at = $('#modal-meeting-at')?.value;
    if (!point || !at) return toast('Selecciona punto, fecha y hora.', 'error');

    let error;
    if (eventType === 'TRANSACTION_MEETING') {
      const payment = $('#modal-payment-method')?.value || 'CASH';
      ({ error } = await supabase.rpc('schedule_transaction', {
        p_transaction_id: transaction.id,
        p_meeting_point_id: point,
        p_meeting_at: new Date(at).toISOString(),
        p_payment_method: payment
      }));
    } else if (eventType === 'LOAN_DELIVERY_MEETING') {
      ({ error } = await supabase.rpc('schedule_loan', {
        p_loan_id: loan.id,
        p_meeting_point_id: point,
        p_meeting_at: new Date(at).toISOString()
      }));
    } else if (eventType === 'LOAN_RETURN_MEETING') {
      ({ error } = await supabase.rpc('schedule_loan_return', {
        p_loan_id: loan.id,
        p_return_meeting_point_id: point,
        p_return_meeting_at: new Date(at).toISOString()
      }));
    }

    if (error) return toast(error.message, 'error');
    closeChatModal();
    toast('Encuentro programado.', 'success');
    load(true);
  }
});

document.addEventListener('click', async event => {
  if (event.target.closest('#chat-back')) return returnToChats(event);

  // Abrir modal de programar / reprogramar
  const openScheduleBtn = event.target.closest('[data-open-schedule]');
  if (openScheduleBtn) {
    return openScheduleModal(openScheduleBtn.dataset.openSchedule);
  }

  // Cerrar modal
  if (event.target.closest('[data-close-chat-modal]') || event.target.id === 'schedule-backdrop') {
    return closeChatModal(false);
  }

  if (event.target.closest('#chat-profile-button')) {
    return openOtherUserProfile();
  }

  const profileAction = event.target.closest('[data-chat-profile-action]')?.dataset.chatProfileAction;
  if (profileAction === 'chat') return closeChatModal(false);
  if (profileAction === 'block' || profileAction === 'report') {
    const reason = prompt(profileAction === 'block' ? 'Indica brevemente el motivo del bloqueo:' : 'Indica el motivo del reporte:');
    if (reason === null) return;
    if (reason.trim().length < 2) return toast('Indica un motivo de al menos dos caracteres.', 'error');
    const table = profileAction === 'block' ? 'user_blocks' : 'user_reports';
    const payload = profileAction === 'block'
      ? { blocker_id: userId, blocked_id: otherUser.id, reason: reason.trim() }
      : { reporter_id: userId, reported_user_id: otherUser.id, reason: reason.trim() };
    const { error } = await supabase.from(table).insert(payload);
    if (error) return toast(error.code === '23505' ? 'Esta acción ya fue registrada.' : error.message, 'error');
    toast(profileAction === 'block' ? 'Usuario bloqueado.' : 'Reporte enviado.', 'success');
    return closeChatModal(false);
  }

  // Selección de estrellas en modal de calificación
  const starBtn = event.target.closest('[data-star-value]');
  if (starBtn) {
    selectedRatingScore = Number(starBtn.dataset.starValue);
    $$('#star-picker .star-btn').forEach(btn => {
      const val = Number(btn.dataset.starValue);
      btn.textContent = val <= selectedRatingScore ? '★' : '☆';
    });
    return;
  }

  // Enviar calificación (para ventas/intercambios y préstamos)
  if (event.target.id === 'submit-rating-btn') {
    const ratedId = otherUser?.id;
    if (!ratedId) return;

    const payload = {
      rater_id: userId,
      rated_id: ratedId,
      score: selectedRatingScore,
      review: null
    };
    if (transaction?.id) payload.transaction_id = transaction.id;
    else if (loan?.id) payload.loan_id = loan.id;

    const { error } = await supabase.from('ratings').insert(payload);
    if (error) return toast(error.message, 'error');
    closeChatModal(true);
    toast('Calificación enviada.', 'success');
    return load(true);
  }

  // Botón Cancelar en encabezado superior
  if (event.target.id === 'chat-cancel-btn') {
    const kind = event.target.dataset.cancelKind;
    let error;
    if (kind === 'transaction' && transaction?.id) {
      ({ error } = await supabase.rpc('cancel_transaction', { p_transaction_id: transaction.id }));
    } else if (kind === 'loan' && loan?.id) {
      ({ error } = await supabase.rpc('cancel_loan', { p_loan_id: loan.id }));
    }
    if (error) return toast(error.message, 'error');
    toast('Proceso cancelado.', 'success');
    return load(true);
  }

  // Acciones de compra/venta
  const txAction = event.target.closest('[data-tx-action]')?.dataset.txAction;
  if (txAction) {
    let error;
    if (txAction === 'accept' || txAction === 'reject') {
      ({ error } = await supabase.rpc('respond_to_transaction', { p_request_id: request.id, p_accept: txAction === 'accept' }));
    } else if (txAction === 'delivery' || txAction === 'reception') {
      ({ error } = await supabase.rpc('confirm_transaction', { p_transaction_id: transaction.id, p_action: txAction === 'delivery' ? 'DELIVERY' : 'RECEPTION' }));
    }
    if (error) return toast(error.message, 'error');
    toast('Operación actualizada.', 'success');
    return load(true);
  }

  // Acciones de préstamo
  const loanBtn = event.target.closest('[data-loan-action]');
  if (loanBtn) {
    const action = loanBtn.dataset.loanAction;
    let error;
    if (action === 'select-lender') {
      ({ error } = await supabase.rpc('select_loan_lender', { p_offer_id: loanBtn.dataset.offerId }));
    } else if (action === 'reject-lender') {
      ({ error } = await supabase.rpc('reject_loan_offer', { p_offer_id: loanBtn.dataset.offerId }));
    } else if (action === 'delivery') {
      ({ error } = await supabase.rpc('confirm_loan_delivery', { p_loan_id: loan.id, p_action: 'DELIVERY' }));
    } else if (action === 'reception') {
      ({ error } = await supabase.rpc('confirm_loan_delivery', { p_loan_id: loan.id, p_action: 'RECEPTION' }));
    } else if (action === 'return') {
      ({ error } = await supabase.rpc('confirm_loan_return', { p_loan_id: loan.id, p_action: 'RETURN' }));
    } else if (action === 'return-reception') {
      ({ error } = await supabase.rpc('confirm_loan_return', { p_loan_id: loan.id, p_action: 'RETURN_RECEPTION' }));
    }
    if (error) return toast(error.message, 'error');
    toast('Préstamo actualizado.', 'success');
    return load(true);
  }
});

setInterval(syncPresence, 8000);
startFallbackRefresh();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') queueReload();
});
window.addEventListener('beforeunload', () => {
  clearInterval(fallbackRefreshTimer);
  if (userId && id) supabase.from('active_chat_sessions').delete().eq('user_id', userId).eq('chat_id', id);
  if (channel) supabase.removeChannel(channel);
});

load();
setTimeout(syncPresence, 1000);
