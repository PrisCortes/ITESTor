import { supabase, isConfigured, VAPID_PUBLIC_KEY } from './supabaseClient.js';

const state = { session: null, profile: null, careers: [], publications: [], detailPublication: null, editingPublication: null, imagesToDelete: new Set(), activeLoanRequest: null, chatsChannel: null, chatsRefreshTimer: null, chatsFallbackTimer: null, chatsLoading: false, chatsRefreshQueued: false, publicationsChannel: null, publicationsRefreshTimer: null, favoriteIds: new Set(), isAdmin: false, searchTimer: null, profileEditing: false, profileTab: 'publications', pendingAvatarFile: null, pendingAvatarPreview: null, avatarCrop: { zoom: 1, x: 50, y: 50 } };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const CHAT_BUILD = '20261117-4';
const chatUrl = id => `chat.html?v=${CHAT_BUILD}&id=${encodeURIComponent(id)}`;
const validInstitutionalEmail = email => /^[^@\s]+@itesa\.edu\.mx$/i.test(email.trim());

function toast(message, type = '') { const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message; $('#toast-root').append(item); setTimeout(() => item.remove(), 4200); }
function empty(message, icon = '◌') { return `<article class="empty-state"><span class="empty-icon">${icon}</span>${escapeHtml(message)}</article>`; }
function requireConfig() { if (isConfigured) return true; toast('Configura Supabase en js/config.js antes de usar esta acción.', 'error'); return false; }
function requireAuth() { if (!requireConfig()) return false; if (state.session) return true; openAuth(); toast('Inicia sesión para continuar.', 'error'); return false; }
function urlBase64ToUint8Array(value) { const padding = '='.repeat((4 - value.length % 4) % 4); const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(base64), char => char.charCodeAt(0)); }
async function savePushSubscription(registration) { const existing = await registration.pushManager.getSubscription(); const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }); const json = subscription.toJSON(); const { error } = await supabase.from('push_subscriptions').upsert({ user_id:state.session.user.id, endpoint:subscription.endpoint, p256dh:json.keys?.p256dh, auth:json.keys?.auth, revoked_at:null }, { onConflict:'endpoint' }); if (error) throw error; return subscription; }
async function enablePushNotifications() { if (!requireAuth()) return; if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return toast('Este navegador no admite notificaciones push.', 'error'); const permission = await Notification.requestPermission(); if (permission !== 'granted') return toast(permission === 'denied' ? 'Las notificaciones están bloqueadas en este navegador.' : 'No se concedió permiso para notificaciones.', 'error'); if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes('TU_CLAVE')) return toast('Falta configurar la clave pública VAPID para activar notificaciones push.', 'error'); try { await savePushSubscription(await navigator.serviceWorker.ready); toast('Notificaciones activadas en este dispositivo.', 'success'); } catch (error) { toast(`No se pudieron activar las notificaciones: ${error.message}`, 'error'); } }

async function registerCurrentServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const migrationKey = `itestore-pwa-reset-${CHAT_BUILD}`;
  if (!localStorage.getItem(migrationKey)) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map(key => caches.delete(key)));
    localStorage.setItem(migrationKey, '1');
  }
  const registration = await navigator.serviceWorker.register(`/sw.js?v=${CHAT_BUILD}`, { updateViaCache:'none' });
  await registration.update();
  if (state.session && Notification.permission === 'granted' && VAPID_PUBLIC_KEY && !VAPID_PUBLIC_KEY.includes('TU_CLAVE')) savePushSubscription(registration).catch(error => console.warn('No se pudo restaurar la suscripción push:', error.message));
  return registration;
}

function syncFloatingFields(root = document) {
  $$('.floating-field', root).forEach(field => {
    const control = field.querySelector('input, textarea, select');
    if (!control) return;
    const hasValue = control.tagName === 'SELECT'
      ? Boolean(control.value)
      : control.type === 'datetime-local'
        ? true
        : control.value.length > 0;
    field.classList.toggle('has-value', hasValue);
    if (control.tagName === 'SELECT') control.classList.toggle('has-selection', Boolean(control.value));
  });
}

function updatePublishFileUI(input) {
  const titleEl = $('#pub-images-title');
  const subEl = $('#pub-images-sub');
  const previewEl = $('#pub-images-preview');
  if (!titleEl || !subEl || !previewEl) return;
  const files = [...(input?.files || [])];
  if (!files.length) {
    titleEl.textContent = 'Seleccionar imágenes';
    subEl.textContent = 'Toca aquí para elegir desde tu galería o archivos';
    previewEl.hidden = true;
    previewEl.innerHTML = '';
    return;
  }
  titleEl.textContent = files.length === 1 ? '1 imagen seleccionada' : `${files.length} imágenes seleccionadas`;
  subEl.textContent = files.map(f => f.name).join(', ');
  previewEl.hidden = false;
  previewEl.innerHTML = files.slice(0, 4).map(file => `<img src="${URL.createObjectURL(file)}" alt="${escapeHtml(file.name)}" />`).join('');
}

async function loadCareers() {
  if (!isConfigured) { state.careers = []; fillCareerSelects(); return; }
  const { data, error } = await supabase.from('careers').select('id, code, name').order('name');
  if (error) { toast('No fue posible cargar las carreras.', 'error'); return; }
  state.careers = data; fillCareerSelects();
}
function fillCareerSelects(root = document) {
  $$('select[name="career"], select[name="career_id"]', root).forEach(select => {
    const blank = select.name === 'career' ? '<option value="">Todas las carreras</option>' : '<option value="">Selecciona una carrera</option>';
    const previous = select.value;
    select.innerHTML = blank + state.careers.map(c => `<option value="${c.id}">${escapeHtml(c.code)} · ${escapeHtml(c.name)}</option>`).join('');
    select.value = previous;
  });
  syncFloatingFields(root);
}

function setView(name) {
  const target = ['home','search','publish','chats','profile','loans','admin'].includes(name) ? name : 'home';
  $$('.view').forEach(view => view.classList.toggle('active', view.dataset.view === target));
  $$('.bottom-nav a').forEach(link => link.classList.toggle('active', link.dataset.nav === target));
  const scroller = $('#main-content');
  if (scroller) scroller.scrollTop = 0;
  syncChatsRealtime(target === 'chats');
  if (target === 'home') loadPublications();
  if (target === 'search') {
    const query = $('#search-input')?.value || '';
    const filters = Object.fromEntries(new FormData($('#search-filters')));
    const hasActiveFilters = Object.values(filters).some(val => String(val || '').trim() !== '');
    if (query.trim() || hasActiveFilters) loadSearch(query, filters);
    else $('#search-results').innerHTML = state.publications.length ? renderCards(state.publications) : empty('Escribe o selecciona filtros para buscar productos o usuarios.', '⌕');
  }
  if (target === 'chats') loadChats();
  if (target === 'profile') renderProfile();
  if (target === 'loans') loadLoans();
  if (target === 'admin') renderAdmin();
  $('#main-content').focus();
}
function avatarMarkup(profile, label = 'Perfil') { const name = profile?.name || label; return profile?.avatar_url ? `<img class="avatar" src="${escapeHtml(profile.avatar_url)}" alt="${escapeHtml(name)}" />` : `<span class="avatar avatar-fallback" aria-label="${escapeHtml(name)}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`; }
function formatLongDate(value) { const date = new Date(value); const day = date.getDate(); const month = date.toLocaleDateString('es-MX', { month:'long' }); const year = date.getFullYear(); return `${day} de ${month} ${year}`; }
function formatLoanDeadline(value) {
  const date = new Date(value);
  const now = new Date();
  const day = date.getDate();
  const month = date.toLocaleDateString('es-MX', { month:'long' });
  return date.getFullYear() === now.getFullYear() ? `${day} de ${month}` : `${day} de ${month} ${date.getFullYear()}`;
}
function renderCards(items, options = {}) {
  return items.length ? items.map(publication => {
    const images = [...(publication.publication_images || [])].sort((a,b) => (a.position || 0) - (b.position || 0));
    const seller = publication.seller || publication.profiles || {};
    const sellerCareerCode = state.careers.find(c => c.id === seller.career_id)?.code || publication.careers?.code || 'ITESA';
    const price = publication.operation_type === 'EXCHANGE' ? 'Intercambio' : `$${Number(publication.price || 0).toFixed(2)}`;
    const favorite = state.favoriteIds.has(publication.id);
    const isOwner = state.session?.user.id === publication.owner_id;
    const hideMenu = Boolean(options.owner || isOwner);
    const menuOption = state.isAdmin
      ? `<button type="button" class="card-floating-option" data-action="admin-remove-publication" data-publication-id="${publication.id}">Retirar publicación</button>`
      : `<button type="button" class="card-floating-option" data-action="report-publication-confirm" data-publication-id="${publication.id}">Reportar publicación</button>`;
    const menu = hideMenu ? '' : `<div class="card-menu-wrap"><button type="button" class="icon-button card-menu" data-action="toggle-card-menu" aria-expanded="false" aria-label="Opciones de publicación">⋮</button><div class="card-floating-menu" hidden>${menuOption}</div></div>`;
    const isReservedFavorite = Boolean(options.favorite && publication.status === 'PENDING');
    const isUnavailableFavorite = Boolean(options.favorite && publication.status === 'COMPLETED');
    const unavailableOverlay = isReservedFavorite
      ? `<div class="unavailable-overlay"><p>El producto está en proceso de venta</p><small>Es posible que vuelva a estar disponible si se cancela el proceso de venta actual.</small></div>`
      : isUnavailableFavorite
        ? `<div class="unavailable-overlay"><p>El producto ya no está disponible</p><button type="button" class="unavailable-remove-btn" data-action="toggle-favorite" data-publication-id="${publication.id}">Eliminar</button></div>`
        : '';
    const requestBtn = `<button class="button compact" data-action="request-publication" data-publication-id="${publication.id}">${publication.operation_type === 'SALE' ? 'Solicitar compra' : 'Solicitar intercambio'}</button>`;
    const action = options.owner || isOwner
      ? `<button class="button compact" data-action="edit-card-publication" data-publication-id="${publication.id}">Editar</button>`
      : options.favorite
        ? `<button class="icon-button favorite-button active" data-action="toggle-favorite" data-publication-id="${publication.id}" aria-label="Quitar de favoritos">♥</button>${requestBtn}`
        : `<button class="icon-button favorite-button ${favorite ? 'active' : ''}" data-action="toggle-favorite" data-publication-id="${publication.id}" aria-label="${favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}">${favorite ? '♥' : '♡'}</button>${requestBtn}`;
    const dots = images.length > 1
      ? `<div class="gallery-dots" aria-hidden="true">${images.map((_, index) => `<span class="gallery-dot ${index === 0 ? 'active' : ''}"></span>`).join('')}</div>`
      : '';
    return `<article class="product-card social-card ${(isReservedFavorite || isUnavailableFavorite) ? 'unavailable-favorite' : ''}" data-product-id="${publication.id}">${unavailableOverlay}<header class="card-owner"><button class="owner-link" data-action="open-public-profile" data-user-id="${publication.owner_id}">${avatarMarkup(seller)}<span class="owner-info"><span class="owner-name">${escapeHtml(seller.name || 'Nombre de usuario')}</span><span class="owner-career">Carrera: ${escapeHtml(sellerCareerCode)}</span></span></button>${menu}</header><div class="product-gallery">${images.length ? images.map(image => `<div class="product-image"><img src="${escapeHtml(image.public_url)}" alt="${escapeHtml(publication.title)}" /></div>`).join('') : '<div class="product-image">Sin imagen</div>'}</div>${dots}<div class="product-body"><div class="product-name-price"><p class="product-title">${escapeHtml(publication.title)}</p><p class="product-price">${price}</p></div><details class="card-details"><div class="card-details-body"><p>${escapeHtml(publication.description || 'Sin descripción')}</p><p>Producto: ${conditionLabel(publication.condition || 'USED')}</p><p>${publication.stock} disponible(s).</p></div><summary>Ver más detalles</summary></details><footer class="card-footer"><p class="card-date">${formatLongDate(publication.created_at)}</p><div class="card-actions">${action}</div></footer></div></article>`;
  }).join('') : empty('No hay publicaciones que coincidan con esta búsqueda.', '⌕');
}
async function enrichPublications(publications) { const ownerIds = [...new Set((publications || []).map(item => item.owner_id))]; if (!ownerIds.length) return publications || []; const { data } = await supabase.from('public_profile_summaries').select('id,name,career_id,rating_average,avatar_url').in('id', ownerIds); const people = new Map((data || []).map(person => [person.id, person])); return (publications || []).map(item => ({ ...item, seller: people.get(item.owner_id) })); }
async function loadFavorites() { if (!state.session || !isConfigured) { state.favoriteIds = new Set(); return; } const { data } = await supabase.from('favorites').select('publication_id').eq('user_id', state.session.user.id); state.favoriteIds = new Set((data || []).map(row => row.publication_id)); }
async function loadPublications(filters = {}) { const target = $('#feed'); if (!isConfigured) { target.innerHTML = empty('Configura Supabase para ver el catálogo real. La interfaz ya está lista para conectarse.', '◫'); return; } target.innerHTML = empty('Cargando publicaciones…', '◌'); let query = supabase.from('publications').select('id,owner_id,title,description,condition,price,stock,operation_type,status,created_at,careers(code),publication_images(public_url,position)').eq('status','AVAILABLE').order('created_at',{ascending:false}); if (state.session && !state.isAdmin) query = query.neq('owner_id', state.session.user.id); if (filters.career) query = query.eq('career_id', filters.career); if (filters.operation) query = query.eq('operation_type', filters.operation); if (filters.minPrice) query = query.gte('price', filters.minPrice); if (filters.maxPrice) query = query.lte('price', filters.maxPrice); const { data, error } = await query; if (error) { target.innerHTML = empty('No se pudieron cargar las publicaciones. Revisa la configuración y permisos.', '⚠'); return; } await loadFavorites(); state.publications = await enrichPublications(data); target.innerHTML = renderCards(state.publications); }

