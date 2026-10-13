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

- Frase secreta → PBKDF2-SHA256, 600000 iteraciones, sal de 16 bytes → llave de envoltorio (KEK).
- PIN de 6 dígitos → el mismo KDF, con otra sal, solo en este teléfono.
- DEK aleatoria de 256 bits. La frase y el PIN envuelven esa DEK. Los registros no se re-cifran al cambiar el PIN.
- Cada registro y cada audio va con AES-GCM, nonce de 12 bytes al azar, y el id como dato adicional. Un nonce no se reutiliza: cada guardado genera otro.
- La DEK de sesión no es extraíble. Hace falta para cifrar, y `wrapKey` funciona igual.
- La base guarda texto cifrado. La sal y los envoltorios tienen que estar en claro para poder abrir.
- Un verificador cifrado (`ok: true`) confirma que la frase o el PIN abrieron la DEK correcta.
- Cambiar la frase genera otra DEK y vuelve a cifrar registros y audios. Los respaldos y las invitaciones anteriores dejan de abrir.

PBKDF2 está en WebCrypto. No agrega dependencias ni WebAssembly, y la CSP puede ir sin `unsafe-eval`. No es un KDF de memoria dura. Quien copie la base puede atacar una frase débil o un PIN más rápido de lo que este teléfono permite. Por eso la frase tiene que ser larga y el PIN no se presenta como protección frente a una copia del disco.

Los nonces son aleatorios, no un contador persistente. A esta cantidad de registros, el choque de 96 bits no es el riesgo práctico. El riesgo práctico es una frase corta.

## Invitación y respaldos

La invitación es un código `mp1.` en el fragmento de la URL (`#`). El fragmento no viaja en la petición HTTP. Puede quedar en el historial, en capturas y en el sitio donde se pegue.

El código lleva identificador del espacio, parámetros del KDF, la DEK envuelta con la frase, y el verificador y los apodos ya cifrados. No lleva la frase ni el PIN ni las quejas. Sin la frase, la DEK envuelta no abre el cuaderno. Con la frase, el otro teléfono puede cifrar con la misma DEK, pero el cuaderno le llega vacío: no hay sincronización. Para copiar lo ya escrito se pasa un respaldo cifrado a mano.

No hay forma de invalidar un enlace sin cambiar la frase (eso rota la DEK).

La exportación cifrada es el mismo material más los registros y audios cifrados. No incluye el PIN. La exportación en claro existe, pide escribir `ENTIENDO`, y el archivo lo dice en un campo `warning`.

## Sincronización

Está apagada. No hay URL. `pushCiphertext` lanza un error. Si algún día existe, el servidor solo puede ver sobres `{ id, iv, ciphertext }` y nunca la frase, el PIN, la DEK ni el texto. Tiene que seguir apagada por defecto.

## Borrar todo

El botón cierra la base, borra la base IndexedDB, borra los cachés, desregistra service workers y limpia `localStorage` y `sessionStorage` de este origen. También suelta las URLs de audio en memoria. No toca otro dispositivo.

## Interfaz

No hay scripts en línea ni `eval`. El DOM se arma con nodos y `textContent`. La CSP de la meta y la del servidor local prohíben inline, eval, objetos embebidos y cualquier origen que no sea el propio, salvo `blob:` para reproducir un audio ya descifrado.
