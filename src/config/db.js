const mysql = require("mysql2/promise");
const { db } = require("./env");

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      namedPlaceholders: true,
    });
  }
  return pool;
}

async function withTransaction(callback) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) {}
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { getPool, withTransaction };