function openModal(templateId) { $('#modal-root').innerHTML = ''; const node = $(`#${templateId}`).content.cloneNode(true); $('#modal-root').append(node); fillCareerSelects($('#modal-root')); syncFloatingFields($('#modal-root')); }
function closeModal() { $('#modal-root').innerHTML = ''; }
function openAuth() { openModal('auth-template'); $('#login-form').hidden = false; $('#register-form').hidden = true; }
async function signIn(form) { if (!requireConfig()) return; const formData = new FormData(form); if (!validInstitutionalEmail(formData.get('email'))) return toast('Usa únicamente un correo @itesa.edu.mx.', 'error'); const { error } = await supabase.auth.signInWithPassword({ email: formData.get('email').trim(), password: formData.get('password') }); if (error) return toast(error.message, 'error'); toast('Sesión iniciada.', 'success'); closeModal(); await refreshSession(); }
async function register(form) { if (!requireConfig()) return; const data = new FormData(form); if (!validInstitutionalEmail(data.get('email'))) return toast('El correo debe terminar exactamente en @itesa.edu.mx.', 'error'); if (data.get('password') !== data.get('passwordConfirm')) return toast('Las contraseñas no coinciden.', 'error'); const { error } = await supabase.auth.signUp({ email:data.get('email').trim(), password:data.get('password'), options:{ data:{ name:data.get('name').trim(), career_id:data.get('career_id') }, emailRedirectTo: `${location.origin}${location.pathname}` } }); if (error) return toast(error.message, 'error'); toast('Revisa tu correo institucional para confirmar tu cuenta.', 'success'); }
async function recoverPassword() { const email = prompt('Escribe tu correo institucional para recuperar tu contraseña:'); if (!email) return; if (!validInstitutionalEmail(email)) return toast('Usa un correo @itesa.edu.mx.', 'error'); const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` }); toast(error ? error.message : 'Te enviamos un enlace de recuperación.', error ? 'error' : 'success'); }
async function refreshSession() { if (!isConfigured) return renderProfile(); const { data:{session} } = await supabase.auth.getSession(); state.session = session; state.profile = null; state.isAdmin = false; if (session) { const [{ data:profile }, { data:role }] = await Promise.all([supabase.from('profiles').select('id,name,email,career_id,rating_average,avatar_path,avatar_url,careers(code,name)').eq('id',session.user.id).maybeSingle(), supabase.from('user_roles').select('role').eq('user_id',session.user.id).maybeSingle()]); state.profile = profile; state.isAdmin = role?.role === 'ADMIN'; await loadFavorites(); } const sessionButton = $('#session-button'); const signedIn = Boolean(state.session); sessionButton.innerHTML = signedIn ? '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/><path d="M14 8l4 4-4 4"/><path d="M7 12h11"/></svg>' : '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/><path d="M10 8l-4 4 4 4"/><path d="M17 12H6"/></svg>'; sessionButton.setAttribute('aria-label', signedIn ? 'Cerrar sesión' : 'Abrir inicio de sesión'); const navAvatar = $('#nav-profile-icon'); if (navAvatar) navAvatar.innerHTML = state.profile?.avatar_url ? `<img src="${escapeHtml(state.profile.avatar_url)}" alt="" />` : '<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 22c.8-4.1 3.4-6 8-6s7.2 1.9 8 6"/></svg>'; syncChatsRealtime(location.hash === '#chats'); syncPublicationsRealtime(); renderProfile(); }

function syncProfileTabsHints() {
  const scroller = $('#profile-tabs-scroller');
  const leftHint = $('#profile-tabs-left');
  const rightHint = $('#profile-tabs-right');
  if (!scroller || !leftHint || !rightHint) return;
  const maxScroll = scroller.scrollWidth - scroller.clientWidth;
  if (maxScroll <= 4) {
    leftHint.hidden = true;
    rightHint.hidden = true;
    return;
  }
  leftHint.hidden = scroller.scrollLeft <= 6;
  rightHint.hidden = scroller.scrollLeft >= maxScroll - 6;
}

function renderProfile() {
  const root = $('#profile-content');
  if (!state.session) {
    root.innerHTML = `<section class="profile-card"><h2>Tu espacio en ITEStore</h2><p>Inicia sesión con tu correo institucional para publicar, conversar y gestionar operaciones.</p><button class="button" data-action="open-auth">Iniciar sesión</button></section>`;
    return;
  }
  const profile = state.profile || {};
  const displayName = profile.name || state.session.user.email.split('@')[0];
  const rating = Math.round(Number(profile.rating_average || 0));
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const avatarSrc = state.pendingAvatarPreview || profile.avatar_url;
  const avatarNode = avatarSrc
    ? `<img class="avatar" id="profile-avatar-preview" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(displayName)}" style="object-position:${state.avatarCrop.x}% ${state.avatarCrop.y}%;transform:scale(${state.avatarCrop.zoom});transform-origin:${state.avatarCrop.x}% ${state.avatarCrop.y}%" />`
    : `<span class="avatar avatar-fallback" id="profile-avatar-preview" aria-label="${escapeHtml(displayName)}">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</span>`;

  const cardContent = state.profileEditing
    ? `<form id="profile-form" class="profile-card">
        <div class="profile-avatar-wrap">
          ${avatarNode}
          <label class="profile-avatar-trigger" for="profile-avatar-input" aria-label="Seleccionar imagen de perfil">
            <span class="profile-avatar-overlay">Seleccionar<br>imagen</span>
          </label>
          <input id="profile-avatar-input" class="sr-only" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" />
        </div>
        ${state.pendingAvatarFile ? `<div class="avatar-crop-controls" aria-label="Ajustar fotografía"><strong>Ajustar encuadre</strong><label>Zoom <input data-avatar-crop="zoom" type="range" min="1" max="2.5" step="0.05" value="${state.avatarCrop.zoom}" /></label><label>Horizontal <input data-avatar-crop="x" type="range" min="0" max="100" step="1" value="${state.avatarCrop.x}" /></label><label>Vertical <input data-avatar-crop="y" type="range" min="0" max="100" step="1" value="${state.avatarCrop.y}" /></label><small>La imagen se recorta y optimiza automáticamente al guardar.</small></div>` : ''}
        <div class="profile-info">
          <input id="profile-name" class="profile-name-input" name="name" maxlength="120" required aria-label="Nombre de usuario" value="${escapeHtml(displayName)}" />
          <p class="profile-email-text">${escapeHtml(profile.email || state.session.user.email)}</p>
          <p class="profile-stars">${stars} <span class="sr-only">${Number(profile.rating_average || 0).toFixed(1)} de 5</span></p>
        </div>
        <div class="profile-card-actions">
          <button class="button" type="submit">Guardar</button>
          <button class="button" type="button" data-action="cancel-profile-edit">Cancelar</button>
        </div>
      </form>`
    : `<section class="profile-card">
        <div class="profile-avatar-wrap">${avatarNode}</div>
        <div class="profile-info">
          <h2 class="profile-display-name">${escapeHtml(displayName)}</h2>
          <p class="profile-email-text">${escapeHtml(profile.email || state.session.user.email)}</p>
          <p class="profile-stars">${stars} <span class="sr-only">${Number(profile.rating_average || 0).toFixed(1)} de 5</span></p>
        </div>
        <div class="profile-card-actions">
          <button class="button" type="button" data-action="edit-profile">Editar</button>
        </div>
      </section>`;

  const currentTab = state.profileTab || 'publications';
  root.innerHTML = `${cardContent}
    <div class="profile-tabs-wrap">
      <button type="button" class="profile-tabs-hint left" id="profile-tabs-left" data-action="scroll-profile-tabs" data-dir="-1" aria-label="Desplazar pestañas a la izquierda" hidden>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="13 17 8 12 13 7"/><polyline points="19 17 14 12 19 7"/></svg>
      </button>
      <div class="profile-tabs" id="profile-tabs-scroller">
        <button type="button" class="tab ${currentTab === 'publications' ? 'active' : ''}" data-profile-tab="publications">Mis publicaciones</button>
        <button type="button" class="tab ${currentTab === 'sales' ? 'active' : ''}" data-profile-tab="sales">Mis ventas</button>
        <button type="button" class="tab ${currentTab === 'purchases' ? 'active' : ''}" data-profile-tab="purchases">Mis compras</button>
        <button type="button" class="tab ${currentTab === 'favorites' ? 'active' : ''}" data-profile-tab="favorites">Mis favoritos</button>
      </div>
      <button type="button" class="profile-tabs-hint right" id="profile-tabs-right" data-action="scroll-profile-tabs" data-dir="1" aria-label="Desplazar pestañas a la derecha">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="11 17 16 12 11 7"/><polyline points="5 17 10 12 5 7"/></svg>
      </button>
    </div>
    <div id="profile-tab-content" class="card-grid"></div>
    <div class="profile-actions">
      <button class="button" type="button" data-action="enable-notifications">Activar notificaciones</button>
      ${state.isAdmin ? '<a class="button secondary" href="#admin">Administración</a>' : ''}
      <button class="button secondary" type="button" data-action="logout">Cerrar sesión</button>
    </div>`;

  requestAnimationFrame(syncProfileTabsHints);
  loadProfileTab(currentTab);
}

