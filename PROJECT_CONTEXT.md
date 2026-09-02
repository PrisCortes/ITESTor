# Contexto del proyecto: ITEStore

## Objetivo

ITEStore es un marketplace universitario exclusivo para estudiantes del ITESA. Una sola cuenta puede comprar, vender, intercambiar, solicitar préstamos y prestar artículos. Los pagos se acuerdan y realizan fuera de la plataforma.

## Tecnología y estructura

- Frontend: HTML5, CSS3 mobile first y JavaScript vanilla con ES Modules.
- Backend: Supabase Auth, PostgreSQL, Storage y Realtime.
- No usa React, Angular, Vue, Tailwind, Bootstrap, Express, Docker ni claves privadas en el navegador.
- `index.html` es la interfaz principal; `chat.html` es la conversación vinculada a una operación.
- El cliente importa el SDK oficial de Supabase desde ESM. La configuración local está en `js/config.js`, ignorado por Git; la plantilla pública es `js/config.example.js`.

## Alcance actual

Incluye autenticación institucional, perfil, publicaciones de venta/intercambio con cuatro imágenes como máximo, feed, búsqueda combinable, solicitudes de transacción, chat contextual en tiempo real, solicitudes de préstamo, catálogo de puntos de encuentro, transacciones, préstamos, calificaciones y notificaciones internas a nivel de modelo de datos.

No incluye todavía panel administrativo, favoritos, reportes, bloqueo, estadísticas ni notificaciones push externas.

## Carreras

LA Administración; LT Turismo; IGE Gestión Empresarial; ISA Sistemas Automotrices; IA Alimentarias; IE Electromecánica; IC Civil; IM Mecatrónica; ISC Sistemas Computacionales.

## Puntos de encuentro

Edificios A–G, Polideportivo, Asta, Árbol de conexión y Cafetería.

## Estados

| Área | Estados |
|---|---|
| Publicación | `AVAILABLE`, `PENDING`, `COMPLETED` |
| Solicitud de transacción | `PENDING`, `ACCEPTED`, `REJECTED`, `CANCELLED`, `COMPLETED` |
| Transacción | `PENDING`, `SCHEDULED`, `DELIVERED`, `RECEIVED`, `COMPLETED`, `CANCELLED` |
| Solicitud/préstamo | `OPEN`, `EXPIRED`, `SELECTED`, `SCHEDULED`, `ACTIVE`, `RETURN_PENDING`, `RETURNED`, `CANCELLED`, `CLOSED` |

Una publicación concluida queda fuera del catálogo. `PENDING` significa apartada: ya no admite solicitudes nuevas.

## Flujos

Compra/intercambio: estudiante autenticado → solicitud pendiente → chat contextual → vendedor acepta/rechaza → se reserva stock y se programa encuentro → ambas partes confirman entrega/recepción → se completa, actualiza stock y se habilitan calificaciones.

Préstamo: solicitante publica necesidad con límite → el listado vence solicitudes abiertas al consultar → prestamistas presentan oferta y chat contextual → solicitante selecciona una única propuesta → se programa/reprograma o cancela entrega → ambas confirmaciones activan préstamo → se coordina devolución en el mismo chat → ambas confirmaciones cierran e historizan préstamo.

## Decisiones de arquitectura

- Relaciones normalizadas y UUIDs en PostgreSQL; estados consistentes con enums.
- RLS es la barrera de seguridad principal, complementada con triggers que impiden mensajes ajenos, calificaciones prematuras y más de cuatro imágenes.
- Las imágenes usan el bucket público `publication-images`, con rutas por usuario/publicación y tipos permitidos JPG/PNG.
- Los usuarios de prueba se crean desde Supabase Auth para que el trigger genere su perfil. Nunca se insertan en `auth.users` mediante SQL.
