import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as dotenvExpand from 'dotenv-expand';

// Load environment variables from .env file
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

/**
 * ==============================================================================
 * FORTIS POS - PHASE 1 DATABASE MIGRATION SCRIPT (METHOD A)
 * ==============================================================================
 * This script handles database bootstrapping in two sequential steps:
 * 1. Runs standard Drizzle ORM schema migrations (tables, indexes, RLS policies).
 * 2. Reads and deploys custom PostgreSQL stored functions & triggers (phase1_functions.sql).
 * ==============================================================================
 */

async function runPhase1Migrations() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ Error: DATABASE_URL environment variable is not defined.');
    process.exit(1);
  }

  console.log('🔄 Connecting to PostgreSQL database...');
  const pool = new Pool({
    connectionString,
    // Optional configuration for SSL in production environments
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const db = drizzle(pool);

  try {
    // Step 1: Run standard Drizzle Kit migrations
    const migrationsFolder = path.join(__dirname, '../drizzle');
    console.log(`🚀 Step 1: Running Drizzle schema migrations from '${migrationsFolder}'...`);
    
    if (fs.existsSync(migrationsFolder)) {
      await migrate(db, { migrationsFolder });
      console.log('✅ Drizzle schema migrations applied successfully.');
    } else {
      console.warn(`⚠️ Warning: Migrations folder '${migrationsFolder}' not found. Skipping schema migration step.`);
    }

    // Step 2: Read and deploy PostgreSQL functions & triggers
    const functionsFilePath = path.join(__dirname, '../database_files/phase1_functions.sql');
    console.log(`🚀 Step 2: Deploying Phase 1 PostgreSQL functions from '${functionsFilePath}'...`);

    if (!fs.existsSync(functionsFilePath)) {
      throw new Error(`Functions file not found at path: ${functionsFilePath}`);
    }

    const functionsSql = fs.readFileSync(functionsFilePath, 'utf8');

    // Execute raw SQL script containing stored functions and triggers
    await db.execute(sql.raw(functionsSql));
    console.log('✅ PostgreSQL functions and triggers deployed successfully.');

    console.log('\n🎉 Phase 1 database migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed with error:', error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Database connection pool closed.');
  }
}

// Execute migration
runPhase1Migrations();