async function saveProfile(form) {
  if (!requireAuth()) return;
  const data = new FormData(form);
  const name = data.get('name').trim();
  if (name.length < 2) return toast('Indica un nombre válido.', 'error');
  let avatarPath = state.profile?.avatar_path || null;
  let avatarUrl = state.profile?.avatar_url || null;
  const file = state.pendingAvatarFile || data.get('avatar');
  if (file && file.size > 0) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) return toast('Selecciona una foto JPG, PNG o WEBP de hasta 15 MB.', 'error');
    const optimized = await prepareAvatarUpload(file, state.avatarCrop);
    const extension = 'jpg';
    const newPath = `${state.session.user.id}/avatar-${crypto.randomUUID()}.${extension}`;
    let upload = await supabase.storage.from('profile-images').upload(newPath, optimized, { contentType: optimized.type, upsert: true });
    let bucketUsed = 'profile-images';
    if (upload.error) {
      upload = await supabase.storage.from('publication-images').upload(newPath, optimized, { contentType: optimized.type, upsert: true });
      bucketUsed = 'publication-images';
    }
    if (upload.error) return toast(`No se pudo subir la imagen: ${upload.error.message}`, 'error');
    avatarPath = newPath;
    const { data: pub } = supabase.storage.from(bucketUsed).getPublicUrl(newPath);
    avatarUrl = `${pub.publicUrl}?t=${Date.now()}`;
  }
  const { error } = await supabase.from('profiles').update({ name, avatar_path: avatarPath, avatar_url: avatarUrl }).eq('id', state.session.user.id);
  if (error) return toast(error.message, 'error');
  state.profileEditing = false;
  state.pendingAvatarFile = null;
  state.pendingAvatarPreview = null;
  state.avatarCrop = { zoom: 1, x: 50, y: 50 };
  toast('Perfil actualizado.', 'success');
  await refreshSession();
}

async function prepareAvatarUpload(file, crop) {
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = source; });
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const scale = baseScale * Number(crop?.zoom || 1);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (size - width) * (Number(crop?.x ?? 50) / 100);
    const y = (size - height) * (Number(crop?.y ?? 50) / 100);
    context.drawImage(image, x, y, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob) throw new Error('No fue posible procesar la imagen.');
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(source); }
}

async function loadProfileTab(tab) {
  state.profileTab = tab;
  const root = $('#profile-tab-content');
  if (!root || !state.session) return;
  root.innerHTML = empty('Cargando…', '◌');
  const userId = state.session.user.id;
  if (tab === 'publications') {
    const { data } = await supabase.from('publications').select('id,owner_id,title,description,condition,price,stock,operation_type,status,created_at,careers(code),publication_images(public_url,position)').eq('owner_id',userId).eq('status','AVAILABLE').order('created_at',{ascending:false});
    root.innerHTML = (data || []).length ? renderCards(await enrichPublications(data), { owner:true }) : empty('No tienes publicaciones disponibles.', '◌');
    return;
  }
  if (tab === 'favorites') {
    const { data } = await supabase.from('favorites').select('publication_id,publications(id,owner_id,title,description,condition,price,stock,operation_type,status,created_at,careers(code),publication_images(public_url,position))').eq('user_id',userId).order('created_at',{ascending:false});
    const favPubs = (data || []).map(item => item.publications).filter(Boolean);
    root.innerHTML = favPubs.length ? renderCards(await enrichPublications(favPubs), { favorite:true }) : empty('Aún no tienes publicaciones en favoritos.', '♡');
    return;
  }
  const column = tab === 'sales' ? 'seller_id' : 'buyer_id';
  const { data, error } = await supabase.from('transactions').select('id,status,completed_at,created_at,buyer_id,seller_id,publication:publications(id,owner_id,title,description,condition,price,stock,operation_type,status,career_id,publication_images(public_url,position))').eq(column,userId).eq('status','COMPLETED').order('completed_at',{ascending:false});
  if (error) { root.innerHTML = empty('No fue posible cargar las operaciones.', '⚠'); return; }
  const counterpartIds = [...new Set((data || []).map(row => row.buyer_id === userId ? row.seller_id : row.buyer_id))];
  const { data:people } = counterpartIds.length ? await supabase.from('public_profile_summaries').select('id,name').in('id',counterpartIds) : { data:[] };
  const names = new Map((people || []).map(person => [person.id,person.name]));
  root.innerHTML = (data || []).length ? data.map(row => {
    const counterpart = row.buyer_id === userId ? row.seller_id : row.buyer_id;
    const publication = row.publication || {};
    return `<article class="list-card transaction-card"><div class="transaction-thumb">${publication.publication_images?.[0]?.public_url ? `<img src="${escapeHtml(publication.publication_images[0].public_url)}" alt="" />` : '◫'}</div><div><h3>${escapeHtml(publication.title || 'Operación')}</h3><p>${tab === 'sales' ? 'Comprador' : 'Vendedor'}: ${escapeHtml(names.get(counterpart) || 'Estudiante ITESA')}</p><small>Concluida · ${new Date(row.completed_at || row.created_at).toLocaleDateString('es-MX')}</small>${tab === 'sales' && publication.id ? `<button class="button compact secondary repost-button" type="button" data-action="repost-publication" data-publication-id="${publication.id}">Volver a publicar</button>` : ''}</div><strong>${publication.price ? `$${Number(publication.price).toFixed(2)}` : 'Intercambio'}</strong></article>`;
  }).join('') : empty(tab === 'sales' ? 'Aún no tienes ventas concluidas.' : 'Aún no tienes compras concluidas.', '◌');
}

async function repostPublication(publicationId) {
  if (!requireAuth()) return;
  const product = await loadPublicationDetail(publicationId);
  if (!product || product.owner_id !== state.session.user.id) return toast('No fue posible preparar esta publicación.', 'error');
  state.editingPublication = null; state.imagesToDelete = new Set();
  location.hash = '#publish';
  const form = $('#publish-form');
  form.title.value = product.title; form.description.value = product.description; form.condition.value = product.condition; form.price.value = product.price; form.operation_type.value = product.operation_type; form.stock.value = 1; form.career_id.value = state.profile?.career_id || product.career_id;
  $('#publish-title').textContent = 'Volver a publicar'; $('#publish-submit').textContent = 'Publicar artículo'; $('#publication-career-field').hidden = true; $('#publication-status-field').hidden = true; $('#cancel-edit').hidden = false; renderCurrentImages(); await copyRepostImages(product, form.images); updatePublishFileUI(form.images); syncFloatingFields(form);
  toast('Revisa los datos. La nueva publicación tendrá stock de 1.', '');
}

