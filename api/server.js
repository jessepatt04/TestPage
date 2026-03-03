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

// server.js (inside app.get('/points', ...))

app.get('/points', async (req, res) => {
  const { minLong, minLat, maxLong, maxLat, limit } = req.query;

  // Build WHERE dynamically; apply on numeric fields after extraction
  const whereParams = [];
  let whereClause = '';
  if ([minLong, minLat, maxLong, maxLat].every(v => v !== undefined)) {
    whereClause = `WHERE long BETWEEN $1 AND $3 AND lat BETWEEN $2 AND $4`;
    whereParams.push(Number(minLong), Number(minLat), Number(maxLong), Number(maxLat));
  }

  const lim =
    Number(limit) > 0 && Number(limit) <= 100000 ? `LIMIT ${Number(limit)}` : '';

  // Robust extraction:
  // - arrays are JSONB strings -> use jsonb_array_elements_text
  // - trim whitespace
  // - keep only values that look like numbers via regex
  // - cast to float
  const sql = `
    WITH exploded AS (
      SELECT
        lo.ord,
        trim(lo.val) AS long_txt,
        trim(la.val) AS lat_txt
      FROM ${TABLE} d
      CROSS JOIN LATERAL jsonb_array_elements_text(d.${LONG}) WITH ORDINALITY AS lo(val, ord)
      CROSS JOIN LATERAL jsonb_array_elements_text(d.${LAT})  WITH ORDINALITY AS la(val, ord)
      WHERE lo.ord = la.ord                      -- zip long[i] with lat[i]
    ),
    cleaned AS (
      SELECT
        long_txt,
        lat_txt
      FROM exploded
      WHERE long_txt ~ '^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$'
        AND lat_txt  ~ '^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$'
    ),
    pts AS (
      SELECT
        long_txt::float AS long,
        lat_txt::float  AS lat
      FROM cleaned
    )
    SELECT long, lat
    FROM pts
    ${whereClause}
    ${lim};
  `;

  // --- TEMP: debug logging; remove once verified ---
  console.log('------------------------------------------------');
  console.log('[API] /points');
  console.log('[API] SQL:', sql.replace(/\s+/g, ' ').trim());
  console.log('[API] Params:', whereParams);

  try {
    const result = await pool.query(sql, whereParams);

    console.log('[API] rows:', result.rowCount, ' sample row:', result.rows[0]);

    // Avoid NaN/null in JSON: drop any non-finite values (paranoia)
    const data = result.rows
      .map(r => [Number(r.long), Number(r.lat)])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
      .map(([lng, lat]) => ({ position: [lng, lat] }));

    console.log('[API] first mapped:', data[0]);
    res.json(data);
  } catch (err) {
    console.error('[API] ERROR:', err);
    res.status(500).json({ error: 'DB query failed', detail: String(err) });
  }
});
``

// Fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// -----------------------------
// Start
// -----------------------------
app.listen(PORT, () => {
  console.log(`Heatmap API listening on port ${PORT}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(', ') || '*'} `);
});