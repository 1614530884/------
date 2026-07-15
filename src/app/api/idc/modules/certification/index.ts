import { ModuleHandler } from '../../shared/types';
import { certificationActions } from './actions';
import {
  transformCertifiLogListParams,
  transformCertifiStatusParams,
} from './transformers';

export class CertificationModule implements ModuleHandler {
  getActions() {
    return certificationActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'certifiLogList':
        return transformCertifiLogListParams(params);
      case 'certifiStatus':
        return transformCertifiStatusParams(params);
      default:
        return params;
    }
  }
}
