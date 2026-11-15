import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@plataforma/shared';

export interface AuthClaims {
  userId: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthClaims;
    user: AuthClaims;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Não autenticado. Faça login novamente.' });
  }
}

export function requireRole(...allowedRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!allowedRoles.includes(request.user.role)) {
      return reply.status(403).send({
        error: 'Acesso negado para o seu perfil de permissão.',
      });
    }
  };
}

export function requireTenantOperator() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (request.user.role === 'END_CLIENT') {
      return reply.status(403).send({ error: 'Acesso restrito a operadores de workspace.' });
    }
    if (!request.user.tenantId) {
      return reply.status(403).send({ error: 'Operação requer um workspace (tenant_id) associado.' });
    }
  };
}