async function copyRepostImages(product, input) {
  const transfer = new DataTransfer();
  const copies = await Promise.all((product.publication_images || []).slice(0, 4).map(async (image, index) => {
    try { const response = await fetch(image.public_url); if (!response.ok) throw new Error('No disponible'); const blob = await response.blob(); return new File([blob], `imagen-${index + 1}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type }); } catch { return null; }
  }));
  copies.filter(Boolean).forEach(file => transfer.items.add(file));
  input.files = transfer.files;
  if ((product.publication_images || []).length && !transfer.files.length) toast('No se pudieron recuperar las fotos anteriores; puedes añadirlas manualmente.', 'error');
}

async function toggleFavorite(publicationId) {
  if (!requireAuth()) return;
  const saved = state.favoriteIds.has(publicationId);
  const request = saved
    ? supabase.from('favorites').delete().eq('user_id',state.session.user.id).eq('publication_id',publicationId)
    : supabase.from('favorites').insert({ user_id:state.session.user.id, publication_id:publicationId });
  const { error } = await request;
  if (error) return toast(error.message, 'error');
  saved ? state.favoriteIds.delete(publicationId) : state.favoriteIds.add(publicationId);
  toast(saved ? 'Eliminado de favoritos.' : 'Guardado en favoritos.', 'success');
  if (location.hash === '#profile') loadProfileTab('favorites');
  else if (location.hash === '#home') loadPublications();
  else if (location.hash === '#search') {
    $$('.favorite-button').forEach(btn => {
      if (btn.dataset.publicationId === publicationId) {
        const active = state.favoriteIds.has(publicationId);
        btn.classList.toggle('active', active);
        btn.textContent = active ? '♥' : '♡';
        btn.setAttribute('aria-label', active ? 'Quitar de favoritos' : 'Agregar a favoritos');
      }
    });
  }
}

function openReportDialog(type, id) {
  if (!requireAuth()) return;
  const noun = type === 'publication' ? 'publicación' : 'usuario';
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button><h2 id="report-title">Reportar ${noun}</h2><form id="report-form" class="auth-form" data-report-type="${type}" data-report-id="${id}"><div class="form-group"><div class="floating-field"><textarea id="report-reason" name="reason" minlength="2" maxlength="1000" required rows="3" placeholder=" "></textarea><label for="report-reason">Motivo</label></div></div><button class="button secondary" type="submit">Enviar reporte</button></form></section></div>`;
  syncFloatingFields($('#modal-root'));
}
async function submitReport(form) { const reason = new FormData(form).get('reason').trim(); if (reason.length < 2) return toast('Indica un motivo válido.', 'error'); const type = form.dataset.reportType; const payload = type === 'publication' ? { publication_id:form.dataset.reportId, reporter_id:state.session.user.id, reason } : { reported_user_id:form.dataset.reportId, reporter_id:state.session.user.id, reason }; const { error } = await supabase.from(type === 'publication' ? 'publication_reports' : 'user_reports').insert(payload); if (error) return toast(error.code === '23505' ? 'Ya enviaste un reporte para este elemento.' : error.message, 'error'); toast('Reporte enviado para revisión.', 'success'); closeModal(); }
async function openPublicProfile(userId) { if (!requireConfig() || userId === state.session?.user.id) return location.hash = '#profile'; if (!requireAuth()) return; const { data:profiles, error } = await supabase.rpc('get_public_profile', { p_profile_id:userId }); const profile = profiles?.[0]; if (error || !profile) return toast('Este perfil no está disponible.', 'error'); const { data:publications } = await supabase.from('publications').select('id,owner_id,title,description,condition,price,stock,operation_type,status,created_at,careers(code),publication_images(public_url,position)').eq('owner_id',userId).eq('status','AVAILABLE').order('created_at',{ascending:false}); const stars = '★'.repeat(Math.round(Number(profile.rating_average || 0))) + '☆'.repeat(5 - Math.round(Number(profile.rating_average || 0))); $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal public-profile" role="dialog" aria-modal="true" aria-labelledby="public-profile-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button>${avatarMarkup(profile)}<h2 id="public-profile-title">${escapeHtml(profile.name)}</h2><p class="muted">${escapeHtml(profile.email)}</p><p>${stars} ${Number(profile.rating_average || 0).toFixed(1)} / 5</p><div class="profile-actions"><button class="button" data-action="chat-with-user" data-user-id="${profile.id}">Chatear</button><button class="button secondary" data-action="block-user" data-user-id="${profile.id}">Bloquear</button><button class="button secondary" data-action="report-user" data-user-id="${profile.id}">Reportar</button>${state.isAdmin ? `<button class="button secondary" data-action="suspend-user" data-user-id="${profile.id}">Suspender</button>` : ''}</div><h3>Publicaciones</h3><div class="card-grid">${renderCards(await enrichPublications(publications || []))}</div></section></div>`; }
async function chatWithUser(userId) { if (!requireAuth()) return; const me = state.session.user.id; const { data, error } = await supabase.from('chats').select('id,participant_a,participant_b,updated_at').or(`participant_a.eq.${me},participant_b.eq.${me}`).order('updated_at', { ascending:false }); if (error) return toast(error.message, 'error'); let chat = (data || []).find(item => (item.participant_a === me && item.participant_b === userId) || (item.participant_b === me && item.participant_a === userId)); if (!chat) { const { data:created, error:creationError } = await supabase.from('chats').insert({ participant_a:me, participant_b:userId }).select('id').single(); if (creationError) return toast(creationError.message, 'error'); chat = created; } closeModal(); location.href = chatUrl(chat.id); }
async function blockUser(userId) { if (!requireAuth()) return; const reason = prompt('Indica brevemente el motivo del bloqueo:'); if (reason === null) return; if (reason.trim().length < 2) return toast('Indica un motivo de al menos dos caracteres.', 'error'); const { error } = await supabase.from('user_blocks').insert({ blocker_id:state.session.user.id, blocked_id:userId, reason:reason.trim() }); if (error) return toast(error.code === '23505' ? 'Este usuario ya está bloqueado.' : error.message, 'error'); toast('Usuario bloqueado. Sus publicaciones e interacciones nuevas ya no serán visibles.', 'success'); closeModal(); loadPublications(); }
async function renderAdmin() { const root = $('#admin-content'); if (!state.session || !state.isAdmin) { root.innerHTML = empty('No tienes acceso al módulo administrativo.', '⚠'); return; } root.innerHTML = empty('Cargando panel administrativo…', '◌'); const [{ data:stats }, { data:publicationReports }, { data:userReports }] = await Promise.all([supabase.rpc('admin_statistics'), supabase.from('publication_reports').select('id,reason,status,created_at,publication_id,reporter_id').order('created_at',{ascending:false}), supabase.from('user_reports').select('id,reason,status,created_at,reported_user_id,reporter_id').order('created_at',{ascending:false})]); const ids = [...new Set([...(publicationReports || []).flatMap(item => [item.reporter_id]), ...(userReports || []).flatMap(item => [item.reporter_id,item.reported_user_id])])]; const { data:people } = ids.length ? await supabase.from('public_profile_summaries').select('id,name').in('id',ids) : { data:[] }; const peopleById = new Map((people || []).map(person => [person.id,person.name])); const rows = (items,type) => (items || []).map(item => `<article class="list-card"><div><h3>${type === 'PUBLICATION' ? 'Reporte de publicación' : `Reporte de ${escapeHtml(peopleById.get(item.reported_user_id) || 'usuario')}`}</h3><p>${escapeHtml(item.reason)}</p><small>Reportó: ${escapeHtml(peopleById.get(item.reporter_id) || 'Usuario')} · ${new Date(item.created_at).toLocaleString('es-MX')} · ${escapeHtml(item.status)}</small></div>${item.status === 'OPEN' ? `<button class="button compact" data-action="resolve-report" data-report-type="${type}" data-report-id="${item.id}">Resolver</button>` : ''}</article>`).join('') || '<p>No hay reportes.</p>'; const months = (stats?.sales_completed_by_month || []).map(item => `<li>${escapeHtml(item.month)}: ${item.count}</li>`).join('') || '<li>Sin ventas finalizadas.</li>'; root.innerHTML = `<section class="stats-grid"><article><strong>${stats?.total_users || 0}</strong><span>usuarios</span></article><article><strong>${stats?.loans_completed || 0}</strong><span>préstamos finalizados</span></article><article><strong>${stats?.loans_overdue || 0}</strong><span>préstamos sin devolución</span></article><article><strong>${stats?.total_publications || 0}</strong><span>publicaciones</span></article><article><strong>${stats?.expired_requests_without_offer || 0}</strong><span>solicitudes vencidas</span></article></section><section class="admin-months"><h2>Ventas finalizadas por mes</h2><ul>${months}</ul></section><h2>Reportes de publicaciones</h2>${rows(publicationReports,'PUBLICATION')}<h2>Reportes de usuarios</h2>${rows(userReports,'USER')}`; }
async function resolveReport(button) { const resolution = prompt('Describe brevemente la resolución:'); if (resolution === null) return; const { error } = await supabase.rpc('admin_resolve_report', { p_report_type:button.dataset.reportType, p_report_id:button.dataset.reportId, p_status:'RESOLVED', p_resolution:resolution.trim() || null }); if (error) return toast(error.message, 'error'); toast('Reporte resuelto.', 'success'); renderAdmin(); }
async function removePublicationAsAdmin(id) { if (!state.isAdmin) return; const reason = prompt('Indica el motivo para retirar la publicación:'); if (reason === null) return; const { error } = await supabase.rpc('admin_remove_publication', { p_publication_id:id, p_reason:reason.trim() }); if (error) return toast(error.message, 'error'); toast('Publicación retirada y notificada al propietario.', 'success'); closeModal(); loadPublications(); }
async function suspendUser(userId) { if (!state.isAdmin) return; const kind = (prompt('Escribe TEMPORARY para baja temporal o PERMANENT para baja permanente:') || '').trim().toUpperCase(); if (!['TEMPORARY','PERMANENT'].includes(kind)) return toast('Selecciona TEMPORARY o PERMANENT.', 'error'); const reason = prompt('Indica el motivo de la baja:'); if (!reason || reason.trim().length < 2) return toast('Indica un motivo válido.', 'error'); let endsAt = null; if (kind === 'TEMPORARY') { const value = prompt('Fecha y hora de finalización (AAAA-MM-DDTHH:MM):'); endsAt = value ? new Date(value).toISOString() : null; if (!endsAt || Number.isNaN(new Date(endsAt).valueOf())) return toast('Indica una fecha válida.', 'error'); } const { error } = await supabase.rpc('admin_suspend_user', { p_user_id:userId, p_kind:kind, p_reason:reason.trim(), p_ends_at:endsAt }); if (error) return toast(error.message, 'error'); toast('Baja registrada y notificada.', 'success'); closeModal(); }
function closeCardMenus(exceptWrap = null) { $$('.card-menu-wrap').forEach(wrap => { if (wrap === exceptWrap) return; const menu = wrap.querySelector('.card-floating-menu'); const btn = wrap.querySelector('.card-menu'); if (menu) menu.hidden = true; if (btn) btn.setAttribute('aria-expanded', 'false'); }); }
async function hideChats(chatIds) { if (!requireAuth() || !chatIds.length) return; const { error } = await supabase.from('chat_hidden_users').upsert(chatIds.map(chat_id => ({ chat_id, user_id:state.session.user.id })), { onConflict:'chat_id,user_id' }); if (error) return toast(error.message, 'error'); toast('Conversación ocultada.', 'success'); loadChats(); }

async function createTransactionRequest(event, product) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const quantity = Number(fields.get('quantity'));
  const note = (fields.get('note') || '').trim();
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) return toast('La cantidad solicitada no es válida.', 'error');

  const { data: full, error: loadError } = await supabase.from('publications').select('owner_id,stock,status').eq('id', product.id).single();
  if (loadError || full.status !== 'AVAILABLE' || full.stock < quantity) return toast('El artículo ya no tiene stock suficiente.', 'error');

  const { data: request, error } = await supabase.from('transaction_requests').insert({
    publication_id: product.id,
    buyer_id: state.session.user.id,
    seller_id: full.owner_id,
    quantity,
    kind: product.operation_type,
    note: note || null
  }).select().single();
  if (error) return toast(error.message, 'error');

  const { data: createdChat, error: chatError } = await supabase.from('chats').insert({
    transaction_request_id: request.id,
    participant_a: state.session.user.id,
    participant_b: full.owner_id
  }).select('id').single();

  if (chatError) {
    toast('Solicitud creada; el chat se generará al abrirla.', 'error');
  } else {
    if (note && createdChat?.id) {
      await supabase.from('messages').insert({
        chat_id: createdChat.id,
        sender_id: state.session.user.id,
        content: note
      });
    }
    toast('Solicitud creada y chat abierto para coordinarse.', 'success');
  }
  closeModal();
  location.hash = '#chats';
}

const chatSelect = 'id,participant_a,participant_b,created_at,updated_at,transaction_requests(id,status,updated_at,publications(title),transactions(id,status,completed_at,cancelled_at,updated_at,meeting_at,payment_method,meeting_points(name))),loan_requests(id,title,status,updated_at,loans(id,status,closed_at,updated_at,meeting_point_id,meeting_at,return_meeting_point_id,return_meeting_at,delivery_point:meeting_points!loans_meeting_point_id_fkey(name),return_point:meeting_points!loans_return_meeting_point_id_fkey(name)))';
const asOne = value => Array.isArray(value) ? value[0] : value;
const chatPreview = value => value && value.length > 52 ? `${value.slice(0, 51)}…` : value;
const chatListStamp = value => { const date = new Date(value); const today = new Date(); const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate(); return sameDay ? date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase() : date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }); };
function chatFinishedAt(chat) { const request = asOne(chat.transaction_requests); const transaction = asOne(request?.transactions); const loanRequest = asOne(chat.loan_requests); const loan = asOne(loanRequest?.loans); return transaction?.completed_at || loan?.closed_at || (transaction?.status === 'CANCELLED' ? (transaction.cancelled_at || transaction.updated_at) : null) || (loan?.status === 'CANCELLED' ? loan.updated_at : null) || (request?.status === 'REJECTED' ? request.updated_at : null) || null; }

function chatRowStatusIcon(message, userId) {
  if (!message || message.sender_id !== userId) return '';
  const receipt = asOne(message.message_receipts);
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

function isChatsViewActive() { return location.hash === '#chats' && Boolean(state.session); }
function scheduleChatsRefresh() { if (!isChatsViewActive()) return; clearTimeout(state.chatsRefreshTimer); state.chatsRefreshTimer = setTimeout(() => { state.chatsRefreshTimer = null; loadChats(); }, 180); }
function stopChatsRealtime() { clearTimeout(state.chatsRefreshTimer); clearInterval(state.chatsFallbackTimer); state.chatsRefreshTimer = null; state.chatsFallbackTimer = null; if (state.chatsChannel) { supabase.removeChannel(state.chatsChannel); state.chatsChannel = null; } }
function syncChatsRealtime(active) {
  if (!active || !isConfigured || !state.session) { stopChatsRealtime(); return; }
  if (state.chatsChannel) return;
  const userId = state.session.user.id;
  state.chatsChannel = supabase.channel(`chat-list:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, payload => {
      const chat = payload.new?.id ? payload.new : payload.old;
      if (chat && [chat.participant_a, chat.participant_b].includes(userId)) scheduleChatsRefresh();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_receipts' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_requests' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_requests' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_offers' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_system_events' }, () => scheduleChatsRefresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, () => scheduleChatsRefresh())
    .subscribe();
  state.chatsFallbackTimer = setInterval(() => {
    if (isChatsViewActive()) loadChats();
  }, 1500);
}

function schedulePublicationsRefresh() {
  clearTimeout(state.publicationsRefreshTimer);
  state.publicationsRefreshTimer = setTimeout(() => {
    state.publicationsRefreshTimer = null;
    if (location.hash === '#home') loadPublications();
    if (location.hash === '#profile' && state.profileTab === 'favorites') loadProfileTab('favorites');
  }, 40);
}

function syncPublicationsRealtime() {
  if (!isConfigured || !state.session) {
    clearTimeout(state.publicationsRefreshTimer);
    if (state.publicationsChannel) supabase.removeChannel(state.publicationsChannel);
    state.publicationsChannel = null;
    return;
  }
  if (state.publicationsChannel) return;
  state.publicationsChannel = supabase.channel(`publications:${state.session.user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'publications' }, schedulePublicationsRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'favorites', filter: `user_id=eq.${state.session.user.id}` }, schedulePublicationsRefresh)
    .subscribe();
}

function chatIsFinished(chat, ratedTxIds, ratedLoanIds) {
  const request = asOne(chat.transaction_requests);
  const transaction = asOne(request?.transactions);
  const loan = asOne(chat.loan_requests?.loans);
  if (request?.status === 'REJECTED') return true;
  if (transaction?.status === 'CANCELLED') return true;
  if (loan?.status === 'CANCELLED') return true;
  if (transaction?.status === 'COMPLETED' && ratedTxIds.has(transaction.id)) return true;
  if (loan?.status === 'CLOSED' && ratedLoanIds.has(loan.id)) return true;
  return false;
}

async function loadChats() {
  const root = $('#chats-list');
  if (!state.session) { root.innerHTML = empty('Inicia sesión para ver tus conversaciones.', '◌'); return; }
  if (!isConfigured) { root.innerHTML = empty('Configura Supabase para usar el chat interno.', '◌'); return; }
  if (state.chatsLoading) { state.chatsRefreshQueued = true; return; }
  state.chatsLoading = true;
  try {
    const userId = state.session.user.id;
    const { data: chats, error } = await supabase.from('chats').select(chatSelect).or(`participant_a.eq.${userId},participant_b.eq.${userId}`);
    if (error) { root.innerHTML = empty('No fue posible cargar los chats.', '⚠'); return; }
    const chatIds = (chats || []).map(chat => chat.id);

    const [{ data: messages }, { data: hidden }, { data: ratings }] = await Promise.all([
      chatIds.length ? supabase.from('messages').select('chat_id,sender_id,content,created_at,message_receipts(recipient_id,delivered_at,read_at)').in('chat_id', chatIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      chatIds.length ? supabase.from('chat_hidden_users').select('chat_id').eq('user_id', userId).in('chat_id', chatIds) : Promise.resolve({ data: [] }),
      supabase.from('ratings').select('transaction_id,loan_id').eq('rater_id', userId)
    ]);

    const hiddenIds = new Set((hidden || []).map(row => row.chat_id));
    const lastByChat = new Map();
    (messages || []).forEach(message => {
      if (!lastByChat.has(message.chat_id)) lastByChat.set(message.chat_id, message);
    });

    const visible = (chats || []).filter(chat => !hiddenIds.has(chat.id));
    const otherIds = [...new Set(visible.map(chat => chat.participant_a === userId ? chat.participant_b : chat.participant_a))];
    const { data: people } = otherIds.length ? await supabase.from('public_profile_summaries').select('id,name,avatar_url').in('id', otherIds) : { data: [] };
    const personById = new Map((people || []).map(person => [person.id, person]));

    const ratedTxIds = new Set((ratings || []).map(row => row.transaction_id).filter(Boolean));
    const ratedLoanIds = new Set((ratings || []).map(row => row.loan_id).filter(Boolean));

    const sorted = visible
      .map(chat => ({ ...chat, lastMessage: lastByChat.get(chat.id) || null }))
      .sort((a, b) => new Date(b.lastMessage?.created_at || b.updated_at || b.created_at) - new Date(a.lastMessage?.created_at || a.updated_at || a.created_at));

    root.innerHTML = sorted.length ? sorted.map(chat => {
      const other = personById.get(chat.participant_a === userId ? chat.participant_b : chat.participant_a);
      const userName = other?.name || 'Nombre del usuario';
      const message = chat.lastMessage;
      const finished = chatIsFinished(chat, ratedTxIds, ratedLoanIds);
      const receipt = asOne(message?.message_receipts);
      const processEndedAt = chatFinishedAt(chat);
      const messageAfterFinish = Boolean(finished && message && processEndedAt && new Date(message.created_at) > new Date(processEndedAt));
      const isUnread = Boolean(message && message.sender_id !== userId && !receipt?.read_at && (!finished || messageAfterFinish));
      const topRight = isUnread ? '<span class="chat-unread-dot" aria-label="Mensaje sin leer"></span>' : '';
      const previewText = message && (!finished || messageAfterFinish) ? chatPreview(message.content) : 'Proceso terminado';
      const statusIcon = message && (!finished || messageAfterFinish) ? chatRowStatusIcon(message, userId) : '';
      const timeText = chatListStamp(message?.created_at || chat.updated_at || chat.created_at);
      const deleteButton = finished ? `<button type="button" class="chat-delete-btn chat-delete-bottom" data-action="hide-chat" data-chat-id="${chat.id}" aria-label="Eliminar conversación" title="Eliminar conversación"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2 2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>` : '';

      return `<article class="chat-row ${isUnread ? 'unread' : ''}" data-chat-id="${chat.id}" role="link" tabindex="0">
        <div class="chat-row-avatar">${avatarMarkup(other, userName)}</div>
        <div class="chat-row-body">
          <div class="chat-row-top">
            <h3 class="chat-row-name">${escapeHtml(userName)}</h3>
            ${topRight}
          </div>
          <p class="chat-row-preview">${escapeHtml(previewText)}</p>
          <div class="chat-row-bottom">
            ${statusIcon}
            <time class="chat-row-time">${escapeHtml(timeText)}</time>
            ${deleteButton}
          </div>
        </div>
      </article>`;
    }).join('') : empty('Aún no tienes chats visibles. Se crea uno al solicitar una compra, intercambio o préstamo.', '◌');
  } finally {
    state.chatsLoading = false;
    if (state.chatsRefreshQueued) {
      state.chatsRefreshQueued = false;
      scheduleChatsRefresh();
    }
  }
}

const loanStatusLabel = status => ({OPEN:'Vigente',EXPIRED:'Vencida',SELECTED:'Prestamista seleccionado',SCHEDULED:'Entrega programada',ACTIVE:'Préstamo activo',RETURN_PENDING:'Devolución pendiente',RETURNED:'Devuelto',CANCELLED:'Cancelado',CLOSED:'Cerrado'}[status] || status);
const loanSelect = 'id,requester_id,career_id,title,description,quantity,deadline,use_duration,estimated_return,status,created_at,careers(code,name),loan_offers(id,lender_id,note,status,created_at),loans(id,lender_id,status,meeting_point_id,meeting_at,return_meeting_point_id,return_meeting_at,expected_return_at,lender_delivered_at,requester_received_at,requester_returned_at,lender_received_at,closed_at,delivery_point:meeting_points!loans_meeting_point_id_fkey(name),return_point:meeting_points!loans_return_meeting_point_id_fkey(name))';
async function expireLoans() { if (isConfigured) await supabase.rpc('expire_loan_requests'); }
async function profileSummary(id) { const { data } = await supabase.from('public_profile_summaries').select('id,name,career_id,rating_average,avatar_url').eq('id',id).maybeSingle(); return data; }
async function createLoan(form) { if (!requireAuth()) return; const fields = new FormData(form); const deadline = new Date(fields.get('deadline')); const estimatedReturn = new Date(fields.get('estimated_return')); if (!fields.get('title').trim() || !fields.get('description').trim() || Number(fields.get('quantity')) < 1 || !fields.get('career_id')) return toast('Completa todos los campos obligatorios.', 'error'); if (deadline <= new Date() || estimatedReturn <= deadline) return toast('Usa fechas coherentes: límite futuro y devolución posterior.', 'error'); const { error } = await supabase.from('loan_requests').insert({ requester_id:state.session.user.id,title:fields.get('title').trim(),description:fields.get('description').trim(),quantity:Number(fields.get('quantity')),career_id:fields.get('career_id'),deadline:deadline.toISOString(),use_duration:fields.get('use_duration').trim(),estimated_return:estimatedReturn.toISOString(),status:'OPEN' }); if (error) return toast(error.message, 'error'); toast('Solicitud de préstamo publicada.', 'success'); closeModal(); loadLoans(); }
async function logout() { if (!isConfigured) return; await supabase.auth.signOut(); state.profileEditing = false; state.pendingAvatarFile = null; state.pendingAvatarPreview = null; await refreshSession(); toast('Sesión cerrada.'); location.hash='#home'; }

function bindEvents() {
  window.addEventListener('hashchange',()=>setView(location.hash.replace('#','') || 'home'));
  window.addEventListener('resize', syncProfileTabsHints);
  document.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'open-auth') openAuth();
    if (action === 'close-modal') closeModal();
    if (action === 'recover-password') recoverPassword();
    if (action === 'logout') logout();
    if (action === 'enable-notifications') enablePushNotifications();
    if (action === 'open-loan-form') { if(requireAuth()) openModal('loan-template'); }
    if (action === 'edit-profile') {
      state.profileEditing = true;
      state.pendingAvatarFile = null;
      state.pendingAvatarPreview = null;
      renderProfile();
    }
    if (action === 'cancel-profile-edit') {
      state.profileEditing = false;
      state.pendingAvatarFile = null;
      state.pendingAvatarPreview = null;
      renderProfile();
    }
    if (action === 'scroll-profile-tabs') {
      const scroller = $('#profile-tabs-scroller');
      const dir = Number(event.target.closest('[data-dir]')?.dataset.dir || 1);
      if (scroller) scroller.scrollBy({ left: dir * 160, behavior: 'smooth' });
    }
    if (action === 'toggle-search-filters') {
      const panel = $('#search-filters');
      const btn = $('#toggle-search-filters');
      if (panel && btn) {
        const willShow = panel.hidden;
        panel.hidden = !willShow;
        btn.setAttribute('aria-expanded', String(willShow));
      }
    }
    if (event.target.matches('[data-auth-tab]')) { $$('[data-auth-tab]').forEach(tab=>tab.classList.toggle('active',tab===event.target)); $('#login-form').hidden=event.target.dataset.authTab!=='login'; $('#register-form').hidden=event.target.dataset.authTab!=='register'; }
    if (event.target.id === 'session-button') state.session ? logout() : openAuth();
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'login-form') { event.preventDefault(); signIn(event.target); }
    if (event.target.id === 'register-form') { event.preventDefault(); register(event.target); }
    if (event.target.id === 'publish-form') { event.preventDefault(); publish(event.target); }
    if (event.target.id === 'loan-form') { event.preventDefault(); createLoan(event.target); }
    if (event.target.id === 'search-form') { event.preventDefault(); const q = new FormData(event.target).get('query'); loadSearch(q, Object.fromEntries(new FormData($('#search-filters')))); }
  });
}
function triggerSearchUpdate() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    const query = $('#search-input')?.value || '';
    const filters = Object.fromEntries(new FormData($('#search-filters')));
    loadSearch(query, filters);
  }, 240);
}
async function loadSearch(query, filters = {}) {
  if (!isConfigured) return toast('Configura Supabase para realizar búsquedas reales.', 'error');
  const target = $('#search-results');
  const term = String(query || '').trim().replace(/[(),%]/g, '');
  const hasFilters = Boolean(filters.career || filters.operation || filters.minPrice || filters.maxPrice);
  if (!term && !hasFilters) {
    target.innerHTML = empty('Escribe un producto, nombre o correo, o selecciona un filtro.', '⌕');
    return;
  }
  target.innerHTML = empty('Buscando…', '◌');
  let products = supabase.from('publications').select('id,owner_id,title,description,condition,price,stock,operation_type,status,created_at,careers(code),publication_images(public_url,position)').eq('status','AVAILABLE').order('created_at',{ascending:false}).limit(30);
  if (term) products = products.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  if (state.session && !state.isAdmin) products = products.neq('owner_id',state.session.user.id);
  if (filters.career) products = products.eq('career_id', filters.career);
  if (filters.operation) products = products.eq('operation_type', filters.operation);
  if (filters.minPrice) products = products.gte('price', filters.minPrice);
  if (filters.maxPrice) products = products.lte('price', filters.maxPrice);
  const peopleTask = term && state.session ? supabase.rpc('search_public_profiles', { p_query:term }) : Promise.resolve({ data:[] });
  const [{ data, error }, { data:people, error:peopleError }] = await Promise.all([products, peopleTask]);
  if (error) return target.innerHTML = empty('No se pudo realizar la búsqueda.', '⚠');
  const userRows = !peopleError && people?.length ? `<section class="search-users"><h2>Usuarios</h2>${people.map(person => `<button class="user-result" data-action="open-public-profile" data-user-id="${person.id}">${avatarMarkup(person)}<span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.email)}</small></span></button>`).join('')}</section>` : '';
  target.innerHTML = `${userRows}<section class="search-products"><h2>Publicaciones</h2><div class="card-grid">${renderCards(await enrichPublications(data || []))}</div></section>`;
}
async function loadLoanDetail(id) { await expireLoans(); const { data:loan,error } = await supabase.from('loan_requests').select(loanSelect).eq('id',id).single(); if (error || !loan) { toast('No fue posible cargar esta solicitud.','error'); return null; } loan.requester = await profileSummary(loan.requester_id); loan.loan_offers = loan.loan_offers || []; loan.offerPeople = new Map((await Promise.all(loan.loan_offers.map(offer=>profileSummary(offer.lender_id)))).filter(Boolean).map(person=>[person.id,person])); return loan; }
async function openLoanDetail(id) { if (!requireConfig()) return; const loan=await loadLoanDetail(id); if(!loan)return; const owner=state.session?.user.id===loan.requester_id; const offers=owner?loan.loan_offers.map(offer=>`<article class="list-card"><div><h3>${escapeHtml(loan.offerPeople.get(offer.lender_id)?.name||'Estudiante ITESA')}</h3><p>${escapeHtml(offer.note||'Sin mensaje adicional')}</p><span class="badge ${offer.status==='PENDING'?'':'pending'}">${escapeHtml(offer.status)}</span></div>${loan.status==='OPEN'&&offer.status==='PENDING'?`<button class="button compact" data-select-loan-offer="${offer.id}">Seleccionar</button>`:''}</article>`).join(''):''; const action=!owner&&loan.status==='OPEN'?'<button class="button success" data-action="open-loan-offer">Ofrecer préstamo</button>':''; const activeLoan=Array.isArray(loan.loans)?loan.loans[0]:loan.loans; const progress=activeLoan?`<p><strong>Proceso:</strong> ${loanStatusLabel(activeLoan.status)}${activeLoan.meeting_at?` · ${new Date(activeLoan.meeting_at).toLocaleString('es-MX')}`:''}</p>`:''; $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="loan-detail-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">PRÉSTAMO</p><h2 id="loan-detail-title">${escapeHtml(loan.title)}</h2><p class="detail-description">${escapeHtml(loan.description)}</p><div class="detail-meta"><p><strong>Cantidad</strong><br>${loan.quantity}</p><p><strong>Carrera</strong><br>${escapeHtml(loan.careers?.code||'ITESA')}</p><p><strong>Límite</strong><br>${new Date(loan.deadline).toLocaleString('es-MX')}</p><p><strong>Uso</strong><br>${escapeHtml(loan.use_duration)}</p><p><strong>Devolución estimada</strong><br>${new Date(loan.estimated_return).toLocaleString('es-MX')}</p><p><strong>Estado</strong><br><span class="badge ${loan.status==='OPEN'?'':'pending'}">${loanStatusLabel(loan.status)}</span></p></div><p><strong>Solicitante:</strong> ${escapeHtml(loan.requester?.name||'Estudiante ITESA')}</p>${progress}${action}${owner?`<h3>Propuestas recibidas</h3>${offers||'<p>Aún no tienes propuestas.</p>'}`:''}</section></div>`; state.activeLoanRequest=loan; }
function openLoanOfferForm(){
  const loan=state.activeLoanRequest;
  if(!requireAuth()||!loan)return;
  if(loan.requester_id===state.session.user.id)return toast('No puedes ofrecerte para tu propia solicitud.','error');
  if(loan.status!=='OPEN')return toast('Esta solicitud ya no acepta propuestas.','error');
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="loan-offer-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button><h2 id="loan-offer-title">Ofrecer préstamo</h2><p>${escapeHtml(loan.title)}</p><form id="loan-offer-form" class="auth-form"><div class="form-group"><div class="floating-field"><textarea id="loan-offer-note" name="note" rows="3" maxlength="1000" placeholder=" "></textarea><label for="loan-offer-note">Mensaje opcional</label></div></div><button class="button success" type="submit">Enviar propuesta</button></form></section></div>`;
  syncFloatingFields($('#modal-root'));
}
async function submitLoanOffer(form){
  const loan=state.activeLoanRequest;
  if(!loan)return;
  const note = (new FormData(form).get('note') || '').trim();
  const {error}=await supabase.rpc('create_loan_offer',{p_loan_request_id:loan.id,p_note:note||null});
  if(error)return toast(error.message,'error');
  toast('Propuesta enviada.','success');
  closeModal();
  loadLoans();
}
function bindLoanContacts() {
  document.addEventListener('click', event => {
    const card=event.target.closest('[data-loan-id]');
    if(card && !event.target.closest('[data-action="open-public-profile"]')) return openLoanDetail(card.dataset.loanId);
    const select=event.target.closest('[data-select-loan-offer]');
    if(select)return selectLoanOffer(select.dataset.selectLoanOffer);
    const reject=event.target.closest('[data-reject-loan-offer]');
    if(reject)return rejectLoanOffer(reject.dataset.rejectLoanOffer);
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='open-loan-offer')openLoanOfferForm();
    if(action==='open-my-loans')openMyLoans();
  });
  document.addEventListener('submit',event=>{if(event.target.id==='loan-offer-form'){event.preventDefault();submitLoanOffer(event.target);}});
}

const conditionLabel = condition => condition === 'NEW' ? 'Nuevo' : 'Usado';
const operationLabel = operation => operation === 'SALE' ? 'Venta' : 'Intercambio';
const publicationSelect = 'id,owner_id,career_id,title,description,condition,price,stock,operation_type,status,created_at,updated_at,completed_at,careers(code,name),publication_images(id,storage_path,public_url,position)';

async function loadPublicationDetail(id) {
  const { data: publication, error } = await supabase.from('publications').select(publicationSelect).eq('id', id).single();
  if (error || !publication) { toast('No fue posible cargar esta publicación.', 'error'); return null; }
  publication.publication_images = (publication.publication_images || []).sort((a,b) => a.position - b.position);
  const { data: seller } = await supabase.from('public_profile_summaries').select('id,name,rating_average').eq('id', publication.owner_id).maybeSingle();
  publication.seller = seller;
  return publication;
}

function openRequestForm(product) {
  if (!requireAuth()) return;
  if (!product || product.owner_id === state.session.user.id) return toast('No puedes solicitar tu propia publicación.', 'error');
  if (product.status !== 'AVAILABLE') return toast('Esta publicación ya no está disponible.', 'error');
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="request-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button><p class="eyebrow">${operationLabel(product.operation_type).toUpperCase()}</p><h2 id="request-title">${escapeHtml(product.title)}</h2><p>Confirma la cantidad que deseas solicitar.</p><form id="request-form" class="auth-form"><div class="form-group"><div class="floating-field has-value"><input id="request-quantity" name="quantity" type="number" min="1" max="${product.stock}" value="1" required placeholder=" " /><label for="request-quantity">Cantidad</label></div><div class="floating-field"><textarea id="request-note" name="note" rows="3" placeholder=" "></textarea><label for="request-note">Mensaje opcional</label></div></div><button class="button success" type="submit">${product.operation_type === 'SALE' ? 'Solicitar compra' : 'Solicitar intercambio'}</button></form></section></div>`;
  syncFloatingFields($('#modal-root'));
  $('#request-form').addEventListener('submit', event => createTransactionRequest(event, product));
}

function renderCurrentImages() {
  const root = $('#current-images'); const publication = state.editingPublication;
  if (!publication) { root.hidden = true; root.innerHTML = ''; return; }
  const images = publication.publication_images.filter(image => !state.imagesToDelete.has(image.id));
  root.hidden = false; root.className = 'current-images';
  root.innerHTML = `<p class="current-images-note">Imágenes actuales (${images.length}/4). Selecciona × para eliminarlas al guardar.</p>${images.map(image => `<div class="current-image"><img src="${escapeHtml(image.public_url)}" alt="Imagen actual de ${escapeHtml(publication.title)}" /><button type="button" data-remove-image="${image.id}" aria-label="Eliminar imagen">×</button></div>`).join('')}`;
}

async function startPublicationEdit() {
  if (!requireAuth()) return;
  const product = await loadPublicationDetail(state.detailPublication?.id);
  if (!product) return;
  if (product.owner_id !== state.session.user.id) return toast('Solo puedes editar tus propias publicaciones.', 'error');
  state.editingPublication = product; state.imagesToDelete = new Set(); closeModal(); location.hash = '#publish';
  const form = $('#publish-form'); form.title.value = product.title; form.description.value = product.description; form.condition.value = product.condition; form.price.value = product.price; form.operation_type.value = product.operation_type; form.stock.value = product.stock; form.career_id.value = product.career_id; form.status.value = product.status;
  $('#publish-title').textContent = 'Editar publicación'; $('#publish-submit').textContent = 'Guardar cambios'; $('#publication-career-field').hidden = true; $('#publication-status-field').hidden = false; $('#cancel-edit').hidden = false; form.stock.min = '0'; renderCurrentImages(); updatePublishFileUI(form.images); syncFloatingFields(form);
}

function resetPublicationMode() {
  state.editingPublication = null; state.imagesToDelete = new Set(); const form = $('#publish-form'); form.reset(); form.stock.value = 1; form.stock.min = '1'; form.career_id.value = state.profile?.career_id || ''; $('#publish-title').textContent = 'Comparte algo útil'; $('#publish-submit').textContent = 'Publicar artículo'; $('#publication-career-field').hidden = true; $('#publication-status-field').hidden = true; $('#cancel-edit').hidden = true; renderCurrentImages(); updatePublishFileUI(form.images); syncFloatingFields(form);
}

function validatePublicationForm(form, retainedCount) {
  const fields = new FormData(form); const images = [...form.images.files];
  if (images.length + retainedCount > 4) { toast('El total de imágenes no puede superar cuatro.', 'error'); return null; }
  if (images.some(file => !['image/jpeg','image/png'].includes(file.type))) { toast('Solo se aceptan imágenes JPG, JPEG o PNG.', 'error'); return null; }
  if (!state.editingPublication && Number(fields.get('stock')) < 1) { toast('La cantidad inicial debe ser al menos 1.', 'error'); return null; }
  if (state.editingPublication && Number(fields.get('stock')) < 0) { toast('La cantidad no puede ser negativa.', 'error'); return null; }
  if (fields.get('operation_type') === 'SALE' && (!fields.get('price') || Number(fields.get('price')) <= 0)) { toast('Indica un precio válido para una venta.', 'error'); return null; }
  return { fields, images };
}

async function uploadPublicationImages(publication, images, startPosition) {
  for (let index = 0; index < images.length; index++) {
    const file = images[index]; const extension = file.name.split('.').pop().toLowerCase(); const path = `${state.session.user.id}/${publication.id}/${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage.from('publication-images').upload(path, file, { contentType:file.type });
    if (upload.error) { toast(`La publicación se guardó, pero una imagen no pudo subir: ${upload.error.message}`, 'error'); continue; }
    const { data:url } = supabase.storage.from('publication-images').getPublicUrl(path);
    const { error } = await supabase.from('publication_images').insert({ publication_id:publication.id, storage_path:path, public_url:url.publicUrl, position:startPosition + index });
    if (error) toast(`La imagen se subió, pero no pudo asociarse: ${error.message}`, 'error');
  }
}

async function publish(form) {
  if (!requireAuth()) return;
  const current = state.editingPublication; const retained = current ? current.publication_images.filter(image => !state.imagesToDelete.has(image.id)) : [];
  const valid = validatePublicationForm(form, retained.length); if (!valid) return;
  const { fields, images } = valid;
  if (!current) {
    const payload = { owner_id:state.session.user.id, title:fields.get('title').trim(), description:fields.get('description').trim(), operation_type:fields.get('operation_type'), condition:fields.get('condition'), price:fields.get('price') || 0, stock:Number(fields.get('stock')), career_id:state.profile?.career_id };
    const { data:publication, error } = await supabase.from('publications').insert(payload).select().single(); if (error) return toast(error.message, 'error');
    await uploadPublicationImages(publication, images, 0); form.reset(); updatePublishFileUI(form.images); syncFloatingFields(form); toast('Publicación creada.', 'success'); location.hash = '#home'; return;
  }
  if (current.owner_id !== state.session.user.id) return toast('No tienes permiso para editar esta publicación.', 'error');
  const stock = Number(fields.get('stock')); const status = stock === 0 ? 'COMPLETED' : fields.get('status'); const payload = { title:fields.get('title').trim(), description:fields.get('description').trim(), operation_type:fields.get('operation_type'), condition:fields.get('condition'), price:fields.get('price') || 0, stock, career_id:current.career_id, status, completed_at:status === 'COMPLETED' ? (current.completed_at || new Date().toISOString()) : null };
  const { data:updated, error } = await supabase.from('publications').update(payload).eq('id',current.id).eq('owner_id',state.session.user.id).select().single(); if (error || !updated) return toast(error?.message || 'No fue posible actualizar la publicación.', 'error');
  for (const image of current.publication_images.filter(image => state.imagesToDelete.has(image.id))) { const removed = await supabase.storage.from('publication-images').remove([image.storage_path]); if (removed.error) return toast(`No se pudo eliminar una imagen: ${removed.error.message}`, 'error'); const deleted = await supabase.from('publication_images').delete().eq('id',image.id).eq('publication_id',current.id); if (deleted.error) return toast(deleted.error.message, 'error'); }
  for (let index = 0; index < retained.length; index++) { const positioned = await supabase.from('publication_images').update({ position:index }).eq('id',retained[index].id).eq('publication_id',current.id); if (positioned.error) return toast(positioned.error.message, 'error'); }
  await uploadPublicationImages(updated, images, retained.length); resetPublicationMode(); toast('Publicación actualizada.', 'success'); location.hash = '#home';
}

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'request-from-detail') openRequestForm(state.detailPublication);
  if (action === 'edit-publication') startPublicationEdit();
  if (event.target.id === 'cancel-edit') { resetPublicationMode(); location.hash = '#home'; }
  const imageButton = event.target.closest('[data-remove-image]'); if (imageButton) { state.imagesToDelete.add(imageButton.dataset.removeImage); renderCurrentImages(); }
});

document.addEventListener('click', async event => {
  const menuWrap = event.target.closest('.card-menu-wrap');
  const trigger = event.target.closest('[data-action]');
  const action = trigger?.dataset.action;
  const profileTabBtn = event.target.closest('[data-profile-tab]');

  if (!menuWrap) closeCardMenus();
  if (action === 'toggle-card-menu') {
    const wrap = trigger.closest('.card-menu-wrap');
    const menu = wrap?.querySelector('.card-floating-menu');
    const willOpen = Boolean(menu?.hidden);
    closeCardMenus(wrap);
    if (menu) { menu.hidden = !willOpen; trigger.setAttribute('aria-expanded', String(willOpen)); }
    return;
  }
  if (profileTabBtn) {
    $$('.profile-tabs .tab').forEach(tab => tab.classList.toggle('active', tab === profileTabBtn));
    return loadProfileTab(profileTabBtn.dataset.profileTab);
  }
  if (!action) {
    const chat = event.target.closest('.chat-row');
    if (chat && !event.target.closest('button')) location.href = chatUrl(chat.dataset.chatId);
    return;
  }
  if (action === 'toggle-favorite') return toggleFavorite(trigger.dataset.publicationId);
  if (action === 'request-publication') { const item = state.publications.find(publication => publication.id === trigger.dataset.publicationId) || await loadPublicationDetail(trigger.dataset.publicationId); return openRequestForm(item); }
  if (action === 'edit-card-publication') { state.detailPublication = await loadPublicationDetail(trigger.dataset.publicationId); return startPublicationEdit(); }
  if (action === 'repost-publication') return repostPublication(trigger.dataset.publicationId);
  if (action === 'report-publication-confirm') { closeCardMenus(); return openReportDialog('publication', trigger.dataset.publicationId); }
  if (action === 'report-user') return openReportDialog('user', trigger.dataset.userId);
  if (action === 'open-public-profile') return openPublicProfile(trigger.dataset.userId);
  if (action === 'chat-with-user') return chatWithUser(trigger.dataset.userId);
  if (action === 'block-user') return blockUser(trigger.dataset.userId);
  if (action === 'suspend-user') return suspendUser(trigger.dataset.userId);
  if (action === 'resolve-report') return resolveReport(trigger);
  if (action === 'admin-remove-publication') { closeCardMenus(); return removePublicationAsAdmin(trigger.dataset.publicationId); }
  if (action === 'hide-chat') { event.stopPropagation(); return hideChats([trigger.dataset.chatId]); }
});

document.addEventListener('submit', event => {
  if (event.target.id === 'profile-form') { event.preventDefault(); saveProfile(event.target); }
  if (event.target.id === 'report-form') { event.preventDefault(); submitReport(event.target); }
});
document.addEventListener('input', event => {
  if (event.target.closest('.floating-field')) syncFloatingFields(event.target.closest('.floating-field').parentElement);
  if (event.target.dataset.avatarCrop) { state.avatarCrop[event.target.dataset.avatarCrop] = Number(event.target.value); const preview = $('#profile-avatar-preview'); if (preview) { preview.style.objectPosition = `${state.avatarCrop.x}% ${state.avatarCrop.y}%`; preview.style.transform = `scale(${state.avatarCrop.zoom})`; preview.style.transformOrigin = `${state.avatarCrop.x}% ${state.avatarCrop.y}%`; } }
  if (event.target.id === 'search-input' || event.target.closest('#search-filters')) triggerSearchUpdate();
});
document.addEventListener('change', event => {
  if (event.target.closest('.floating-field')) syncFloatingFields(event.target.closest('.floating-field').parentElement);
  if (event.target.id === 'pub-stock' && state.editingPublication && Number(event.target.value) === 0) { $('#pub-status').value = 'COMPLETED'; syncFloatingFields($('#pub-status').closest('.form-group')); }
  if (event.target.id === 'pub-images') updatePublishFileUI(event.target);
  if (event.target.id === 'profile-avatar-input') {
    const file = event.target.files?.[0];
    if (file) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { event.target.value = ''; return toast('Selecciona una foto JPG, PNG o WEBP de hasta 15 MB.', 'error'); }
      if (state.pendingAvatarPreview) URL.revokeObjectURL(state.pendingAvatarPreview);
      state.pendingAvatarFile = file;
      state.pendingAvatarPreview = URL.createObjectURL(file);
      state.avatarCrop = { zoom: 1, x: 50, y: 50 };
      renderProfile();
    }
  }
  if (event.target.closest('#search-filters')) triggerSearchUpdate();
});
document.addEventListener('toggle', event => {
  if (event.target.matches('.card-details')) event.target.querySelector('summary').textContent = event.target.open ? 'Ver menos detalles' : 'Ver más detalles';
}, true);
document.addEventListener('scroll', event => {
  if (event.target.id === 'profile-tabs-scroller') {
    syncProfileTabsHints();
    return;
  }
  if (!event.target.matches?.('.product-gallery')) return;
  const gallery = event.target;
  const dots = gallery.parentElement?.querySelectorAll('.gallery-dot');
  if (!dots?.length || !gallery.clientWidth) return;
  const activeIndex = Math.round(gallery.scrollLeft / gallery.clientWidth);
  dots.forEach((dot, idx) => dot.classList.toggle('active', idx === activeIndex));
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeCardMenus();
  const chat = event.target.closest('.chat-row');
  if (chat && !event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); location.href = chatUrl(chat.dataset.chatId); return; }
});

async function loadLoans() {
  const root = $('#loans-list');
  if (!isConfigured) { root.innerHTML = empty('Configura Supabase para consultar solicitudes de préstamo.', '◌'); return; }
  await expireLoans();
  const { data, error } = await supabase.from('loan_requests').select('id,requester_id,title,description,quantity,status,deadline,use_duration,careers(code)').eq('status','OPEN').order('created_at',{ascending:false});
  if (error) { root.innerHTML = empty('No se pudieron cargar las solicitudes.', '⚠'); return; }
  const requests = (data || []).filter(item => item.requester_id !== state.session?.user.id);
  const people = new Map((await Promise.all(requests.map(item => profileSummary(item.requester_id)))).filter(Boolean).map(person => [person.id,person]));
  root.innerHTML = requests.length ? requests.map(item => {
    const requester = people.get(item.requester_id) || {};
    const careerCode = state.careers.find(c => c.id === requester.career_id)?.code || item.careers?.code || 'ITESA';
    return `<article class="loan-request-card" tabindex="0" role="button" data-loan-id="${item.id}" aria-label="Ver solicitud de ${escapeHtml(item.title)}"><header class="loan-request-header"><button type="button" class="owner-link" data-action="open-public-profile" data-user-id="${item.requester_id}">${avatarMarkup(requester)}<span class="owner-info"><span class="owner-name">${escapeHtml(requester.name || 'Nombre de usuario')}</span><span class="owner-career">Carrera: ${escapeHtml(careerCode)}</span></span></button></header><div class="loan-request-content"><div class="loan-request-info"><h3 class="loan-request-title">${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><p>${item.quantity} unidad(es).</p><p>Límite: ${formatLoanDeadline(item.deadline)}</p><p>Tiempo de uso: ${escapeHtml(item.use_duration)}</p></div><div class="loan-request-action"><button class="button" type="button" data-action="offer-loan-direct" data-loan-id="${item.id}">Ofrecer préstamo</button></div></div></article>`;
  }).join('') : empty('No hay solicitudes de préstamo vigentes de otros estudiantes.', '◌');
}

async function openMyLoans() {
  if (!requireAuth()) return;
  await expireLoans();
  const [{ data:requests, error:requestsError }, { data:loans, error:loansError }] = await Promise.all([
    supabase.from('loan_requests').select('id,title,status,deadline,created_at,loan_offers(id,lender_id,note,status,created_at),chats(id)').eq('requester_id',state.session.user.id).order('created_at',{ascending:false}),
    supabase.from('loans').select('id,loan_request_id,status,requester_id,lender_id,expected_return_at,created_at,loan_requests(title,chats(id))').or(`requester_id.eq.${state.session.user.id},lender_id.eq.${state.session.user.id}`).order('created_at',{ascending:false})
  ]);
  if (requestsError || loansError) return toast('No fue posible cargar tus préstamos.', 'error');

  const loanByRequestId = new Map((loans || []).map(l => [l.loan_request_id, l]));
  const activeLoanStatuses = new Set(['SELECTED', 'SCHEDULED', 'ACTIVE', 'RETURN_PENDING', 'RETURNED']);

  const requestRows = (requests || []).map(item => {
    const associatedLoan = loanByRequestId.get(item.id);
    const effectiveStatus = associatedLoan ? associatedLoan.status : item.status;
    const isConcluded = effectiveStatus === 'EXPIRED' || effectiveStatus === 'CLOSED' || effectiveStatus === 'CANCELLED';
    const offers = item.loan_offers || [];
    const chatId = asOne(item.chats)?.id;
    let actionBtn = '';
    if (!isConcluded) {
      if (effectiveStatus === 'OPEN') {
        actionBtn = `<button class="button compact" data-action="view-my-loan-offers" data-loan-id="${item.id}">Ver</button>`;
      } else if (activeLoanStatuses.has(effectiveStatus) && chatId) {
        actionBtn = `<a class="button compact" href="${chatUrl(chatId)}">Chatear</a>`;
      }
    }
    return `<article class="list-card"><div><h3>${escapeHtml(item.title)}</h3><p>${effectiveStatus === 'EXPIRED' ? 'Vencida' : loanStatusLabel(effectiveStatus)}</p><small>${offers.length ? `${offers.length} propuesta(s) recibida(s)` : 'Sin propuestas recibidas'}</small></div>${actionBtn}</article>`;
  }).join('') || '<p>Aún no has creado solicitudes.</p>';

  const lent = (loans || []).filter(item => item.lender_id === state.session.user.id);
  const loanRows = lent.map(item => {
    const isConcluded = item.status === 'CLOSED' || item.status === 'CANCELLED' || item.status === 'EXPIRED';
    const chatId = asOne(item.loan_requests?.chats)?.id;
    const actionBtn = !isConcluded && activeLoanStatuses.has(item.status) && chatId
      ? `<a class="button compact" href="${chatUrl(chatId)}">Chatear</a>`
      : '';
    return `<article class="list-card"><div><h3>${escapeHtml(item.loan_requests?.title || 'Préstamo')}</h3><p>${loanStatusLabel(item.status)}</p><small>Devolución estimada: ${new Date(item.expected_return_at).toLocaleDateString('es-MX')}</small></div>${actionBtn}</article>`;
  }).join('') || '<p>Aún no has ofrecido ni prestado artículos.</p>';

  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="my-loans-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button><h2 id="my-loans-title">Mis préstamos</h2><h3>Solicitudes</h3>${requestRows}<h3>Préstamos</h3>${loanRows}</section></div>`;
}

async function selectLoanOffer(offerId) {
  const { data: offer, error: offerError } = await supabase.from('loan_offers').select('loan_request_id,lender_id,note').eq('id', offerId).single();
  if (offerError) return toast('No fue posible identificar la propuesta.', 'error');

  const { error } = await supabase.rpc('select_loan_lender', { p_offer_id: offerId });
  if (error) return toast(error.message, 'error');

  const { data: chat } = await supabase.from('chats').select('id').eq('loan_request_id', offer.loan_request_id).maybeSingle();
  if (chat?.id && offer.note && offer.note.trim()) {
    const { data: existing } = await supabase.from('messages').select('id').eq('chat_id', chat.id).limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from('messages').insert({
        chat_id: chat.id,
        sender_id: offer.lender_id,
        content: offer.note.trim()
      });
    }
  }

  toast('Prestamista seleccionado.', 'success');
  if (chat?.id) location.href = chatUrl(chat.id);
  else { closeModal(); loadLoans(); }
}

async function rejectLoanOffer(offerId) {
  const { error } = await supabase.rpc('reject_loan_offer', { p_offer_id: offerId });
  if (error) return toast(error.message, 'error');
  toast('Propuesta rechazada.', 'success');
  closeModal();
  loadLoans();
}

async function viewReceivedLoanOffers(loanId) { const loan = await loadLoanDetail(loanId); if (!loan) return; const offers = loan.loan_offers || []; $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="received-offers-title"><button class="modal-close" data-action="close-modal" aria-label="Cerrar">×</button><h2 id="received-offers-title">Propuestas recibidas</h2>${offers.length ? offers.map(offer => `<article class="list-card"><div><h3>${escapeHtml(loan.offerPeople.get(offer.lender_id)?.name || 'Estudiante ITESA')}</h3><p>${escapeHtml(offer.note || 'Sin mensaje adicional')}</p></div>${offer.status === 'PENDING' && loan.status === 'OPEN' ? `<button class="button compact" data-select-loan-offer="${offer.id}">Seleccionar</button>` : `<span class="badge pending">${escapeHtml(offer.status)}</span>`}</article>`).join('') : '<p>Aún no hay propuestas para esta solicitud.</p>'}</section></div>`; }
document.addEventListener('click', async event => { const offer = event.target.closest('[data-action="offer-loan-direct"]'); if (offer) { event.preventDefault(); event.stopImmediatePropagation(); await openLoanDetail(offer.dataset.loanId); return openLoanOfferForm(); } const view = event.target.closest('[data-action="view-my-loan-offers"]'); if (view) { event.preventDefault(); event.stopImmediatePropagation(); return viewReceivedLoanOffers(view.dataset.loanId); } }, true);

async function init() { bindEvents(); bindLoanContacts(); syncFloatingFields(); window.addEventListener('beforeunload', stopChatsRealtime); await loadCareers(); await refreshSession(); registerCurrentServiceWorker().catch(error => console.error('No se pudo actualizar la aplicación instalada:', error)); if (isConfigured) { supabase.auth.onAuthStateChange(()=>refreshSession()); } else toast('Modo preparación: añade la URL y anon key de Supabase para activar las funciones.', ''); setView(location.hash.replace('#','') || 'home'); }
init().catch(error => { console.error('No fue posible iniciar ITEStore:', error); const target = $('#feed') || $('#profile-content'); if (target) target.innerHTML = empty('No se pudo iniciar la aplicación. Recarga desde http://localhost:8000 después de aplicar las migraciones.', '⚠'); });
