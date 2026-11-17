import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createHandler } from './handler.mjs';
import { checkStorage, persistRecord } from './storage.mjs';

const secret = process.env.AMR_WEBHOOK_SECRET;
const connectionString = process.env.AMR_WRITER_DATABASE_URL;
if (!connectionString) throw new Error('Restricted writer database URL is required');
if (new URL(connectionString).username !== 'amr_worker') throw new Error('Use the restricted AMR writer account');
const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000, application_name: 'amr01-commissioning-webhook' });
attachDatabasePool(pool);
export default { fetch: createHandler({ secret, persist: record => persistRecord(pool, record), healthcheck: () => checkStorage(pool) }) };
