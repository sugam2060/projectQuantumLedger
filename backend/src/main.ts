import { NestFactory } from '@nestjs/core';
import {RequestMethod} from "@nestjs/common"
import { AppModule, ObserveInstrument } from './app.module';
import {ConfigService} from "@nestjs/config"

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {instrument: ObserveInstrument});
  app.setGlobalPrefix("/api/v1", {
    exclude: [
      {path: "health/(.*)", method: RequestMethod.ALL},
      {path: "metrics/(.*)", method: RequestMethod.ALL},
      {path: "webhooks/(.*)", method: RequestMethod.ALL}
    ]
  })
  const config = app.get(ConfigService)
  await app.listen(config.get<number>("PORT",3000));
}
void bootstrap();
