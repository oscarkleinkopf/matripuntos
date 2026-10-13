# Seguridad

Matripuntos guarda quejas de pareja en el propio teléfono. Un filtrado puede hacer daño. Este documento dice cómo avisar de un fallo, qué entra en el alcance y cómo está armado el cifrado.

## Avisar de una vulnerabilidad

No abras un issue público con detalles para explotarla.

Si el repositorio tiene avisos privados de seguridad, usa ese canal. Si no, escribe en privado a quien mantiene el repositorio y espera una respuesta antes de publicarlo.

Incluye qué versión (commit), qué navegador y qué lograste hacer. No mandes frases reales, quejas reales ni respaldos con datos de personas.

## Alcance

Dentro:

- Cifrado en reposo en el navegador y el modelo de llaves (frase, PIN, DEK).
- Que un respaldo cifrado o una invitación filtren texto en claro, la frase o el PIN.
- La CSP, inyección en la interfaz, o que la app llame a un tercero.
- Borrar todo deje datos recuperables en este origen (base, caché, service worker).
- El tope del PIN se pueda saltar sin borrar el envoltorio del PIN.
- La sincronización, si en el futuro se enciende, reciba algo que no sea texto cifrado.

Fuera:

- Malware o un depurador en el dispositivo.
- Alguien que ve la pantalla desbloqueada o una captura.
- Una frase corta, compartida por chat, o reutilizada.
- El fabricante del navegador procesando el audio del dictado cuando la persona decide dictar. La app lo avisa y no agrega otro servicio.
- Pérdida de la frase. No hay recuperación.
- Un servidor que alguien monte por su cuenta fuera de este código.

## Cifrado

El envoltorio de la llave lleva una versión.

- Versión 1, espacios ya creados: frase → PBKDF2-SHA256, 600000 iteraciones, sal de 16 bytes → llave de envoltorio (KEK). Siguen abriendo. Al entrar con la frase, la app ofrece pasarlos a Argon2id. La frase no cambia y las anotaciones no se reescriben.
- Versión 2, espacios nuevos y los que se actualizan: frase → Argon2id (versión 0x13), 19 MiB, 2 pasadas, 1 carril, sal de 16 bytes, etiqueta de 32 bytes. La entrada del KDF es `mp-phrase` o `mp-pin` más el secreto, para que una frase y un PIN no se mezclen.
- PIN de 6 dígitos → el mismo tipo de KDF que el espacio, con otra sal, solo en este teléfono. En un espacio nuevo es Argon2id. En uno viejo sigue en PBKDF2 hasta que se actualiza el cifrado o se cambia el PIN.
- DEK aleatoria de 256 bits. La frase y el PIN envuelven esa DEK. Los registros no se re-cifran al cambiar el PIN ni al cambiar la frase.
- Cada registro y cada audio va con AES-GCM, nonce de 12 bytes al azar, y el id como dato adicional. Un nonce no se reutiliza: cada guardado genera otro.
- La DEK de sesión no es extraíble. En Chrome `wrapKey` rechaza una llave no extraíble, así que un PIN nuevo, un cambio de frase o una migración se envuelven con una copia extraíble de un momento, que no se guarda. La sesión sigue sin poder exportarse.
- La base guarda texto cifrado. La sal y los envoltorios tienen que estar en claro para poder abrir.
- Un verificador cifrado (`ok: true`) confirma que la frase o el PIN abrieron la DEK correcta.
- Cambiar la frase vuelve a envolver la misma DEK, sube un contador del espacio (época) y rechaza los códigos `mp1.` de una época anterior. No reescribe las anotaciones.

Argon2id está vendido en `app/vendor/argon2id/` (argon2id 1.0.1, MIT; el aviso de copyright queda en el `LICENSE` de esa carpeta). El SHA-256 de los binarios y del pegamento está en `app/js/argon2.js` y se comprueba antes de instanciar. El pegamento no usa `eval` ni `new Function`. `WebAssembly.instantiate` sí exige `'wasm-unsafe-eval'` en `script-src`. Ese token no permite `eval`, scripts en línea ni `new Function`. El binario reserva unas 65 MiB de memoria WASM porque así está compilado; un teléfono que no pueda reservarlas no abre la llave y los datos siguen cifrados.

