# Camino

## Etapa 1 (esta)

PWA de un teléfono, o de dos teléfonos que todavía no se sincronizan.

- Espacio creado con una frase compartida y un PIN local.
- Quejas (−1 a −5), saldar con disculpa o gesto, gestos buenos, marcador semanal y mensual que se reinicia, historial.
- Techo diario para que no se vuelva un libro de rencores.
- Cifrado en el teléfono. Los espacios nuevos usan Argon2id; los que ya existían siguen abriéndose con PBKDF2 y pueden pasarse a Argon2id. La base queda lista para que un servidor futuro solo vea texto cifrado.
- Invitación por código o enlace con fragmento, sin frase adentro. El otro teléfono parte vacío.
- Respaldo cifrado y, con aviso, exportación en claro.
- Borrar todo en el dispositivo.
- Dictado con Web Speech API y aviso de que algunos navegadores mandan el audio al fabricante. Notas de voz de hasta 60 segundos, cifradas y borradas con el resto.
- Cierre automático. El PIN se bloquea por intentos y termina pidiendo la frase.

## Etapa 2

Sin fecha. Nada de esto está encendido.

- Sincronización cero-conocimiento: el servidor solo guarda sobres `{ id, iv, ciphertext }`, apagada hasta que el cifrado y el borrado estén revisados. Sin cuentas complejas. Hoy no hay servidor.
- Cómo se juntan dos cuadernos si los dos anotaron fuera de línea.
- Código QR dibujado en el teléfono, además del enlace. Hoy el código se copia; no hay un dibujo.
- Desbloqueo con el autenticador del teléfono, además del PIN. Se miró WebAuthn con la extensión PRF: sin esa extensión el autenticador no entrega material para desenvolver la llave, y el soporte en teléfonos todavía no es parejo. No está encendido.
- Más idiomas y categorías, si otras parejas las proponen.
- Preguntar a parejas cómo llevan la cuenta hoy, antes de crecer la app.

No hay cobro. Si alguna vez se habla de dinero, tiene que seguir siendo un juego y no un negocio armado encima de la pelea.
