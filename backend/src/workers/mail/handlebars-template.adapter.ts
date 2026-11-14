import type { TemplateAdapter } from '@nestjs-modules/mailer/dist/interfaces/template-adapter.interface';
import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

type CompileMail = {
  data?: {
    template?: string;
    context?: Record<string, unknown>;
    html?: string;
  };
};

export class HandlebarsTemplateAdapter implements TemplateAdapter {
  compile(
    mail: Parameters<TemplateAdapter['compile']>[0],
    callback: Parameters<TemplateAdapter['compile']>[1],
    options: Parameters<TemplateAdapter['compile']>[2],
  ): void {
    try {
      const data = (mail as CompileMail).data;
      if (!data?.template) {
        throw new Error('A mail template name is required');
      }

      const templateDirectory = options.template?.dir;
      if (!templateDirectory) {
        throw new Error('A mail template directory is required');
      }

      const templatePath = resolve(templateDirectory, data.template);
      const relativeTemplatePath = relative(templateDirectory, templatePath);
      if (
        isAbsolute(relativeTemplatePath) ||
        relativeTemplatePath === '..' ||
        relativeTemplatePath.startsWith(`..\\`) ||
        relativeTemplatePath.startsWith('../')
      ) {
        throw new Error('Mail template path is outside the template directory');
      }

      const source = readFileSync(templatePath, 'utf8');
      const template = Handlebars.compile(source, options.template?.options);
      data.html = template(data.context ?? {});
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
