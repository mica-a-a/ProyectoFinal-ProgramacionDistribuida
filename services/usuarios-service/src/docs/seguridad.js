// TP7 (sección 16) - Seguridad en la documentación OpenAPI. MISMO código en los tres servicios
// (los servicios no comparten paquetes): copiar tal cual a services/<servicio>/src/docs/seguridad.js
//
// Cada servicio declara una tabla { 'METODO /ruta': { acceso, forbidden } } con SUS endpoints protegidos,
// tomada de la matriz del Hito 1 (docs/tp7-hito1-seguridad.md). Este módulo agrega a cada uno:
//   - el candado de Swagger UI (`security: bearerAuth`) y el rol o condición exigida en la descripción,
//   - las respuestas 401 (sin identidad válida) y, si corresponde, 403 (identidad válida sin permiso).
// Lo que no figura en la tabla es público. Si una ruta de la tabla no existe en `paths`, falla al cargar:
// así la documentación no puede quedar desactualizada respecto de las rutas sin que nadie lo note.
const ERROR = { $ref: '#/components/schemas/Error' };

const resp401 = {
  description: 'No hay una identidad válida: falta el token, está mal formado, la firma no es válida o el token venció',
  content: {
    'application/json': {
      schema: ERROR,
      examples: {
        TOKEN_AUSENTE: { summary: 'Sin token', value: { message: 'Falta el token de autenticación', code: 'TOKEN_AUSENTE' } },
        TOKEN_INVALIDO: { summary: 'Mal formado, firma inválida o algoritmo no esperado', value: { message: 'Token inválido', code: 'TOKEN_INVALIDO' } },
        TOKEN_VENCIDO: { summary: 'Token vencido', value: { message: 'Token vencido', code: 'TOKEN_VENCIDO' } },
      },
    },
  },
};

const resp403 = {
  description: 'La identidad es válida pero no tiene permiso: rol insuficiente o recurso que pertenece a otro usuario',
  content: {
    'application/json': {
      schema: ERROR,
      example: { message: 'No tenés permisos para esta operación', code: 'PERMISOS_INSUFICIENTES' },
    },
  },
};

function aplicarSeguridad(spec, reglas, descripcionServicio) {
  spec.components = spec.components || {};
  spec.components.securitySchemes = {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Access token JWT (HS256) emitido por `usuarios-service` en `POST /auth/login`. ' +
        'En Swagger UI: botón **Authorize** y pegar solo el token (sin la palabra `Bearer`). ' +
        'Se envía como `Authorization: Bearer <token>` y vence según `JWT_EXPIRES_IN` (por defecto 1 hora).',
    },
  };

  for (const [clave, regla] of Object.entries(reglas)) {
    const [metodo, ruta] = clave.split(' ');
    const operacion = spec.paths[ruta] && spec.paths[ruta][metodo.toLowerCase()];
    if (!operacion) throw new Error(`OpenAPI: la regla de seguridad "${clave}" no corresponde a ningún endpoint documentado`);
    operacion.security = [{ bearerAuth: [] }];
    operacion.description = `🔒 **${regla.acceso}**${operacion.description ? `\n\n${operacion.description}` : ''}`;
    // Las respuestas se reordenan por código para que 401 y 403 queden donde se esperan.
    const respuestas = { ...operacion.responses, 401: resp401, ...(regla.forbidden === false ? {} : { 403: resp403 }) };
    operacion.responses = Object.fromEntries(Object.entries(respuestas).sort(([a], [b]) => Number(a) - Number(b)));
  }

  spec.info.description = `${spec.info.description}\n\n${descripcionServicio}`;
  return spec;
}

module.exports = { aplicarSeguridad };
