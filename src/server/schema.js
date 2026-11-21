// Forge SQL schema. Migrations are idempotent and run in order by name; never edit
// a migration that has shipped, add a new one.
//
// ledger_records is written with INSERT only: the primary key (wall_id, seq) makes
// two concurrent appends of the same sequence number fail instead of forking the chain.
// insider_details holds the personal details the export needs; it is the one table
// rows are deleted from, person by person, when their retention ends.

export const MIGRATIONS = Object.freeze([
  [
    'v001_create_walls',
    `CREATE TABLE IF NOT EXISTS walls (
      wall_id VARCHAR(64) NOT NULL,
      project_key VARCHAR(64) NOT NULL,
      subject VARCHAR(300) NOT NULL,
      code_name VARCHAR(100) NULL,
      status VARCHAR(16) NOT NULL,
      raised_at VARCHAR(30) NOT NULL,
      updated_at VARCHAR(30) NOT NULL,
      PRIMARY KEY (wall_id)
    )`,
  ],
  [
    'v002_create_ledger_records',
    `CREATE TABLE IF NOT EXISTS ledger_records (
      wall_id VARCHAR(64) NOT NULL,
      seq INT NOT NULL,
      record_type VARCHAR(40) NOT NULL,
      recorded_at VARCHAR(30) NOT NULL,
      hash CHAR(64) NOT NULL,
      prev_hash CHAR(64) NOT NULL,
      body MEDIUMTEXT NOT NULL,
      PRIMARY KEY (wall_id, seq)
    )`,
  ],
  [
    'v003_create_scans',
    `CREATE TABLE IF NOT EXISTS scans (
      wall_id VARCHAR(64) NOT NULL,
      taken_at VARCHAR(30) NOT NULL,
      scan_hash CHAR(64) NOT NULL,
      wall_hash CHAR(64) NOT NULL,
      summary MEDIUMTEXT NOT NULL,
      PRIMARY KEY (wall_id, taken_at)
    )`,
  ],
  [
    'v004_create_insider_details',
    `CREATE TABLE IF NOT EXISTS insider_details (
      account_id VARCHAR(128) NOT NULL,
      first_name VARCHAR(200) NULL,
      surname VARCHAR(200) NULL,
      professional_phone VARCHAR(64) NULL,
      company VARCHAR(300) NULL,
      company_address VARCHAR(500) NULL,
      updated_at VARCHAR(30) NOT NULL,
      erase_after VARCHAR(30) NULL,
      PRIMARY KEY (account_id)
    )`,
  ],
]);