Quien copie la base puede atacar una frase débil fuera del teléfono. Argon2id le cuesta memoria. PBKDF2, en un espacio que todavía no se actualizó, no. El PIN de 6 dígitos no es protección frente a una copia del disco. La frase tiene que ser larga.

Los nonces son aleatorios, no un contador persistente. A esta cantidad de registros, el choque de 96 bits no es el riesgo práctico. El riesgo práctico es una frase corta.

## Invitación y respaldos

La invitación es un código `mp1.` en el fragmento de la URL (`#`). El fragmento no viaja en la petición HTTP. La app lo quita de la barra con `history.replaceState` en cuanto lo lee. Puede quedar en el historial, en capturas y en el sitio donde se pegue.

El código lleva identificador del espacio, la época, un vencimiento de 15 minutos, parámetros del KDF, la DEK envuelta con la frase, y el verificador y los apodos ya cifrados. No lleva la frase ni el PIN ni las quejas. Sin la frase, la DEK envuelta no abre el cuaderno. Con la frase, el otro teléfono puede cifrar con la misma DEK, pero el cuaderno le llega vacío: no hay sincronización. Para copiar lo ya escrito se pasa un respaldo cifrado a mano.

En cada teléfono el código se acepta una vez: se guarda un resumen en `localStorage`, que borrar todo limpia. Un código vencido se rechaza. Un código de una época anterior se rechaza en un teléfono que ya tiene la época nueva. Un teléfono que nunca vio el espacio no puede saber que la época subió: el código viejo, si no venció y todavía no se usó ahí, abre la misma DEK con la frase vieja. Cambiar la frase no reescribe las anotaciones. Un respaldo cifrado de antes sigue abriendo con la frase de entonces.

La exportación cifrada es el mismo material más los registros y audios cifrados. No incluye el PIN. La exportación en claro existe, pide escribir `ENTIENDO`, y el archivo lo dice en un campo `warning`. Si se copia un código de invitación, la app avisa y a los 45 segundos intenta vaciar el portapapeles. Otra aplicación puede haberlo leído antes, y el navegador puede negar el borrado.

## PIN, pantalla y autenticador

El PIN aguanta 5 intentos. Después espera, y la espera se duplica (30 segundos, luego 1 minuto) y queda guardada en el teléfono. A la tercera ronda se borra el envoltorio del PIN y hace falta la frase. El cuaderno se cierra solo por inactividad y también al pasar la app a segundo plano. En segundo plano una pantalla tapa el contenido y lo desenfoca. El sistema puede haber tomado la captura antes de que la página se entere.

WebAuthn con autenticador de plataforma no está encendido. Una afirmación normal no entrega bytes para desenvolver la DEK. La extensión PRF sí podría, pero no está en todos los teléfonos que esta PWA tiene que abrir, y un camino a medias dejaría gente fuera o una llave mal envuelta. El PIN y la frase siguen siendo el desbloqueo.

## Sincronización

Está apagada. No hay URL. `pushCiphertext` lanza un error. Si algún día existe, el servidor solo puede ver sobres `{ id, iv, ciphertext }` y nunca la frase, el PIN, la DEK ni el texto. Tiene que seguir apagada por defecto.

## Borrar todo

El botón cierra la base, borra la base IndexedDB, borra los cachés, desregistra service workers y limpia `localStorage` y `sessionStorage` de este origen. También suelta las URLs de audio en memoria. No toca otro dispositivo.

## Interfaz

No hay scripts en línea ni `eval`. El DOM se arma con nodos y `textContent`. La CSP de la meta y la de `app/_headers` prohíben inline, `unsafe-eval`, objetos embebidos y cualquier origen que no sea el propio, salvo `blob:` para reproducir un audio ya descifrado y `'wasm-unsafe-eval'` solo para compilar el módulo de Argon2id. Esas cabeceras también mandan `Referrer-Policy: no-referrer`, `Permissions-Policy` con micrófono solo en el propio origen y cámara y geolocalización cerradas, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, COOP y CORP en el mismo origen.
