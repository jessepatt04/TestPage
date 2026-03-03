import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;

// -----------------------------
// Environment & defaults
// -----------------------------
const PORT = Number(process.env.PORT || 3000);
const TABLE = process.env.TABLE_NAME || 'public.dexter';
const LAT = process.env.LAT_COLUMN || 'lat';
const LONG = process.env.LONG_COLUMN || 'long';

// CORS origins: comma-separated list or "*" for dev
const allowedOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// -----------------------------
// Express app & CORS
// -----------------------------
const app = express();
app.set('trust proxy', true);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow curl/postman
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: false
};
app.use(cors(corsOptions));

// -----------------------------
// Postgres pool
// -----------------------------
const pool = new Pool({
  host: process.env.PGHOST || 'host.docker.internal',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'jesse',
  password: process.env.PGPASSWORD || 'jesse',
  max: 10,
  idleTimeoutMillis: 30000
});

// -----------------------------
// Routes
// -----------------------------
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /points?minLng=&minLat=&maxLng=&maxLat=&limit=
app.get('/points', async (req, res) => {
  const { minLong, minLat, maxLong, maxLat, limit } = req.query;

  // Build WHERE dynamically if bbox provided (apply WHERE on numeric fields)
  const clauses = [];
  const params = [];

  if ([minLong, minLat, maxLong, maxLat].every(v => v !== undefined)) {
    clauses.push(`long BETWEEN $1 AND $3 AND lat BETWEEN $2 AND $4`);
    params.push(Number(minLong), Number(minLat), Number(maxLong), Number(maxLat));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Number(limit) > 0 && Number(limit) <= 100000 ? `LIMIT ${Number(limit)}` : '';

  const sql = `
    WITH pts AS (
      SELECT
        (lo.val)::float AS long,
        (la.val)::float AS lat
      FROM ${TABLE} d
      -- arrays are JSONB **strings**, so use _text extractor
      CROSS JOIN LATERAL jsonb_array_elements_text(d.${LONG}) WITH ORDINALITY AS lo(val, ord)
      CROSS JOIN LATERAL jsonb_array_elements_text(d.${LAT})  WITH ORDINALITY AS la(val, ord2)
      WHERE lo.ord = la.ord2
    )
    SELECT long, lat
    FROM pts
    ${where}
    ${lim};
  `;

  const result = await pool.query(sql, params);
  const data = result.rows.map(r => ({ position: [Number(r.long), Number(r.lat)] }));
  res.json(data);

  try {
    const result = await pool.query(sql, params);
    const data = result.rows.map(r => ({
      position: [Number(r.long), Number(r.lat)]
    }));
    res.json(data);
  } catch (err) {
    console.error('Error querying points:', err);
    res.status(500).json({ error: 'DB query failed', detail: String(err) });
  }


// Fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// -----------------------------
// Start
// -----------------------------
app.listen(PORT, () => {
  console.log(`Heatmap API listening on port ${PORT}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(', ') || '*'} `);
});