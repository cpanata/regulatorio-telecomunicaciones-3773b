# Regulatorio Telecomunicaciones

Landing page estática, adaptable a móviles y sin dependencias de compilación.

La identidad gráfica incluye un logotipo vectorial original, un favicon y dibujos SVG integrados para las tarjetas de servicios y los ocho estudios de ingeniería. Se muestran directamente desde el sitio, sin descargas de imágenes ni paquetes externos.

Los servicios tienen accesos directos y consultas de WhatsApp con el tema precargado. La navegación principal abre vistas independientes en la misma pestaña (Servicios, Trámites, Normativa, Normativa ARCOTEL, selección de documentos LOT, Tips, Casos y Contacto); sus direcciones usan `?view=`, por lo que se pueden compartir, recargar y recorrer con los botones atrás y adelante. La portada ejecutiva ofrece accesos directos a cada vista. La vista de Normativa ARCOTEL reúne referencias sectoriales, técnicas y municipales sobre soterramiento, ordenamiento de redes y gestión de incidentes de seguridad; verifica los textos oficiales vigentes antes de aplicarlos. El ítem de la LOT lleva a una vista para escoger entre la Ley y el Reglamento General, cuyos documentos se abren en una pestaña nueva.

El asistente de preguntas frecuentes combina respuestas locales preparadas con un flujo RAG opcional. Al habilitarlo, recupera fragmentos de documentos públicos cargados por el administrador, genera respuestas con Google Gemini y muestra las fuentes disponibles. No conserva el historial de preguntas; las consultas y los fragmentos recuperados se envían a Google Gemini. Sin configurar los servicios, permanece disponible el modo FAQ local. Las respuestas son orientativas y no sustituyen asesoría legal o regulatoria.

La vista **Tips** incluye seis consejos regulatorios extensos (auditoría de seguridad para prestadores SAI, redes soterradas, etiquetado de redes, infraestructura aérea, radiocomunicaciones de dos vías y gestión de títulos habilitantes), inicialmente contraídos y desplegables desde su encabezado mediante clic o teclado. Cada tip incluye un gráfico SVG integrado y recomendaciones para conservar evidencias y verificar las obligaciones concretas en la normativa vigente. El asistente orienta sobre estos temas y enlaza la vista de Tips; confirma siempre obligaciones, vigencia y alcance con la norma oficial y asesoría competente.

La sección **Estudios de ingeniería** describe estudios para SAI, AVS, radiocomunicaciones VHF/UHF, FM, televisión VHF/UHF, sistemas satelitales, redes privadas y enlaces de Modulación Digital de Banda Ancha (MDBA). Confirma los requisitos vigentes con ARCOTEL antes de preparar documentación para un trámite.

Las fichas de servicios y estudios se expanden al seleccionarlas para mostrar el tipo de trámite, una lista inicial de requisitos y enlaces a fuentes de ARCOTEL. El reporte diferencia título habilitante, registro, concesión, autorización y permiso; es una guía informativa, no asesoría legal ni sustituto de la ficha vigente o resolución aplicable al solicitante.

