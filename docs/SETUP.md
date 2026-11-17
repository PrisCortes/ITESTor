# Configuración de ITEStore con Supabase

## 1. Crear el proyecto

1. Entra a [Supabase](https://supabase.com/dashboard), crea un proyecto y espera a que esté listo.
2. En **Authentication > Providers**, activa **Email**. En **Authentication > Settings**, activa la confirmación de correo.
3. En **Authentication > URL Configuration**, agrega la dirección donde servirás ITEStore (por ejemplo, `http://localhost:8000`) a las Redirect URLs.

## 2. Crear la base de datos

En **SQL Editor**, ejecuta los archivos en este orden exacto:

1. `supabase/schema.sql`
2. `supabase/policies.sql`
3. `supabase/storage.sql`
4. `supabase/seed.sql`

No alteres el orden: el esquema crea las tablas, las políticas las protegen, Storage crea su bucket y el seed agrega carreras/puntos. Si `alter publication ... messages` indica que la tabla ya pertenece a la publicación de Realtime, puede omitirse solo esa línea.

Si ya habías ejecutado el esquema antes de la mejora de detalle, ejecuta una vez, en este orden: `supabase/migrations/20260927_public_profile_summaries.sql`, `supabase/migrations/20260927_publication_images_update_policy.sql` y `supabase/migrations/20260927_pending_publication_detail_policy.sql`. La segunda migración permite al propietario reordenar únicamente sus propias imágenes después de eliminar una. La tercera permite consultar una publicación pendiente y sus imágenes para mostrar el detalle, pero mantiene las concluidas fuera del catálogo público. La migración social posterior incorpora avatar y correo institucional al resumen porque son campos explícitamente requeridos en el perfil; los perfiles interactivos se obtienen mediante RPC con validación de bloqueos.

Para habilitar el flujo completo de préstamos ejecuta después `supabase/migrations/20260927_complete_loans_module.sql`. La migración añade las RPCs seguras, el vencimiento al consultar, recordatorios internos y el campo de cierre. No elimina datos existentes. Si ya ejecutaste esa migración, ejecuta una vez después `supabase/migrations/20260927_fix_chat_loan_compatibility.sql`; corrige una recursión de RLS entre solicitudes y ofertas de préstamo sin modificar tablas, FKs, chats ni mensajes. Por último, ejecuta `supabase/migrations/20260927_complete_loan_chat_flow.sql` para agregar la programación segura de devolución y sus campos históricos separados.

Después, comprueba en **Database > Replication** que `messages` esté habilitada para `supabase_realtime`. Para la actualización en tiempo real del listado de chats, ejecuta también una vez `supabase/migrations/20261113_realtime_chat_list.sql`; registra `chats` en la misma publicación y actualiza su actividad cuando llega un mensaje o cambia la operación asociada. No elimina chats ni mensajes.

Para la versión social, administrativa y de notificaciones, ejecuta después y una sola vez estas migraciones, en el orden listado:

1. `supabase/migrations/20261113_social_admin_and_notifications.sql`
2. `supabase/migrations/20261113_profile_storage.sql`
3. `supabase/migrations/20261113_security_workflows_and_admin.sql`
4. `supabase/migrations/20261113_realtime_operational_updates.sql`
5. `supabase/migrations/20261113_push_presence.sql`
6. `supabase/migrations/20261113_chat_system_events.sql`

Estas migraciones añaden favoritos, avatares, reportes, bloqueos, roles, suspensiones, auditoría, ocultamiento lógico de conversaciones, estados verificables de mensaje, presencia efímera y suscripciones push. No eliminan mensajes, transacciones, préstamos ni publicaciones históricas. Para asignar el primer administrador, usa el SQL Editor con una cuenta de mantenimiento: inserta el UUID de una cuenta existente en `public.user_roles` con `role = 'ADMIN'`. Ningún usuario puede asignarse ese rol desde la aplicación.

## 3. Agregar las credenciales públicas

1. Ve a **Project Settings > API**.
2. Copia **Project URL** y la clave **anon** o **publishable** pública.
3. Copia `js/config.example.js` como `js/config.js`.
4. Sustituye `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `js/config.js`.

`js/config.js` está ignorado por Git. Nunca uses ni pegues una clave `service_role` en el frontend.

## 3.1 Notificaciones push y PWA

La interfaz usa el Service Worker `sw.js`, el manifiesto `manifest.webmanifest`, Realtime para actualizar pantallas abiertas, `internal_notifications` para avisos persistentes y Web Push para avisos fuera de ITEStore. Son capas distintas: Realtime no sustituye a Push.

1. Genera un par VAPID y coloca **solo** la clave pública en `VAPID_PUBLIC_KEY` de `js/config.js`.
2. Configura en la función Edge los secretos `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (por ejemplo, `mailto:soporte@itesa.edu.mx`). No coloques la clave privada en archivos web.
3. Despliega `supabase/functions/send-push/index.ts` como función `send-push`.
4. Sirve el sitio mediante HTTPS en producción (o `localhost` durante desarrollo). El navegador solicita permiso únicamente al pulsar **Activar notificaciones**.

Cada navegador se registra en `push_subscriptions`. Al enviar un mensaje, el servidor valida que quien lo notificó es el remitente real, evita reenvíos con `push_dispatches`, envía a todos los dispositivos del destinatario y revoca suscripciones 404/410. `active_chat_sessions` expira en 90 segundos y evita el Push si el destinatario está realmente en ese mismo chat. En iOS y algunos navegadores, el comportamiento en segundo plano requiere que el sitio esté instalado y que el sistema permita notificaciones; debe verificarse en el dispositivo real.

## 4. Ejecutar localmente

Desde la carpeta raíz ejecuta uno de estos comandos:

```powershell
py -m http.server 8000
```

o, si `py` no está disponible:

```powershell
python -m http.server 8000
```

Abre `http://localhost:8000`. No abras el HTML con doble clic: los módulos JavaScript requieren un servidor local.

## 5. Crear dos usuarios de prueba

La forma recomendada es registrar dos cuentas desde la pantalla **Registro** de ITEStore, con dos direcciones institucionales reales que puedan confirmar el correo. Escoge una carrera para cada una y confirma ambos correos.

Para pruebas supervisadas, un administrador de Supabase puede crearlos desde **Authentication > Users > Add user**, indicando correo/contraseña y confirmando el usuario. Tras crear cada usuario, completa su perfil si el trigger no recibió `name` y `career_id`; se recomienda el registro de la app porque envía ambos datos.

## Errores comunes

- **“Configura Supabase”**: faltan URL o anon key en `js/config.js`.
- **No llega el correo**: revisa Email provider, Confirm email y la bandeja/carpeta de spam de la cuenta institucional.
- **“new row violates row-level security”**: confirma que ejecutaste `policies.sql` y que el usuario inició sesión.
- **No llegan mensajes en vivo**: habilita `messages` en Replication/Realtime y recarga ambos clientes.
- **No sube una imagen**: revisa que sea JPG/PNG menor a 5 MB, máximo cuatro, y que ejecutaste `storage.sql`.
- **No aparecen carreras**: ejecuta `seed.sql` después del esquema.
