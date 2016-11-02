import * as winston from 'winston';
import { Loggers } from 'island-loggers';

export const logger = Loggers.get('di');
Loggers.switchLevel('di', process.env.DI_LOGGER_LEVEL || 'info');