'use strict'

const mysql = require('mysql2/promise')

let pool = null

async function getPool() {
  if (pool) return pool
  pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'inbody_crm',
    waitForConnections: true,
    connectionLimit: 10,
  })
  await initSchema()
  return pool
}

async function initSchema() {
  const conn = await pool.getConnection()
  try {
    // Measurement events received via webhook
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      VARCHAR(50)  NOT NULL,
        user_token   VARCHAR(20)  DEFAULT NULL,
        equip        VARCHAR(100) DEFAULT NULL,
        equip_serial VARCHAR(50)  DEFAULT NULL,
        test_at      VARCHAR(14)  NOT NULL,
        account      VARCHAR(100) DEFAULT NULL,
        is_temp      TINYINT(1)   NOT NULL DEFAULT 0,
        inbody_data  JSON         DEFAULT NULL,
        fetch_status VARCHAR(30)  NOT NULL DEFAULT 'pending',
        fetch_error  TEXT         DEFAULT NULL,
        received_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_received_at (received_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // Free-form notes per member
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS member_notes (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    VARCHAR(50) NOT NULL,
        note       TEXT        NOT NULL,
        created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
  } finally {
    conn.release()
  }
}

module.exports = { getPool }
