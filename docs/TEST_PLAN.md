# Plan de pruebas de ITEStore

Todos los casos tienen resultado, estado y evidencia en **PENDIENTE**. No representan resultados ejecutados.

| ID | Módulo | Objetivo / precondiciones | Datos y pasos | Resultado esperado | Resultado obtenido | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Autenticación | Registrarse con correo institucional; carrera cargada | Registrar `alumno@itesa.edu.mx`, contraseña válida y carrera | Se crea cuenta y solicita confirmar correo | PENDIENTE | PENDIENTE | PENDIENTE |
| AUTH-02 | Autenticación | Rechazar correo externo | Registrar `alumno@gmail.com` | No se envía registro; se informa dominio inválido | PENDIENTE | PENDIENTE | PENDIENTE |
| AUTH-03 | Autenticación | Iniciar/cerrar sesión | Confirmar usuario y usar credenciales válidas; luego cerrar sesión | Sesión persistente al recargar y cierre correcto | PENDIENTE | PENDIENTE | PENDIENTE |
| AUTH-04 | Autenticación | Recuperar contraseña | Solicitar recuperación con correo ITESA | Supabase envía enlace de recuperación | PENDIENTE | PENDIENTE | PENDIENTE |
| PUB-01 | Publicaciones | Crear publicación válida | Venta, título, descripción, carrera, precio, stock 1 y JPG | Publicación disponible en feed | PENDIENTE | PENDIENTE | PENDIENTE |
| PUB-02 | Publicaciones | Limitar imágenes | Intentar cargar 5 imágenes válidas | Cliente/base rechazan excedente | PENDIENTE | PENDIENTE | PENDIENTE |
| PUB-03 | Publicaciones | Validar formatos | Seleccionar GIF/PDF | Cliente rechaza formato | PENDIENTE | PENDIENTE | PENDIENTE |
| EDIT-01 | Publicaciones | Mostrar edición solo al propietario | Propietario abre su artículo; después lo abre otro usuario | Solo el propietario ve “Editar publicación” | PENDIENTE | PENDIENTE | PENDIENTE |
| EDIT-02 | Publicaciones | Guardar cambios e imágenes | Editar título/precio, quitar una imagen y añadir otra | Se actualizan campos, `updated_at` e imágenes sin superar cuatro | PENDIENTE | PENDIENTE | PENDIENTE |
| EDIT-03 | Seguridad | Bloquear edición ajena | Usuario B intenta `update` a publicación de A desde cliente Supabase | RLS rechaza la actualización | PENDIENTE | PENDIENTE | PENDIENTE |
| SEARCH-01 | Búsqueda | Filtrar por carrera | Crear artículos de dos carreras y filtrar una | Solo aparecen artículos de la carrera elegida | PENDIENTE | PENDIENTE | PENDIENTE |
| SEARCH-02 | Búsqueda | Combinar rango/precio/tipo | Buscar texto y filtrar venta + rango | Solo aparecen coincidencias que satisfacen todo | PENDIENTE | PENDIENTE | PENDIENTE |
| DETAIL-01 | Detalle | Abrir detalle desde catálogo | Pulsar una tarjeta disponible | Se muestra galería, descripción, vendedor, stock y datos completos antes de solicitar | PENDIENTE | PENDIENTE | PENDIENTE |
| DETAIL-02 | Detalle | Respetar disponibilidad y propiedad | Abrir artículo propio, pendiente y concluido | Propietario ve edición; publicaciones no disponibles no permiten solicitud | PENDIENTE | PENDIENTE | PENDIENTE |
| TX-01 | Compra/chat | Solicitar compra | Usuario B abre publicación disponible de A y solicita cantidad 1 | Se crea solicitud pendiente y chat contextual | PENDIENTE | PENDIENTE | PENDIENTE |
| TX-02 | Compra/chat | Impedir compra propia | A intenta solicitar su propia publicación | Operación rechazada | PENDIENTE | PENDIENTE | PENDIENTE |
| TX-03 | Compra/chat | Rechazar/cancelar operación | Vendedor rechaza solicitud; repetir y cancelar una aceptada | Solicitud se actualiza y stock/publicación se libera | PENDIENTE | PENDIENTE | PENDIENTE |
| TX-04 | Compra/chat | Aislar chat | Usuario C intenta abrir URL del chat A/B | RLS niega lectura y envío | PENDIENTE | PENDIENTE | PENDIENTE |
| TX-05 | Compra/chat | Realtime | A y B abren el chat; A envía mensaje | B lo ve sin recargar | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-01 | Préstamos | Crear solicitud válida | Capturar artículo, cantidad, carrera, límite futuro y devolución posterior | Solicitud queda `OPEN` | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-02 | Préstamos | Validar límite futuro | Intentar crear con límite pasado | Se rechazan fechas incoherentes | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-03 | Préstamos | Vencimiento | Crear solicitud con límite corto y abrir listado después | Se marca `EXPIRED` y no acepta ofertas | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-04 | Préstamos | Crear propuesta | Usuario B abre solicitud `OPEN` de A y ofrece préstamo | Se crea propuesta y chat contextual | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-05 | Préstamos | Impedir auto-oferta | A intenta ofrecerse en su propia solicitud | RPC rechaza operación | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-06 | Préstamos | Seleccionar prestamista | A selecciona propuesta pendiente de B | Propuesta pasa a `ACCEPTED`, demás a `REJECTED` y se crea préstamo `SELECTED` | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-07 | Préstamos | Programar entrega | A o B eligen punto y fecha futura | Préstamo y solicitud pasan a `SCHEDULED` | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-08 | Préstamos | Reprogramar entrega | Cambiar punto/fecha de préstamo programado | Se conserva `SCHEDULED` y se actualiza encuentro | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-09 | Préstamos | Cancelar antes de entrega | A o B cancela `SELECTED`/`SCHEDULED` | Se conserva historial con estado `CANCELLED` | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-10 | Préstamos | Confirmar entrega | B pulsa “Confirmar entrega” | Se registra timestamp del prestamista | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-11 | Préstamos | Confirmar recepción | A confirma recepción tras entrega | Se registra timestamp del solicitante | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-12 | Préstamos | Activar préstamo | Completar ambas confirmaciones de entrega | Solicitud y préstamo pasan a `ACTIVE` | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-13 | Préstamos | Mantener chat activo | Abrir chat durante estado `ACTIVE` | Chat permite leer y enviar mensajes | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-14 | Préstamos | Mostrar devolución pendiente | Iniciar devolución de un préstamo activo | Estados pasan a `RETURN_PENDING` sin cerrar chat | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-15 | Préstamos | Confirmar devolución | A confirma que devolvió artículo | Se registra timestamp del solicitante | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-16 | Préstamos | Confirmar recepción final | B confirma que recibió el artículo | Se registra timestamp del prestamista | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-17 | Préstamos | Cerrar e historizar | Completar ambas confirmaciones de devolución | Préstamo y solicitud quedan `CLOSED` con `closed_at` | PENDIENTE | PENDIENTE | PENDIENTE |
| LOAN-18 | Seguridad | Aislamiento RLS | Usuario C consulta/actualiza préstamo y chat de A/B | RLS y RPCs rechazan acceso ajeno | PENDIENTE | PENDIENTE | PENDIENTE |
| RATE-01 | Calificaciones | Calificar tras concluir | Concluir transacción y calificar contraparte 1–5 | Inserta una calificación y actualiza promedio | PENDIENTE | PENDIENTE | PENDIENTE |
| RATE-02 | Calificaciones | Evitar calificación prematura | Intentar calificar transacción `PENDING` | Trigger/RLS rechazan operación | PENDIENTE | PENDIENTE | PENDIENTE |
