import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors });
  try {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const client = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const { data:{ user }, error:userError } = await client.auth.getUser(token);
    if (userError || !user) return new Response('No autorizado', { status:401, headers:cors });
    const { messageId } = await request.json();
    if (!messageId) return new Response('messageId requerido', { status:400, headers:cors });
    const { data:message } = await client.from('messages').select('id,chat_id,sender_id').eq('id',messageId).maybeSingle();
    if (!message || message.sender_id !== user.id) return new Response('Evento no autorizado', { status:403, headers:cors });
    const { data:chat } = await client.from('chats').select('participant_a,participant_b').eq('id',message.chat_id).single();
    const recipientId = chat?.participant_a === user.id ? chat?.participant_b : chat?.participant_a;
    if (!recipientId) return new Response('Destinatario no encontrado', { status:404, headers:cors });
    const { error:dispatchError } = await client.from('push_dispatches').insert({ message_id:message.id, recipient_id:recipientId });
    if (dispatchError?.code === '23505') return Response.json({ duplicate:true }, { headers:cors });
    if (dispatchError) throw dispatchError;
    const { data:active } = await client.from('active_chat_sessions').select('user_id').eq('user_id',recipientId).eq('chat_id',message.chat_id).gt('expires_at',new Date().toISOString()).maybeSingle();
    if (active) { await client.from('push_dispatches').update({ skipped_active_at:new Date().toISOString() }).eq('message_id',message.id); return Response.json({ active:true }, { headers:cors }); }
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
    const subject = Deno.env.get('VAPID_SUBJECT') || '';
    if (!publicKey || !privateKey || !subject) throw new Error('Faltan secretos VAPID en la función');
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const { data:subscriptions } = await client.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id',recipientId).is('revoked_at',null);
    const payload = JSON.stringify({ title:'ITEStore', body:'Tienes un mensaje nuevo.', url:`/chat.html?v=20261117-3&id=${message.chat_id}`, tag:`message-${message.id}` });
    await Promise.all((subscriptions || []).map(async subscription => {
      try { await webpush.sendNotification({ endpoint:subscription.endpoint, keys:{ p256dh:subscription.p256dh, auth:subscription.auth } }, payload); }
      catch (error: any) { const status = error?.statusCode; if (status === 404 || status === 410) await client.from('push_subscriptions').update({ revoked_at:new Date().toISOString() }).eq('id',subscription.id); else console.error('Push no entregado', error); }
    }));
    await client.from('push_dispatches').update({ sent_at:new Date().toISOString() }).eq('message_id',message.id);
    return Response.json({ sent:(subscriptions || []).length }, { headers:cors });
  } catch (error) { console.error(error); return new Response('No se pudo procesar la notificación', { status:500, headers:cors }); }
});
