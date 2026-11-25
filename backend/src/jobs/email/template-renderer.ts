import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Renders an HTML email template with Handlebars (`strict` mode, so a missing
 * variable is an error, and every value is HTML-escaped). Compiled templates are
 * cached per file. Paths are resolved inside `templateDirectory` only.
 */
export class TemplateRenderer {
  private readonly cache = new Map<string, HandlebarsTemplateDelegate>();

  constructor(private readonly templateDirectory: string) {}

  render(templateFile: string, context: Record<string, unknown>): string {
    return this.compile(templateFile)(context);
  }

  private compile(templateFile: string): HandlebarsTemplateDelegate {
    const cached = this.cache.get(templateFile);
    if (cached) return cached;

    const templatePath = resolve(this.templateDirectory, templateFile);
    const relativePath = relative(this.templateDirectory, templatePath);
    if (
      isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith('..\\') ||
      relativePath.startsWith('../')
    ) {
      throw new Error('Mail template path is outside the template directory');
    }

    const compiled = Handlebars.compile(readFileSync(templatePath, 'utf8'), {
      strict: true,
    });
    this.cache.set(templateFile, compiled);
    return compiled;
  }
}

/** Plain-text alternative: tags stripped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x3D;/g, '=')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
