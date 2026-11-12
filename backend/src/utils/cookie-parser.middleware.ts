import type { NextFunction, Request, Response } from 'express';

export function cookieParserMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const entries = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): [string, string] | undefined => {
      const separator = part.indexOf('=');
      if (separator < 1) return undefined;

      const name = part.slice(0, separator).trim();
      const rawValue = part.slice(separator + 1).trim();
      const value =
        rawValue.startsWith('"') && rawValue.endsWith('"')
          ? rawValue.slice(1, -1)
          : rawValue;
      try {
        return [name, decodeURIComponent(value)];
      } catch {
        return [name, value];
      }
    })
    .filter((entry): entry is [string, string] => entry !== undefined);

  request.cookies = Object.fromEntries(entries);
  next();
}
