const { Pool } = require('pg');
require('dotenv').config();

// O Render injeta a variável DATABASE_URL automaticamente em produção
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: isProduction ? process.env.DATABASE_URL : `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

module.exports = {
    query: (text, params) => pool.query(text, params),
};