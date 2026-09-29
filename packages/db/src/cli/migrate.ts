import { openDatabase } from '../client';
import { runMigrations } from '../migrate';
import { cliDatabaseOptions } from './env';

const { db, close } = openDatabase(cliDatabaseOptions());
runMigrations(db);
close();
console.log('Migrations applied.');
