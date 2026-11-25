/** HTTP context copied onto an audit row. Every field is optional. */
export type AuditRequestContext = {
  method?: string;
  endpointPath?: string;
  responseStatus?: number;
  requestId?: string;
  clientType?: string;
  terminalId?: string;
  ipAddress?: string;
  userAgent?: string;
};
