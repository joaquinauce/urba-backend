import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AdminRequest } from './auth.js';

export function isPlatformOperator(request: Pick<AdminRequest, 'administratorId' | 'administratorPersonId'>): boolean {
  const principalId = request.administratorPersonId ?? request.administratorId;
  if (!principalId) return false;
  return (process.env.PLATFORM_OPERATOR_IDS ?? '').split(',').some((id) => id.trim() === principalId);
}

@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!isPlatformOperator(request)) throw new ForbiddenException('Operación reservada a la plataforma');
    return true;
  }
}
