# Modelo de datos de ITEStore

El modelo está normalizado para no duplicar identidades, carreras, puntos institucionales ni imágenes. Las tablas y restricciones se implementan en `supabase/schema.sql`.

| Tabla | Propósito | Relaciones clave |
|---|---|---|
| `careers` | Catálogo de nueve carreras | Referenciado por perfiles, publicaciones y préstamos |
| `meeting_points` | Puntos institucionales permitidos | Referenciado por transacciones y préstamos |
| `profiles` | Perfil público/privado asociado 1:1 a Auth | PK = `auth.users.id` |
| `public_profile_summaries` | Vista pública sin correo para tarjetas y detalle | Nombre y promedio del vendedor |
| `publications` | Artículos de venta o intercambio | Propietario, carrera, imágenes y solicitudes |
| `publication_images` | Hasta cuatro archivos por publicación | Publicación y ruta de Storage |
| `transaction_requests` | Intención de compra/intercambio | Publicación, comprador y vendedor |
| `transactions` | Operación aceptada y su encuentro | Solicitud única, ambas partes y punto |
| `chats` / `messages` | Chat siempre contextual y cronológico | Dos participantes + solicitud/transacción de origen |
| `loan_requests` | Necesidad de un artículo prestado | Solicitante, carrera y fecha límite |
| `loan_offers` | Propuesta de un posible prestamista | Solicitud + prestamista únicos |
| `loans` | Préstamo seleccionado y sus confirmaciones | Solicitud, oferta, solicitante y prestamista |
| `ratings` | Una evaluación por dirección/transacción | Transacción, evaluador y evaluado |
| `internal_notifications` | Recordatorios internos persistentes | Usuario destinatario |

## Reglas que protege la base

- `profiles.id` deriva de `auth.users.id`; el correo se valida como `@itesa.edu.mx` y no se edita desde la app.
- El propietario, vendedor y comprador no pueden ser la misma persona.
- Los precios son no negativos; una venta exige precio positivo; el stock y cantidad son positivos.
- `publication_images` tiene posiciones 0–3 y un trigger rechaza la quinta imagen.
- Un mensaje debe venir de uno de los dos participantes del chat.
- Una calificación exige transacción `COMPLETED`, participante válido y dirección aún no calificada.
- El trigger de calificaciones recalcula `profiles.rating_average`.

## Interpretación de préstamos

- `OPEN`: se reciben propuestas antes del límite.
- `EXPIRED`: el límite venció sin selección.
- `SELECTED`: el solicitante eligió una oferta.
- `SCHEDULED`: hay punto/fecha de entrega acordados.
- `ACTIVE`: ambos confirmaron la entrega inicial.
- `RETURN_PENDING`: se coordina o confirmó una devolución, pendiente de la contraparte.
- `RETURNED`: ambas partes confirmaron devolución.
- `CANCELLED`: se canceló antes de concluir.
- `CLOSED`: historial final cerrado.

La transición de estados complejos debe realizarse con operaciones atómicas/RPC en una iteración posterior antes de exponer el sistema a uso masivo; RLS evita que personas externas a una operación la modifiquen.