La ficha SIETEL resume el alcance y plazo publicados en el [portal oficial de ARCOTEL](https://apc.arcotel.gob.ec/sietel1/index.aspx). Confirma siempre en el sistema y en los oficios recibidos qué formularios y periodicidad aplican al prestador.

La ficha FODETEL distingue entre las gestiones de obligaciones de operadores y los asuntos asociados a proyectos de servicio universal. Presenta el origen legal como contexto histórico y dirige a ARCOTEL para verificar los procedimientos vigentes.

La ficha de planes de contingencia refleja el plazo anual y alcance publicados por ARCOTEL; valida en el portal de la Agencia el formato vigente, las instrucciones del año y el servicio al que corresponde el título habilitante.

La ficha SISREGI describe la declaración semestral de ingresos y enlaza al portal y al aviso oficial de ARCOTEL. Las fechas deben confirmarse en la resolución o comunicación oficial de cada período, pues las publicadas para 2023 son históricas.

## Edición del contenido

La página obtiene los textos editables desde `content/site.json` cuando se sirve por HTTP/HTTPS. El archivo `content-loader.js` aplica esos valores de forma segura y también actualiza el número y los mensajes de WhatsApp. Al abrir `index.html` directamente como archivo, se conserva la vista estática de respaldo; para comprobar los cambios del JSON usa un servidor local, por ejemplo `python -m http.server 8000`, y abre `http://localhost:8000`.

El panel privado usa Decap CMS con Netlify Identity y Git Gateway. No se guarda ninguna contraseña en los archivos del sitio. Para habilitarlo:

1. Crea un repositorio en GitHub con los archivos del sitio en la raíz y la rama `main`.
2. En Netlify, importa ese repositorio como un sitio nuevo. No hace falta comando de compilación; publica la carpeta raíz del proyecto.
3. En la configuración del sitio en Netlify, habilita **Identity** y configura el registro solo por invitación. Invita únicamente el correo del propietario que administrará los textos.
4. En **Identity → Services**, habilita **Git Gateway** para que el panel pueda guardar los cambios en el repositorio.
5. Abre `https://tu-sitio.netlify.app/admin/`, acepta la invitación e inicia sesión. Desde **Contenido del sitio** puedes actualizar marca, portada, servicios, descripciones de estudios, consejos, casos ilustrativos, contacto y mensajes de WhatsApp. Los cambios se guardan en GitHub y se publican mediante Netlify.

Git Gateway figura actualmente como una función beta de Netlify; confirma que siga disponible para tu sitio antes de completar la configuración.

El panel mantiene exactamente tres consejos y tres casos para ajustarse al diseño. Los requisitos, tipos de trámite, enlaces de normativa y fichas regulatorias desplegables se mantienen fijos en `index.html` para evitar cambios accidentales; deben revisarse y actualizarse manualmente por una persona responsable cuando cambie la normativa. Los casos actuales son ilustrativos: reemplázalos solo por experiencias reales verificables y autorizadas, o conserva claramente el aviso que los identifica como ejemplos.

## Asistente documental RAG (configuración opcional)

La integración usa Netlify Functions para el backend, Netlify Identity para autenticar a quienes cargan o eliminan documentos, Supabase (Postgres con `pgvector` y Storage privado) para guardar el corpus e índice vectorial, y Google Gemini para embeddings y generación. El modelo no se reentrena: cada consulta recupera fragmentos indexados. Los PDF y sus fragmentos se almacenan en Supabase; las consultas y fragmentos recuperados se envían a Google. El alojamiento estático puede seguir en un plan gratuito, pero cuotas, límites y precios de Gemini, Supabase y Netlify pueden cambiar y generar cargos; compruébalos antes de activar la función. No cargues documentos privados, información personal ni material sin autorización. Revisa las condiciones y políticas de los proveedores antes de activar la función.

Para habilitarlo:

1. Crea un proyecto Supabase y ejecuta `supabase/rag-schema.sql` desde SQL Editor. El script crea tablas protegidas, el bucket privado y las funciones de ingestión, búsqueda y límite de consultas.
2. Crea una API key de Gemini y configura las variables privadas de entorno en Netlify, usando `.env.example` como lista: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RAG_ADMIN_EMAILS` y `RAG_RATE_LIMIT_SECRET`. Opcionalmente configura el modelo, umbral y límite. `RAG_ADMIN_EMAILS` es una lista separada por comas; usa el mismo correo de la cuenta administradora de Netlify Identity. Genera un secreto aleatorio largo para `RAG_RATE_LIMIT_SECRET`.
3. En Netlify Identity, conserva registro solo por invitación e invita a los administradores. La función compara el correo autenticado con la lista `RAG_ADMIN_EMAILS`. El `SUPABASE_SERVICE_ROLE_KEY` y la clave de Gemini solo van en variables privadas del backend; nunca las pongas en HTML, CMS ni variables públicas `VITE_`/`NEXT_PUBLIC_`.
4. Publica el sitio con Netlify. La configuración `netlify.toml` define las Functions y Node.js 22. Inicia sesión en `https://tu-sitio.netlify.app/admin/knowledge.html` para cargar PDF públicos con título, enlace de fuente y fecha; allí también puedes listar y eliminar documentos.
5. Para desarrollo local, instala dependencias con `npm install`, copia `.env.example` a `.env`, agrega credenciales de prueba y usa `npx netlify dev`. No compartas ni subas `.env`; está excluido por `.gitignore`.

La primera versión acepta PDF de hasta 5 MB con texto seleccionable (sin OCR) y hasta 80.000 caracteres extraídos. Los duplicados se rechazan. El chat limita cada IP a 20 consultas por hora por defecto (ajustable mediante `RAG_MAX_REQUESTS_PER_HOUR`) y no persiste el texto de las preguntas. Si la recuperación no encuentra evidencia suficiente, el asistente se abstiene. Verifica siempre la versión y vigencia de las fuentes, porque la indexación no actualiza automáticamente documentos derogados ni sustituye una revisión profesional.

El teléfono se edita en el CMS como número internacional sin espacios ni signos (por ejemplo, `593991234567`) y su formato visible se configura en el campo **Teléfono visible**. Un número inválido deshabilita los enlaces de WhatsApp y muestra un aviso en la página, en vez de enviar consultas al destino equivocado.

El formulario de contacto no transmite ni almacena información en el sitio: prepara el texto en WhatsApp para que la persona lo revise y lo envíe voluntariamente. Se solicita únicamente un nombre opcional, el servicio y la consulta; se recomienda no incluir información confidencial.

El sitio incluye un aviso inicial de privacidad editable desde el panel y enlaza la Ley Orgánica de Protección de Datos Personales y a la Superintendencia de Protección de Datos Personales. El aviso informa que Netlify aloja el sitio y que las tipografías provienen de Google Fonts. No es una revisión legal ni acredita por sí solo cumplimiento normativo: antes de utilizarlo como aviso formal, el propietario debe completar la identidad legal y domicilio del responsable y revisar los fines, bases de legitimación, conservación, transferencias y canales para ejercer derechos que correspondan a su operación.

## Mejoras sugeridas para revisar antes de publicar

- Confirmar el nombre comercial, logotipo definitivo, datos del responsable y ubicación/área de atención.
- Validar que el número de WhatsApp esté activo para recibir consultas y que los mensajes precargados representen el servicio ofrecido.
- Reemplazar los casos ilustrativos por casos reales autorizados, con resultados verificables y permiso del cliente.
- Revisar con asesoría competente el aviso de privacidad inicial y los textos legales, especialmente antes de habilitar más formularios, analítica o recolección de datos personales.
- Hacer una revisión final de requisitos y enlaces de ARCOTEL; definir quién actualizará el contenido cuando cambien normas o fechas.
- Tras publicar, configurar dominio propio si se desea, revisar el título y la descripción en redes, y comprobar la experiencia desde teléfonos reales.

## Publicar gratis

Para usar el panel de edición, publica desde el repositorio Git conectado a Netlify siguiendo los pasos anteriores. Netlify Drop permite publicar una vista estática, pero no configura por sí solo Git Gateway ni el guardado de cambios desde el CMS. Consulta los límites y condiciones actuales del plan gratuito de Netlify.
