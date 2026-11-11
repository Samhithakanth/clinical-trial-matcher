import mysql from 'mysql2/promise';
const globalForMySQL = globalThis as unknown as { mysqlPool?: mysql.Pool };
const pool = globalForMySQL.mysqlPool ?? mysql.createPool({
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'clinical_trial_matcher',
  waitForConnections: true, connectionLimit: 5, queueLimit: 0,
});
if (process.env.NODE_ENV !== 'production') globalForMySQL.mysqlPool = pool;
export default pool;
