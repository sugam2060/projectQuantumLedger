#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Directory containing the schema files
const schemaDir = path.join(__dirname, 'src', 'database', 'schema', 'domains');

// Function to process a single file
function processFile(filePath) {
  console.log(`Processing ${filePath}...`);

  // Read the file content
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if already processed
  if (content.includes('primaryKey({ columns:')) {
    console.log(`Skipping ${filePath} - already updated`);
    return;
  }

  // Add missing imports
  if (!content.includes('primaryKey') && content.includes('import {') && content.includes('pgTable')) {
    content = content.replace(
      /import\s*{([^}]+)}\s*from\s*'drizzle-orm\/pg-core'/,
      (match, imports) => {
        if (!imports.includes('primaryKey')) {
          imports = imports.trim() + ', primaryKey';
        }
        if (!imports.includes('unique') && (imports.includes('varchar') || imports.includes('text'))) {
          imports = imports.trim() + ', unique';
        }
        return `import {${imports}} from 'drizzle-orm/pg-core'`;
      }
    );
  }

  // Add primaryKey definition if missing
  if (content.includes('.primaryKey()') && !content.includes('primaryKey({ columns:')) {
    content = content.replace(
      /(}\)),?\s*\(table\)\s*=>\s*\(\{)/,
      '$1$2\n  pk: primaryKey({ columns: [table.id] }),'
    );
  }

  // Replace array-based unique constraints
  content = content.replace(
    /([a-zA-Z]+):\s*\[([^\]]+)\]/g,
    (match, constraintName, columns) => {
      const constraintNameFormatted = constraintName.replace(/([A-Z])/g, '_$1').toLowerCase();
      return `${constraintName}: unique('${constraintNameFormatted}').on(${columns})`;
    }
  );

  // Write the updated content back to the file
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${filePath}`);
}

// Walk through all files in the schema directory
function walkDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (stat.isFile() && filePath.endsWith('.ts')) {
      processFile(filePath);
    }
  });
}

// Process all schema files
walkDir(schemaDir);
console.log('Migration script completed!');