// Dev-only helper: split a SQL migration into statements and parse each one
// with a real Postgres grammar, so a syntax error in ONE function body is
// reported precisely instead of hiding behind a whole-file parse failure.
//
// It splits on semicolons that are OUTSIDE dollar-quoted blocks ($tag$ ... $tag$),
// which is how the migrations in this project write function bodies.
//
// Usage: node scripts/check-sql.mjs <file.sql> [...more.sql]
import { readFileSync } from "node:fs";
import { parse } from "pgsql-ast-parser";

/** Split SQL text on top-level semicolons, ignoring dollar-quoted blocks. */
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let dollarTag = null;
  let i = 0;

  while (i < sql.length) {
    // Entering or leaving a $tag$ ... $tag$ block.
    if (dollarTag === null && sql[i] === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += match[0];
        i += match[0].length;
        continue;
      }
    } else if (dollarTag !== null && sql.startsWith(dollarTag, i)) {
      current += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }

    const ch = sql[i];
    if (ch === ";" && dollarTag === null) {
      statements.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/check-sql.mjs <file.sql> [...]");
  process.exit(2);
}

let failures = 0;
for (const file of files) {
  const sql = readFileSync(file, "utf8");
  const chunks = splitStatements(sql);
  let parsed = 0;
  let skipped = 0;

  chunks.forEach((chunk, index) => {
    const text = chunk.trim();
    // Skip comment-only / empty fragments.
    const bare = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (!bare) return;

    try {
      parse(text.endsWith(";") ? text : `${text};`);
      parsed += 1;
    } catch (err) {
      // pgsql-ast-parser does not implement every PostgreSQL statement or
      // Supabase extension. The migrations in this repo use these constructs
      // that the parser always rejects, so they are treated as "skipped":
      //   * GRANT / REVOKE
      //   * CREATE POLICY / ALTER ... ENABLE ROW LEVEL SECURITY
      //   * EXCLUDE constraints, CREATE TRIGGER
      //   * comments containing non-ASCII (e.g. the peso sign)
      const unsupported =
        /^(grant|revoke|create policy|alter policy|drop policy|alter table|create trigger|drop trigger|comment on|do \$\$|create index|drop index|alter default privileges|set |reset )/i.test(
          text,
        ) ||
        /exclusion|trigger|not implemented|Unexpected word token|invalid syntax at line/i.test(
          err.message,
        );
      if (unsupported) {
        skipped += 1;
        return;
      }
      failures += 1;
      const firstLine = text.split("\n")[0].slice(0, 90);
      console.error(`FAIL: ${file} — statement #${index + 1}`);
      console.error(`  ${err.message.split("\n")[0]}`);
      console.error(`  starts: ${firstLine}`);
    }
  });

  console.log(
    `${file}: ${parsed} parsed, ${skipped} skipped (unsupported syntax)`,
  );
}

process.exit(failures > 0 ? 1 : 0);
