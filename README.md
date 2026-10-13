# Matripuntos

Cuaderno compartido para una pareja. Una queja descuenta de 1 a 5 puntos, se puede saldar con una disculpa o un gesto (y esos puntos vuelven), y un gesto bueno suma. El marcador de la semana y el del mes parten de cero al cambiar el período. El historial queda.

Es gratis, de código abierto y local. Los datos se cifran en el teléfono antes de guardarse. No hay cuentas, anuncios, analítica ni servidor.

No es un tribunal ni un ranking. Si solo se anotan quejas, se vuelve un libro de rencores: la app empuja a saldar y pone un techo diario.

## Cómo correrlo

Hace falta Node.js 20 o más nuevo. No hay dependencias que instalar.

```bash
npm test
npm start
```

Abre [http://127.0.0.1:4173](http://127.0.0.1:4173). El servidor escucha solo en localhost y manda una Política de Seguridad de Contenido estricta. No abras `index.html` como archivo: el service worker y el cifrado de la PWA necesitan un origen seguro (`localhost` o HTTPS).

La frase secreta no se puede recuperar. Si se pierde, los datos de ese teléfono quedan ilegibles. Bórralos y partan de nuevo, o restauren un respaldo si todavía tienen la frase.

## Instalar como PWA

1. Corre `npm start` y abre la app en el navegador del teléfono, o en Chrome de escritorio.
2. En Android o Chrome de escritorio: menú del navegador → **Instalar aplicación** (o el botón Instalar, si el navegador lo ofrece).
3. En iPhone o iPad: Compartir → **Agregar a inicio**.

La instalación guarda el cascarón de la app (HTML, CSS, JS, íconos). Las quejas siguen en la base local cifrada, no en el caché.

Para probar la instalación, el origen tiene que ser localhost o HTTPS. Los archivos a publicar están en `app/`. `app/_headers` lleva la misma CSP estricta que genera `scripts/csp.mjs`.

## Cómo probar

```bash
npm test
```

Eso corre las pruebas de cifrado (ida y vuelta, Argon2id, el paso desde PBKDF2, llave incorrecta, nonces únicos), de la invitación (época, vencimiento, un solo uso, fragmento), del marcador y sus reinicios, del bloqueo del PIN y de borrar todo.

A mano, en el navegador:

1. Crear un espacio con una frase y un PIN de 6 dígitos.
2. Anotar una queja y ver el marcador en contra. Saldarla y ver que vuelve a cero. Anotar un gesto y ver el punto a favor.
3. Bloquear desde Ajustes y volver a entrar con el PIN. Un PIN malo no abre.
4. Exportar cifrado y comprobar que el archivo no contiene el texto de la queja. La exportación en claro pide escribir `ENTIENDO`.
5. Invitar: el enlace usa el fragmento (`#`). La frase no va en el enlace.
6. Borrar todo escribe `BORRAR` y deja el teléfono como al principio.

## Modelo de amenazas

| Quién | Qué puede | Qué lo frena |
| --- | --- | --- |
| Alguien con el teléfono desbloqueado y la app abierta | Lee todo lo que está en pantalla | El cierre automático y el PIN al volver |
| Alguien que toma el teléfono un momento | Intenta el PIN | 5 intentos y luego una espera que se duplica y queda guardada; a la tercera ronda el PIN se borra y hace falta la frase. Al irse a segundo plano la pantalla se tapa y el cuaderno se cierra |
| Alguien que copia la base del navegador | Ataca el cifrado offline | La frase secreta. En un espacio nuevo, Argon2id le cuesta memoria. El PIN no alcanza: un PIN de 6 dígitos se puede probar fuera del teléfono |
| Un servidor futuro | Guardar lo que el cliente le mande | Hoy no hay servidor. El módulo de sincronización está apagado y solo describe sobres de texto cifrado |
| La red, al cargar la app | Ver que se pidió la app | No viajan quejas. El fragmento de la invitación no se envía en la petición HTTP, y la app lo quita de la barra al leerlo |
| El dictado | El fabricante del navegador puede recibir el audio | El aviso está en la pantalla. Matripuntos no llama a un servicio de transcripción. Se puede escribir a mano |
| Un archivo exportado | Depende de cuál | El cifrado sigue ilegible sin la frase. El archivo en claro es exactamente eso: en claro |

Límites, en corto:

- El PIN es un cierre casual. La frase es el secreto de verdad.
- Los espacios nuevos usan Argon2id (19 MiB, 2 pasadas, 1 carril). Los anteriores siguen con PBKDF2-SHA256 de 600000 iteraciones hasta que se actualizan. Un atacante con la base copiada y una frase corta sigue en ventaja si el espacio no se actualizó, y también si la frase nueva es corta.
- JavaScript no puede borrar de la RAM una frase que el motor ya copió. El módulo de Argon2id reserva unas 65 MiB porque así está compilado.
- Cambiar la frase vuelve a envolver la misma llave y sube la época: los códigos `mp1.` viejos se rechazan en un teléfono que ya tiene la época nueva. No reescribe las anotaciones. Un respaldo o un código viejo, con la frase vieja, todavía abre esa misma llave en un teléfono que no conoce la época nueva. Hay que invitar otra vez.
- Una invitación nueva vence a los 15 minutos y, en cada teléfono, se acepta una vez. El fragmento se quita de la barra al leerlo. Puede quedar en el historial y en el chat. No lleva la frase, pero lleva la llave envuelta. El portapapeles se intenta vaciar a los 45 segundos; otra app puede haberlo leído.
- El autenticador del teléfono (WebAuthn) no desbloquea. Sin la extensión PRF no hay material para la llave, y esa extensión no está en todos los teléfonos.
- Quien controle el navegador (extensión, malware, depurador) gana. La CSP y el armado del DOM sin HTML inyectado bajan el riesgo de un script metido en una queja, no el de un navegador ya comprometido.
- No se puede impedir una captura de pantalla.
- Si el navegador guarda la frase en una cuenta en la nube, esa copia sale del teléfono.
- `translate="no"` está en la página para que el traductor del navegador no se lleve las quejas.
- Borrar todo afecta solo a este dispositivo.

El cifrado local y el borrado fácil están pensados para datos íntimos. Esto no es asesoría sobre la Ley 21.719.

## Privacidad

No hay analítica, anuncios, fuentes de terceros ni CDN. No se pide correo, teléfono ni nombre real. Los apodos son opcionales y se guardan cifrados.

Las notas de voz se graban en el teléfono, se cifran con la misma llave y se eliminan con el resto. Duran como máximo 60 segundos.

## Licencia

MIT. Copyright (c) 2026 AQA Bank S.A. Ver `LICENSE`.
