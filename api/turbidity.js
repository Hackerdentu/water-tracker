import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const API_KEY = process.env.ESP32_API_KEY || 'my-secret-esp32-key';

let tableInitialized = false;

async function ensureTable() {
  if (tableInitialized) return;
  await sql`
    CREATE TABLE IF NOT EXISTS turbidity_readings (
      id SERIAL PRIMARY KEY,
      ntu REAL NOT NULL,
      voltage REAL NOT NULL,
      is_dirty BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  tableInitialized = true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await ensureTable();

    // 1. ESP32 sends sensor data
    if (req.method === 'POST') {
      if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { ntu, voltage, isDirty } = req.body;

      if (typeof ntu !== 'number' || typeof voltage !== 'number' || typeof isDirty !== 'boolean') {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const [inserted] = await sql`
        INSERT INTO turbidity_readings (ntu, voltage, is_dirty)
        VALUES (${ntu}, ${voltage}, ${isDirty})
        RETURNING id, ntu, voltage, is_dirty AS "isDirty", created_at AS "timestamp";
      `;

      // ~1% chance per insert to prune rows older than 30 days
      if (Math.random() < 0.01) {
        await sql`DELETE FROM turbidity_readings WHERE created_at < NOW() - INTERVAL '30 days';`;
      }

      return res.status(201).json({ status: 'saved', entry: inserted });
    }

    // 2. Frontend fetches recent history
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, ntu, voltage, is_dirty AS "isDirty", created_at AS "timestamp"
        FROM turbidity_readings
        ORDER BY created_at DESC
        LIMIT 50;
      `;

      // Reverse so oldest is first (left-to-right on chart)
      return res.status(200).json(rows.reverse());
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Database/API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}