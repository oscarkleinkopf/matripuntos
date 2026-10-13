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

Eso corre las pruebas de cifrado (ida y vuelta, llave incorrecta, nonces únicos), del marcador y sus reinicios, del bloqueo del PIN y de borrar todo.

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
| Alguien que toma el teléfono un momento | Intenta el PIN | PBKDF2 lento, 5 intentos y luego esperas; a la tercera ronda el PIN se borra y hace falta la frase |
| Alguien que copia la base del navegador | Ataca el cifrado offline | La frase secreta. El PIN no alcanza: un PIN de 6 dígitos se puede probar fuera del teléfono |
| Un servidor futuro | Guardar lo que el cliente le mande | Hoy no hay servidor. El módulo de sincronización está apagado y solo describe sobres de texto cifrado |
| La red, al cargar la app | Ver que se pidió la app | No viajan quejas. El fragmento de la invitación no se envía en la petición HTTP |
| El dictado | El fabricante del navegador puede recibir el audio | El aviso está en la pantalla. Matripuntos no llama a un servicio de transcripción. Se puede escribir a mano |
| Un archivo exportado | Depende de cuál | El cifrado sigue ilegible sin la frase. El archivo en claro es exactamente eso: en claro |

Límites, en corto:

- El PIN es un cierre casual. La frase es el secreto de verdad.
- PBKDF2-SHA256 con 600000 iteraciones no es resistente a memoria. Un atacante con la base copiada y una frase corta está en ventaja frente a un KDF como Argon2id.
- JavaScript no puede borrar de la RAM una frase que el motor ya copió.
- Una invitación no caduca sola. Cambiar la frase vuelve a cifrar y deja inútiles los enlaces y respaldos viejos. El otro teléfono no se entera solo.
- El fragmento puede quedar en el historial del navegador y en el chat donde se pegó. No lleva la frase, pero lleva la llave envuelta.
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

MIT. Copyright (c) 2026 Osias Kleinkopf. Ver `LICENSE`.
