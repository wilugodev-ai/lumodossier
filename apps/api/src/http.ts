import 'reflect-metadata';
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpException,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Database } from './db';
import { Problem, crmSchema, ensure, id } from './model';
import { Signing } from './recipient';
import { Services } from './providers';
import { PdfInputError } from './pdf';
import { statuses } from './sender';

const ENGINE = Symbol('signing');
const uuid = new ParseUUIDPipe();
const types = z.enum(['original', 'completed', 'record']);
function token(auth?: string) {
  ensure(auth && auth.startsWith('Bearer '), 401, 'Authentication is required.');
  return auth.slice(7);
}
function output(res: Response, kind: string, data: unknown) {
  const ext = kind === 'record' ? 'json' : 'pdf';
  res.setHeader(
    'Content-Disposition',
    (kind === 'original' ? 'inline' : 'attachment') +
      '; filename="LumoDossier-' +
      kind +
      '.' +
      ext +
      '"',
  );
  res.type(kind === 'record' ? 'application/json' : 'application/pdf');
  return res.send(kind === 'record' ? JSON.stringify(data, null, 2) : data);
}
@Catch()
class Errors implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 503,
      message = 'LumoDossier is temporarily unavailable. Please try again.';
    if (e instanceof Problem) {
      status = e.status;
      message = e.message;
    } else if (e instanceof PdfInputError) {
      status = 400;
      message = e.message;
    } else if (e instanceof z.ZodError) {
      status = 400;
      message = 'Check the submitted ' + (e.issues[0]?.path.join(' ') || 'information') + '.';
    } else if (e instanceof HttpException) {
      status = e.getStatus();
      message = status === 413 ? 'PDFs must be 15 MB or smaller.' : e.message;
    } else if ((e as { status?: number })?.status === 413) {
      status = 413;
      message = 'The uploaded file or form is too large.';
    } else if ((e as { status?: number })?.status === 400) {
      status = 400;
      message = 'The submitted form could not be read.';
    } else console.error('A LumoDossier service operation failed.');
    res.status(status).json({ message });
  }
}
@Controller()
class Api {
  constructor(@Inject(ENGINE) private readonly app: Signing) {}
  private who(auth?: string) {
    return this.app.services.auth.user(token(auth));
  }
  @Get('health') async health() {
    await this.app.system((tx) => tx.query('select id from lumo.jobs limit 0'));
    return { service: 'LumoDossier', status: 'ok' };
  }
  @Get('v1/workspaces') async workspaces(@Headers('authorization') a: string) {
    return this.app.spaces(await this.who(a));
  }
  @Post('v1/workspaces') async newSpace(@Headers('authorization') a: string, @Body() body: unknown) {
    const who = await this.who(a);
    await this.app.limit('space/' + who.id, 10);
    return this.app.createSpace(
      who,
      z.strictObject({ name: z.string().trim().min(1).max(100) }).parse(body).name,
    );
  }
  @Get('v1/workspaces/:w/documents') async documents(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Query() q: Record<string, string>,
  ) {
    const search = z
        .string()
        .max(160)
        .parse(q.q ?? ''),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000000)
        .parse(q.page ?? 1);
    const status = z.enum(['', ...statuses]).parse(q.status ?? '');
    const refs = crmSchema.parse(
      Object.fromEntries(Object.entries(q).filter(([k]) => ['customer', 'quote', 'deal'].includes(k))),
    );
    return this.app.list(await this.who(a), w, search, status, page, refs);
  }
  @Post('v1/workspaces/:w/documents') async upload(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Req() req: Request,
  ) {
    const who = await this.who(a);
    await this.app.limit('upload/' + who.id, 24);
    ensure(req.is('application/pdf') && Buffer.isBuffer(req.body), 415, 'Choose a PDF document.');
    let title, refs;
    try {
      title = decodeURIComponent(req.get('x-document-title') || 'Untitled document');
      refs = JSON.parse(req.get('x-crm-references') || '{}');
    } catch {
      throw new Problem(400, 'Invalid document details.');
    }
    return this.app.upload(
      who,
      w,
      z.string().trim().min(1).max(160).parse(title),
      req.body,
      crmSchema.parse(refs),
    );
  }
  @Get('v1/workspaces/:w/documents/:d') async detail(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
  ) {
    return this.app.detail(await this.who(a), w, d);
  }
  @Patch('v1/workspaces/:w/documents/:d') async save(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
    @Body() body: unknown,
  ) {
    return this.app.save(await this.who(a), w, d, body);
  }
  @Post('v1/workspaces/:w/documents/:d/send') async send(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
    @Body() body: unknown,
  ) {
    const v = z
      .strictObject({ revision: z.number().int().positive(), days: z.number().int().min(1).max(90) })
      .parse(body);
    return this.app.send(await this.who(a), w, d, v.revision, v.days);
  }
  @Post('v1/workspaces/:w/documents/:d/cancel') async cancel(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
  ) {
    return this.app.cancel(await this.who(a), w, d);
  }
  @Post('v1/workspaces/:w/documents/:d/retry-files') async retry(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
  ) {
    return this.app.retryFiles(await this.who(a), w, d);
  }
  @Post('v1/workspaces/:w/documents/:d/recipients/:p/:action') async action(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
    @Param('p', uuid) p: string,
    @Param('action') action: string,
  ) {
    const who = await this.who(a);
    await this.app.limit('manage/' + who.id, 60);
    return this.app.manageLink(who, w, d, p, z.enum(['share', 'remind', 'revoke']).parse(action));
  }
  @Get('v1/workspaces/:w/documents/:d/files/:kind') async file(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('d', uuid) d: string,
    @Param('kind') k: string,
    @Res() res: Response,
  ) {
    return output(res, k, await this.app.download(await this.who(a), w, d, types.parse(k)));
  }
  @Get('v1/workspaces/:w/related/:kind/:record') async related(
    @Headers('authorization') a: string,
    @Param('w', uuid) w: string,
    @Param('kind') kind: string,
    @Param('record') record: string,
  ) {
    const who = await this.who(a),
      refs = crmSchema.parse({ [z.enum(['customer', 'quote', 'deal']).parse(kind)]: id.parse(record) });
    return this.app.inSpace(who, w, false, async (tx, space) => ({
      refs,
      contact: await this.app.refs(who, space, refs),
    }));
  }
  private async publicToken(req: Request) {
    await this.app.limit('recipient/ip/' + (req.ip || req.socket.remoteAddress), 160);
    const t = token(req.get('authorization'));
    ensure(t.length === 43, 401, 'Invalid signing link.');
    await this.app.limit('recipient/link/' + t, 80);
    return t;
  }
  @Post('v1/recipient/open') async open(@Req() req: Request) {
    return this.app.recipient(await this.publicToken(req));
  }
  @Post('v1/recipient/sign') async sign(@Req() req: Request, @Body() body: unknown) {
    return this.app.sign(await this.publicToken(req), body);
  }
  @Post('v1/recipient/decline') async decline(@Req() req: Request, @Body() body: unknown) {
    const t = await this.publicToken(req);
    return this.app.decline(
      t,
      z.strictObject({ reason: z.string().trim().max(500).default('') }).parse(body ?? {}).reason,
    );
  }
  @Get('v1/recipient/files/:kind') async copy(
    @Req() req: Request,
    @Param('kind') k: string,
    @Res() res: Response,
  ) {
    return output(res, k, await this.app.recipientFile(await this.publicToken(req), types.parse(k)));
  }
}
export async function httpServer(db: Database, services: Services, crmOrigin?: string) {
  @Module({ controllers: [Api], providers: [{ provide: ENGINE, useValue: new Signing(db, services) }] })
  class App {}
  const app = await NestFactory.create<NestExpressApplication>(App, {
    logger: false,
    bodyParser: false,
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  if (process.env.RENDER === 'true') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use((_req: Request, res: Response, next: () => void) => {
    res.set({
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  });
  app.enableCors({
    origin: [services.webOrigin, ...(crmOrigin ? [new URL(crmOrigin).origin] : [])],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Document-Title', 'X-CRM-References'],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    credentials: false,
  });
  app.useBodyParser('raw', { type: 'application/pdf', limit: '15mb' });
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalFilters(new Errors());
  return app;
}
