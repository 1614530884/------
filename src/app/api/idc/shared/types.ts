export interface ApiActionDef {
  path: string;
  method: string;
}

export interface IdcRequestContext {
  baseUrl: string;
  headers: Record<string, string>;
  cookie: string;
  phpSessId: string;
}

export interface ModuleHandler {
  getActions(): Record<string, ApiActionDef>;
  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown>;
  handleSpecialAction?(action: string, params: Record<string, unknown>, ctx: IdcRequestContext): Promise<import('next/server').NextResponse | null>;
  handleResponse?(action: string, result: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown>;
  isFrontendApi?(action: string): boolean;
}
