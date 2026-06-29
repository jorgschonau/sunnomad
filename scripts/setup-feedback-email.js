#!/usr/bin/env node
/**
 * One-time: enable feedback emails via Resend.
 * RESEND_API_KEY in .env, then: node scripts/setup-feedback-email.js
 */
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)/)?.[1];
const password = process.env.SUPABASE_DB_PASSWORD;
const resendKey = process.env.RESEND_API_KEY;

if (!ref || !password) {
  console.error('Need SUPABASE_URL and SUPABASE_DB_PASSWORD in .env');
  process.exit(1);
}
if (!resendKey) {
  console.error('Need RESEND_API_KEY in .env');
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, '../supabase/add-feedback-email-trigger.sql'),
  'utf8',
);

const hosts = [
  'aws-1-eu-west-1.pooler.supabase.com',
  'aws-0-eu-west-1.pooler.supabase.com',
  'aws-1-eu-central-1.pooler.supabase.com',
];

async function run() {
  for (const host of hosts) {
    const client = new Client({
      host,
      port: 5432,
      user: `postgres.${ref}`,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
      await client.query(sql);
      await client.query(
        `INSERT INTO private_config (key, value) VALUES ('resend_api_key', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [resendKey],
      );
      console.log('Feedback emails enabled → hola@sunnomad.app');
      await client.end();
      return;
    } catch (e) {
      if (__DEV !== false) console.error(host, e.message);
      try { await client.end(); } catch {}
    }
  }
  console.error('Could not connect. Run supabase/add-feedback-email-trigger.sql in SQL Editor.');
  process.exit(1);
}

run();
